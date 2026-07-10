"""
instabiz.overrides.payroll — monthly payroll automation.

run_monthly_payroll_draft() fires daily; on the 7th of each month it creates
draft Salary Slips for all active employees for the previous month (if they
don't already exist), then sends a bell notification to HR Manager to review
and submit.

Can also be triggered manually from the HR Dashboard via trigger_payroll_draft().
"""
import frappe
from frappe import _
from frappe.utils import nowdate, getdate, get_first_day, get_last_day, add_months


def _prev_month_range():
    """Return (start, end) for the previous calendar month."""
    today = getdate(nowdate())
    prev_month = add_months(today, -1)
    return get_first_day(prev_month), get_last_day(prev_month)


def _hr_manager():
    rows = frappe.db.sql("""
        SELECT DISTINCT hr.parent FROM `tabHas Role` hr
        JOIN `tabUser` u ON u.name = hr.parent
        WHERE hr.role = 'HR Manager' AND hr.parenttype = 'User'
          AND u.enabled = 1 AND hr.parent NOT IN ('Administrator', 'Guest')
        LIMIT 1
    """, as_dict=True)
    return rows[0].parent if rows else "Administrator"


def run_monthly_payroll_draft():
    """Daily scheduler hook.

    Day 1: create draft salary slips for all active employees for the previous month.
    Day 5: auto-submit all remaining drafts for the previous month (fire-and-forget).
    Both steps skip if already done (idempotent guards inside helpers).
    """
    today = getdate(nowdate())
    if today.day == 1:
        _create_payroll_drafts(triggered_by="schedule")
    elif today.day == 5:
        _auto_submit_prev_month()


def _auto_submit_prev_month():
    """Submit all draft salary slips for the previous month. Called on day 5."""
    start, end = _prev_month_range()
    drafts = frappe.db.sql("""
        SELECT name FROM `tabSalary Slip`
        WHERE start_date = %s AND end_date = %s AND docstatus = 0
    """, (start, end), as_dict=True)

    if not drafts:
        return

    submitted = 0
    errors = []
    for d in drafts:
        try:
            doc = frappe.get_doc("Salary Slip", d.name)
            doc.run_method("calculate_net_pay")
            doc.submit()
            frappe.db.commit()
            submitted += 1
        except Exception as e:
            frappe.db.rollback()
            errors.append({"name": d.name, "error": str(e)})
            frappe.log_error(f"IB Payroll auto-submit {d.name}", str(e))

    period_label = start.strftime("%B %Y")
    hr_user = _hr_manager()
    msg = f"Auto-submitted {submitted} salary slips for {period_label}"
    if errors:
        msg += f". {len(errors)} failed — check Error Log."
    frappe.get_doc({
        "doctype": "Notification Log",
        "subject": f"[ib-payroll-autosubmit-{start}] {msg}",
        "email_content": f"<p>{msg}</p>",
        "for_user": hr_user,
        "type": "Alert",
        "from_user": "Administrator",
    }).insert(ignore_permissions=True)
    frappe.db.commit()


@frappe.whitelist()
def trigger_payroll_draft(month=None):
    """Manual trigger from HR Dashboard — creates drafts for a specific month."""
    frappe.only_for(["HR Manager", "System Manager"])
    if month:
        month_date = getdate(month)
        start = get_first_day(month_date)
        end = get_last_day(month_date)
    else:
        start, end = _prev_month_range()
    result = _create_payroll_drafts(triggered_by="manual", start=start, end=end)
    return result


def _create_payroll_drafts(triggered_by="schedule", start=None, end=None):
    if start is None or end is None:
        start, end = _prev_month_range()

    period_label = start.strftime("%B %Y")

    employees = frappe.db.sql("""
        SELECT name, employee_name, department
        FROM `tabEmployee`
        WHERE status = 'Active'
        ORDER BY employee_name
    """, as_dict=True)

    created = []
    skipped = []
    no_structure = []
    errors = []

    company = frappe.db.get_single_value("Global Defaults", "default_company")

    for emp in employees:
        # Skip if slip already exists for this period
        existing = frappe.db.exists("Salary Slip", {
            "employee": emp.name,
            "start_date": start,
            "end_date": end,
            "docstatus": ["in", [0, 1]],
        })
        if existing:
            skipped.append(emp.name)
            continue

        # Pre-check salary structure assignment to avoid frappe.throw() leaking into message_log
        has_structure = frappe.db.get_value(
            "Salary Structure Assignment",
            {"employee": emp.name, "from_date": ["<=", start], "docstatus": 1},
            "salary_structure",
            order_by="from_date desc",
        )
        if not has_structure:
            no_structure.append(emp.employee_name or emp.name)
            continue

        try:
            ss = frappe.get_doc({
                "doctype": "Salary Slip",
                "employee": emp.name,
                "start_date": start,
                "end_date": end,
                "company": company,
            })
            ss.insert(ignore_permissions=True)
            ss.run_method("calculate_net_pay")
            ss.save(ignore_permissions=True)
            frappe.db.commit()
            created.append(emp.name)
        except Exception as e:
            frappe.db.rollback()
            frappe.message_log.clear()  # prevent throw() messages leaking to client
            errors.append({"employee": emp.name, "error": str(e)})
            frappe.log_error(f"IB Payroll: slip create {emp.name}", str(e))

    # Notify HR Manager
    hr_user = _hr_manager()
    summary_parts = [f"Payroll draft for {period_label}: {len(created)} slips created"]
    if skipped:
        summary_parts.append(f"{len(skipped)} already existed")
    if no_structure:
        summary_parts.append(f"{len(no_structure)} skipped (no salary structure): {', '.join(no_structure)}")
    if errors:
        summary_parts.append(f"{len(errors)} errors — check Error Log")
    summary = ". ".join(summary_parts) + ". Please review and submit."

    frappe.get_doc({
        "doctype": "Notification Log",
        "subject": f"[ib-payroll-{start}] Payroll Drafts Ready: {period_label}",
        "email_content": f"<p>{summary}</p>",
        "for_user": hr_user,
        "type": "Alert",
        "from_user": "Administrator",
    }).insert(ignore_permissions=True)
    frappe.db.commit()

    return {
        "period": period_label,
        "created": len(created),
        "skipped": len(skipped),
        "no_structure": no_structure,
        "errors": errors,
        "summary": summary,
    }


@frappe.whitelist()
def get_payroll_status(month=None):
    """Return payroll completion status for a given month."""
    frappe.only_for(["HR Manager", "System Manager", "HR User"])
    if month:
        month_date = getdate(month)
        start = get_first_day(month_date)
        end = get_last_day(month_date)
    else:
        start, end = _prev_month_range()

    total_active = frappe.db.count("Employee", {"status": "Active"})

    rows = frappe.db.sql("""
        SELECT ss.name, ss.employee, e.employee_name, e.department,
               ss.gross_pay, ss.total_deduction, ss.net_pay,
               CASE ss.docstatus WHEN 1 THEN 'Submitted' ELSE 'Draft' END AS slip_status,
               ss.docstatus
        FROM `tabSalary Slip` ss
        JOIN `tabEmployee` e ON e.name = ss.employee
        WHERE ss.start_date = %s AND ss.end_date = %s AND ss.docstatus < 2
        ORDER BY e.department, e.employee_name
    """, (start, end), as_dict=True)

    submitted = sum(1 for r in rows if r.docstatus == 1)
    pending = len(rows) - submitted
    missing = total_active - len(rows)
    total_net = sum(float(r.net_pay or 0) for r in rows if r.docstatus == 1)

    return {
        "period": start.strftime("%B %Y"),
        "period_start": str(start),
        "period_end": str(end),
        "total_active": total_active,
        "slips_created": len(rows),
        "submitted": submitted,
        "pending_draft": pending,
        "missing": missing,
        "total_net_pay": total_net,
        "slips": rows,
    }


@frappe.whitelist()
def submit_all_drafts(month_start):
    """Submit all draft salary slips for a given period."""
    frappe.only_for(["HR Manager", "System Manager"])
    month_date = getdate(month_start)
    start = get_first_day(month_date)
    end = get_last_day(month_date)

    drafts = frappe.db.sql("""
        SELECT name FROM `tabSalary Slip`
        WHERE start_date = %s AND end_date = %s AND docstatus = 0
    """, (start, end), as_dict=True)

    submitted = 0
    errors = []
    for d in drafts:
        try:
            doc = frappe.get_doc("Salary Slip", d.name)
            doc.run_method("calculate_net_pay")
            doc.save(ignore_permissions=True)
            doc.submit()
            frappe.db.commit()
            submitted += 1
        except Exception as e:
            frappe.db.rollback()
            errors.append({"name": d.name, "error": str(e)})
            frappe.log_error(f"IB Payroll: submit {d.name}", str(e))

    return {"submitted": submitted, "errors": errors}
