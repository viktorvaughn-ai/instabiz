import frappe
from frappe.utils import nowdate, getdate, get_first_day, get_last_day, flt

from instabiz.overrides.utils import build_multi_token_where_named


def get_context(context):
	context.no_cache = 1


@frappe.whitelist()
def get_hrms_data(month=None, att_search=None, att_status=None, leave_search=None,
				   leave_status=None, pay_search=None, pay_status=None,
				   att_offset=0, leave_offset=0, pay_offset=0, page_size=20):
	frappe.only_for(["HR Manager", "HR User", "Factory Management", "System Manager"])
	att_offset, leave_offset, pay_offset, page_size = int(att_offset), int(leave_offset), int(pay_offset), int(page_size)
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
		conditions = ["a.attendance_date BETWEEN %(month_start)s AND %(month_end)s", "a.docstatus=1"]
		params = {"month_start": month_start, "month_end": month_end}
		if att_status:
			conditions.append("a.status = %(att_status)s")
			params["att_status"] = att_status
		att_cond, att_extra = build_multi_token_where_named(["e.employee_name", "a.employee"], att_search, "att_tok")
		if att_cond:
			conditions.append(att_cond)
			params.update(att_extra)
		attendance_total = int(frappe.db.sql(f"""
			SELECT COUNT(*) FROM `tabAttendance` a
			LEFT JOIN `tabEmployee` e ON e.name=a.employee
			WHERE {' AND '.join(conditions)}
		""", params)[0][0])
		attendance_list = frappe.db.sql(f"""
			SELECT a.employee, e.employee_name, e.department, a.attendance_date,
				   a.status, a.in_time, a.out_time
			FROM `tabAttendance` a
			LEFT JOIN `tabEmployee` e ON e.name=a.employee
			WHERE {' AND '.join(conditions)}
			ORDER BY a.attendance_date DESC, a.employee
			LIMIT %(page_size)s OFFSET %(att_offset)s
		""", {**params, "page_size": page_size, "att_offset": att_offset}, as_dict=True)
	except Exception:
		attendance_list, attendance_total = [], 0

	# ── Leave applications ────────────────────────────────────────────────────
	try:
		# docstatus IN (0, 1), not just 1: a self-service Leave Application
		# stays Draft (docstatus=0) with status="Open" while pending approval
		# (see ib_my_hr.apply_leave / approve_leave/reject_leave below — HRMS's
		# own Leave Application refuses to be submitted while status="Open").
		# Filtering to docstatus=1 only would make every such pending request
		# invisible here, leaving the Approve/Reject buttons with nothing to
		# ever act on. docstatus=2 (Cancelled) stays excluded.
		conditions = ["la.docstatus IN (0, 1)"]
		params = {}
		if leave_status:
			conditions.append("la.status = %(leave_status)s")
			params["leave_status"] = leave_status
		else:
			conditions.append("la.status IN ('Open','Approved','Rejected')")
		leave_cond, leave_extra = build_multi_token_where_named(["e.employee_name", "la.employee"], leave_search, "leave_tok")
		if leave_cond:
			conditions.append(leave_cond)
			params.update(leave_extra)
		leave_total = int(frappe.db.sql(f"""
			SELECT COUNT(*) FROM `tabLeave Application` la
			LEFT JOIN `tabEmployee` e ON e.name=la.employee
			WHERE {' AND '.join(conditions)}
		""", params)[0][0])
		leave_list = frappe.db.sql(f"""
			SELECT la.name, la.employee, e.employee_name,
				   la.leave_type, la.from_date, la.to_date,
				   la.total_leave_days, la.status, la.description as reason
			FROM `tabLeave Application` la
			LEFT JOIN `tabEmployee` e ON e.name=la.employee
			WHERE {' AND '.join(conditions)}
			ORDER BY la.from_date DESC
			LIMIT %(page_size)s OFFSET %(leave_offset)s
		""", {**params, "page_size": page_size, "leave_offset": leave_offset}, as_dict=True)
	except Exception:
		leave_list, leave_total = [], 0

	# ── Salary slips MTD ──────────────────────────────────────────────────────
	try:
		conditions = ["ss.docstatus < 2", "ss.start_date BETWEEN %(month_start)s AND %(month_end)s"]
		params = {"month_start": month_start, "month_end": month_end}
		if pay_status:
			conditions.append("ss.docstatus = %(pay_docstatus)s")
			params["pay_docstatus"] = 1 if pay_status == "Submitted" else 0
		pay_cond, pay_extra = build_multi_token_where_named(["e.employee_name", "ss.employee"], pay_search, "pay_tok")
		if pay_cond:
			conditions.append(pay_cond)
			params.update(pay_extra)
		pay_total = int(frappe.db.sql(f"""
			SELECT COUNT(*) FROM `tabSalary Slip` ss
			LEFT JOIN `tabEmployee` e ON e.name=ss.employee
			WHERE {' AND '.join(conditions)}
		""", params)[0][0])
		# Submitted/draft summary must reflect the full filtered set, not just
		# the current page — otherwise it flickers per-page once real
		# pagination replaces the old "cap at 100, sum in JS" approach.
		pay_summary_row = frappe.db.sql(f"""
			SELECT
				SUM(CASE WHEN ss.docstatus=1 THEN 1 ELSE 0 END) AS submitted_count,
				SUM(CASE WHEN ss.docstatus=0 THEN 1 ELSE 0 END) AS draft_count,
				COALESCE(SUM(CASE WHEN ss.docstatus=1 THEN ss.net_pay ELSE 0 END), 0) AS submitted_net_total
			FROM `tabSalary Slip` ss
			LEFT JOIN `tabEmployee` e ON e.name=ss.employee
			WHERE {' AND '.join(conditions)}
		""", params, as_dict=True)[0]
		pay_submitted_count = int(pay_summary_row.submitted_count or 0)
		pay_draft_count = int(pay_summary_row.draft_count or 0)
		pay_submitted_net_total = flt(pay_summary_row.submitted_net_total)
		salary_slips = frappe.db.sql(f"""
			SELECT ss.name, ss.employee, e.employee_name,
				   ss.gross_pay, ss.total_deduction, ss.net_pay, ss.start_date,
				   CASE ss.docstatus WHEN 1 THEN 'Submitted' ELSE 'Draft' END as slip_status
			FROM `tabSalary Slip` ss
			LEFT JOIN `tabEmployee` e ON e.name=ss.employee
			WHERE {' AND '.join(conditions)}
			ORDER BY ss.net_pay DESC
			LIMIT %(page_size)s OFFSET %(pay_offset)s
		""", {**params, "page_size": page_size, "pay_offset": pay_offset}, as_dict=True)
	except Exception:
		salary_slips, pay_total = [], 0
		pay_submitted_count = pay_draft_count = 0
		pay_submitted_net_total = 0

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
		"attendance_total": attendance_total,
		"leaves": leave_list,
		"leave_total": leave_total,
		"salary_slips": salary_slips,
		"pay_total": pay_total,
		"pay_submitted_count": pay_submitted_count,
		"pay_draft_count": pay_draft_count,
		"pay_submitted_net_total": pay_submitted_net_total,
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
def generate_single_slip(employee, month=None, notify=1):
	"""Create (or fetch) one employee's Salary Slip for the given month and
	bell-notify them. Used by the HR Dashboard's per-person payroll action."""
	frappe.only_for(["HR Manager", "HR User", "System Manager"])
	today = getdate(nowdate())
	month_date = getdate(month) if month else today
	month_start = get_first_day(month_date)
	month_end = get_last_day(month_date)

	if not frappe.db.exists("Salary Structure Assignment", {"employee": employee, "docstatus": 1}):
		frappe.throw(f"{employee} has no active Salary Structure Assignment — set a base salary first.")

	existing = frappe.db.get_value("Salary Slip", {"employee": employee, "start_date": month_start})
	if existing:
		return {"status": "exists", "slip": existing}

	doc = frappe.get_doc({
		"doctype": "Salary Slip",
		"employee": employee,
		"posting_date": today,
		"start_date": month_start,
		"end_date": month_end,
	})
	doc.insert(ignore_permissions=True)
	frappe.db.commit()

	if frappe.utils.cint(notify):
		user_id = frappe.db.get_value("Employee", employee, "user_id")
		if user_id:
			frappe.get_doc({
				"doctype": "Notification Log",
				"subject": f"Your salary slip for {month_start.strftime('%B %Y')} is ready",
				"email_content": f"Salary Slip {doc.name} has been generated — net pay {frappe.utils.fmt_money(doc.net_pay, precision=2)}.",
				"for_user": user_id,
				"from_user": frappe.session.user,
				"type": "Alert",
				"document_type": "Salary Slip",
				"document_name": doc.name,
			}).insert(ignore_permissions=True)
			frappe.db.commit()

	return {"status": "created", "slip": doc.name, "net_pay": doc.net_pay}


@frappe.whitelist()
def approve_leave(leave_id):
	frappe.only_for(["HR Manager", "System Manager"])
	doc = frappe.get_doc("Leave Application", leave_id)
	# HRMS's Leave Application only creates its Leave Ledger Entry (the actual
	# balance deduction) inside on_submit() — a raw frappe.db.set_value() on
	# `status` bypasses Document events entirely (see CLAUDE.md "Frappe /
	# ERPNext Gotchas"), so the previous version here could mark a leave
	# "Approved" while never touching the employee's real leave balance.
	# Confirmed live: this whole self-service apply→approve pipeline had never
	# processed a single leave end-to-end (see ib_my_hr.apply_leave fix,
	# same session) — every existing real Leave Application was created via
	# the native HRMS form instead, which sets status before submit.
	if doc.docstatus == 0:
		if doc.status != "Open":
			frappe.throw(f"Cannot approve leave in status '{doc.status}'")
		doc.status = "Approved"
		doc.submit()  # HRMS on_submit(): validates, creates Leave Ledger Entry, notifies employee
	elif doc.docstatus == 1:
		# Already submitted — HRMS's own doctype has no post-submit transition
		# for `status` (permlevel=1, no allow_on_submit), so there is nothing
		# safe to do here via the framework; a doc reaching this branch is
		# already in whatever state it was submitted with.
		if doc.status != "Approved":
			frappe.throw(
				f"Leave {leave_id} is already submitted with status '{doc.status}' — "
				"it cannot be re-approved. Cancel and re-create it if this is wrong."
			)
	else:
		frappe.throw(f"Cannot approve a cancelled leave application ({leave_id}).")
	frappe.db.commit()
	return {"status": "ok"}


@frappe.whitelist()
def reject_leave(leave_id):
	frappe.only_for(["HR Manager", "System Manager"])
	doc = frappe.get_doc("Leave Application", leave_id)
	if doc.docstatus == 0:
		if doc.status != "Open":
			frappe.throw(f"Cannot reject leave in status '{doc.status}'")
		doc.status = "Rejected"
		doc.submit()  # on_submit() allows Rejected; no ledger entry created for a rejection
	elif doc.docstatus == 1:
		if doc.status != "Rejected":
			frappe.throw(
				f"Leave {leave_id} is already submitted with status '{doc.status}' — "
				"it cannot be re-rejected."
			)
	else:
		frappe.throw(f"Cannot reject a cancelled leave application ({leave_id}).")
	frappe.db.commit()
	return {"status": "ok"}
