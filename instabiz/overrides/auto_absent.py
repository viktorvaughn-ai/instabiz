"""instabiz.overrides.auto_absent

Daily scheduler: mark absent for employees who have no attendance record
for the previous working day and are not on approved leave.

Skips: holidays (per employee holiday list), weekends (Sat/Sun),
       employees with docstatus != 1 (inactive/left),
       factory employees (dept contains "Factory" — their attendance comes
       from biometric device and must be imported/entered manually).
"""
import frappe
from frappe.utils import add_days, get_weekday, nowdate, getdate

# Departments excluded from auto-absent (biometric / manual attendance)
_FACTORY_DEPT_KEYWORD = "Factory"


def _is_factory_employee(department):
    return department and _FACTORY_DEPT_KEYWORD.lower() in (department or "").lower()


def run_auto_absent():
	yesterday = add_days(nowdate(), -1)
	weekday = get_weekday(getdate(yesterday))  # 0=Mon ... 6=Sun

	# Skip weekends
	if weekday in (5, 6):
		frappe.logger().info(f"[auto_absent] {yesterday} is weekend — skipping")
		return

	active_employees = frappe.db.get_all(
		"Employee",
		filters={"status": "Active", "docstatus": ["!=", 2]},
		fields=["name", "employee_name", "holiday_list", "department"],
	)

	marked = 0
	skipped_factory = 0
	skipped_checkin = 0
	errors = 0
	for emp in active_employees:
		# Savepoint, not a full rollback — a full frappe.db.rollback() here would
		# also discard every OTHER employee's already-inserted (but not yet
		# committed) Attendance doc from earlier in this same loop.
		save_point = f"auto_absent_{emp.name}"
		frappe.db.savepoint(save_point)
		try:
			# Skip factory employees — biometric attendance, do not auto-absent
			if _is_factory_employee(emp.department):
				skipped_factory += 1
				continue

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

			# Skip if a real check-in punch exists that day — regardless of whether
			# HRMS's own shift resolution (Employee Checkin -> shift assignment)
			# managed to convert it to a Present Attendance yet. Without this guard,
			# employees with no default_shift/Shift Assignment (or whose punch falls
			# outside their shift window) get silently marked Absent here even
			# though they physically checked in — confirmed live for 4 employees
			# with clean daily terminal punches marked Absent every working day.
			has_checkin = frappe.db.exists("Employee Checkin", {
				"employee": emp.name,
				"time": ["between", [f"{yesterday} 00:00:00", f"{yesterday} 23:59:59"]],
				"log_type": "IN",
			})
			if has_checkin:
				skipped_checkin += 1
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
		except Exception:
			# One bad record must not silently zero out the whole day's run —
			# previously a single unhandled exception (e.g. OverlappingShiftAttendanceError,
			# a concurrently-inserted Attendance) rolled back everything with no trace.
			errors += 1
			frappe.log_error(
				title=f"auto_absent: failed for {emp.name} on {yesterday}",
				message=frappe.get_traceback(),
			)
			frappe.db.rollback(save_point=save_point)
			continue

	if marked:
		frappe.db.commit()

	frappe.logger().info(
		f"[auto_absent] {yesterday}: marked {marked} absent, skipped {skipped_factory} factory, "
		f"skipped {skipped_checkin} with a real check-in, {errors} errors"
	)


def _is_holiday(date, holiday_list):
	if not holiday_list:
		return False
	return bool(frappe.db.exists("Holiday", {
		"parent": holiday_list,
		"holiday_date": date,
	}))
