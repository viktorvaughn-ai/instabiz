import frappe
from frappe import _
from frappe.utils import now_datetime, today


@frappe.whitelist()
def get_employees_with_status(search=None, department=None, status=None, limit=20, offset=0, date=None):
	"""
	Return paginated active employees with attendance status for the given date (default today).
	Filters are applied server-side.
	"""
	limit  = int(limit)
	offset = int(offset)
	if not date:
		date = today()

	filters = {"status": "Active"}
	if department:
		filters["department"] = department

	# Fetch all matching employees for count + checkin join (names only first)
	all_employees = frappe.get_all(
		"Employee",
		filters=filters,
		fields=["name", "employee_name", "designation", "department"],
		order_by="employee_name asc",
	)

	if not all_employees:
		return {"data": [], "total": 0}

	# Apply name/ID search
	if search:
		search_lower = search.lower()
		all_employees = [
			e for e in all_employees
			if search_lower in (e.employee_name or "").lower()
			or search_lower in (e.name or "").lower()
		]

	if not all_employees:
		return {"data": [], "total": 0}

	# Get today's checkins for all matching employees in one query
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
			emp["last_log_type"] = None
			emp["last_checkin_time"] = None
		elif any(r.log_type == "IN" for r in logs) and any(r.log_type == "OUT" for r in logs):
			emp["last_log_type"] = "DONE"
			emp["last_checkin_time"] = str(logs[-1].time)
		else:
			emp["last_log_type"] = logs[-1].log_type
			emp["last_checkin_time"] = str(logs[-1].time)

	# Apply status filter after checkin data is attached
	if status:
		status_map = {"In": "IN", "Out": "OUT", "Absent": None}
		status_key = status_map.get(status, status)
		if status_key:
			all_employees = [e for e in all_employees if e.last_log_type == status_key]
		else:
			# Absent = no checkin today
			all_employees = [e for e in all_employees if not e.last_log_type]

	total = len(all_employees)
	data  = all_employees[offset: offset + limit]

	return {"data": data, "total": total}


@frappe.whitelist()
def get_my_status():
	"""Return today's checkin status for the logged-in employee."""
	employee = _get_employee_for_user()

	rows = frappe.db.sql(
		"""
		SELECT log_type, time
		FROM `tabEmployee Checkin`
		WHERE employee = %(employee)s
		  AND DATE(time) = %(today)s
		ORDER BY time ASC
		""",
		{"employee": employee.name, "today": today()},
		as_dict=True,
	)

	if not rows:
		log_type = None
		last_time = None
	elif any(r.log_type == "IN" for r in rows) and any(r.log_type == "OUT" for r in rows):
		log_type = "DONE"
		last_time = str(rows[-1].time)
	else:
		log_type = rows[-1].log_type
		last_time = str(rows[-1].time)

	# Compute duration if currently checked in
	duration = None
	if log_type == "IN" and last_time:
		from frappe.utils import time_diff_in_seconds
		secs = time_diff_in_seconds(now_datetime(), rows[-1].time)
		h, m = divmod(int(secs) // 60, 60)
		duration = f"{h}h {m}m" if h else f"{m}m"

	return {
		"employee":       employee.name,
		"employee_name":  employee.employee_name,
		"log_type":       log_type,
		"last_checkin_time": last_time,
		"duration":       duration,
	}


@frappe.whitelist()
def self_checkin(log_type, latitude=None, longitude=None):
	"""Check in or out for the logged-in employee."""
	if log_type not in ("IN", "OUT"):
		frappe.throw(_("Invalid log_type"))

	employee = _get_employee_for_user()

	doc = frappe.get_doc({
		"doctype":   "Employee Checkin",
		"employee":  employee.name,
		"log_type":  log_type,
		"time":      now_datetime(),
		"device_id": "Self Service",
		"shift":     _get_default_shift(employee.name),
	})

	if latitude and longitude:
		doc.latitude  = float(latitude)
		doc.longitude = float(longitude)

	doc.insert(ignore_permissions=True)
	return {"log_type": log_type}


def _get_default_shift(employee):
	"""Return the employee's default_shift, or None if not set."""
	return frappe.db.get_value("Employee", employee, "default_shift")


def _get_employee_for_user():
	"""Resolve the active Employee linked to the current session user."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	employee = frappe.db.get_value(
		"Employee",
		{"user_id": frappe.session.user, "status": "Active"},
		["name", "employee_name"],
		as_dict=True,
	)
	if not employee:
		frappe.throw(_("No active Employee record linked to your account."))
	return employee


@frappe.whitelist()
def get_daily_attendance(date=None, department=None, search=None, limit=20, offset=0):
	"""
	Return one row per employee with their IN time, OUT time and work hours
	for the given date (defaults to today). Used by the Employee Checkin list view.
	"""
	limit  = int(limit)
	offset = int(offset)

	if not date:
		date = today()

	filters = {"status": "Active"}
	if department:
		filters["department"] = department

	all_employees = frappe.get_all(
		"Employee",
		filters=filters,
		fields=["name", "employee_name", "department", "designation"],
		order_by="employee_name asc",
	)

	if not all_employees:
		return {"data": [], "total": 0}

	if search:
		s = search.lower()
		all_employees = [
			e for e in all_employees
			if s in (e.employee_name or "").lower() or s in (e.name or "").lower()
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

	total = len(all_employees)
	paged = all_employees[offset: offset + limit]

	data = []
	for emp in paged:
		logs    = logs_by_emp.get(emp.name, [])
		in_time  = None
		out_time = None
		last_in  = None

		for log in logs:
			if log.log_type == "IN":
				if not in_time:
					in_time = log.time
				last_in = log.time
			elif log.log_type == "OUT":
				out_time = log.time   # keep last OUT

		if in_time and out_time:
			status = "OUT"
			delta  = (out_time - in_time).total_seconds()
			h, rem = divmod(int(delta), 3600)
			m      = rem // 60
			work_hours = f"{h}h {m}m" if h else f"{m}m"
		elif in_time:
			status     = "IN"
			work_hours = None
		else:
			status     = "Absent"
			work_hours = None

		data.append({
			"employee":      emp.name,
			"employee_name": emp.employee_name,
			"department":    emp.department or "—",
			"designation":   emp.designation or "—",
			"status":        status,
			"in_time":       str(in_time)  if in_time  else None,
			"out_time":      str(out_time) if out_time else None,
			"work_hours":    work_hours,
			"last_in":       str(last_in)  if last_in  else None,
		})

	return {"data": data, "total": total}


@frappe.whitelist()
def create_checkin(employee, log_type):
	"""Create an Employee Checkin record."""
	if log_type not in ("IN", "OUT"):
		frappe.throw(_("Invalid log_type"))

	frappe.get_doc({
		"doctype":   "Employee Checkin",
		"employee":  employee,
		"log_type":  log_type,
		"time":      now_datetime(),
		"device_id": "Attendance Terminal",
		"shift":     _get_default_shift(employee),
	}).insert()

	return {"log_type": log_type}


@frappe.whitelist()
def mark_absent(employee):
	"""Create a submitted Attendance record with status Absent for today."""
	from hrms.hr.doctype.attendance.attendance import mark_attendance

	attendance = mark_attendance(employee, today(), "Absent")
	if not attendance:
		frappe.throw(_("Could not mark absent. An attendance record may already exist for today."))

	return {"status": "Absent"}
