import frappe
from frappe.utils import nowdate, getdate, get_first_day, get_last_day, flt


def get_context(context):
	context.no_cache = 1


@frappe.whitelist()
def get_hrms_data(month=None):
	frappe.only_for(["HR Manager", "HR User", "Factory Management", "System Manager"])
	today = getdate(nowdate())
	month_date = getdate(month) if month else today
	month_start = get_first_day(month_date)
	month_end = get_last_day(month_date)

	# ── Employees ─────────────────────────────────────────────────────────────
	try:
		total_emp = flt(frappe.db.sql(
			"SELECT COUNT(*) FROM `tabEmployee` WHERE status='Active'"
		)[0][0])
	except Exception:
		total_emp = 0

	# ── Attendance today ──────────────────────────────────────────────────────
	try:
		present_today = flt(frappe.db.sql("""
			SELECT COUNT(DISTINCT employee) FROM (
				SELECT employee FROM `tabEmployee Checkin`
				WHERE DATE(time) = %s AND log_type = 'IN'
				UNION
				SELECT employee FROM `tabAttendance`
				WHERE attendance_date = %s AND status = 'Present' AND docstatus = 1
			) _combined
		""", (today, today))[0][0])
		absent_today = flt(frappe.db.sql(
			"SELECT COUNT(*) FROM `tabAttendance` WHERE attendance_date=%s AND status='Absent' AND docstatus=1",
			(today,)
		)[0][0])
	except Exception:
		present_today = absent_today = 0

	# ── Pending leaves ────────────────────────────────────────────────────────
	try:
		pending_leaves = flt(frappe.db.sql(
			"SELECT COUNT(*) FROM `tabLeave Application` WHERE status='Open' AND docstatus=1"
		)[0][0])
	except Exception:
		pending_leaves = 0

	# ── Payroll MTD ───────────────────────────────────────────────────────────
	try:
		payroll_row = frappe.db.sql("""
			SELECT
				COALESCE(SUM(CASE WHEN docstatus=1 THEN net_pay ELSE 0 END), 0) AS submitted_net,
				COALESCE(SUM(CASE WHEN docstatus=0 THEN net_pay ELSE 0 END), 0) AS draft_net,
				COALESCE(SUM(CASE WHEN docstatus=0 THEN 1 ELSE 0 END), 0)       AS draft_count,
				COALESCE(SUM(CASE WHEN docstatus=1 THEN 1 ELSE 0 END), 0)       AS submitted_count
			FROM `tabSalary Slip`
			WHERE docstatus < 2
			AND start_date BETWEEN %s AND %s
		""", (month_start, month_end))[0]
		payroll_mtd             = flt(payroll_row[0]) or flt(payroll_row[1])
		payroll_draft_count     = int(payroll_row[2])
		payroll_submitted_count = int(payroll_row[3])
		payroll_is_draft        = flt(payroll_row[0]) == 0 and flt(payroll_row[1]) > 0
	except Exception:
		payroll_mtd = payroll_draft_count = payroll_submitted_count = 0
		payroll_is_draft = False

	# ── Attendance for month ──────────────────────────────────────────────────
	try:
		attendance_list = frappe.db.sql("""
			SELECT a.employee, e.employee_name, a.attendance_date,
				   a.status, a.in_time, a.out_time
			FROM `tabAttendance` a
			LEFT JOIN `tabEmployee` e ON e.name=a.employee
			WHERE a.attendance_date >= %s AND a.docstatus=1
			ORDER BY a.attendance_date DESC, a.employee
			LIMIT 50
		""", (month_start,), as_dict=True)
	except Exception:
		attendance_list = []

	# ── Leave applications ────────────────────────────────────────────────────
	try:
		leave_list = frappe.db.sql("""
			SELECT la.name, la.employee, e.employee_name,
				   la.leave_type, la.from_date, la.to_date,
				   la.total_leave_days, la.status, la.description as reason
			FROM `tabLeave Application` la
			LEFT JOIN `tabEmployee` e ON e.name=la.employee
			WHERE la.docstatus=1 AND la.status IN ('Open','Approved')
			ORDER BY la.from_date DESC
			LIMIT 30
		""", as_dict=True)
	except Exception:
		leave_list = []

	# ── Salary slips MTD ──────────────────────────────────────────────────────
	try:
		salary_slips = frappe.db.sql("""
			SELECT ss.name, ss.employee, e.employee_name,
				   ss.gross_pay, ss.total_deduction, ss.net_pay, ss.start_date,
				   CASE ss.docstatus WHEN 1 THEN 'Submitted' ELSE 'Draft' END as slip_status
			FROM `tabSalary Slip` ss
			LEFT JOIN `tabEmployee` e ON e.name=ss.employee
			WHERE ss.docstatus < 2 AND ss.start_date BETWEEN %s AND %s
			ORDER BY ss.net_pay DESC
			LIMIT 20
		""", (month_start, month_end), as_dict=True)
	except Exception:
		salary_slips = []

	# ── Department headcount ──────────────────────────────────────────────────
	try:
		by_dept = frappe.db.sql("""
			SELECT department as label, COUNT(*) as count
			FROM `tabEmployee` WHERE status='Active' AND department IS NOT NULL
			GROUP BY department ORDER BY count DESC
		""", as_dict=True)
	except Exception:
		by_dept = []

	# ── Designation (job role) headcount ─────────────────────────────────────
	try:
		by_designation = frappe.db.sql("""
			SELECT designation as label, COUNT(*) as count
			FROM `tabEmployee` WHERE status='Active' AND designation IS NOT NULL
			GROUP BY designation ORDER BY count DESC
		""", as_dict=True)
	except Exception:
		by_designation = []

	return {
		"total_emp": int(total_emp),
		"present_today": int(present_today),
		"absent_today": int(absent_today),
		"pending_leaves": int(pending_leaves),
		"payroll_mtd": payroll_mtd,
		"payroll_draft_count": payroll_draft_count,
		"payroll_submitted_count": payroll_submitted_count,
		"payroll_is_draft": payroll_is_draft,
		"attendance": attendance_list,
		"leaves": leave_list,
		"salary_slips": salary_slips,
		"by_dept": by_dept,
		"by_designation": by_designation,
	}


@frappe.whitelist()
def get_payroll_audit(month=None):
	"""Per-employee payroll verification: slip vs actual attendance."""
	frappe.only_for(["HR Manager", "System Manager", "HR User"])
	today = getdate(nowdate())
	month_date = getdate(month) if month else today
	month_start = get_first_day(month_date)
	month_end = get_last_day(month_date)

	rows = frappe.db.sql("""
		SELECT
			ss.name        AS slip_name,
			ss.employee,
			e.employee_name,
			e.department,
			ss.salary_structure,
			ss.total_working_days,
			ss.payment_days,
			ss.absent_days   AS slip_absent,
			ss.leave_without_pay AS slip_lwp,
			ss.gross_pay,
			ss.net_pay,
			ss.docstatus,
			COALESCE(att.att_count, 0)    AS att_records,
			COALESCE(att.actual_present, 0) AS actual_present,
			COALESCE(att.actual_absent, 0)  AS actual_absent,
			COALESCE(att.actual_half, 0)    AS actual_half
		FROM `tabSalary Slip` ss
		JOIN `tabEmployee` e ON e.name = ss.employee
		LEFT JOIN (
			SELECT employee,
				COUNT(*)                                                   AS att_count,
				SUM(CASE WHEN status='Present' THEN 1 ELSE 0 END)         AS actual_present,
				SUM(CASE WHEN status='Absent'  THEN 1 ELSE 0 END)         AS actual_absent,
				SUM(CASE WHEN status='Half Day' THEN 0.5 ELSE 0 END)      AS actual_half
			FROM `tabAttendance`
			WHERE attendance_date BETWEEN %s AND %s AND docstatus = 1
			GROUP BY employee
		) att ON att.employee = ss.employee
		WHERE ss.docstatus < 2
		  AND ss.start_date = %s AND ss.end_date = %s
		ORDER BY e.department, e.employee_name
	""", (month_start, month_end, month_start, month_end), as_dict=True)

	result = []
	for r in rows:
		abs_slip = flt(r.slip_absent)
		abs_att  = flt(r.actual_absent) + flt(r.actual_half)
		net_pay  = flt(r.net_pay)
		is_factory = "Factory" in (r.department or "")
		att_count  = int(r.att_records or 0)

		if att_count == 0:
			status = "NO ATT DATA"
		elif net_pay <= 0 and flt(r.gross_pay) > 0:
			status = "ZERO NET PAY"
		elif abs(abs_slip - abs_att) > 1:
			status = "MISMATCH"
		else:
			status = "OK"

		result.append({
			"slip_name":       r.slip_name,
			"employee":        r.employee,
			"employee_name":   r.employee_name or "",
			"department":      r.department or "",
			"salary_structure":r.salary_structure or "",
			"emp_type":        "Factory" if is_factory else "Office",
			"working_days":    int(r.total_working_days or 0),
			"payment_days":    flt(r.payment_days),
			"slip_absent":     abs_slip,
			"att_records":     att_count,
			"actual_absent":   abs_att,
			"gross_pay":       flt(r.gross_pay),
			"net_pay":         net_pay,
			"slip_status":     "Submitted" if r.docstatus == 1 else "Draft",
			"status":          status,
		})

	ok   = sum(1 for r in result if r["status"] == "OK")
	issues = len(result) - ok
	return {"rows": result, "ok": ok, "issues": issues, "period": month_start.strftime("%B %Y")}


@frappe.whitelist()
def approve_leave(leave_id):
	frappe.only_for(["HR Manager", "System Manager"])
	doc = frappe.get_doc("Leave Application", leave_id)
	if doc.status not in ("Open", "Approved"):
		frappe.throw(f"Cannot approve leave in status '{doc.status}'")
	# Leave Applications are already submitted (docstatus=1); update status in-place
	frappe.db.set_value("Leave Application", leave_id, "status", "Approved")
	frappe.db.commit()
	return {"status": "ok"}


@frappe.whitelist()
def reject_leave(leave_id):
	frappe.only_for(["HR Manager", "System Manager"])
	doc = frappe.get_doc("Leave Application", leave_id)
	if doc.status not in ("Open", "Approved"):
		frappe.throw(f"Cannot reject leave in status '{doc.status}'")
	frappe.db.set_value("Leave Application", leave_id, "status", "Rejected")
	frappe.db.commit()
	return {"status": "ok"}
