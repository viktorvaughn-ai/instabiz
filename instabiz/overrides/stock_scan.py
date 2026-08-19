from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt


def _require_stock_role() -> None:
	frappe.only_for(["Stock User", "Stock Manager", "System Manager"])


@frappe.whitelist()
def resolve_barcode(barcode: str) -> dict:
	_require_stock_role()
	item_code = frappe.db.get_value("Item Barcode", {"barcode": barcode}, "parent")
	if not item_code:
		frappe.throw(_("No item found for barcode {0}").format(barcode))

	item = frappe.db.get_value("Item", item_code, ["item_name", "stock_uom"], as_dict=True)
	balances = frappe.get_all(
		"Bin",
		filters={"item_code": item_code, "actual_qty": [">", 0]},
		fields=["warehouse", "actual_qty"],
	)
	return {
		"item_code": item_code,
		"item_name": item.item_name,
		"stock_uom": item.stock_uom,
		"balances": balances,
	}


@frappe.whitelist()
def adjust_stock(barcode: str, warehouse: str, qty: float, direction: str) -> dict:
	_require_stock_role()
	if direction not in ("Add", "Deduct"):
		frappe.throw(_("Direction must be Add or Deduct"))
	qty = flt(qty)
	if qty <= 0:
		frappe.throw(_("Qty must be greater than 0"))

	item_code = frappe.db.get_value("Item Barcode", {"barcode": barcode}, "parent")
	if not item_code:
		frappe.throw(_("No item found for barcode {0}").format(barcode))

	se = frappe.new_doc("Stock Entry")
	row = {"item_code": item_code, "qty": qty}
	if direction == "Add":
		se.stock_entry_type = "Material Receipt"
		row["t_warehouse"] = warehouse
	else:
		se.stock_entry_type = "Material Issue"
		row["s_warehouse"] = warehouse
	se.remarks = _("Scanned {0} via Scan Stock ({1})").format(barcode, direction)
	se.append("items", row)
	se.insert(ignore_permissions=True)
	se.submit()

	new_qty = frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty") or 0
	return {
		"stock_entry": se.name,
		"item_code": item_code,
		"new_qty": flt(new_qty),
	}
