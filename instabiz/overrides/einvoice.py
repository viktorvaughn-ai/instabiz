"""instabiz.overrides.einvoice

Auto-generate E-Invoice (IRN) on Sales Invoice submission via india_compliance.
When submitted from UI: india_compliance client JS handles it (on_submit event in e_invoice_actions.js).
When submitted via API/script: we enqueue generation after commit.
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


def _had_cancelled_irn(docname):
	"""True if this SI previously had an IRN that was cancelled at NIC."""
	try:
		return bool(frappe.db.exists(
			"e-Invoice Log",
			{"reference_doctype": "Sales Invoice", "reference_name": docname, "is_cancelled": 1},
		))
	except Exception:
		return False


def _dn_ewaybill_exists(doc):
	"""True if any linked Delivery Note already has an e-waybill number."""
	dn_names = list({
		row.delivery_note
		for row in doc.items
		if row.get("delivery_note")
	})
	if not dn_names:
		return False
	return bool(frappe.db.sql(
		"SELECT 1 FROM `tabDelivery Note` WHERE name IN %s AND ewaybill IS NOT NULL AND ewaybill != '' LIMIT 1",
		(dn_names,),
	))


def _generate_einvoice_background(docname):
	"""Background job: generate e-invoice with e-waybill suppression if DN already has one."""
	try:
		doc = frappe.get_doc("Sales Invoice", docname)

		from india_compliance.gst_india.utils.e_invoice import (  # pyright: ignore[reportMissingImports]
			generate_e_invoice,
		)

		# Suppress duplicate e-waybill if DN already owns one
		settings = frappe.get_cached_doc("GST Settings")
		_saved_flag = settings.generate_e_waybill_with_e_invoice
		if _dn_ewaybill_exists(doc):
			settings.generate_e_waybill_with_e_invoice = 0

		try:
			generate_e_invoice(docname, throw=False)
		finally:
			settings.generate_e_waybill_with_e_invoice = _saved_flag

	except Exception:
		frappe.log_error(
			title=f"E-Invoice background generation failed: {docname}",
			message=frappe.get_traceback(),
			reference_doctype="Sales Invoice",
			reference_name=docname,
		)


def run_einvoice_on_submit(doc, method=None):
	"""Called on Sales Invoice on_submit.

	UI submits: india_compliance client JS (e_invoice_actions.js on_submit) handles generation.
	API/script submits (_submitted_from_ui not set): we enqueue after commit.
	"""
	# Skip returns, debit notes
	if doc.get("is_return") or doc.get("is_debit_note"):
		return
	# Already has IRN
	if doc.get("irn"):
		return

	# UI submits: client JS handles generation automatically when auto_generate_e_invoice=1
	# Avoid double-generation which causes errors and confuses users
	if getattr(doc, "_submitted_from_ui", None):
		return

	# Non-UI submit path (API, scripts, bulk tools)
	if _had_cancelled_irn(doc.name):
		return

	if not _is_einvoice_configured():
		return

	# Enqueue after commit to avoid in-transaction DB state issues
	frappe.enqueue(
		"instabiz.overrides.einvoice._generate_einvoice_background",
		enqueue_after_commit=True,
		queue="short",
		docname=doc.name,
	)
