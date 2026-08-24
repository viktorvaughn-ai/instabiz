"""instabiz.overrides.asset_loan_alert

Daily scheduler: flag IB Asset Loans past their expected_return_date as
Overdue and alert HR + the borrowing employee. Dedup marker is keyed by
loan name only (no date component) — same catch-up-safe pattern as
pdc_alert.py: a loan already notified once won't be re-notified even if
the scheduler misses a day or reruns.
"""
import frappe
from frappe.utils import today, getdate, escape_html


def run_asset_loan_alert():
	overdue = frappe.get_all(
		"IB Asset Loan",
		filters={"status": "Issued", "expected_return_date": ["<", today()]},
		fields=["name", "asset_code", "asset_name", "employee", "employee_name", "expected_return_date"],
	)

	if not overdue:
		return

	# Data hygiene: flip status to Overdue so the doctype reflects reality —
	# validate() doesn't need to also run this each save.
	for loan in overdue:
		frappe.db.set_value("IB Asset Loan", loan.name, "status", "Overdue", update_modified=False)

	hr_users = frappe.db.sql(
		"""
		SELECT DISTINCT u.name
		FROM `tabUser` u
		INNER JOIN `tabHas Role` hr ON hr.parent = u.name
		WHERE hr.role IN ('HR Manager', 'HR User', 'System Manager')
		AND u.enabled = 1 AND u.name != 'Administrator'
		""",
		as_list=True,
	)
	hr_managers = [r[0] for r in hr_users]

	for loan in overdue:
		marker = f"[ib-asset-overdue-{loan.name}]"
		emp_user = frappe.db.get_value("Employee", loan.employee, "user_id")
		users = list(set(hr_managers + ([emp_user] if emp_user else [])))

		days_overdue = (getdate(today()) - getdate(loan.expected_return_date)).days
		base = (
			f"Asset overdue: {escape_html(loan.asset_name)} ({escape_html(loan.asset_code)}) "
			f"held by {escape_html(loan.employee_name or loan.employee)}, "
			f"{days_overdue}d past due"
		)
		subject = f"{base[:140 - len(marker) - 1]} {marker}"

		for user in users:
			if frappe.db.exists("Notification Log", {"for_user": user, "subject": ["like", f"%{marker}%"]}):
				continue
			frappe.get_doc({
				"doctype":       "Notification Log",
				"for_user":      user,
				"from_user":     "Administrator",
				"type":          "Alert",
				"document_type": "IB Asset Loan",
				"document_name": loan.name,
				"subject":       subject,
				"email_content": "",
			}).insert(ignore_permissions=True)

	frappe.db.commit()
