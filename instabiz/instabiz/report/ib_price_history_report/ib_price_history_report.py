"""IB Price History Report — exportable, filterable wrapper around the app's
existing per-item Sales Order price history logic.

`instabiz/instabiz/page/ib_item_price_history/ib_item_price_history.py`
(now surfaced inside the merged "Item Pricing" page) already computes exactly
this data for a single item/customer lookup. That module is left untouched —
its `export_item_price_history()` is imported and called directly whenever
this report's filters describe a single-item/customer lookup, so the SO-price
query is never re-implemented for that case.

The one real gap in the existing feature is company-wide, multi-item
filtering (by Item Group / Territory, with no single item picked) — that
was never supported by the page (it requires an Item or a Customer). This
report adds that missing query (`_data_multi_item`), reusing the same
privilege rule (`_is_privileged`) and Sales-Order-basis the existing feature
already uses, rather than duplicating its item/customer lookup path.
"""
import frappe
from frappe import _
from frappe.utils import flt

from instabiz.overrides.permissions import _is_privileged
from instabiz.instabiz.page.ib_item_price_history.ib_item_price_history import (
	export_item_price_history,
)


def execute(filters=None):
	filters = filters or {}
	data    = _data(filters)
	columns = _columns()
	return columns, data, None, _chart(data, filters), _summary(data)


def _columns():
	return [
		{"label": _("Item Code"),    "fieldname": "item_code",        "fieldtype": "Link",     "options": "Item",        "width": 170},
		{"label": _("Item Name"),    "fieldname": "item_name",        "fieldtype": "Data",     "width": 200},
		{"label": _("Customer"),     "fieldname": "customer",         "fieldtype": "Link",     "options": "Customer",    "width": 160},
		{"label": _("Date"),         "fieldname": "transaction_date", "fieldtype": "Date",     "width": 100},
		{"label": _("Sales Order"),  "fieldname": "sales_order",      "fieldtype": "Link",     "options": "Sales Order", "width": 150},
		{"label": _("Qty"),          "fieldname": "qty",              "fieldtype": "Float",    "width": 90},
		{"label": _("UOM"),          "fieldname": "uom",              "fieldtype": "Data",     "width": 80},
		{"label": _("Rate"),         "fieldname": "rate",             "fieldtype": "Currency", "width": 110},
		{"label": _("Amount"),       "fieldname": "amount",           "fieldtype": "Currency", "width": 130},
		{"label": _("Location"),     "fieldname": "location",         "fieldtype": "Data",     "width": 100},
		{"label": _("Sales Person"), "fieldname": "sales_person",     "fieldtype": "Data",     "width": 140},
	]


def _use_reuse_path(filters):
	"""Single item and/or customer lookup, no company-wide scoping — the exact
	shape `export_item_price_history()` already serves. Item Group / Territory
	filters need the multi-item query below (that function accepts neither).
	"""
	has_item_or_customer = bool(filters.get("item_code") or filters.get("customer"))
	return has_item_or_customer and not filters.get("item_group") and not filters.get("territory")


def _data(filters):
	if _use_reuse_path(filters):
		result = export_item_price_history(
			item_code=filters.get("item_code"),
			customer=filters.get("customer"),
			from_date=filters.get("from_date"),
			to_date=filters.get("to_date"),
		)
		if result.get("truncated"):
			frappe.msgprint(_("Row limit reached — showing a partial result. Narrow the date range for a complete export."))
		return result.get("data") or []

	return _data_multi_item(filters)


def _data_multi_item(filters):
	"""Company-wide multi-item price trend — the one real gap the existing
	single-item page can't cover (Item Group / Territory scoping with no
	single Item picked). Same Sales-Order basis + row-level privilege rule
	as the reused function above, kept consistent deliberately.
	"""
	user = frappe.session.user
	conditions = ["so.docstatus = 1"]
	params = {}

	if filters.get("item_code"):
		conditions.append("soi.item_code = %(item_code)s")
		params["item_code"] = filters["item_code"]

	if filters.get("item_group"):
		conditions.append("i.item_group = %(item_group)s")
		params["item_group"] = filters["item_group"]

	if filters.get("customer"):
		conditions.append("so.customer = %(customer)s")
		params["customer"] = filters["customer"]

	if filters.get("territory"):
		conditions.append("so.territory = %(territory)s")
		params["territory"] = filters["territory"]

	if filters.get("from_date"):
		conditions.append("so.transaction_date >= %(from_date)s")
		params["from_date"] = filters["from_date"]

	if filters.get("to_date"):
		conditions.append("so.transaction_date <= %(to_date)s")
		params["to_date"] = filters["to_date"]

	if not _is_privileged(user):
		conditions.append("(so.custom_sales_person_user = %(user)s OR so.owner = %(user)s)")
		params["user"] = user

	where = " AND ".join(conditions)

	rows = frappe.db.sql(
		f"""
		SELECT
			soi.item_code,
			soi.item_name,
			so.customer,
			so.transaction_date,
			so.name AS sales_order,
			soi.qty,
			soi.uom,
			soi.rate,
			soi.amount,
			so.custom_location AS location,
			so.custom_sales_person AS sales_person
		FROM `tabSales Order Item` soi
		INNER JOIN `tabSales Order` so ON so.name = soi.parent
		INNER JOIN `tabItem` i ON i.name = soi.item_code
		WHERE {where}
		ORDER BY so.transaction_date DESC, so.creation DESC
		LIMIT 5000
		""",
		params,
		as_dict=True,
	)
	return rows


def _chart(data, filters=None):
	if not data:
		return None
	chart_type = (filters or {}).get("chart_type") or "bar"
	agg = {}
	for r in data:
		agg[r["item_code"]] = agg.get(r["item_code"], 0) + flt(r.get("amount") or 0)
	top = sorted(agg.items(), key=lambda x: x[1], reverse=True)[:10]
	return {
		"data": {
			"labels":   [t[0] for t in top],
			"datasets": [{"name": _("Revenue (INR)"), "values": [round(t[1]) for t in top]}],
		},
		"type": chart_type,
		"colors": ["#2e74b5"],
	}


def _summary(data):
	if not data:
		return None
	items = {r["item_code"] for r in data}
	rates = [flt(r.get("rate") or 0) for r in data if flt(r.get("rate") or 0) > 0]
	avg_rate = flt(sum(rates) / len(rates), 2) if rates else 0
	total_amount = sum(flt(r.get("amount") or 0) for r in data)

	return [
		{"value": len(data),      "label": _("Records"),      "datatype": "Int",      "indicator": "blue"},
		{"value": len(items),     "label": _("Unique Items"), "datatype": "Int",      "indicator": "orange"},
		{"value": total_amount,   "label": _("Total Value"),  "datatype": "Currency", "indicator": "green"},
		{"value": avg_rate,       "label": _("Avg Rate"),     "datatype": "Currency", "indicator": "purple"},
	]
