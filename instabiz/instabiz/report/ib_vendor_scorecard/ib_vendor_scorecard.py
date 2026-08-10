"""IB Vendor Scorecard — vendor-wise trailing-90-day performance scorecard.

Reads history from `IB Supplier Score` (one row per vendor per scheduler run,
see instabiz.overrides.vendor_scorecard.run_vendor_scorecard) — never
recomputes on the fly, so this report is always exactly what the scorecard
doctype itself already shows, just with filters/chart/summary on top.
"""
import frappe
from frappe import _
from frappe.utils import flt


def execute(filters=None):
	filters = filters or {}
	data = _data(filters)
	columns = _columns()
	return columns, data, None, _chart(data, filters), _summary(data)


def _columns():
	return [
		{"label": _("Vendor"), "fieldname": "vendor", "fieldtype": "Link", "options": "Supplier", "width": 130},
		{"label": _("Vendor Name"), "fieldname": "vendor_name", "fieldtype": "Data", "width": 180},
		{"label": _("Period Start"), "fieldname": "period_start", "fieldtype": "Date", "width": 100},
		{"label": _("Period End"), "fieldname": "period_end", "fieldtype": "Date", "width": 100},
		{"label": _("On-Time %"), "fieldname": "on_time_pct", "fieldtype": "Percent", "width": 100},
		{"label": _("Quality %"), "fieldname": "quality_pct", "fieldtype": "Percent", "width": 100},
		{"label": _("Fulfillment %"), "fieldname": "fulfillment_pct", "fieldtype": "Percent", "width": 110},
		{"label": _("Overall Score"), "fieldname": "overall_score", "fieldtype": "Percent", "width": 110},
		{"label": _("Rating"), "fieldname": "rating", "fieldtype": "Data", "width": 90},
	]


def _data(filters):
	conditions = ["1=1"]
	values = {}

	if filters.get("vendor"):
		conditions.append("vendor = %(vendor)s")
		values["vendor"] = filters["vendor"]

	if filters.get("from_date"):
		conditions.append("period_end >= %(from_date)s")
		values["from_date"] = filters["from_date"]

	if filters.get("to_date"):
		conditions.append("period_end <= %(to_date)s")
		values["to_date"] = filters["to_date"]

	return frappe.db.sql(
		f"""
		SELECT vendor, vendor_name, period_start, period_end,
		       on_time_pct, quality_pct, fulfillment_pct, overall_score, rating
		FROM `tabIB Supplier Score`
		WHERE {" AND ".join(conditions)}
		ORDER BY vendor_name ASC, period_end DESC
		""",
		values,
		as_dict=True,
	)


def _chart(data, filters=None):
	if not data:
		return None
	chart_type = (filters or {}).get("chart_type") or "bar"

	# Single vendor selected -> real trend line over period_end.
	if (filters or {}).get("vendor"):
		rows = sorted(data, key=lambda r: r["period_end"])
		return {
			"data": {
				"labels": [str(r["period_end"]) for r in rows],
				"datasets": [{"name": _("Overall Score"), "values": [flt(r["overall_score"]) for r in rows]}],
			},
			"type": "line" if chart_type == "bar" else chart_type,
			"colors": ["#d97757"],
		}

	# Otherwise: latest row per vendor, top 10 by overall_score.
	latest_by_vendor = {}
	for r in data:
		key = r["vendor"]
		if key not in latest_by_vendor or r["period_end"] > latest_by_vendor[key]["period_end"]:
			latest_by_vendor[key] = r
	top = sorted(latest_by_vendor.values(), key=lambda r: flt(r["overall_score"]), reverse=True)[:10]
	return {
		"data": {
			"labels": [r["vendor_name"] or r["vendor"] for r in top],
			"datasets": [
				{"name": _("Overall Score"), "values": [flt(r["overall_score"]) for r in top]},
				{"name": _("On-Time %"), "values": [flt(r["on_time_pct"]) for r in top]},
			],
		},
		"type": chart_type,
		"colors": ["#d97757", "#2e74b5"],
	}


def _summary(data):
	if not data:
		return None
	latest_by_vendor = {}
	for r in data:
		key = r["vendor"]
		if key not in latest_by_vendor or r["period_end"] > latest_by_vendor[key]["period_end"]:
			latest_by_vendor[key] = r
	latest_rows = list(latest_by_vendor.values())
	avg_score = flt(sum(flt(r["overall_score"]) for r in latest_rows) / len(latest_rows), 1) if latest_rows else 0
	poor_count = sum(1 for r in latest_rows if r["rating"] == "Poor")
	return [
		{"value": len(latest_rows), "label": _("Vendors Scored"), "datatype": "Int", "indicator": "blue"},
		{"value": avg_score, "label": _("Avg Overall Score"), "datatype": "Percent", "indicator": "green"},
		{"value": poor_count, "label": _("Poor-Rated Vendors"), "datatype": "Int", "indicator": "red"},
		{"value": len(data), "label": _("Scorecard Rows (History)"), "datatype": "Int", "indicator": "orange"},
	]
