import frappe
from frappe import _
from frappe.utils import now_datetime, today

# Departments whose name contains any of these strings are "factory" employees.
# Everything else is treated as "office".
_FACTORY_KEYWORDS = ("factory",)

_PRIVILEGED_ROLES = {"System Manager", "HR Manager", "HR User"}


def _is_privileged():
	return bool(_PRIVILEGED_ROLES & set(frappe.get_roles(frappe.session.user)))


def _is_factory_dept(dept):
	dept_lower = (dept or "").lower()
	return any(kw in dept_lower for kw in _FACTORY_KEYWORDS)


def _user_employee_category():
	"""Return 'factory' or 'office' based on the logged-in user's own employee dept."""
	dept = frappe.db.get_value("Employee", {"user_id": frappe.session.user}, "department")
	return "factory" if _is_factory_dept(dept) else "office"


@frappe.whitelist()
def get_employees_with_status(search=None, department=None, employee_category=None, status=None, limit=20, offset=0, date=None):
	"""
	Return paginated active employees with attendance status for the given date (default today).
	employee_category: "office" | "factory" | None (all) — non-privileged users are forced to "office".
	"""
	limit  = int(limit)
	offset = int(offset)
	if not date:
		date = today()

	# Non-privileged users are locked to their own dept category (office or factory)
	if not _is_privileged():
		employee_category = _user_employee_category()

	filters = {"status": "Active"}
	if department:
		filters["department"] = ["like", f"%{department}%"]

	all_employees = frappe.get_all(
		"Employee",
		filters=filters,
		fields=["name", "employee_name", "designation", "department"],
		order_by="employee_name asc",
	)

	# Filter by office / factory category
	if employee_category == "office":
		all_employees = [e for e in all_employees if not _is_factory_dept(e.department)]
	elif employee_category == "factory":
		all_employees = [e for e in all_employees if _is_factory_dept(e.department)]

	if not all_employees:
		return {"data": [], "total": 0}

	if search:
		s = search.lower()
		all_employees = [
			e for e in all_employees
			if s in (e.employee_name or "").lower()
			or s in (e.name or "").lower()
		]

	if not all_employees:
		return {"data": [], "total": 0}

	emp_names = [e.name for e in all_employees]

	# Employees with a submitted Absent attendance today are excluded entirely
	absent_today = set(frappe.db.sql(
		"""
		SELECT employee FROM `tabAttendance`
		WHERE employee IN %(employees)s
		  AND attendance_date = %(date)s
		  AND status = 'Absent'
		  AND docstatus = 1
		""",
		{"employees": emp_names, "date": date},
		pluck="employee",
	))
	all_employees = [e for e in all_employees if e.name not in absent_today]

	if not all_employees:
		return {"data": [], "total": 0}

	emp_names = [e.name for e in all_employees]
	rows = frappe.db.sql(
		"""
		SELECT employee, log_type, time
		FROM `tabEmployee Checkin`
		WHERE employee IN %(employees)s
		  AND DATE(time) = %(date)s
		ORDER BY time ASC
		""",
		{"employees": emp_names, "date": date},
		as_dict=True,
	)

	# Fetch shift start/end times so frontend can detect late/early arrivals
	shift_rows = frappe.db.sql(
		"""
		SELECT e.name, st.start_time, st.end_time
		FROM `tabEmployee` e
		LEFT JOIN `tabShift Type` st ON st.name = e.default_shift
		WHERE e.name IN %(employees)s
		""",
		{"employees": emp_names},
		as_dict=True,
	)
	shift_map = {r.name: r for r in shift_rows}

	logs_by_emp = {}
	for r in rows:
		logs_by_emp.setdefault(r.employee, []).append(r)

	for emp in all_employees:
		logs = logs_by_emp.get(emp.name, [])
		if not logs:
			emp["last_log_type"]    = None
			emp["last_checkin_time"] = None
		elif any(r.log_type == "IN" for r in logs) and any(r.log_type == "OUT" for r in logs):
			emp["last_log_type"]    = "DONE"
			emp["last_checkin_time"] = str(logs[-1].time)
		else:
			emp["last_log_type"]    = logs[-1].log_type
			emp["last_checkin_time"] = str(logs[-1].time)

		shift = shift_map.get(emp.name, {})
		emp["shift_start_seconds"] = int(shift.get("start_time").total_seconds()) if shift.get("start_time") else None
		emp["shift_end_seconds"]   = int(shift.get("end_time").total_seconds())   if shift.get("end_time")   else None

	if status:
		status_map = {"In": "IN", "Out": "OUT", "Absent": None}
		status_key = status_map.get(status, status)
		if status_key:
			all_employees = [e for e in all_employees if e.last_log_type == status_key]
		else:
			all_employees = [e for e in all_employees if not e.last_log_type]

	total = len(all_employees)
	data  = all_employees[offset: offset + limit]

	return {"data": data, "total": total}


@frappe.whitelist()
def get_terminal_context():
	"""Return session-level caps so the frontend can show/hide the category filter."""
	privileged = _is_privileged()
	category   = None if privileged else _user_employee_category()
	return {"privileged": privileged, "category": category}


@frappe.whitelist()
def create_checkin(employee, log_type, late_reason=None):
	"""Create an Employee Checkin from the Attendance Terminal."""
	if log_type not in ("IN", "OUT"):
		frappe.throw(_("Invalid log_type"))

	shift = frappe.db.get_value("Employee", employee, "default_shift")

	doc = frappe.get_doc({
		"doctype":   "Employee Checkin",
		"employee":  employee,
		"log_type":  log_type,
		"time":      now_datetime(),
		"device_id": "Attendance Terminal",
		"shift":     shift,
	})
	if late_reason:
		doc.custom_late_reason = late_reason
	doc.insert(ignore_permissions=True)

	return {"log_type": log_type}


@frappe.whitelist()
def mark_absent(employee):
	"""Submit an Absent attendance record for today."""
	# Replicate mark_attendance() with ignore_permissions so terminal users
	# (who lack Attendance create/submit roles) can still mark absent.
	from hrms.hr.doctype.attendance.attendance import (
		DuplicateAttendanceError,
		OverlappingShiftAttendanceError,
	)

	savepoint = "ib_absent_creation"
	try:
		frappe.db.savepoint(savepoint)
		doc = frappe.new_doc("Attendance")
		doc.update({
			"employee":        employee,
			"attendance_date": today(),
			"status":          "Absent",
		})
		doc.insert(ignore_permissions=True)
		doc.submit()
	except (DuplicateAttendanceError, OverlappingShiftAttendanceError):
		frappe.db.rollback(save_point=savepoint)
		frappe.throw(_("Attendance already marked for this employee today."))

	return {"status": "Absent"}
