"""IB ABC Analysis — Pareto-style item classification by trailing-12-month
consumption value.

Reads the latest run's rows from `IB ABC Classification` (see
instabiz.overrides.abc_analysis.run_abc_analysis) — never recomputes on the
fly. Defaults to the most recent computed_on date found, so the report is
useful immediately after opening without any filter interaction.
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
		{"label": _("Item"), "fieldname": "item", "fieldtype": "Link", "options": "Item", "width": 150},
		{"label": _("Item Name"), "fieldname": "item_name", "fieldtype": "Data", "width": 200},
		{"label": _("Classification"), "fieldname": "classification", "fieldtype": "Data", "width": 100},
		{"label": _("Consumption Value"), "fieldname": "annual_consumption_value", "fieldtype": "Currency", "width": 160},
		{"label": _("% of Total"), "fieldname": "pct_of_total", "fieldtype": "Percent", "width": 100},
		{"label": _("Cumulative %"), "fieldname": "cumulative_pct", "fieldtype": "Percent", "width": 110},
		{"label": _("Computed On"), "fieldname": "computed_on", "fieldtype": "Date", "width": 100},
	]


def _latest_computed_on(filters):
	if filters.get("computed_on"):
		return filters["computed_on"]
	return frappe.db.sql(
		"SELECT MAX(computed_on) FROM `tabIB ABC Classification`"
	)[0][0]


def _data(filters):
	computed_on = _latest_computed_on(filters)
	if not computed_on:
		return []

	conditions = ["computed_on = %(computed_on)s"]
	values = {"computed_on": computed_on}

	if filters.get("classification"):
		conditions.append("classification = %(classification)s")
		values["classification"] = filters["classification"]

	rows = frappe.db.sql(
		f"""
		SELECT item, item_name, classification, annual_consumption_value, pct_of_total, computed_on
		FROM `tabIB ABC Classification`
		WHERE {" AND ".join(conditions)}
		ORDER BY annual_consumption_value DESC
		""",
		values,
		as_dict=True,
	)

	running = 0.0
	total = flt(sum(flt(r["annual_consumption_value"]) for r in rows))
	for r in rows:
		running += flt(r["annual_consumption_value"])
		r["cumulative_pct"] = flt(running / total * 100, 2) if total else 0

	return rows


def _chart(data, filters=None):
	if not data:
		return None
	top = data[:20]
	color_by_class = {"A": "#1a7f37", "B": "#d97757", "C": "#cf222e"}
	return {
		"data": {
			"labels": [r["item"] for r in top],
			"datasets": [
				{"name": _("Consumption Value"), "values": [flt(r["annual_consumption_value"]) for r in top]},
			],
		},
		"type": "bar",
		"colors": [color_by_class.get(top[0]["classification"], "#d97757")] if top else ["#d97757"],
		"barOptions": {"stacked": 0},
	}


def _summary(data):
	if not data:
		return None
	total = flt(sum(flt(r["annual_consumption_value"]) for r in data))
	a_count = sum(1 for r in data if r["classification"] == "A")
	b_count = sum(1 for r in data if r["classification"] == "B")
	c_count = sum(1 for r in data if r["classification"] == "C")
	return [
		{"value": len(data), "label": _("Items Classified"), "datatype": "Int", "indicator": "blue"},
		{"value": total, "label": _("Total Consumption Value"), "datatype": "Currency", "indicator": "green"},
		{"value": a_count, "label": _("A Items"), "datatype": "Int", "indicator": "green"},
		{"value": b_count, "label": _("B Items"), "datatype": "Int", "indicator": "orange"},
		{"value": c_count, "label": _("C Items"), "datatype": "Int", "indicator": "red"},
	]
