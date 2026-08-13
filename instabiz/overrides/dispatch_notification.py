"""instabiz.overrides.dispatch_notification"""
import frappe
from frappe import _


def run_dispatch_notification(doc, method=None):
	sales_user = doc.get("custom_sales_person_user")
	if not sales_user:
		return

	lr = doc.get("custom_lr_number") or doc.get("lr_no") or ""
	transporter = doc.get("custom_transport") or doc.get("transporter_name") or doc.get("transporter") or ""

	parts = [f"Delivery Note <b>{doc.name}</b> for <b>{doc.customer_name}</b> has been submitted."]
	if lr:
		parts.append(f"LR No: <b>{lr}</b>")
	if transporter:
		parts.append(f"Transporter: <b>{transporter}</b>")

	message = " | ".join(parts)

	# Frappe's own bell dropdown renders Notification Log.subject via .html()
	# (frappe/public/js/frappe/ui/notifications/notifications.js) — customer_name
	# is a free-text Data field any Sales User can set once at Customer creation
	# and never edit again, so it must be escaped before going into subject the
	# same way this session already fixed for Dialog/frappe.confirm sinks
	# elsewhere in this app.
	customer_bit = f" ({frappe.utils.escape_html(doc.customer_name)})" if doc.customer_name else ""
	frappe.get_doc({
		"doctype":       "Notification Log",
		"subject":       _("Order Dispatched: {0}{1}").format(doc.name, customer_bit),
		"email_content": message,
		"for_user":      sales_user,
		"from_user":     "Administrator",
		"type":          "Alert",
		"document_type": "Delivery Note",
		"document_name": doc.name,
	}).insert(ignore_permissions=True)
