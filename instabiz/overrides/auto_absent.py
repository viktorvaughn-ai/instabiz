"""instabiz.overrides.auto_absent

Daily scheduler: mark absent for employees who have no attendance record
for the previous working day and are not on approved leave.

Skips: holidays (per employee holiday list), weekends (Sat/Sun),
       employees with docstatus != 1 (inactive/left).
"""
import frappe
from frappe.utils import add_days, get_weekday, getdate, nowdate


def run_auto_absent():
	yesterday = add_days(nowdate(), -1)
	weekday = get_weekday(yesterday)  # 0=Mon ... 6=Sun

	# Skip weekends
	if weekday in (5, 6):
		frappe.logger().info(f"[auto_absent] {yesterday} is weekend — skipping")
		return

	active_employees = frappe.db.get_all(
		"Employee",
		filters={"status": "Active", "docstatus": ["!=", 2]},
		fields=["name", "employee_name", "holiday_list"],
	)

	marked = 0
	for emp in active_employees:
		# Skip if it was a holiday for this employee
		if _is_holiday(yesterday, emp.holiday_list):
			continue

		# Skip if attendance already exists
		exists = frappe.db.exists("Attendance", {
			"employee": emp.name,
			"attendance_date": yesterday,
			"docstatus": ["!=", 2],
		})
		if exists:
			continue

		# Skip if on approved leave
		on_leave = frappe.db.exists("Leave Application", {
			"employee": emp.name,
			"from_date": ["<=", yesterday],
			"to_date": [">=", yesterday],
			"status": "Approved",
			"docstatus": 1,
		})
		if on_leave:
			continue

		doc = frappe.get_doc({
			"doctype": "Attendance",
			"employee": emp.name,
			"employee_name": emp.employee_name,
			"attendance_date": yesterday,
			"status": "Absent",
		})
		doc.insert(ignore_permissions=True)
		doc.submit()
		marked += 1

	if marked:
		frappe.db.commit()

	frappe.logger().info(f"[auto_absent] {yesterday}: marked {marked} employees absent")


def _is_holiday(date, holiday_list):
	if not holiday_list:
		return False
	return bool(frappe.db.exists("Holiday", {
		"parent": holiday_list,
		"holiday_date": date,
	}))
