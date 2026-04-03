import frappe
from frappe import _
from frappe.utils import now_datetime, today


@frappe.whitelist()
def get_employees_with_status():
	"""
	Return active employees with today's attendance status.
	last_log_type values:
	  None   — no checkin today
	  "IN"   — checked in, not yet out
	  "DONE" — completed (had both IN and OUT) — filtered out by frontend
	"""
	employees = frappe.get_all(
		"Employee",
		filters={"status": "Active"},
		fields=["name", "employee_name", "designation", "department"],
		order_by="employee_name asc",
	)

	if not employees:
		return []

	emp_names = [e.name for e in employees]

	# Get all of today's checkins per employee (ordered asc to track sequence)
	rows = frappe.db.sql(
		"""
		SELECT employee, log_type, time
		FROM `tabEmployee Checkin`
		WHERE employee IN %(employees)s
		  AND DATE(time) = %(today)s
		ORDER BY time ASC
		""",
		{"employees": emp_names, "today": today()},
		as_dict=True,
	)

	# Build per-employee log sequence
	logs_by_emp = {}
	for r in rows:
		logs_by_emp.setdefault(r.employee, []).append(r)

	for emp in employees:
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

	return employees


@frappe.whitelist()
def create_checkin(employee, log_type):
	"""Create an Employee Checkin record."""
	if log_type not in ("IN", "OUT"):
		frappe.throw(_("Invalid log_type"))

	frappe.get_doc({
		"doctype": "Employee Checkin",
		"employee": employee,
		"log_type": log_type,
		"time": now_datetime(),
		"device_id": "Attendance Terminal",
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
