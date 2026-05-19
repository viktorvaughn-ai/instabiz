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


def _patch_ship_from(doc):
	"""
	Patch EWaybillData.set_party_address_details to overwrite ship_from with
	the physical warehouse address (address_line_1, city, pin) for the given doc.
	Returns the original method so the caller can restore it.
	"""
	from india_compliance.gst_india.utils.e_waybill import EWaybillData  # pyright: ignore[reportMissingImports]
	from instabiz.overrides.utils import LOCATION_WAREHOUSE

	loc = (doc.get("custom_location") or "").lower()
	wh_name = LOCATION_WAREHOUSE.get(loc)
	_orig = EWaybillData.set_party_address_details

	def _patched(self):
		_orig(self)
		if not wh_name:
			return
		wh = frappe.db.get_value(
			"Warehouse", wh_name, ["address_line_1", "city", "pin"], as_dict=True
		)
		if not wh:
			return
		if wh.address_line_1:
			self.ship_from.address_line1 = wh.address_line_1.replace("\n", " ").strip()
		if wh.city:
			self.ship_from.city = wh.city
		if wh.pin:
			self.ship_from.pincode = wh.pin

	EWaybillData.set_party_address_details = _patched
	return _orig


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
		_orig = _patch_ship_from(doc)
		try:
			_generate_e_waybill(doc, throw=False)
		finally:
			from india_compliance.gst_india.utils.e_waybill import EWaybillData  # pyright: ignore[reportMissingImports]
			EWaybillData.set_party_address_details = _orig
	except Exception:
		frappe.log_error(
			title=f"e-Way Bill auto-generation failed: {doc_name}",
			message=frappe.get_traceback(),
			reference_doctype="Delivery Note",
			reference_name=doc_name,
		)


def _addr_fields(address_name):
	"""Return address_line1, city, pincode from an Address doc, or None if not found."""
	if not address_name:
		return None
	return frappe.db.get_value(
		"Address", address_name, ["address_line1", "city", "pincode"], as_dict=True
	)


def _apply_addr(side, addr):
	"""Overwrite ship_from / ship_to / bill_from fields from an Address dict."""
	if not addr:
		return
	if addr.address_line1:
		side.address_line1 = addr.address_line1
	if addr.city:
		side.city = addr.city
	if addr.pincode:
		side.pincode = addr.pincode


@frappe.whitelist()
def custom_generate_e_waybill(
	doctype=None,
	docname=None,
	values=None,
	force=False,
	transaction_type=None,
	bill_from_address=None,
	dispatch_from_address=None,
	ship_to_address=None,
):
	from india_compliance.gst_india.utils.e_waybill import (  # pyright: ignore[reportMissingImports]
		EWaybillData,
		generate_e_waybill,
	)
	from instabiz.overrides.utils import LOCATION_WAREHOUSE

	frappe.logger().info(
		f"[IB EWB] custom_generate_e_waybill — txn_type={transaction_type!r} "
		f"bill_from={bill_from_address!r} dispatch={dispatch_from_address!r} ship_to={ship_to_address!r}"
	)

	doc = frappe.get_doc(doctype, docname)
	txn_type = int(transaction_type) if transaction_type else None
	loc = (doc.get("custom_location") or "").lower()
	wh_name = LOCATION_WAREHOUSE.get(loc)

	# Correct stale company_gstin/company_address on submitted docs (e.g. created before
	# the post-super() fix was in place). Permanent correction — wrong data, not a temp patch.
	from instabiz.overrides.utils import LOCATION_COMPANY_ADDRESS, LOCATION_COMPANY_GSTIN  # noqa: PLC0415
	correct_gstin = LOCATION_COMPANY_GSTIN.get(loc)
	correct_addr  = LOCATION_COMPANY_ADDRESS.get(loc)
	updates = {}
	if correct_gstin and doc.get("company_gstin") != correct_gstin:
		updates["company_gstin"] = correct_gstin
	if correct_addr and doc.get("company_address") != correct_addr:
		updates["company_address"] = correct_addr
	if updates:
		frappe.db.set_value(doctype, docname, updates, update_modified=False)
		doc.update(updates)

	_orig = EWaybillData.set_party_address_details

	def _patched(self):
		_orig(self)

		# --- Bill From override (explicit address wins over default) ---
		bill_from_addr = _addr_fields(bill_from_address)
		if bill_from_addr:
			_apply_addr(self.bill_from, bill_from_addr)
			_apply_addr(self.ship_from, bill_from_addr)   # ship_from defaults to copy of bill_from

		# --- Dispatch From: explicit address > warehouse lookup ---
		dispatch_addr = _addr_fields(dispatch_from_address)
		if dispatch_addr:
			_apply_addr(self.ship_from, dispatch_addr)
		elif wh_name:
			wh = frappe.db.get_value(
				"Warehouse", wh_name, ["address_line_1", "city", "pin"], as_dict=True
			)
			if wh:
				if wh.address_line_1:
					self.ship_from.address_line1 = wh.address_line_1.replace("\n", " ").strip()
				if wh.city:
					self.ship_from.city = wh.city
				if wh.pin:
					self.ship_from.pincode = wh.pin

		# --- Ship To override ---
		ship_to_addr = _addr_fields(ship_to_address)
		if ship_to_addr:
			_apply_addr(self.ship_to, ship_to_addr)

		# --- Transaction type override ---
		if txn_type:
			self.transaction_details.transaction_type = txn_type

	EWaybillData.set_party_address_details = _patched
	try:
		return generate_e_waybill(doctype=doctype, docname=docname, values=values, force=force)
	finally:
		EWaybillData.set_party_address_details = _orig


def run_ewaybill_on_submit(doc, method=None):
	"""Called from doc_events → Delivery Note → on_submit."""
	if doc.get("is_return") or not doc.get("customer"):
		return

	# Self pickup — no third-party transporter; e-waybill must be generated from the Sales Invoice
	if (doc.get("custom_transport") or "").strip().upper() == "SELF PICKUP":
		frappe.msgprint(
			_("Transport is Self Pickup — e-Way Bill not auto-generated. "
			  "Generate it from the linked Sales Invoice using the e-Way Bill action button."),
			title=_("Self Pickup — Generate E-Waybill from SI"),
			indicator="orange",
			alert=True,
		)
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
