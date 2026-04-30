import frappe
from frappe import _


@frappe.whitelist()
def mark_work_order_created(name: str) -> None:
	doc = frappe.get_doc("IB Sample Request", name)
	if doc.status != "Draft":
		frappe.throw(_("Can only mark Work Order Created from Draft status."))
	doc.status = "Work Order Created"
	doc.save()


@frappe.whitelist()
def mark_sent(name: str) -> None:
	doc = frappe.get_doc("IB Sample Request", name)
	if doc.status not in ("Draft", "Work Order Created"):
		frappe.throw(_("Can only mark Sent from Draft or Work Order Created status."))
	doc.status = "Sent"
	doc.save()


@frappe.whitelist()
def record_feedback(name: str, feedback: str, outcome: str) -> None:
	doc = frappe.get_doc("IB Sample Request", name)
	if doc.status not in ("Sent", "Feedback Received"):
		frappe.throw(_("Can only record feedback after sample is Sent."))
	doc.feedback = feedback
	doc.outcome = outcome
	doc.status = "Feedback Received"
	doc.save()


@frappe.whitelist()
def convert_to_order(name: str, sales_order: str) -> None:
	frappe.get_doc("Sales Order", sales_order)
	doc = frappe.get_doc("IB Sample Request", name)
	doc.related_sales_order = sales_order
	doc.outcome = "Converted"
	doc.status = "Converted"
	doc.save()
