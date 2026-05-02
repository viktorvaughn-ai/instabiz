from urllib.parse import quote

import frappe
from frappe.utils import add_days, nowdate

DORMANT_DAYS = 60
_MARKER = "[ib-dormant-reminder]"
_MESSAGE = (
	"Hi, we noticed it's been a while since your last order with us. "
	"We'd love to stay in touch — let us know if there's anything we can help with!"
)


@frappe.whitelist()
def run_dormant_check():
	threshold = add_days(nowdate(), -DORMANT_DAYS)

	dormant = frappe.db.sql(
		"""
		SELECT customer, MAX(transaction_date) AS last_order_date
		FROM `tabSales Order`
		WHERE docstatus = 1
		GROUP BY customer
		HAVING last_order_date <= %(threshold)s
		""",
		{"threshold": threshold},
		as_dict=True,
	)

	created = 0
	for row in dormant:
		so = frappe.db.get_value(
			"Sales Order",
			{"customer": row.customer, "docstatus": 1},
			["custom_sales_person_user", "name"],
			order_by="transaction_date desc",
			as_dict=True,
		)
		if not so or not so.custom_sales_person_user:
			continue

		# skip if open dormant ToDo already exists for this customer
		if frappe.db.exists("ToDo", {
			"reference_type": "Customer",
			"reference_name": row.customer,
			"status": "Open",
			"description": ["like", f"%{_MARKER}%"],
		}):
			continue

		sales_user = so.custom_sales_person_user
		phone      = _clean_phone(frappe.db.get_value("Customer", row.customer, "mobile_no"))
		wa_link    = f"https://wa.me/{phone}?text={quote(_MESSAGE)}" if phone else None

		desc = (
			f"<b>{row.customer}</b> has not placed an order in over {DORMANT_DAYS} days "
			f"(last order: {frappe.utils.formatdate(row.last_order_date)}).<br><br>"
			+ (f'<a href="{wa_link}" target="_blank">Send WhatsApp Message</a><br><br>' if wa_link else "")
			+ _MARKER
		)

		frappe.get_doc({
			"doctype":        "ToDo",
			"status":         "Open",
			"priority":       "Medium",
			"date":           add_days(nowdate(), 3),
			"allocated_to":   sales_user,
			"reference_type": "Customer",
			"reference_name": row.customer,
			"description":    desc,
		}).insert(ignore_permissions=True)

		frappe.get_doc({
			"doctype":        "Notification Log",
			"subject":        f"Follow up: {row.customer} — no order in {DORMANT_DAYS}+ days",
			"email_content":  desc,
			"for_user":       sales_user,
			"type":           "Alert",
			"document_type":  "Customer",
			"document_name":  row.customer,
		}).insert(ignore_permissions=True)

		created += 1

	frappe.db.commit()
	frappe.logger().info(f"[dormant] created {created} follow-up tasks")


def _clean_phone(raw):
	if not raw:
		return None
	phone = raw.strip().replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
	if not phone:
		return None
	if phone.startswith("+"):
		return phone.lstrip("+")
	if phone.startswith("0"):
		phone = phone[1:]
	return "91" + phone  # default India
