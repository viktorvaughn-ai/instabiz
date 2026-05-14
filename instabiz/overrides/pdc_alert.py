"""instabiz.overrides.pdc_alert

Daily scheduler: alert Accounts/Sales users when PDC cheque date is 3 days away.
"""
import frappe
from frappe.utils import today, add_days, getdate


def run_pdc_alert():
	alert_date = getdate(add_days(today(), 3))

	pdcs = frappe.get_all(
		"IB PDC",
		filters={"cheque_date": alert_date, "status": "Pending"},
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
			frappe.get_doc({
				"doctype":       "Notification Log",
				"for_user":      user,
				"type":          "Alert",
				"document_type": "IB PDC",
				"document_name": pdc.name,
				"subject":       (
					f"🏦 PDC due in 3 days — Cheque #{pdc.cheque_no} | "
					f"Customer: {pdc.customer_name or pdc.customer} | "
					f"Bank: {pdc.bank_name} | "
					f"Amount: ₹{pdc.amount:,.2f} | "
					f"Date: {pdc.cheque_date} {marker}"
				),
				"email_content": "",
			}).insert(ignore_permissions=True)
