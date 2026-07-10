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

	frappe.get_doc({
		"doctype":       "Notification Log",
		"subject":       _("Order Dispatched: {0}").format(doc.name),
		"email_content": message,
		"for_user":      sales_user,
		"from_user":     "Administrator",
		"type":          "Alert",
		"document_type": "Delivery Note",
		"document_name": doc.name,
	}).insert(ignore_permissions=True)
