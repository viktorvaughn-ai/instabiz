import frappe
from frappe import _
from frappe.utils import now_datetime, today


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
		log_type  = None
		last_time = None
	elif any(r.log_type == "IN" for r in rows) and any(r.log_type == "OUT" for r in rows):
		log_type  = "DONE"
		last_time = str(rows[-1].time)
	else:
		log_type  = rows[-1].log_type
		last_time = str(rows[-1].time)

	duration = None
	if log_type == "IN" and last_time:
		from frappe.utils import time_diff_in_seconds
		secs = time_diff_in_seconds(now_datetime(), rows[-1].time)
		h, m = divmod(int(secs) // 60, 60)
		duration = f"{h}h {m}m" if h else f"{m}m"

	return {
		"employee":          employee.name,
		"employee_name":     employee.employee_name,
		"log_type":          log_type,
		"last_checkin_time": last_time,
		"duration":          duration,
	}


@frappe.whitelist()
def self_checkin(log_type, latitude=None, longitude=None):
	"""Check in or out for the logged-in employee."""
	if log_type not in ("IN", "OUT"):
		frappe.throw(_("Invalid log_type"))

	employee = _get_employee_for_user()

	# Prevent consecutive duplicate log types (IN→IN or OUT→OUT)
	last = frappe.db.sql(
		"SELECT log_type FROM `tabEmployee Checkin`"
		" WHERE employee = %s AND DATE(time) = %s"
		" ORDER BY time DESC LIMIT 1",
		(employee.name, today()),
		as_dict=True,
	)
	if last and last[0].log_type == log_type:
		label = _("in") if log_type == "IN" else _("out")
		frappe.throw(_("You are already checked {0}.").format(label))

	shift    = frappe.db.get_value("Employee", employee.name, "default_shift")

	doc = frappe.get_doc({
		"doctype":   "Employee Checkin",
		"employee":  employee.name,
		"log_type":  log_type,
		"time":      now_datetime(),
		"device_id": "Self Service",
		"shift":     shift,
	})

	if latitude and longitude:
		doc.latitude  = float(latitude)
		doc.longitude = float(longitude)

	doc.insert(ignore_permissions=True)
	return {"log_type": log_type}


@frappe.whitelist()
def get_daily_attendance(date=None, department=None, search=None, limit=20, offset=0):
	"""
	Return one row per employee with IN time, OUT time and work hours
	for the given date. Used by the Employee Checkin list view.
	"""
	limit  = int(limit)
	offset = int(offset)
	if not date:
		date = today()

	filters = {"status": "Active"}
	if department and department.strip():
		filters["department"] = ["like", f"%{department.strip()}%"]

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
		logs     = logs_by_emp.get(emp.name, [])
		in_time  = None
		out_time = None
		last_in  = None

		for log in logs:
			if log.log_type == "IN":
				if not in_time:
					in_time = log.time
				last_in = log.time
			elif log.log_type == "OUT":
				out_time = log.time

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
