"""IB Demand Forecast — recency-weighted trailing-26-week velocity per item,
projected 4-week demand, and Weeks of Cover against current company-wide
Bin stock. Computed live (no caching doctype) — data volume in this app
(a few hundred items, script-report scale) makes on-the-fly computation
fast enough that a cached table would be premature.

Signal source: Delivery Note (this app's "goods actually shipped" doctype
of record — see CLAUDE.md), not Sales Order/Invoice, so the forecast
reflects real fulfilled demand rather than booked-but-undelivered orders.

Weighting formula (documented per spec — simple linear ramp, not overengineered):
Each of the trailing 26 completed weeks gets weight(w) = 1 + (25 - w) / 25,
where w = 0 is the most recent completed week and w = 25 is the oldest
(26 weeks ago). That ramps linearly from 2.0 (most recent week) down to
1.0 (oldest week) — i.e. the most recent week counts twice as much as the
oldest one. weighted_avg_weekly_demand = SUM(qty_w * weight_w) / SUM(weight_w)
across all 26 buckets; weeks with no Delivery Note activity contribute
qty=0 but still count their weight in the denominator, so a long quiet
patch correctly drags the average down instead of being skipped.
"""
import frappe
from frappe import _
from frappe.utils import flt

_WEEKS = 26


def execute(filters=None):
	filters = filters or {}
	data = _data(filters)
	columns = _columns()
	return columns, data, None, _chart(data, filters), _summary(data)


def _columns():
	return [
		{"label": _("Item Code"), "fieldname": "item_code", "fieldtype": "Link", "options": "Item", "width": 160},
		{"label": _("Item Name"), "fieldname": "item_name", "fieldtype": "Data", "width": 200},
		{"label": _("UOM"), "fieldname": "uom", "fieldtype": "Data", "width": 70},
		{"label": _("Avg Weekly Demand"), "fieldname": "avg_weekly_demand", "fieldtype": "Float", "width": 140},
		{"label": _("Projected 4-Wk Demand"), "fieldname": "projected_4wk_demand", "fieldtype": "Float", "width": 160},
		{"label": _("Current Stock"), "fieldname": "current_stock", "fieldtype": "Float", "width": 120},
		{"label": _("Weeks of Cover"), "fieldname": "weeks_of_cover_display", "fieldtype": "Data", "width": 120},
		{"label": _("Risk"), "fieldname": "risk_flag", "fieldtype": "Data", "width": 130},
	]


def _weight(week_idx):
	# week_idx: 0 = most recent completed week ... (_WEEKS - 1) = oldest.
	# Linear ramp: 2.0 at week_idx=0 down to 1.0 at week_idx=_WEEKS-1.
	return 1 + ((_WEEKS - 1) - week_idx) / (_WEEKS - 1)


def _data(filters):
	item_group = filters.get("item_group")
	item_code_f = filters.get("item")

	ig_cond = "AND i.item_group = %(item_group)s" if item_group else ""
	item_cond = "AND dni.item_code = %(item_code)s" if item_code_f else ""

	rows = frappe.db.sql(
		f"""
		SELECT dni.item_code,
		       FLOOR(DATEDIFF(CURDATE(), dn.posting_date) / 7) AS week_idx,
		       SUM(dni.stock_qty) AS qty
		FROM `tabDelivery Note Item` dni
		INNER JOIN `tabDelivery Note` dn ON dn.name = dni.parent
		INNER JOIN `tabItem` i ON i.name = dni.item_code
		WHERE dn.docstatus = 1
		  AND dn.posting_date >= DATE_SUB(CURDATE(), INTERVAL {_WEEKS} WEEK)
		  {ig_cond} {item_cond}
		GROUP BY dni.item_code, week_idx
		""",
		{"item_group": item_group, "item_code": item_code_f},
		as_dict=True,
	)

	by_item = {}
	for r in rows:
		w = int(r.week_idx)
		if w < 0 or w >= _WEEKS:
			continue
		by_item.setdefault(r.item_code, {})[w] = flt(r.qty)

	if not by_item:
		return []

	item_meta = {
		d.name: d
		for d in frappe.get_all(
			"Item",
			filters={"name": ["in", list(by_item.keys())]},
			fields=["name", "item_name", "stock_uom"],
		)
	}

	stock_rows = frappe.db.sql(
		"""
		SELECT item_code, SUM(actual_qty) AS qty
		FROM `tabBin`
		WHERE item_code IN %(items)s
		GROUP BY item_code
		""",
		{"items": tuple(by_item.keys())},
		as_dict=True,
	)
	stock_map = {r.item_code: flt(r.qty) for r in stock_rows}

	out = []
	for item_code, weeks in by_item.items():
		weighted_sum = 0.0
		weight_total = 0.0
		for w in range(_WEEKS):
			wt = _weight(w)
			weighted_sum += weeks.get(w, 0.0) * wt
			weight_total += wt
		avg_weekly = weighted_sum / weight_total if weight_total else 0
		projected_4wk = avg_weekly * 4
		stock = stock_map.get(item_code, 0)

		if avg_weekly > 0:
			woc = stock / avg_weekly
			woc_display = str(round(woc, 1))
			risk = "Low Cover" if woc < 2 else ""
		else:
			# Guard divide-by-zero: no recent demand -> WOC is undefined, not
			# an error. Represent as a blank/sentinel rather than crashing.
			woc_display = "—"
			risk = "No Recent Demand" if stock > 0 else ""

		meta = item_meta.get(item_code, {})
		out.append({
			"item_code": item_code,
			"item_name": meta.get("item_name"),
			"uom": meta.get("stock_uom"),
			"avg_weekly_demand": round(avg_weekly, 2),
			"projected_4wk_demand": round(projected_4wk, 2),
			"current_stock": round(flt(stock), 2),
			"weeks_of_cover_display": woc_display,
			"risk_flag": risk,
		})

	out.sort(key=lambda r: r["avg_weekly_demand"], reverse=True)
	return out


def _chart(data, filters=None):
	if not data:
		return None
	chart_type = (filters or {}).get("chart_type") or "bar"
	top = [r for r in data if r["avg_weekly_demand"] > 0][:10]
	if not top:
		return None
	return {
		"data": {
			"labels": [r["item_code"] for r in top],
			"datasets": [{"name": _("Projected 4-Wk Demand"), "values": [r["projected_4wk_demand"] for r in top]}],
		},
		"type": chart_type,
		"colors": ["#4e7fff"],
	}


def _summary(data):
	if not data:
		return None
	total_items = len(data)
	at_risk = sum(1 for r in data if r["risk_flag"] == "Low Cover")
	no_demand = sum(1 for r in data if r["risk_flag"] == "No Recent Demand")
	return [
		{"value": total_items, "label": _("Items Forecasted"), "datatype": "Int", "indicator": "blue"},
		{"value": at_risk, "label": _("Low Cover (WOC < 2)"), "datatype": "Int", "indicator": "red"},
		{"value": no_demand, "label": _("No Recent Demand, Stock > 0"), "datatype": "Int", "indicator": "orange"},
	]
