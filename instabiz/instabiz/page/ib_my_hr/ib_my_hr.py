import frappe
from frappe import _
from frappe.utils import nowdate, getdate, get_first_day, get_last_day, flt, add_days, add_months


def get_context(context):
	context.no_cache = 1


def _get_employee():
	"""Return the Employee record for the current session user, or throw."""
	emp = frappe.db.get_value(
		"Employee",
		{"user_id": frappe.session.user, "status": "Active"},
		["name", "employee_name", "department", "designation", "date_of_joining", "image"],
		as_dict=True,
	)
	if not emp:
		frappe.throw(_("No active Employee record is linked to your account. Please contact HR."))
	return emp


# ── Data fetch ────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_my_hr_data(month=None):
	emp = _get_employee()
	today = getdate(nowdate())
	month_date = getdate(month) if month else today
	month_start = get_first_day(month_date)
	month_end = get_last_day(month_date)
	year_start = getdate(f"{today.year}-01-01")

	# ── Leave allocations for current year ────────────────────────────────────
	try:
		allocations = frappe.db.sql("""
			SELECT la.leave_type, la.total_leaves_allocated,
			       COALESCE(SUM(CASE WHEN app.status='Approved' AND app.docstatus=1 THEN app.total_leave_days ELSE 0 END), 0) AS used_days
			FROM `tabLeave Allocation` la
			LEFT JOIN `tabLeave Application` app
			       ON app.employee = la.employee
			      AND app.leave_type = la.leave_type
			      AND app.from_date >= la.from_date
			      AND app.to_date <= la.to_date
			WHERE la.employee = %s
			  AND la.docstatus = 1
			  AND la.from_date <= %s
			  AND la.to_date >= %s
			GROUP BY la.leave_type, la.total_leaves_allocated
			ORDER BY la.leave_type
		""", (emp.name, today, today), as_dict=True)
	except Exception:
		allocations = []

	for a in allocations:
		a["remaining"] = max(0, flt(a["total_leaves_allocated"]) - flt(a["used_days"]))

	# ── My leave applications ─────────────────────────────────────────────────
	try:
		leaves = frappe.db.sql("""
			SELECT name, leave_type, from_date, to_date,
			       total_leave_days, status, description
			FROM `tabLeave Application`
			WHERE employee = %s AND docstatus IN (0, 1)
			ORDER BY from_date DESC
			LIMIT 30
		""", (emp.name,), as_dict=True)
	except Exception:
		leaves = []

	# ── My attendance this month ──────────────────────────────────────────────
	try:
		attendance = frappe.db.sql("""
			SELECT attendance_date, status, in_time, out_time, late_entry, early_exit
			FROM `tabAttendance`
			WHERE employee = %s AND docstatus = 1
			  AND attendance_date BETWEEN %s AND %s
			ORDER BY attendance_date DESC
		""", (emp.name, month_start, month_end), as_dict=True)
	except Exception:
		attendance = []

	# ── Working day count for summary ─────────────────────────────────────────
	present = sum(1 for a in attendance if a.status in ("Present", "Work From Home"))
	absent = sum(1 for a in attendance if a.status == "Absent")
	on_leave = sum(1 for a in attendance if a.status == "On Leave")
	half_day = sum(1 for a in attendance if a.status == "Half Day")

	# ── My payslips (last 6 months) ───────────────────────────────────────────
	try:
		payslips = frappe.db.sql("""
			SELECT name, start_date, end_date, gross_pay, total_deduction, net_pay,
			       CASE docstatus WHEN 1 THEN 'Submitted' ELSE 'Draft' END AS slip_status
			FROM `tabSalary Slip`
			WHERE employee = %s AND docstatus IN (0, 1)
			  AND start_date >= %s
			ORDER BY start_date DESC
			LIMIT 6
		""", (emp.name, add_days(today, -180)), as_dict=True)
	except Exception:
		payslips = []

	# ── Pending leaves (awaiting approval) ───────────────────────────────────
	pending_count = sum(1 for l in leaves if l.status == "Open")

	return {
		"employee": emp,
		"allocations": allocations,
		"leaves": leaves,
		"attendance": attendance,
		"payslips": payslips,
		"summary": {
			"present": present,
			"absent": absent,
			"on_leave": on_leave,
			"half_day": half_day,
			"pending_leave_requests": pending_count,
		},
	}


@frappe.whitelist()
def get_leave_types():
	"""Return leave types the current employee has an allocation for."""
	emp = _get_employee()
	today = getdate(nowdate())
	rows = frappe.db.sql("""
		SELECT DISTINCT leave_type
		FROM `tabLeave Allocation`
		WHERE employee = %s AND docstatus = 1
		  AND from_date <= %s AND to_date >= %s
		ORDER BY leave_type
	""", (emp.name, today, today), as_dict=True)
	# Fall back to all leave types if no allocations (is_active field doesn't exist on Leave Type in HRMS v15)
	if not rows:
		rows = frappe.get_all("Leave Type", fields=["name as leave_type"], order_by="name asc")
	return [r.leave_type for r in rows]


@frappe.whitelist()
def apply_leave(leave_type, from_date, to_date, reason="", half_day=0, half_day_date=None):
	emp = _get_employee()
	half_day = int(half_day)

	if getdate(from_date) > getdate(to_date):
		frappe.throw(_("From Date cannot be after To Date."))
	if getdate(from_date) < getdate(nowdate()):
		frappe.throw(_("Cannot apply leave for a past date."))

	doc = frappe.get_doc({
		"doctype": "Leave Application",
		"employee": emp.name,
		"leave_type": leave_type,
		"from_date": from_date,
		"to_date": to_date,
		"description": reason or "",
		"half_day": half_day,
		"half_day_date": half_day_date if half_day else None,
		"status": "Open",
		"follow_via_email": 0,
	})
	doc.insert(ignore_permissions=True)
	try:
		doc.submit()
	except Exception as e:
		# Some leave types don't require submit — keep as draft if submit fails
		frappe.log_error("IB My HR: leave submit", str(e))

	frappe.db.commit()
	return {"name": doc.name, "status": doc.status, "docstatus": doc.docstatus}


@frappe.whitelist()
def generate_my_salary_slip(month=None):
	"""Employee self-service: generate my own Salary Slip for a completed
	month — same generation logic as the HR-only
	ib_hrms_dashboard.generate_single_slip, scoped strictly to the calling
	user's own Employee record (no manager role required, and a different
	user's employee id can never be passed in)."""
	emp = _get_employee()
	today = getdate(nowdate())
	month_date = getdate(month) if month else add_months(today, -1)
	month_start = get_first_day(month_date)
	month_end = get_last_day(month_date)

	if month_end >= today:
		frappe.throw(_("You can only generate a salary slip after that month has ended."))

	if not frappe.db.exists("Salary Structure Assignment", {"employee": emp.name, "docstatus": 1}):
		frappe.throw(_("No active Salary Structure Assignment found for you — contact HR to set up your base salary first."))

	existing = frappe.db.get_value("Salary Slip", {"employee": emp.name, "start_date": month_start})
	if existing:
		return {"status": "exists", "slip": existing}

	doc = frappe.get_doc({
		"doctype": "Salary Slip",
		"employee": emp.name,
		"posting_date": today,
		"start_date": month_start,
		"end_date": month_end,
	})
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return {"status": "created", "slip": doc.name, "net_pay": doc.net_pay}


@frappe.whitelist()
def cancel_leave(leave_id):
	"""Cancel own pending leave application."""
	emp = _get_employee()
	doc = frappe.get_doc("Leave Application", leave_id)
	if doc.employee != emp.name:
		frappe.throw(_("Not authorised."))
	if doc.status not in ("Open",):
		frappe.throw(_("Only pending (Open) leaves can be cancelled."))
	if doc.docstatus == 1:
		doc.cancel()
	else:
		doc.delete()
	frappe.db.commit()
	return {"status": "ok"}
