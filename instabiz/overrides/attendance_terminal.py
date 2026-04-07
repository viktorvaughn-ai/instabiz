import frappe
from frappe import _
from frappe.utils import now_datetime, today


@frappe.whitelist()
def get_employees_with_status(search=None, department=None, status=None, limit=20, offset=0, date=None):
	"""
	Return paginated active employees with attendance status for the given date (default today).
	"""
	limit  = int(limit)
	offset = int(offset)
	if not date:
		date = today()

	filters = {"status": "Active"}
	if department:
		filters["department"] = ["like", f"%{department}%"]

	all_employees = frappe.get_all(
		"Employee",
		filters=filters,
		fields=["name", "employee_name", "designation", "department"],
		order_by="employee_name asc",
	)

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
def create_checkin(employee, log_type):
	"""Create an Employee Checkin from the Attendance Terminal."""
	if log_type not in ("IN", "OUT"):
		frappe.throw(_("Invalid log_type"))

	shift = frappe.db.get_value("Employee", employee, "default_shift")

	frappe.get_doc({
		"doctype":   "Employee Checkin",
		"employee":  employee,
		"log_type":  log_type,
		"time":      now_datetime(),
		"device_id": "Attendance Terminal",
		"shift":     shift,
	}).insert()

	return {"log_type": log_type}


@frappe.whitelist()
def mark_absent(employee):
	"""Submit an Absent attendance record for today."""
	from hrms.hr.doctype.attendance.attendance import mark_attendance

	attendance = mark_attendance(employee, today(), "Absent")
	if not attendance:
		frappe.throw(_("Could not mark absent. An attendance record may already exist for today."))

	return {"status": "Absent"}
