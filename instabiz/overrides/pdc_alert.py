"""instabiz.overrides.pdc_alert

Daily scheduler: alert Accounts/Sales users when a Pending PDC cheque is due
within 3 days, or is already past its cheque date and still Pending.

Was an exact `cheque_date = today+3` match — if the scheduler ever missed a
day, that cheque silently never got alerted at all. The dedup marker is keyed
by PDC name only (no date component), so widening this to a catch-up range is
safe — a user already notified for a given PDC won't be re-notified.
"""
import frappe
from frappe.utils import today, add_days, getdate, escape_html


def run_pdc_alert():
	alert_date = getdate(add_days(today(), 3))

	pdcs = frappe.get_all(
		"IB PDC",
		filters={"cheque_date": ["<=", alert_date], "status": "Pending"},
		fields=["name", "customer", "customer_name", "cheque_no", "amount", "bank_name",
		        "cheque_date", "sales_person_user"],
	)

	if not pdcs:
		return

	recipients = frappe.db.sql(
		"""
		SELECT DISTINCT u.name
		FROM `tabUser` u
		INNER JOIN `tabHas Role` hr ON hr.parent = u.name
		WHERE hr.role IN ('Accounts User', 'Accounts Manager', 'Sales Manager', 'System Manager')
		AND u.enabled = 1 AND u.name != 'Administrator'
		""",
		as_list=True,
	)
	managers = [r[0] for r in recipients]

	for pdc in pdcs:
		marker = f"[ib-pdc-{pdc.name}]"
		users  = list(set(managers + ([pdc.sales_person_user] if pdc.sales_person_user else [])))

		for user in users:
			if frappe.db.exists("Notification Log", {"for_user": user, "subject": ["like", f"%{marker}%"]}):
				continue
			days_left = (getdate(pdc.cheque_date) - getdate(today())).days
			label = f"overdue by {abs(days_left)}d" if days_left < 0 else f"due in {days_left}d"
			base = (
				f"PDC {label}: #{escape_html(pdc.cheque_no or '')} "
				f"{escape_html(pdc.customer_name or pdc.customer)} "
				f"Rs.{pdc.amount:,.0f} on {pdc.cheque_date}"
			)
			subject = f"{base[:140 - len(marker) - 1]} {marker}"
			frappe.get_doc({
				"doctype":       "Notification Log",
				"for_user":      user,
				"from_user":     "Administrator",
				"type":          "Alert",
				"document_type": "IB PDC",
				"document_name": pdc.name,
				"subject":       subject,
				"email_content": "",
			}).insert(ignore_permissions=True)

	frappe.db.commit()
