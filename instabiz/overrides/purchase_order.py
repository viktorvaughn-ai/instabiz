"""instabiz.overrides.purchase_order"""
import frappe
from frappe import _
from erpnext.buying.doctype.purchase_order.purchase_order import PurchaseOrder  # pyright: ignore[reportMissingImports]

from instabiz.overrides.utils import (
	LOCATION_WAREHOUSE,
	LOCATION_COST_CENTER,
	LOCATION_COMPANY_ADDRESS,
	LOCATION_COMPANY_GSTIN,
	recalculate_purchase_items,
)
from instabiz.overrides.naming import autoname_purchase_order


# ── GST template correction ───────────────────────────────────────────────────

_PURCHASE_GST_TEMPLATES = {
	(False, True):  "Input GST In-state - IB",
	(False, False): "Input GST Out-state - IB",
	(True,  True):  "Input GST RCM In-state - IB",
	(True,  False): "Input GST RCM Out-state - IB",
}


def _auto_correct_purchase_gst_template(doc):
	"""Swap to correct purchase GST template based on company vs supplier GSTIN state."""
	company_gstin = (doc.get("company_gstin") or "")[:2]
	supplier_gstin = (
		doc.get("supplier_gstin")
		or frappe.db.get_value("Address", doc.get("supplier_address"), "gstin")
		or ""
	)[:2]
	if not company_gstin or not supplier_gstin:
		return

	is_rcm = bool(doc.get("is_reverse_charge"))
	is_instate = company_gstin == supplier_gstin
	correct = _PURCHASE_GST_TEMPLATES.get((is_rcm, is_instate))
	if not correct or doc.get("taxes_and_charges") == correct:
		return

	doc.taxes_and_charges = correct
	template_doc = frappe.get_cached_doc("Purchase Taxes and Charges Template", correct)
	doc.set("taxes", [])
	for row in template_doc.taxes:
		doc.append("taxes", {
			"charge_type":  row.charge_type,
			"account_head": row.account_head,
			"description":  row.description,
			"rate":         row.rate,
		})


def _apply_purchase_cost_center(doc):
	"""Set cost_center on item + tax rows from set_warehouse → location mapping."""
	warehouse = doc.get("set_warehouse") or _first_warehouse(doc)
	if not warehouse:
		return
	loc = next((l for l, w in LOCATION_WAREHOUSE.items() if w == warehouse), None)
	if not loc:
		return
	cc = LOCATION_COST_CENTER.get(loc)
	if not cc:
		return
	for item in doc.get("items") or []:
		item.cost_center = cc
	for tax in doc.get("taxes") or []:
		tax.cost_center = cc


def _apply_purchase_location_gstin(doc):
	"""Set billing_address/shipping_address/company_gstin from custom_location,
	mirroring CustomSalesInvoice._apply_location_gstin / CustomDeliveryNote.validate.
	Purchase Order has no `company_address` field (verified via doctype meta —
	its own-company address field is `billing_address` / `billing_address_display`;
	`shipping_address` is where WE receive the goods, i.e. also our own company's
	location address here, not a third-party drop-ship address; `supplier_address`
	is the supplier's and is left untouched). Both billing_address and
	shipping_address were found defaulting to whatever the Company's single
	primary address happened to be (e.g. Chennai) regardless of custom_location,
	so a Maharashtra-location PO printed a Tamil Nadu GSTIN and a Chennai
	"Ship To" address. Set BEFORE super().validate() so BuyingController's
	update_if_missing() sees the fields already filled and leaves them alone,
	and set_supplier_address() regenerates the *_display fields from the
	correct address."""
	loc = (doc.get("custom_location") or "").lower()
	addr = LOCATION_COMPANY_ADDRESS.get(loc)
	if addr:
		doc.billing_address = addr
		doc.shipping_address = addr
	gstin = LOCATION_COMPANY_GSTIN.get(loc)
	if gstin:
		doc.company_gstin = gstin


def _first_warehouse(doc):
	for item in doc.get("items") or []:
		w = item.get("warehouse")
		if w:
			return w
	return None


# ── Document class ────────────────────────────────────────────────────────────

def _set_location_from_warehouse(doc):
	if doc.get("custom_location") and doc.custom_location != "Select":
		return
	warehouse = doc.get("set_warehouse") or _first_warehouse(doc)
	if not warehouse:
		return
	wh_lower = warehouse.lower()
	for loc, wh in LOCATION_WAREHOUSE.items():
		if wh.lower() == wh_lower or loc in wh_lower:
			doc.custom_location = loc.upper()
			return


class CustomPurchaseOrder(PurchaseOrder):
	def autoname(self):
		autoname_purchase_order(self)

	def validate(self):
		_set_location_from_warehouse(self)
		_apply_purchase_location_gstin(self)
		_auto_correct_purchase_gst_template(self)
		_apply_purchase_cost_center(self)
		recalculate_purchase_items(self)
		super().validate()

	def before_cancel(self):
		if not (self.get("custom_cancel_reason") or "").strip():
			frappe.throw(_("Fill in Cancellation Reason before cancelling this Purchase Order."))
		frappe.msgprint(_("Purchase Order cancelled successfully."), indicator="green")