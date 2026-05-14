"""instabiz.overrides.einvoice

Auto-generate E-Invoice (IRN) on Sales Invoice submission via india_compliance.
Same non-blocking pattern as ewaybill.py.
"""
import frappe
from frappe import _


def _is_einvoice_configured():
	try:
		from india_compliance.gst_india.utils import is_api_enabled  # pyright: ignore[reportMissingImports]
	except ImportError:
		return False
	settings = frappe.get_cached_doc("GST Settings")
	return is_api_enabled(settings) and settings.get("enable_e_invoice")


def run_einvoice_on_submit(doc, method=None):
	"""Called on Sales Invoice on_submit. Non-blocking — warns on failure."""
	# Skip returns, debit notes, inter-company
	if doc.get("is_return") or doc.get("is_debit_note"):
		return
	# B2C invoices don't need IRN
	if not doc.get("customer_gstin"):
		return
	# Already has IRN
	if doc.get("irn"):
		return

	if not _is_einvoice_configured():
		frappe.msgprint(
			_("E-Invoice API not configured in GST Settings. "
			  "Enable API credentials and 'Enable E-Invoice' to auto-generate IRN."),
			title=_("E-Invoice Not Generated"),
			indicator="orange",
			alert=True,
		)
		return

	try:
		from india_compliance.gst_india.utils.e_invoice import (  # pyright: ignore[reportMissingImports]
			generate_e_invoice,
		)
		generate_e_invoice(doc.name, throw=False)
	except Exception:
		frappe.log_error(
			title=f"E-Invoice auto-generation failed: {doc.name}",
			message=frappe.get_traceback(),
			reference_doctype="Sales Invoice",
			reference_name=doc.name,
		)
		frappe.msgprint(
			_("E-Invoice (IRN) auto-generation failed for {0}. "
			  "Check error log or generate manually from the invoice.").format(frappe.bold(doc.name)),
			title=_("E-Invoice Error"),
			indicator="orange",
			alert=True,
		)
