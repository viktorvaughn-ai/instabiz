"""instabiz.overrides.ewaybill

Auto-generate e-Way Bill on Delivery Note submission via india_compliance.

Credential check: reads GST Settings.enable_e_waybill + is_api_enabled().
If credentials not configured → msgprint warning (non-blocking).
If configured → attempts generation; errors are logged + warned, not fatal.

Field mapping before generation:
  custom_transport (Link→IB Transport) → gst_transporter_id via IB Transport.custom_transport_gst
  custom_lr_number (Data)              → lr_no
"""
import frappe
from frappe import _


def _is_ewb_configured():
	"""Return True only when GST Settings have API enabled + e-Waybill enabled."""
	try:
		from india_compliance.gst_india.utils import is_api_enabled  # pyright: ignore[reportMissingImports]
	except ImportError:
		return False

	settings = frappe.get_cached_doc("GST Settings")
	return is_api_enabled(settings) and settings.get("enable_e_waybill") and settings.get("enable_e_waybill_from_dn")


def _sync_transporter_fields(doc):
	"""
	Copy instabiz custom transport/LR fields into the standard fields that
	india_compliance reads when generating the e-Way Bill.
	"""
	# LR number: custom_lr_number → lr_no
	if doc.get("custom_lr_number") and not doc.get("lr_no"):
		frappe.db.set_value("Delivery Note", doc.name, "lr_no", doc.custom_lr_number, update_modified=False)
		doc.lr_no = doc.custom_lr_number

	# Transporter GST ID: IB Transport.custom_transport_gst → gst_transporter_id
	if doc.get("custom_transport") and not doc.get("gst_transporter_id"):
		gst_id = frappe.db.get_value("IB Transport", doc.custom_transport, "custom_transport_gst")
		if gst_id:
			frappe.db.set_value("Delivery Note", doc.name, "gst_transporter_id", gst_id, update_modified=False)
			doc.gst_transporter_id = gst_id


def run_ewaybill_on_submit(doc, method=None):
	"""
	Called from doc_events → Delivery Note → on_submit.
	Warns if credentials not configured. Attempts generation otherwise.
	"""
	# Skip returns and internal transfers
	if doc.get("is_return") or not doc.get("customer"):
		return

	if not _is_ewb_configured():
		frappe.msgprint(
			_("e-Way Bill credentials not configured in GST Settings. "
			  "Please configure NIC API credentials and enable e-Waybill from Delivery Note "
			  "to auto-generate e-Way Bills."),
			title=_("e-Way Bill Not Generated"),
			indicator="orange",
			alert=True,
		)
		return

	# Already has an e-waybill number
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
			title=f"e-Way Bill auto-generation failed: {doc.name}",
			message=frappe.get_traceback(),
			reference_doctype="Delivery Note",
			reference_name=doc.name,
		)
		frappe.msgprint(
			_("e-Way Bill auto-generation failed for {0}. Check error log for details. "
			  "You can generate it manually from the Delivery Note.").format(frappe.bold(doc.name)),
			title=_("e-Way Bill Error"),
			indicator="orange",
			alert=True,
		)
