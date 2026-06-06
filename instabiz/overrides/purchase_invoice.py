"""instabiz.overrides.purchase_invoice"""
import frappe
from frappe import _
from erpnext.accounts.doctype.purchase_invoice.purchase_invoice import PurchaseInvoice  # pyright: ignore[reportMissingImports]

from instabiz.overrides.purchase_order import (
	_auto_correct_purchase_gst_template,
	_apply_purchase_cost_center,
	_set_location_from_warehouse,
	_first_warehouse,
)
from instabiz.overrides.naming import autoname_purchase_invoice


# ── Document class ────────────────────────────────────────────────────────────

class CustomPurchaseInvoice(PurchaseInvoice):
	def autoname(self):
		autoname_purchase_invoice(self)

	def validate(self):
		_set_location_from_warehouse(self)
		_auto_correct_purchase_gst_template(self)
		_apply_purchase_cost_center(self)
		super().validate()
		# Re-apply after super() resets cost centers to company default
		_apply_purchase_cost_center(self)

	def before_cancel(self):
		if not (self.get("custom_cancel_reason") or "").strip():
			frappe.throw(_("Fill in Cancellation Reason before cancelling this Purchase Invoice."))
