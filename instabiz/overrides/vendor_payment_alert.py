import frappe
from frappe.utils import today, add_days, getdate


def run_vendor_payment_alert():
	"""Daily: notify Purchase roles when PO payment due within 7 days."""
	alert_date = getdate(add_days(today(), 7))
	today_date  = getdate(today())

	rows = frappe.db.sql(
		"""
		SELECT
			ps.parent            AS po_name,
			ps.due_date,
			ps.payment_amount,
			ps.outstanding,
			po.supplier,
			po.currency
		FROM `tabPayment Schedule` ps
		INNER JOIN `tabPurchase Order` po ON po.name = ps.parent
		WHERE po.docstatus = 1
		AND ps.due_date BETWEEN %(today)s AND %(alert_date)s
		AND ps.outstanding > 0
		ORDER BY ps.due_date ASC
		""",
		{"today": today_date, "alert_date": alert_date},
		as_dict=True,
	)

	if not rows:
		return

	recipients = frappe.db.sql(
		"""
		SELECT DISTINCT u.name
		FROM `tabUser` u
		INNER JOIN `tabHas Role` hr ON hr.parent = u.name
		WHERE hr.role IN ('Purchase Manager', 'Purchase User', 'System Manager')
		AND u.enabled = 1
		AND u.name != 'Administrator'
		""",
		as_list=True,
	)
	users = [r[0] for r in recipients]
	if not users:
		return

	for row in rows:
		days_left = (getdate(row.due_date) - today_date).days
		marker    = f"[ib-vendor-pay-{row.po_name}-{row.due_date}]"

		for user in users:
			existing = frappe.db.exists("Notification Log", {
				"for_user": user,
				"subject": ["like", f"%{marker}%"],
			})
			if existing:
				continue

			base = (
				f"Payment due in {days_left}d: {row.po_name} "
				f"{row.supplier} {row.currency} {row.outstanding:,.0f} "
				f"due {row.due_date}"
			)
			subject = f"{base[:140 - len(marker) - 1]} {marker}"
			frappe.get_doc({
				"doctype":       "Notification Log",
				"for_user":      user,
				"from_user":     "Administrator",
				"type":          "Alert",
				"document_type": "Purchase Order",
				"document_name": row.po_name,
				"subject":       subject,
				"email_content": "",
			}).insert(ignore_permissions=True)

	frappe.db.commit()
