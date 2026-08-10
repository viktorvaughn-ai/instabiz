"""instabiz.overrides.production_twin

Factory Digital Twin — read-only delivery-feasibility simulator.

Given a target delivery date and either a real Sales Order or an ad-hoc
list of items, estimates whether the factory can deliver by that date,
using the REAL current `IB Work Order` backlog, `IB Machine` capacity/
load, and historical completion-rate data. This module is a pure
calculation against current state: it never creates, modifies, or
touches any real record (no `.insert()`, `.save()`, or
`frappe.db.set_value()` anywhere below — every DB call here is a read).

Reuses the same stage-routing and machine-load-balancing logic
`production.py` already uses for real Work Order creation
(`_get_stage_route`, `_assign_machine_load_balanced`) so the simulation
reasons about the same rules the real `auto_create_all_stage_wos()` /
`advance_to_next_stage()` path would apply, without ever calling those
write paths itself. This app does not use native ERPNext Manufacturing
(BOM/Work Order/Operations/Job Card) — everything below is built against
the app's real custom production model (`IB Work Order` / `IB Machine` /
`IB Order Sheet`).
"""
import json
import math

import frappe
from frappe import _
from frappe.utils import add_days, flt, getdate, nowdate

from instabiz.overrides.production import (
	_assign_machine_load_balanced,
	_get_stage_route,
	_require_production_role,
)

# Trailing window for historical throughput sampling — "reasonable trailing
# window" per spec; 30 days of real Completed Work Orders.
_THROUGHPUT_WINDOW_DAYS = 30

# Assumed working hours/day when converting summed queue+processing hours
# into a calendar completion date. No shift-calendar doctype exists in this
# app to derive this from real data, so it's a documented estimate, not a
# database read — surfaced in the response under `assumptions` rather than
# silently baked in.
_WORKING_HOURS_PER_DAY = 8.0

# Last-resort throughput when a machine has zero Completed-WO history in the
# trailing window AND no usable hourly capacity on its own IB Machine record.
# Clearly flagged in the response (`throughput_source: "default_fallback"`)
# rather than silently masquerading as real data.
_DEFAULT_THROUGHPUT_PER_HOUR = 10.0


@frappe.whitelist()
def simulate(target_delivery_date, sales_order=None, items=None, location=None):
	"""Read-only delivery-feasibility simulation against real production state.

	Args:
		target_delivery_date: date string — the delivery date to test feasibility against.
		sales_order: optional real Sales Order name. Pulls its items and
			`custom_location` automatically. Works for Draft or submitted SOs.
		items: optional ad-hoc list of {"item_code": ..., "qty": ...} dicts
			(or JSON-encoded string of the same) — a what-if scenario before
			an order even exists. Mutually exclusive with `sales_order`.
		location: required when `items` is used instead of `sales_order`
			(maharashtra/gujarat/chennai — case-insensitive) since stage
			routing is location-aware (`_get_stage_route`).

	Returns:
		{
			"feasible": bool,
			"estimated_completion_date": "YYYY-MM-DD",
			"target_delivery_date": "YYYY-MM-DD",
			"bottleneck": {"item_code", "stage", "machine", "reason", ...} | None,
			"per_item_breakdown": [ { "item_code", "qty", "stage_route",
				"stages": [...], "total_hours", "estimated_completion_date",
				"material_check" }, ... ],
			"assumptions": {...},
		}

	This function performs SELECT-only reads (frappe.db.get_value/get_all/sql,
	plus reuse of the existing read-only `_get_stage_route` /
	`_assign_machine_load_balanced` helpers). It never writes to any doctype.
	"""
	_require_production_role()

	if isinstance(items, str) and items:
		items = json.loads(items)

	target_date = getdate(target_delivery_date)
	resolved_items, resolved_location = _resolve_items(sales_order, items, location)

	per_item_breakdown = []
	overall_completion = getdate(nowdate())
	bottleneck = None
	worst_hours = -1.0
	blocking_bottleneck = None  # a stage with literally no machine — always wins

	for row in resolved_items:
		item_code = row["item_code"]
		qty = flt(row["qty"])
		route = _get_stage_route(item_code, resolved_location)
		item_result = _simulate_item(sales_order, item_code, qty, route, resolved_location)
		per_item_breakdown.append(item_result)

		item_completion = getdate(item_result["estimated_completion_date"])
		if item_completion > overall_completion:
			overall_completion = item_completion

		for stage_row in item_result["stages"]:
			if stage_row["status"] == "already_completed":
				continue
			if stage_row["status"] == "no_machine_available" and not blocking_bottleneck:
				blocking_bottleneck = {
					"item_code": item_code,
					"stage": stage_row["stage"],
					"machine": None,
					"reason": "no active machine available for this stage",
				}
				continue
			if stage_row["total_hours"] > worst_hours:
				worst_hours = stage_row["total_hours"]
				if stage_row.get("material_shortage"):
					reason = "material shortage"
				elif stage_row["queue_wait_hours"] >= stage_row["processing_hours"]:
					reason = "queue backlog"
				else:
					reason = "throughput"
				bottleneck = {
					"item_code": item_code,
					"stage": stage_row["stage"],
					"machine": stage_row["machine"],
					"reason": reason,
					"queue_wait_hours": stage_row["queue_wait_hours"],
					"processing_hours": stage_row["processing_hours"],
				}

	# A stage with no machine at all is a harder blocker than a slow one —
	# always surface it over a merely-slow bottleneck.
	final_bottleneck = blocking_bottleneck or bottleneck

	feasible = overall_completion <= target_date

	return {
		"feasible": feasible,
		"estimated_completion_date": str(overall_completion),
		"target_delivery_date": str(target_date),
		"bottleneck": final_bottleneck,
		"per_item_breakdown": per_item_breakdown,
		"assumptions": {
			"working_hours_per_day": _WORKING_HOURS_PER_DAY,
			"throughput_window_days": _THROUGHPUT_WINDOW_DAYS,
			"note": (
				"Queue-wait and processing hours are converted to a calendar date "
				f"assuming {_WORKING_HOURS_PER_DAY:g} working hours/day; this app has no "
				"shift-calendar doctype to derive that from real data. Per-stage "
				"throughput uses each machine's own real trailing "
				f"{_THROUGHPUT_WINDOW_DAYS}-day Completed Work Order history where "
				"available (see each stage's throughput_source)."
			),
		},
	}


# ---------------------------------------------------------------------------
# Item resolution
# ---------------------------------------------------------------------------

def _resolve_items(sales_order, items, location):
	"""Read-only. Returns (list of {item_code, qty}, location)."""
	if sales_order and items:
		frappe.throw(_("Pass either sales_order or items, not both."))
	if not sales_order and not items:
		frappe.throw(_("Pass either sales_order or items."))

	if sales_order:
		so = frappe.db.get_value(
			"Sales Order", sales_order, ["name", "custom_location"], as_dict=True
		)
		if not so:
			frappe.throw(_("Sales Order {0} not found").format(sales_order))
		if not so.custom_location:
			frappe.throw(_(
				"Sales Order {0} has no Location set — stage routing depends on it "
				"(same requirement create_order_sheet() enforces)."
			).format(sales_order))
		so_items = frappe.get_all(
			"Sales Order Item", filters={"parent": sales_order}, fields=["item_code", "qty"]
		)
		if not so_items:
			frappe.throw(_("Sales Order {0} has no items").format(sales_order))
		return [{"item_code": r.item_code, "qty": flt(r.qty)} for r in so_items], so.custom_location

	if not location:
		frappe.throw(_("`location` is required when simulating ad-hoc items (no sales_order given)."))
	if not isinstance(items, list) or not items:
		frappe.throw(_("`items` must be a non-empty list of {item_code, qty}"))
	cleaned = []
	for row in items:
		item_code = row.get("item_code")
		qty = flt(row.get("qty"))
		if not item_code or qty <= 0:
			frappe.throw(_("Each item needs item_code and qty > 0"))
		cleaned.append({"item_code": item_code, "qty": qty})
	return cleaned, location


# ---------------------------------------------------------------------------
# Per-item simulation
# ---------------------------------------------------------------------------

def _existing_wo_chain(sales_order, item_code):
	"""Read-only. If an active (non-Cancelled) Order Sheet already exists for
	this Sales Order, return {stage: wo_row} for the item's real Work Order
	chain — so the simulation reflects real already-Completed / already-
	In-Progress stages instead of pretending every stage starts fresh.

	Known simplification: keyed by item_code only (not order_sheet_item),
	so a Sales Order carrying the same item_code on two separate lines will
	see one merged chain here — acceptable for a feasibility estimate, not
	used by any write path.
	"""
	if not sales_order:
		return {}
	os_name = frappe.db.get_value(
		"IB Order Sheet", {"sales_order": sales_order, "status": ["!=", "Cancelled"]}, "name"
	)
	if not os_name:
		return {}
	rows = frappe.get_all(
		"IB Work Order",
		filters={"order_sheet": os_name, "item_code": item_code, "status": ["!=", "Cancelled"]},
		fields=["name", "stage", "status", "machine", "target_qty", "completed_qty"],
	)
	return {r.stage: r for r in rows}


def _simulate_item(sales_order, item_code, qty, route, location):
	chain = _existing_wo_chain(sales_order, item_code)
	stage_results = []
	total_hours = 0.0

	material_check = None
	if "Coating" in route:
		material_check = _check_material_availability(item_code, qty, location)

	for stage in route:
		existing = chain.get(stage)

		if existing and existing.status == "Completed":
			stage_results.append({
				"stage": stage,
				"machine": existing.machine,
				"status": "already_completed",
				"backlog_qty": 0.0,
				"remaining_qty": 0.0,
				"throughput_per_hour": None,
				"throughput_source": None,
				"queue_wait_hours": 0.0,
				"processing_hours": 0.0,
				"total_hours": 0.0,
				"material_shortage": False,
			})
			continue

		if existing and existing.machine:
			machine = existing.machine
			status = "existing_wo"
			target = flt(existing.target_qty) or qty
			remaining_qty = target - flt(existing.completed_qty)
			if remaining_qty <= 0:
				remaining_qty = target
		else:
			# Future stage with no real machine assigned yet (matches real
			# auto_create_all_stage_wos() behaviour — only the first stage
			# in the route gets a machine immediately) or a fully hypothetical
			# ad-hoc item. Estimate using the same load-balanced pick the
			# real create path would make right now.
			machine = _assign_machine_load_balanced(stage, location)
			status = "existing_wo_unassigned" if existing else "hypothetical"
			remaining_qty = qty

		if not machine:
			stage_results.append({
				"stage": stage,
				"machine": None,
				"status": "no_machine_available",
				"backlog_qty": 0.0,
				"remaining_qty": remaining_qty,
				"throughput_per_hour": None,
				"throughput_source": None,
				"queue_wait_hours": 0.0,
				"processing_hours": 0.0,
				"total_hours": 0.0,
				"material_shortage": False,
			})
			continue

		throughput, source, sample_size = _get_machine_throughput_per_hour(machine, stage)
		backlog_qty = _get_machine_backlog_qty(machine, exclude_wo=(existing.name if existing else None))

		queue_wait_hours = (backlog_qty / throughput) if throughput else 0.0
		processing_hours = (remaining_qty / throughput) if throughput else 0.0
		stage_total_hours = queue_wait_hours + processing_hours

		material_shortage = bool(
			material_check and material_check.get("status") == "insufficient" and stage == "Coating"
		)

		stage_results.append({
			"stage": stage,
			"machine": machine,
			"status": status,
			"backlog_qty": round(backlog_qty, 2),
			"remaining_qty": round(remaining_qty, 2),
			"throughput_per_hour": round(throughput, 2) if throughput else 0.0,
			"throughput_source": source,
			"throughput_sample_wos": sample_size,
			"queue_wait_hours": round(queue_wait_hours, 2),
			"processing_hours": round(processing_hours, 2),
			"total_hours": round(stage_total_hours, 2),
			"material_shortage": material_shortage,
		})
		total_hours += stage_total_hours

	working_days = math.ceil(total_hours / _WORKING_HOURS_PER_DAY) if total_hours > 0 else 0
	estimated_completion_date = add_days(nowdate(), working_days)

	return {
		"item_code": item_code,
		"qty": qty,
		"stage_route": route,
		"stages": stage_results,
		"total_hours": round(total_hours, 2),
		"estimated_completion_date": str(estimated_completion_date),
		"material_check": material_check,
	}


# ---------------------------------------------------------------------------
# Machine backlog + historical throughput (all read-only)
# ---------------------------------------------------------------------------

def _get_machine_backlog_qty(machine, exclude_wo=None):
	"""Read-only. SUM(target_qty) of current Pending/In Progress Work Orders
	on this machine — same "active WO" definition
	`_assign_machine_load_balanced()` already uses for its own load-count
	query, summing target_qty (workload) instead of COUNT(*) (job count)
	since throughput here is qty/hour, not jobs/hour.
	"""
	params = {"machine": machine}
	exclude_clause = ""
	if exclude_wo:
		exclude_clause = "AND name != %(exclude_wo)s"
		params["exclude_wo"] = exclude_wo
	total = frappe.db.sql(
		f"""
		SELECT COALESCE(SUM(target_qty), 0) FROM `tabIB Work Order`
		WHERE machine = %(machine)s AND status IN ('Pending', 'In Progress')
		{exclude_clause}
		""",
		params,
	)
	return flt(total[0][0]) if total else 0.0


def _get_machine_throughput_per_hour(machine, stage):
	"""Read-only. Real historical throughput: total completed_qty / total
	elapsed hours across this machine+stage's Completed Work Orders in the
	trailing `_THROUGHPUT_WINDOW_DAYS`. Falls back to the IB Machine
	master's own `capacity` (only if `capacity_uom` is an hourly or
	per-shift unit) when there's no completed history yet, then to a
	documented default constant. Returns (throughput_per_hour, source, sample_size).
	"""
	since = add_days(nowdate(), -_THROUGHPUT_WINDOW_DAYS)
	rows = frappe.db.sql(
		"""
		SELECT completed_qty, started_at, completed_at
		FROM `tabIB Work Order`
		WHERE machine = %(machine)s AND stage = %(stage)s AND status = 'Completed'
		  AND started_at IS NOT NULL AND completed_at IS NOT NULL
		  AND completed_at >= %(since)s AND completed_qty > 0
		""",
		{"machine": machine, "stage": stage, "since": since},
		as_dict=True,
	)
	total_qty, total_hours = 0.0, 0.0
	for r in rows:
		hours = (r.completed_at - r.started_at).total_seconds() / 3600.0
		if hours > 0:
			total_qty += flt(r.completed_qty)
			total_hours += hours

	if total_hours > 0:
		return total_qty / total_hours, "historical_30d", len(rows)

	cap_row = frappe.db.get_value("IB Machine", machine, ["capacity", "capacity_uom"])
	cap, cap_uom = (cap_row or (0, ""))
	cap = flt(cap)
	cap_uom = (cap_uom or "").lower()
	if cap > 0:
		if cap_uom.endswith("/hour"):
			return cap, "machine_capacity_hourly", 0
		if cap_uom.endswith("/shift"):
			return cap / _WORKING_HOURS_PER_DAY, "machine_capacity_per_shift_estimate", 0

	return _DEFAULT_THROUGHPUT_PER_HOUR, "default_fallback", 0


# ---------------------------------------------------------------------------
# Material availability (Coating-stage only)
# ---------------------------------------------------------------------------

def _check_material_availability(item_code, qty, location):
	"""Read-only. Best-effort raw-material check for Coating-stage items.

	`IB Production Recipe` is a FLAT table (no child rows) — each doc is one
	{finished_item, recipe_item, qty_per} line, and a finished item with
	multiple raw materials has multiple `IB Production Recipe` docs sharing
	the same `finished_item`. This mirrors exactly how `mrp.py`'s
	`_explode_demand()` already reads the same doctype. Wrapped in
	try/except so any future schema change still degrades to "unavailable"
	rather than crashing `simulate()`.
	"""
	if not frappe.db.exists("DocType", "IB Production Recipe"):
		return {
			"status": "unavailable",
			"reason": "IB Production Recipe doctype not found — material check unavailable",
		}
	try:
		recipe_rows = frappe.get_all(
			"IB Production Recipe",
			filters={"finished_item": item_code},
			fields=["recipe_item", "qty_per"],
		)
		if not recipe_rows:
			return {
				"status": "unavailable",
				"reason": f"No IB Production Recipe found for item {item_code}",
			}
		shortages = []
		for row in recipe_rows:
			raw_item = row.recipe_item
			qty_required = flt(row.qty_per) * flt(qty)
			if not raw_item or not qty_required:
				continue
			available = flt(frappe.db.sql(
				"SELECT COALESCE(SUM(actual_qty), 0) FROM `tabBin` WHERE item_code = %s",
				raw_item,
			)[0][0])
			if available < qty_required:
				shortages.append({
					"raw_material": raw_item,
					"required": qty_required,
					"available": available,
				})
		if shortages:
			return {"status": "insufficient", "shortages": shortages}
		return {"status": "sufficient"}
	except Exception:
		frappe.log_error(title="production_twin material check", message=frappe.get_traceback())
		return {
			"status": "unavailable",
			"reason": "Material check failed defensively (see Error Log) — skipped",
		}
