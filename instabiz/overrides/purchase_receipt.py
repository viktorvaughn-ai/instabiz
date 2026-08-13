"""instabiz.overrides.purchase_receipt"""
import frappe
from frappe import _
from erpnext.stock.doctype.purchase_receipt.purchase_receipt import PurchaseReceipt  # pyright: ignore[reportMissingImports]

from instabiz.overrides.purchase_order import (
	_auto_correct_purchase_gst_template,
	_apply_purchase_cost_center,
	_apply_purchase_location_gstin,
	_set_location_from_warehouse,
)
from instabiz.overrides.utils import recalculate_purchase_items
from instabiz.overrides.naming import autoname_purchase_receipt


class CustomPurchaseReceipt(PurchaseReceipt):
	def autoname(self):
		autoname_purchase_receipt(self)

	def validate(self):
		_set_location_from_warehouse(self)
		_apply_purchase_location_gstin(self)
		_auto_correct_purchase_gst_template(self)
		_apply_purchase_cost_center(self)
		recalculate_purchase_items(self)
		super().validate()

	def before_cancel(self):
		if not (self.get("custom_cancel_reason") or "").strip():
			frappe.throw(_("Fill in Cancellation Reason before cancelling this Purchase Receipt."))
