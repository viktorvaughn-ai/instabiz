"""IB Machine Utilization — per-machine per-day utilization %, plus a full
Availability/Performance/Quality/OEE breakdown, built off real `IB Work
Order` started_at/completed_at/completed_qty/wastage_pct data.

Reuses `instabiz.overrides.production.get_machine_day_stats()` /
`compute_oee()` / `_get_available_hours_per_day()` — the exact same pure
functions the Production Dashboard's Machine-wise tab uses for its live
"today" cards — so a number in this report and a number on that dashboard
can never drift apart from computing the same thing two different ways.
OEE is always computed live here (never persisted onto IB Machine/Work
Order), so it can't go stale relative to the source WOs either.

Utilization % (this report's headline column + chart, per the original
spec) IS the Availability leg of OEE: real run time (started_at→completed_at
on Completed Work Orders) divided by the factory's planned shift hours —
see compute_oee()'s own docstring for the exact reasoning and the current
real-data caveats (production is still in a testing phase as of 2026-08-10,
so real run times are unrealistically short — this reads low today and will
self-correct as real floor usage matures, it is not a bug in this report).
Performance/Quality/OEE are exposed on the same grain since the date-range
query already exists for Utilization — this is the one place a manager can
see OEE trend over days, not just the Dashboard's "today" snapshot.

Grain: one row per (machine, day) with >=1 real Completed Work Order. A
machine/day with zero completions has no row at all (same convention
DPR/Weekly DPR already use for empty days) — not a synthetic 0% row.
"""
import frappe
from frappe import _
from frappe.utils import add_days, flt, nowdate

from instabiz.overrides.production import (
	_get_available_hours_per_day,
	compute_oee,
	get_machine_day_stats,
)


def execute(filters=None):
	filters = filters or {}
	data = _data(filters)
	columns = _columns()
	return columns, data, None, _chart(data, filters), _summary(data)


def _columns():
	return [
		{"label": _("Date"), "fieldname": "prod_date", "fieldtype": "Date", "width": 95},
		{"label": _("Machine"), "fieldname": "machine", "fieldtype": "Link", "options": "IB Machine", "width": 100},
		{"label": _("Machine Name"), "fieldname": "machine_name", "fieldtype": "Data", "width": 140},
		{"label": _("Type"), "fieldname": "machine_type", "fieldtype": "Data", "width": 90},
		{"label": _("Location"), "fieldname": "location", "fieldtype": "Data", "width": 90},
		{"label": _("Run Hours"), "fieldname": "run_hours", "fieldtype": "Float", "width": 90, "precision": 2},
		{"label": _("Available Hours"), "fieldname": "available_hours", "fieldtype": "Float", "width": 115, "precision": 1},
		{"label": _("Utilization %"), "fieldname": "utilization_pct", "fieldtype": "Percent", "width": 105},
		{"label": _("Output Qty"), "fieldname": "output_qty", "fieldtype": "Float", "width": 95},
		{"label": _("WOs Completed"), "fieldname": "wo_count", "fieldtype": "Int", "width": 110},
		{"label": _("Performance %"), "fieldname": "performance_pct", "fieldtype": "Percent", "width": 110},
		{"label": _("Quality %"), "fieldname": "quality_pct", "fieldtype": "Percent", "width": 95},
		{"label": _("OEE %"), "fieldname": "oee_pct", "fieldtype": "Percent", "width": 90},
	]


def _data(filters):
	from_date = filters.get("from_date") or add_days(nowdate(), -30)
	to_date = filters.get("to_date") or nowdate()

	machine_filters = {}
	if filters.get("machine"):
		machine_filters["name"] = filters["machine"]
	if filters.get("location"):
		machine_filters["location"] = filters["location"]

	machines = frappe.get_all(
		"IB Machine",
		filters=machine_filters,
		fields=["name", "machine_name", "machine_type", "location", "capacity", "capacity_uom"],
		order_by="machine_type asc, name asc",
	)
	if not machines:
		return []
	machine_map = {m.name: m for m in machines}

	# Single factory-wide shift span (see _get_available_hours_per_day's own
	# docstring — IB Machine has no per-machine shift link to join on), same
	# denominator get_machine_wise_dashboard() uses for "today". A filter
	# override (shift_hours) is accepted for anyone who needs to model a
	# different planned-hours assumption without a code change.
	available_hours = _get_available_hours_per_day(filters.get("shift_hours"))

	stats_rows = get_machine_day_stats(list(machine_map.keys()), from_date, to_date)

	rows = []
	for stat in stats_rows:
		m = machine_map.get(stat.machine)
		if not m:
			continue
		oee = compute_oee(
			run_hours=stat.run_hours or 0,
			output_qty=stat.output_qty or 0,
			avg_wastage_pct=stat.avg_wastage_pct or 0,
			wo_count=stat.wo_count or 0,
			capacity=m.capacity,
			capacity_uom=m.capacity_uom,
			available_hours=available_hours,
		)
		rows.append({
			"prod_date": stat.prod_date,
			"machine": m.name,
			"machine_name": m.machine_name,
			"machine_type": m.machine_type,
			"location": m.location,
			"run_hours": oee["run_hours"],
			"available_hours": oee["available_hours"],
			"utilization_pct": oee["availability_pct"],
			"output_qty": flt(stat.output_qty),
			"wo_count": stat.wo_count,
			"performance_pct": oee["performance_pct"],
			"quality_pct": oee["quality_pct"],
			"oee_pct": oee["oee_pct"],
		})

	rows.sort(key=lambda r: (str(r["prod_date"]), r["machine"]), reverse=True)
	return rows


def _chart(data, filters=None):
	if not data:
		return None
	chart_type = (filters or {}).get("chart_type") or "bar"

	# Avg Utilization % per machine across the filtered range — top 15 (all 8
	# real machines fit easily today; capped to match this app's other
	# per-entity bar charts, e.g. IB Vendor Scorecard's top-10 convention).
	by_machine = {}
	for r in data:
		if r["utilization_pct"] is None:
			continue
		key = r["machine"]
		by_machine.setdefault(key, {"name": r["machine_name"] or key, "vals": []})
		by_machine[key]["vals"].append(flt(r["utilization_pct"]))
	if not by_machine:
		return None
	agg = [
		{"name": v["name"], "avg_util": round(sum(v["vals"]) / len(v["vals"]), 1)}
		for v in by_machine.values()
	]
	agg.sort(key=lambda r: r["avg_util"], reverse=True)
	top = agg[:15]
	return {
		"data": {
			"labels": [r["name"] for r in top],
			"datasets": [{"name": _("Utilization %"), "values": [r["avg_util"] for r in top]}],
		},
		"type": chart_type,
		"colors": ["#d97757"],
	}


def _summary(data):
	if not data:
		return None
	util_vals = [flt(r["utilization_pct"]) for r in data if r["utilization_pct"] is not None]
	oee_vals = [flt(r["oee_pct"]) for r in data if r["oee_pct"] is not None]
	machines_covered = len({r["machine"] for r in data})
	avg_util = round(sum(util_vals) / len(util_vals), 1) if util_vals else 0
	has_oee = bool(oee_vals)
	avg_oee = round(sum(oee_vals) / len(oee_vals), 1) if has_oee else 0
	return [
		{"value": machines_covered, "label": _("Machines with Activity"), "datatype": "Int", "indicator": "blue"},
		{"value": len(data), "label": _("Machine-Days"), "datatype": "Int", "indicator": "orange"},
		{
			"value": avg_util,
			"label": _("Avg Utilization %"),
			"datatype": "Percent",
			"indicator": "green" if avg_util >= 50 else "orange",
		},
		{
			"value": avg_oee,
			"label": _("Avg OEE %") if has_oee else _("Avg OEE % (no wastage data recorded yet)"),
			"datatype": "Percent",
			"indicator": "green" if has_oee and avg_oee >= 50 else "orange",
		},
	]
