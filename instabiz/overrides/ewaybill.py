"""instabiz.overrides.ewaybill

Auto-generate e-Way Bill on Delivery Note submission via india_compliance.

Generation is enqueued as a background job so a failure never rolls back the DN submit.
"""
import frappe
from frappe import _


def _is_ewb_configured():
	try:
		from india_compliance.gst_india.utils import is_api_enabled  # pyright: ignore[reportMissingImports]
	except ImportError:
		return False
	settings = frappe.get_cached_doc("GST Settings")
	return is_api_enabled(settings) and settings.get("enable_e_waybill") and settings.get("enable_e_waybill_from_dn")


def _sync_transporter_fields(doc):
	if doc.get("custom_lr_number") and not doc.get("lr_no"):
		frappe.db.set_value("Delivery Note", doc.name, "lr_no", doc.custom_lr_number, update_modified=False)
		doc.lr_no = doc.custom_lr_number

	if doc.get("custom_transport") and not doc.get("gst_transporter_id"):
		gst_id = frappe.db.get_value("IB Transport", doc.custom_transport, "custom_transport_gst")
		if gst_id:
			frappe.db.set_value("Delivery Note", doc.name, "gst_transporter_id", gst_id, update_modified=False)
			doc.gst_transporter_id = gst_id


@frappe.whitelist()
def _generate_ewaybill_async(doc_name):
	"""Background job — runs after DN is committed, so failures don't affect DN docstatus."""
	doc = frappe.get_doc("Delivery Note", doc_name)
	if doc.get("ewaybill"):
		return

	try:
		from india_compliance.gst_india.utils.e_waybill import (  # pyright: ignore[reportMissingImports]
			_generate_e_waybill,
		)
		_sync_transporter_fields(doc)
		_generate_e_waybill(doc, throw=False)
	except Exception:
		frappe.log_error(
			title=f"e-Way Bill auto-generation failed: {doc_name}",
			message=frappe.get_traceback(),
			reference_doctype="Delivery Note",
			reference_name=doc_name,
		)


def run_ewaybill_on_submit(doc, method=None):
	"""Called from doc_events → Delivery Note → on_submit."""
	if doc.get("is_return") or not doc.get("customer"):
		return

	if not _is_ewb_configured():
		frappe.msgprint(
			_("e-Way Bill credentials not configured in GST Settings. "
			  "Generate e-Way Bill manually from the Delivery Note."),
			title=_("e-Way Bill Not Generated"),
			indicator="orange",
			alert=True,
		)
		return

	if doc.get("ewaybill"):
		return

	# Enqueue so DN commit is not rolled back if e-waybill API fails
	frappe.enqueue(
		"instabiz.overrides.ewaybill._generate_ewaybill_async",
		doc_name=doc.name,
		queue="short",
		now=frappe.flags.in_test,
	)
