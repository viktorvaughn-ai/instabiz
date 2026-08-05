"""instabiz.overrides.production"""
import json

import frappe
from frappe import _
from frappe.model.workflow import apply_workflow
from frappe.utils import today, now, flt, add_days, getdate, nowdate, date_diff

_PRODUCTION_ROLES = {"Factory Management", "Factory Production", "System Manager"}


def _require_production_role():
    if not (_PRODUCTION_ROLES & set(frappe.get_roles())):
        frappe.throw(_("Not permitted — Factory Management role required"), frappe.PermissionError)


def _check_so_production_access(sales_order):
	"""Restrict production visibility to: production-role users, Sales Manager/
	System Manager, or the Sales Order's own sales person/owner. Was previously
	unguarded — any logged-in user could pull any other rep's order detail."""
	if _PRODUCTION_ROLES & set(frappe.get_roles()):
		return
	from instabiz.overrides.permissions import _is_privileged
	if _is_privileged(frappe.session.user):
		return
	row = frappe.db.get_value("Sales Order", sales_order, ["custom_sales_person_user", "owner"], as_dict=True)
	if not row:
		frappe.throw(_("Sales Order {0} not found").format(sales_order))
	if frappe.session.user in (row.custom_sales_person_user, row.owner):
		return
	frappe.throw(_("Not permitted to view production status for this Sales Order"), frappe.PermissionError)

STAGES = [
	"Coating",
	"Slitting",
	"Rewinding",
	"Cutting",
	"Packing",
	"Ready to Deliver",
	"Delivered",
]

_STAGE_MACHINE_TYPE = {
	"Coating":          "Coating",
	"Slitting":         "Slitting",
	"Rewinding":        "Rewinding",
	"Cutting":          "Cutting",
	"Packing":          "Packing",
	"Ready to Deliver": "Despatch",
	"Delivered":        "Despatch",
}

# Stage route per item group — determines which stages apply in order.
# Items skip stages not in their route (e.g. PVC tapes don't need Coating).
_ITEM_GROUP_STAGE_ROUTES = {
	"PLASTIC":           ["Coating", "Slitting", "Rewinding", "Cutting", "Packing", "Ready to Deliver"],
	"PAPER":             ["Coating", "Slitting", "Cutting", "Packing", "Ready to Deliver"],
	"REFLECTIVE":        ["Coating", "Slitting", "Cutting", "Packing", "Ready to Deliver"],
	"PVC":               ["Slitting", "Cutting", "Packing", "Ready to Deliver"],
	"CLOTH":             ["Slitting", "Cutting", "Packing", "Ready to Deliver"],
	"FOAM":              ["Slitting", "Cutting", "Packing", "Ready to Deliver"],
	"FOAM - PE":         ["Slitting", "Cutting", "Packing", "Ready to Deliver"],
	"FOIL":              ["Slitting", "Cutting", "Packing", "Ready to Deliver"],
	"AEROSOL-PAINT":     ["Packing", "Ready to Deliver"],
	"AEROSOL-CLEANER":   ["Packing", "Ready to Deliver"],
	"AEROSOL-LUBRICANT": ["Packing", "Ready to Deliver"],
	"AEROSOL-MULTI":     ["Packing", "Ready to Deliver"],
	"AEROSOL-PU FOAM":   ["Packing", "Ready to Deliver"],
	"SEALANT-ACRYLIC":   ["Packing", "Ready to Deliver"],
	"SEALANT-SILICONE":  ["Packing", "Ready to Deliver"],
	"ADHESIVE-HOTMELT":  ["Packing", "Ready to Deliver"],
}
_DEFAULT_STAGE_ROUTE = ["Cutting", "Packing", "Ready to Deliver"]

# Gujarat is the only factory location (Coating/Slitting/Rewinding/Cutting
# machines all live there). Maharashtra and Chennai are warehouse-only — an
# order routed to either always gets Packing -> Ready to Deliver regardless
# of item group, since there's no factory capability physically there.
_WAREHOUSE_ONLY_LOCATIONS = {"maharashtra", "chennai"}
_WAREHOUSE_STAGE_ROUTE = ["Packing", "Ready to Deliver"]


def _get_stage_route(item_code, location=None):
	"""Return ordered list of production stages for an item.

	`location` is the Sales Order's `custom_location` (maharashtra/gujarat/chennai,
	lowercase). Warehouse-only locations short-circuit to Packing->RTD; Gujarat
	(factory) uses the existing item-group-based route.
	"""
	if (location or "").lower() in _WAREHOUSE_ONLY_LOCATIONS:
		return _WAREHOUSE_STAGE_ROUTE
	item_group = frappe.db.get_value("Item", item_code, "item_group") or ""
	return _ITEM_GROUP_STAGE_ROUTES.get(item_group, _DEFAULT_STAGE_ROUTE)


def _assign_machine_load_balanced(stage, location=None):
	"""Return least-loaded active machine for stage (prefer same location).

	Load = number of active (Pending + In Progress) Work Orders currently on the machine.
	If capacity is set on the machine, machines at/over capacity are skipped first.
	"""
	machine_type = _STAGE_MACHINE_TYPE.get(stage)
	if not machine_type:
		return None

	machines = frappe.db.get_all(
		"IB Machine",
		filters={"machine_type": machine_type, "status": "Active"},
		fields=["name", "location", "capacity"],
		order_by="name asc",
	)
	if not machines:
		return None

	# Prefer same-location machines; fall back to any
	preferred = [m for m in machines if not location or m.location == location]
	pool = preferred if preferred else machines

	if len(pool) == 1:
		return pool[0].name

	# Count active WOs per machine
	machine_names = [m.name for m in pool]
	placeholders = ", ".join(["%s"] * len(machine_names))
	load_rows = frappe.db.sql(
		f"""
		SELECT machine, COUNT(*) AS load_count
		FROM `tabIB Work Order`
		WHERE machine IN ({placeholders}) AND status IN ('Pending', 'In Progress')
		GROUP BY machine
		""",
		tuple(machine_names),
		as_dict=True,
	)
	load_map = {r.machine: r.load_count for r in load_rows}

	# Sort by load ascending — ties broken by name (stable order)
	pool.sort(key=lambda m: load_map.get(m.name, 0))

	# Skip machines at/over capacity (if capacity > 0)
	for m in pool:
		cap = flt(m.capacity)
		if cap > 0 and load_map.get(m.name, 0) >= cap:
			continue
		return m.name

	# All machines over capacity — assign to least-loaded anyway
	return pool[0].name


# Keep original name as alias for any callers that still reference it
def _auto_assign_machine(stage, location=None):
	return _assign_machine_load_balanced(stage, location)


def _get_os_location(order_sheet):
	"""Return location string for machine matching by following Order Sheet → SO → custom_location."""
	so_name = frappe.db.get_value("IB Order Sheet", order_sheet, "sales_order")
	if not so_name:
		return None
	loc = frappe.db.get_value("Sales Order", so_name, "custom_location")
	return (loc or "").lower() or None


# ---------------------------------------------------------------------------
# 1. Dashboard
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_production_dashboard(location=None):
	"""KPIs + stage pipeline counts + recent entries.

	location: optional Sales Order custom_location filter (maharashtra/gujarat/chennai) —
	narrows every count below to Work Orders whose Order Sheet's Sales Order is there.
	"""
	_require_production_role()
	today_date = today()

	loc_filter = ""
	params = {"today": today_date, "location": location}
	if location:
		loc_filter = """AND wo.order_sheet IN (
			SELECT os.name FROM `tabIB Order Sheet` os
			JOIN `tabSales Order` so ON so.name = os.sales_order
			WHERE so.custom_location = %(location)s
		)"""

	active_wo = frappe.db.sql(
		f"SELECT COUNT(*) FROM `tabIB Work Order` wo WHERE wo.status NOT IN ('Completed','Cancelled') {loc_filter}",
		params,
	)[0][0]
	pending_wo = frappe.db.sql(
		f"SELECT COUNT(*) FROM `tabIB Work Order` wo WHERE wo.status = 'Pending' {loc_filter}",
		params,
	)[0][0]

	completed_today = frappe.db.sql(
		f"""
		SELECT COUNT(*) FROM `tabIB Work Order` wo
		WHERE wo.status = 'Completed'
		  AND DATE(COALESCE(wo.completed_at, wo.modified)) = %(today)s
		  {loc_filter}
		""",
		params,
	)[0][0]

	machines_active = frappe.db.count(
		"IB Machine", {"status": "Active", **({"location": location} if location else {})}
	)

	# Stage pipeline
	stage_rows = frappe.db.sql(
		f"""
		SELECT wo.stage, wo.status, COUNT(*) AS cnt
		FROM `tabIB Work Order` wo
		WHERE 1=1 {loc_filter}
		GROUP BY wo.stage, wo.status
		""",
		params,
		as_dict=True,
	)
	# Use lowercase_underscore keys so JS STAGE_COLORS lookup works directly
	def _stage_key(s):
		return s.lower().replace(" ", "_")

	# Warehouse-only locations never run Coating/Slitting/Rewinding/Cutting — don't
	# even show those as empty cards when a warehouse location is selected.
	visible_stages = (
		["Packing", "Ready to Deliver", "Delivered"]
		if (location or "").lower() in _WAREHOUSE_ONLY_LOCATIONS
		else STAGES
	)
	stage_map = {s: {"stage": _stage_key(s), "pending": 0, "in_progress": 0, "completed": 0} for s in visible_stages}
	for row in stage_rows:
		if row.stage not in stage_map:
			if location and row.stage not in visible_stages:
				continue
			stage_map[row.stage] = {"stage": _stage_key(row.stage), "pending": 0, "in_progress": 0, "completed": 0}
		if row.status == "Pending":
			stage_map[row.stage]["pending"] = row.cnt
		elif row.status == "In Progress":
			stage_map[row.stage]["in_progress"] = row.cnt
		elif row.status == "Completed":
			stage_map[row.stage]["completed"] = row.cnt
	stage_pipeline = [stage_map[s] for s in STAGES if s in stage_map]

	# Priority overview — lowercase keys match JS badge lookup
	priority_rows = frappe.db.sql(
		f"""
		SELECT os.priority, COUNT(*) AS cnt
		FROM `tabIB Work Order` wo
		JOIN `tabIB Order Sheet` os ON os.name = wo.order_sheet
		WHERE 1=1 {loc_filter}
		GROUP BY os.priority
		""",
		params,
		as_dict=True,
	)
	priority_overview = {"urgent": 0, "high": 0, "normal": 0, "low": 0}
	for row in priority_rows:
		if row.priority:
			priority_overview[row.priority.lower()] = row.cnt

	# Wastage today — IB Production Entry is never populated in real usage (0 rows,
	# verified live) even though a capture dialog exists; source from completed Work
	# Orders instead, same fallback pattern already used in get_dpr().
	wastage_result = frappe.db.sql(
		f"""
		SELECT AVG(wo.wastage_pct) FROM `tabIB Work Order` wo
		WHERE wo.status = 'Completed' AND DATE(COALESCE(wo.completed_at, wo.modified)) = %(today)s
		{loc_filter}
		""",
		params,
	)
	wastage_today = round(flt(wastage_result[0][0]), 1) if wastage_result and wastage_result[0][0] else 0.0

	# Recent 10 completions (IB Production Entry has no real data — see above)
	recent_entries = frappe.db.sql(
		f"""
		SELECT wo.name, wo.stage, wo.machine, wo.completed_qty AS output_qty,
			wo.wastage_pct, DATE(COALESCE(wo.completed_at, wo.modified)) AS entry_date
		FROM `tabIB Work Order` wo
		WHERE wo.status = 'Completed'
		{loc_filter}
		ORDER BY COALESCE(wo.completed_at, wo.modified) DESC
		LIMIT 10
		""",
		params,
		as_dict=True,
	)

	return {
		"summary": {
			"active_work_orders": active_wo,
			"pending": pending_wo,
			"completed_today": completed_today,
			"machines_active": machines_active,
		},
		"pipeline": stage_pipeline,
		"priority_overview": priority_overview,
		"avg_wastage_today": wastage_today,
		"recent_entries": recent_entries,
	}


# ---------------------------------------------------------------------------
# 2. Machines
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_machines(machine_type=None, location=None):
	"""Return all machines, optionally filtered."""
	filters = {}
	if machine_type:
		filters["machine_type"] = machine_type
	if location:
		filters["location"] = location

	machines = frappe.get_all(
		"IB Machine",
		filters=filters,
		fields=[
			"name",
			"machine_code",
			"machine_name",
			"machine_type",
			"location",
			"capacity",
			"capacity_uom",
			"wastage_norm_pct",
			"status",
			"notes",
		],
		order_by="machine_code asc",
	)

	return machines


@frappe.whitelist()
def save_machine(
	machine_code,
	machine_name,
	machine_type,
	location,
	capacity,
	wastage_norm_pct,
	status,
	capacity_uom="",
	notes=None,
	name=None,  # ignored — machine_code IS the name (autoname = field:machine_code)
):
	"""Create or update IB Machine. Requires Factory Management or System Manager."""
	_require_production_role()
	exists = frappe.db.exists("IB Machine", machine_code)
	if exists:
		doc = frappe.get_doc("IB Machine", machine_code)
	else:
		doc = frappe.new_doc("IB Machine")
		doc.machine_code = machine_code

	doc.machine_name = machine_name
	doc.machine_type = machine_type
	doc.location = location
	doc.capacity = flt(capacity)
	doc.capacity_uom = capacity_uom or ""
	doc.wastage_norm_pct = flt(wastage_norm_pct)
	doc.status = status
	doc.notes = notes or ""
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return doc.name


# ---------------------------------------------------------------------------
# 3. Order Sheets
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_order_sheets(status=None, priority=None, location=None, search=None):
	"""Return order sheets with progress %."""
	_require_production_role()
	filters = {}
	if status:
		filters["status"] = status
	if priority:
		filters["priority"] = priority
	if location:
		loc_sos = frappe.get_all("Sales Order", filters={"custom_location": location}, pluck="name")
		filters["sales_order"] = ["in", loc_sos or [""]]

	or_filters = None
	if search:
		like = f"%{search}%"
		or_filters = [["sales_order", "like", like], ["customer_name", "like", like]]

	sheets = frappe.get_all(
		"IB Order Sheet",
		filters=filters,
		or_filters=or_filters,
		fields=[
			"name",
			"sales_order",
			"customer",
			"order_date",
			"delivery_date",
			"priority",
			"status",
		],
		order_by="creation desc",
		# Safety ceiling — this was previously unbounded (full-table fetch every
		# call) while the Order-wise tab's own UI already paginates client-side
		# at 20/page; 467 Order Sheets already exist live, so this was a real,
		# already-active scale risk, not a hypothetical one.
		limit_page_length=500,
	)

	if not sheets:
		return []

	sheet_names = [s.name for s in sheets]
	placeholders = ", ".join(["%s"] * len(sheet_names))

	# Item counts and completed item counts per order sheet
	item_counts = frappe.db.sql(
		f"""
		SELECT parent,
			COUNT(*) AS total_items,
			SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed_items
		FROM `tabIB Order Sheet Item`
		WHERE parent IN ({placeholders})
		GROUP BY parent
		""",
		tuple(sheet_names),
		as_dict=True,
	)
	count_map = {row.parent: row for row in item_counts}

	# Customer name from Customer master. Uses its OWN placeholder count — the
	# previous version reused `placeholders` (sized to len(sheet_names)) for a
	# tuple built from `[s.customer for s in sheets if s.customer]`, which is a
	# different length whenever any sheet has a blank customer, causing a SQL
	# parameter-count mismatch.
	customers = [s.customer for s in sheets if s.customer]
	if customers:
		customer_placeholders = ", ".join(["%s"] * len(customers))
		customer_names = frappe.db.sql(
			f"""
			SELECT name, customer_name FROM `tabCustomer`
			WHERE name IN ({customer_placeholders})
			""",
			tuple(customers),
			as_dict=True,
		)
	else:
		customer_names = []
	cname_map = {r.name: r.customer_name for r in customer_names}

	result = []
	for s in sheets:
		counts = count_map.get(s.name)
		total = counts.total_items if counts else 0
		completed = counts.completed_items if counts else 0
		progress_pct = round((flt(completed) / flt(total) * 100), 1) if total else 0.0
		result.append({
			"name": s.name,
			"sales_order": s.sales_order,
			"customer": s.customer,
			"customer_name": cname_map.get(s.customer, s.customer),
			"order_date": s.order_date,
			"delivery_date": s.delivery_date,
			"priority": s.priority,
			"status": s.status,
			"item_count": total,
			"progress_pct": progress_pct,
		})

	return result


@frappe.whitelist()
def create_order_sheet(sales_order, priority="Normal", notes=None):
	"""Create IB Order Sheet from Sales Order. Pulls items automatically."""
	_require_production_role()

	# Advisory lock prevents two concurrent requests from creating duplicate Order Sheets
	lock_name = f"IB-OS-{sales_order}"
	locked = frappe.db.sql("SELECT GET_LOCK(%s, 5)", lock_name)[0][0]
	if not locked:
		frappe.throw(_("Could not acquire lock for Order Sheet creation. Please try again."))

	# Everything below holds the advisory lock — release it on ANY exit path
	# (validation error, SO fetch failure, insert failure, WO auto-create failure),
	# not just the duplicate-check branch. Otherwise the lock leaks for the life
	# of the DB connection and blocks all future Order Sheet creation for this SO.
	try:
		# for_update=True: the GET_LOCK advisory lock above only serializes *when*
		# two callers' critical sections run — it does nothing about each caller's
		# own already-open REPEATABLE-READ transaction (MariaDB default here,
		# autocommit=0) still seeing a pre-lock snapshot that predates the other
		# caller's commit. A plain read here can return "no existing Order Sheet"
		# for both callers even though they're strictly serialized by the lock,
		# because InnoDB/MariaDB consistent reads under REPEATABLE READ ignore
		# what committed after the transaction's own snapshot was taken. FOR UPDATE
		# forces a locking read of the latest committed row instead of the stale
		# snapshot, closing that gap. Confirmed live: this exact race produced two
		# independent Order Sheets (each with its own full Work Order chain) for
		# one Sales Order when the on-submit background auto-create job
		# (_create_order_sheet_for_so) and an explicit create_order_sheet() call
		# landed close together — same failure class as the historical
		# IB-OS-2026-02038 duplicate-WO incident, one layer up (whole Order Sheet,
		# not just a stage WO).
		existing = frappe.db.get_value(
			"IB Order Sheet",
			{"sales_order": sales_order, "status": ["!=", "Cancelled"]},
			"name",
			for_update=True,
		)
		if existing:
			frappe.throw(
				_("An active Order Sheet ({0}) already exists for Sales Order {1}").format(existing, sales_order)
			)

		so = frappe.get_doc("Sales Order", sales_order)

		customer_name = frappe.db.get_value("Customer", so.customer, "customer_name") or so.customer

		doc = frappe.new_doc("IB Order Sheet")
		doc.sales_order = sales_order
		doc.customer = so.customer
		doc.customer_name = customer_name
		doc.order_date = so.transaction_date
		doc.delivery_date = so.delivery_date
		doc.priority = priority
		doc.status = "Draft"
		if notes:
			doc.notes = notes

		# Pull items from SO. sales_order_item captures the exact source Sales
		# Order Item row (item.name) — a Sales Order can carry the same
		# item_code on multiple separate lines with different quantities, so
		# custom_make_delivery_note() needs this to map back to precisely the
		# one row that's actually ready, not every row sharing that item_code.
		for item in so.items:
			doc.append("items", {
				"item_code": item.item_code,
				"item_name": item.item_name,
				"qty": item.qty,
				"uom": item.uom,
				"completed_qty": 0.0,
				"status": "Pending",
				"sales_order_item": item.name,
			})

		doc.insert(ignore_permissions=True)
		frappe.db.commit()

		# Auto-create WOs for ALL applicable stages per item (route-aware)
		auto_create_all_stage_wos(doc.name)

		return doc.name
	finally:
		frappe.db.sql("SELECT RELEASE_LOCK(%s)", lock_name)


@frappe.whitelist()
def get_available_sales_orders():
	"""Return submitted SOs with no active Order Sheet."""
	_require_production_role()
	rows = frappe.db.sql(
		"""
		SELECT so.name, so.customer, so.transaction_date, so.delivery_date,
			so.grand_total, so.status
		FROM `tabSales Order` so
		WHERE so.docstatus = 1
		AND so.name NOT IN (
			SELECT sales_order FROM `tabIB Order Sheet`
			WHERE status != 'Cancelled' AND sales_order IS NOT NULL
		)
		ORDER BY so.transaction_date DESC
		""",
		as_dict=True,
	)
	return rows


# ---------------------------------------------------------------------------
# 4. Stage Pipeline
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_stage_pipeline(location=None):
	"""Return each item's CURRENT stage only, grouped by stage — powers the
	Stage-wise view (a stage picker + flat table, not the old drag-and-drop
	Kanban this function originally backed — that was removed 2026-07-30 for
	being confusing, see item 119; this query survived, unwired, until now).
	On Hold is included deliberately: a stage supervisor's most important row
	is what's stuck at their own station, not just what's actively moving —
	the old Kanban-era query only ever showed Pending/In Progress.

	auto_create_all_stage_wos() pre-creates one IB Work Order per stage in an
	item's whole route up front (see item 84) — a 4-stage item that hasn't
	started yet already has 4 real WO rows, all sitting Pending. A naive
	"every Pending/In Progress/On Hold WO" query (the original shape of this
	function) therefore showed that one item at all 4 of its stages
	simultaneously, before it had actually reached any of them — confirmed
	live 2026-08-05. Fixed by grouping WOs per item (order_sheet_item, same
	key _update_order_sheet_item() uses, falling back to order_sheet+item_code
	for legacy WOs missing it) and keeping only that item's CURRENT stage: the
	first stage in STAGES order that's In Progress/On Hold, else the earliest
	Pending one — same "current_stage" rule already used elsewhere in this
	file (see get_production_plan()'s order_wise item loop).

	Returns everything for every stage in one call (counts double as each
	stage pill's badge) rather than a per-stage endpoint — this page's real
	WO volume doesn't justify N+1 fetches every time the picker changes tabs.
	"""
	_require_production_role()
	conditions = ["wo.status IN ('Pending', 'In Progress', 'On Hold')"]
	params = {}
	if location:
		conditions.append("so.custom_location = %(location)s")
		params["location"] = location.lower()
	where = " AND ".join(conditions)

	rows = frappe.db.sql(
		f"""
		SELECT wo.name, wo.item_code, wo.stage, wo.machine, wo.status,
			wo.target_qty, wo.target_uom, wo.completed_qty, wo.wastage_pct,
			wo.order_sheet, wo.order_sheet_item, wo.sales_order, wo.priority AS wo_priority,
			wo.creation,
			COALESCE(osi.item_name, wo.item_name) AS item_name,
			os.priority, os.customer_name, os.delivery_date
		FROM `tabIB Work Order` wo
		LEFT JOIN `tabIB Order Sheet` os ON os.name = wo.order_sheet
		LEFT JOIN `tabIB Order Sheet Item` osi ON osi.name = wo.order_sheet_item
		LEFT JOIN `tabSales Order` so ON so.name = wo.sales_order
		WHERE {where}
		ORDER BY wo.stage, FIELD(os.priority, 'Urgent', 'High', 'Normal', 'Low'), wo.creation
		""",
		params,
		as_dict=True,
	)

	stage_rank = {s: i for i, s in enumerate(STAGES)}
	groups = {}
	for row in rows:
		key = row.order_sheet_item or f"{row.order_sheet}::{row.item_code}"
		groups.setdefault(key, []).append(row)

	def _sk(s):
		return s.lower().replace(" ", "_")

	pipeline = {_sk(stage): [] for stage in STAGES}
	for wos in groups.values():
		wos.sort(key=lambda r: stage_rank.get(r.stage, 999))
		current = next((r for r in wos if r.status in ("In Progress", "On Hold")), None)
		if not current:
			current = next((r for r in wos if r.status == "Pending"), None)
		if not current:
			continue
		row = current
		key = _sk(row.get("stage", ""))
		entry = {
			"name": row.name,
			"item_code": row.item_code,
			"item_name": row.item_name,
			"machine": row.machine,
			"priority": row.priority or row.wo_priority,
			"status": row.status,
			"target_qty": row.target_qty,
			"target_uom": row.target_uom,
			"completed_qty": row.completed_qty,
			"wastage_pct": row.wastage_pct,
			"order_sheet": row.order_sheet,
			"order_sheet_item": row.order_sheet_item,
			"sales_order": row.sales_order,
			"customer_name": row.customer_name,
			"delivery_date": str(row.delivery_date) if row.delivery_date else None,
		}
		pipeline.setdefault(key, []).append(entry)

	return pipeline


# ---------------------------------------------------------------------------
# 5. Order Sheet Detail
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_order_sheet_detail(order_sheet):
	"""Full detail for one Order Sheet: doc, work_orders, views."""
	_require_production_role()
	doc = frappe.get_doc("IB Order Sheet", order_sheet)

	items = []
	for item in doc.items:
		items.append({
			"name": item.name,
			"item_code": item.item_code,
			"item_name": item.item_name,
			"qty": item.qty,
			"uom": item.uom,
			"completed_qty": item.completed_qty,
			"status": item.status,
		})

	work_orders = frappe.get_all(
		"IB Work Order",
		filters={"order_sheet": order_sheet},
		fields=[
			"name",
			"item_code",
			"order_sheet_item",
			"stage",
			"machine",
			"operator",
			"status",
			"target_qty",
			"completed_qty",
			"wastage_qty",
			"wastage_pct",
			"started_at",
			"completed_at",
			"sales_order",
			"order_sheet",
			"jumbo_roll",
			"creation",
		],
		order_by="creation asc",
	)

	# Order-wise view: items with their WOs listed per item. Grouping by plain
	# item_code (wo_by_item, still used below for product_wise_view) conflates
	# WOs across multiple Order Sheet Item rows that share the same item_code
	# (e.g. one SKU ordered as separate line items at different quantities) —
	# every row matching that item_code would show the full merged bucket
	# instead of just its own WOs. Same fragility already fixed on the write
	# side in _update_order_sheet_item(): key by order_sheet_item (the unique
	# child-row name) when the WO has it; fall back to an item_code match only
	# for genuinely legacy WOs that predate order_sheet_item being populated.
	order_wise_view = []
	wo_by_item = {}
	wo_by_osi = {}
	wo_by_item_legacy = {}
	for wo in work_orders:
		wo_by_item.setdefault(wo.item_code, []).append(wo)
		if wo.order_sheet_item:
			wo_by_osi.setdefault(wo.order_sheet_item, []).append(wo)
		else:
			wo_by_item_legacy.setdefault(wo.item_code, []).append(wo)

	for item in items:
		row_wos = wo_by_osi.get(item["name"], []) + wo_by_item_legacy.get(item["item_code"], [])
		order_wise_view.append({
			**item,
			"work_orders": row_wos,
		})

	# Product-wise view: per item → {stage: {status, wo_name, completed_qty, target_qty}}
	product_wise_view = {}
	for item in items:
		stage_dict = {}
		for stage in STAGES:
			stage_dict[stage] = {
				"status": None,
				"wo_name": None,
				"completed_qty": 0,
				"target_qty": 0,
			}
		for wo in wo_by_item.get(item["item_code"], []):
			if wo.stage in stage_dict:
				stage_dict[wo.stage] = {
					"status": wo.status,
					"wo_name": wo.name,
					"completed_qty": wo.completed_qty,
					"target_qty": wo.target_qty,
				}
		product_wise_view[item["item_code"]] = stage_dict

	# Machine-wise view: per machine assigned to WOs of this OS
	machines_in_use = list({wo.machine for wo in work_orders if wo.machine})
	machine_wise_view = {}
	if machines_in_use:
		machine_docs = frappe.get_all(
			"IB Machine",
			filters={"machine_code": ["in", machines_in_use]},
			fields=["machine_code", "machine_name", "machine_type"],
		)
		minfo = {m.machine_code: m for m in machine_docs}
		for machine_code in machines_in_use:
			info = minfo.get(machine_code, frappe._dict())
			machine_wise_view[machine_code] = {
				"machine_code": machine_code,
				"machine_name": info.get("machine_name", machine_code),
				"type": info.get("machine_type", ""),
				"wos": [wo for wo in work_orders if wo.machine == machine_code],
			}

	os_fields = {
		"name": doc.name,
		"sales_order": doc.sales_order,
		"customer": doc.customer,
		"order_date": doc.order_date,
		"delivery_date": doc.delivery_date,
		"priority": doc.priority,
		"status": doc.status,
		"notes": doc.get("notes", ""),
	}

	return {
		"order_sheet": os_fields,
		"items": items,
		"work_orders": [dict(wo) for wo in work_orders],
		"order_wise_view": order_wise_view,
		"product_wise_view": product_wise_view,
		"machine_wise_view": machine_wise_view,
	}


@frappe.whitelist()
def get_order_sheet_wo_names(order_sheet):
	"""Names of the ONE currently-actionable Work Order per item under an
	Order Sheet — for the Order-wise list's bulk "Print Job Order" action.

	Was previously every non-Cancelled WO for every item, across every stage
	in that item's route — a 6-stage item printed 6 pages (3 Completed, 1
	In Progress, 2 not-yet-started) instead of the single page a floor
	worker actually needs. Now: walk each item's real stage route (same
	route _get_stage_route()/get_production_plan() already use) in order,
	and take the first stage whose WO is NOT Completed (Pending/In Progress/
	On Hold) — that's the one thing this item still needs done. An item
	whose every stage is already Completed contributes nothing (nothing
	left to hand a floor worker).
	"""
	_require_production_role()
	location = _get_os_location(order_sheet)
	items = frappe.db.get_all(
		"IB Order Sheet Item",
		filters={"parent": order_sheet},
		fields=["name", "item_code"],
	)
	if not items:
		return []

	names = []
	for item in items:
		stage_route = _get_stage_route(item.item_code, location)
		wos = frappe.db.get_all(
			"IB Work Order",
			filters={
				"order_sheet": order_sheet,
				"order_sheet_item": item.name,
				"status": ["!=", "Cancelled"],
			},
			fields=["name", "stage", "status"],
		)
		wo_by_stage = {wo.stage: wo for wo in wos}
		for stage in stage_route:
			wo = wo_by_stage.get(stage)
			if wo and wo.status != "Completed":
				names.append(wo.name)
				break

	return names


_SUMMARY_STAGES = ["Coating", "Slitting", "Rewinding", "Cutting", "Packing", "Ready to Deliver"]


@frappe.whitelist()
def get_order_sheet_stage_workflow(order_sheet):
	"""Per-item full stage routing for the "IB Job Order Summary" print format's
	stage x machine grid — one row per Order Sheet Item, one column per stage in
	_SUMMARY_STAGES, showing the real machine allotment (or lack of one) at every
	stage of that item's actual route (via _get_stage_route — route-aware, same
	helper get_order_sheet_wo_names()/auto_create_all_stage_wos() already use).

	Unlike get_order_sheet_wo_names() (which returns only the ONE currently-
	actionable WO per item), this returns the FULL chain so the printed sheet
	can show completed / current / not-yet-reached / not-in-route honestly —
	all stage WOs for an item are created upfront by auto_create_all_stage_wos(),
	but only the first stage gets a machine at creation time; later stages sit
	as Pending with no machine until advance_to_next_stage() activates them.
	That is real, expected data — not a gap to hide.

	Keyed by order_sheet_item (child row name), not bare item_code, so an item
	appearing on multiple rows of the same order sheet doesn't collide.

	Also carries each item's real dimension fields (color/width_mm/length_mtr/
	qty_pkg/total_pkg, from the underlying Sales Order Item) plus sheet-wide
	any_* flags — the print format uses these to show only the dimension
	columns that actually have data anywhere on the sheet (a SQMT roll item
	and a PCS packed item can sit on the same order sheet; each only fills in
	its own columns, the other's stay blank rather than adding a column no
	row on the sheet ever uses).
	"""
	_require_production_role()
	location = _get_os_location(order_sheet)
	sales_order = frappe.db.get_value("IB Order Sheet", order_sheet, "sales_order")
	items = frappe.db.get_all(
		"IB Order Sheet Item",
		filters={"parent": order_sheet},
		fields=["name", "item_code", "item_name", "qty", "uom"],
	)

	any_color = any_width_mm = any_length_mtr = any_qty_pkg = any_total_pkg = False

	result = []
	for item in items:
		dims = frappe.db.get_value(
			"Sales Order Item",
			{"parent": sales_order, "item_code": item.item_code},
			["color", "width_mm", "length_mtr", "qty_pkg", "total_pkg"],
			as_dict=True,
		) if sales_order else None
		dims = dims or frappe._dict()
		any_color = any_color or bool(dims.color)
		any_width_mm = any_width_mm or bool(dims.width_mm)
		any_length_mtr = any_length_mtr or bool(dims.length_mtr)
		any_qty_pkg = any_qty_pkg or bool(dims.qty_pkg)
		any_total_pkg = any_total_pkg or bool(dims.total_pkg)

		stage_route = _get_stage_route(item.item_code, location)
		wos = frappe.db.get_all(
			"IB Work Order",
			filters={
				"order_sheet": order_sheet,
				"order_sheet_item": item.name,
				"status": ["!=", "Cancelled"],
			},
			fields=["name", "stage", "status", "machine", "pcs_to_make", "logs_to_make",
			        "target_qty", "target_uom"],
		)
		wo_by_stage = {wo.stage: wo for wo in wos}

		# Same "one actionable stage" rule as get_order_sheet_wo_names(): first
		# stage in real route order whose WO is not yet Completed.
		current_stage = None
		for stage in stage_route:
			wo = wo_by_stage.get(stage)
			if wo and wo.status != "Completed":
				current_stage = stage
				break

		stages_out = []
		for stage in _SUMMARY_STAGES:
			if stage not in stage_route:
				stages_out.append({
					"stage": stage, "in_route": False, "machine": None,
					"status": None, "is_current": False,
				})
				continue
			wo = wo_by_stage.get(stage)
			stages_out.append({
				"stage": stage,
				"in_route": True,
				"machine": wo.machine if wo else None,
				"status": wo.status if wo else None,
				"is_current": stage == current_stage,
			})

		# Manager reconciliation (Adjust Qty) is set on whichever stage WO the
		# manager opened — check the whole chain, not just one stage.
		pcs_to_make = next((flt(wo.pcs_to_make) for wo in wos if wo.pcs_to_make), 0)
		logs_to_make = next((flt(wo.logs_to_make) for wo in wos if wo.logs_to_make), 0)
		target_uom = next((wo.target_uom for wo in wos if wo.target_uom), item.uom)

		result.append({
			"item_code": item.item_code,
			"item_name": item.item_name,
			"qty": item.qty,
			"uom": item.uom,
			"target_uom": target_uom,
			"pcs_to_make": pcs_to_make,
			"logs_to_make": logs_to_make,
			"color": dims.color,
			"width_mm": dims.width_mm,
			"length_mtr": dims.length_mtr,
			"qty_pkg": dims.qty_pkg,
			"total_pkg": dims.total_pkg,
			"stages": stages_out,
		})

	return {
		"rows": result,
		"any_color": any_color,
		"any_width_mm": any_width_mm,
		"any_length_mtr": any_length_mtr,
		"any_qty_pkg": any_qty_pkg,
		"any_total_pkg": any_total_pkg,
	}


# ---------------------------------------------------------------------------
# 6. Work Order operations
# ---------------------------------------------------------------------------

@frappe.whitelist()
@frappe.whitelist()
def get_order_dn_readiness(order_sheet):
	"""Whether every item in this Order Sheet has reached Completed at every
	stage — i.e. the whole Sales Order is actually ready to ship, not just
	the one item/WO the caller happens to be looking at.

	Reuses IB Order Sheet.status as the single source of truth: it's only
	ever set to "Completed" once every real Work Order for every item on
	the sheet is itself Completed (see _update_order_sheet_progress, fixed
	2026-08-05 to be symmetric/reliable). Powers the WO side panel's
	"Create Delivery Note" gate — previously that button appeared as soon
	as ONE item's own WO reached Completed at Ready to Deliver, letting a
	rep create a Delivery Note for a single item while the rest of the
	order was still mid-production.
	"""
	_require_production_role()
	if not order_sheet:
		return {"ready": False}
	status = frappe.db.get_value("IB Order Sheet", order_sheet, "status")
	return {"ready": status == "Completed"}


@frappe.whitelist()
def get_work_order_detail(work_order):
	"""Full WO detail + production entries history."""
	_require_production_role()
	doc = frappe.get_doc("IB Work Order", work_order)

	entries = frappe.get_all(
		"IB Production Entry",
		filters={"work_order": work_order},
		fields=[
			"name",
			"stage",
			"machine",
			"operator",
			"entry_date",
			"input_qty",
			"output_qty",
			"wastage_qty",
			"wastage_pct",
			"status",
			"docstatus",
		],
		order_by="entry_date desc, creation desc",
	)

	wo_fields = {
		"name": doc.name,
		"order_sheet": doc.order_sheet,
		"item_code": doc.item_code,
		"stage": doc.stage,
		"machine": doc.machine,
		"operator": doc.operator,
		"status": doc.status,
		"target_qty": doc.target_qty,
		"completed_qty": doc.completed_qty,
		"wastage_qty": doc.wastage_qty,
		"wastage_pct": doc.wastage_pct,
		"started_at": doc.started_at,
		"completed_at": doc.completed_at,
	}

	return {
		**wo_fields,
		"production_entries": [dict(e) for e in entries],
	}


@frappe.whitelist()
def assign_machine(work_order, machine):
	"""Assign machine to work order (only if Pending)."""
	_require_production_role()
	# Advisory lock — same pattern as start_work_order/complete_work_order/etc.
	# Without it, two concurrent assign_machine calls on the same WO can both
	# pass the "is Pending" check before either write lands.
	lock_name = f"IB-WO-{work_order}"
	locked = frappe.db.sql("SELECT GET_LOCK(%s, 5)", lock_name)[0][0]
	if not locked:
		frappe.throw(_("Could not acquire lock for Work Order {0}. Please try again.").format(work_order))
	try:
		doc = frappe.get_doc("IB Work Order", work_order)
		if doc.status != "Pending":
			frappe.throw(_("Machine can only be assigned to a Pending work order. Current status: {0}").format(doc.status))
		machine_type = frappe.db.get_value("IB Machine", machine, "machine_type")
		if machine_type is None:
			frappe.throw(_("Machine {0} does not exist").format(machine))
		required_type = _STAGE_MACHINE_TYPE.get(doc.stage)
		if required_type and machine_type != required_type:
			frappe.throw(
				_("Machine {0} is a {1} machine; Work Order stage {2} requires a {3} machine.").format(
					machine, machine_type, doc.stage, required_type
				)
			)
		doc.machine = machine
		doc.save(ignore_permissions=True)
		frappe.db.commit()
		_notify_floor_update()
		return {"status": "ok", "machine": machine}
	finally:
		frappe.db.sql("SELECT RELEASE_LOCK(%s)", lock_name)


@frappe.whitelist()
def start_work_order(work_order):
	"""Transition status Pending/On Hold -> In Progress via the IB Work Order
	Workflow (action "Start"/"Resume"), record started_at."""
	_require_production_role()
	# Advisory lock prevents two concurrent calls (e.g. double-click, two tabs)
	# from both passing the status check before either write lands — same
	# pattern already used for Order Sheet creation.
	lock_name = f"IB-WO-{work_order}"
	locked = frappe.db.sql("SELECT GET_LOCK(%s, 5)", lock_name)[0][0]
	if not locked:
		frappe.throw(_("Could not acquire lock for Work Order {0}. Please try again.").format(work_order))
	try:
		doc = frappe.get_doc("IB Work Order", work_order)
		if doc.status == "In Progress":
			return {"status": "ok", "started_at": doc.started_at}
		if doc.status not in ("Pending", "On Hold"):
			frappe.throw(
				_("Work Order {0} cannot be started from status '{1}'. Expected: Pending or On Hold.").format(
					work_order, doc.status
				)
			)
		started_at = now()
		doc.started_at = started_at
		apply_workflow(doc, "Resume" if doc.status == "On Hold" else "Start")
		# Same fix as complete_work_order()/advance_to_next_stage(): apply_workflow's
		# internal load_from_db() discards the started_at set above before its own
		# doc.save(), so it must be persisted explicitly or it silently stays NULL.
		frappe.db.set_value("IB Work Order", doc.name, "started_at", started_at)
		frappe.db.commit()
		_notify_floor_update()
		return {"status": "ok", "started_at": started_at}
	finally:
		frappe.db.sql("SELECT RELEASE_LOCK(%s)", lock_name)


@frappe.whitelist()
def complete_work_order(work_order):
	"""Set status=Completed, record completed_at. Also updates Order Sheet Item status."""
	_require_production_role()
	lock_name = f"IB-WO-{work_order}"
	locked = frappe.db.sql("SELECT GET_LOCK(%s, 5)", lock_name)[0][0]
	if not locked:
		frappe.throw(_("Could not acquire lock for Work Order {0}. Please try again.").format(work_order))
	try:
		doc = frappe.get_doc("IB Work Order", work_order)
		if doc.status == "Completed":
			frappe.throw(_("Work Order {0} is already Completed.").format(work_order))
		if doc.status not in ("In Progress",):
			frappe.throw(
				_("Work Order {0} cannot be completed from status '{1}'. Expected: In Progress.").format(
					work_order, doc.status
				)
			)
		completed_at = now()
		# completed_qty is never populated (IB Production Entry is unused by design) — fall back
		# to target_qty so the WO/Order Sheet Item actually reach "Completed" status.
		qty_done = flt(doc.completed_qty) or flt(doc.target_qty)
		doc.completed_at = completed_at
		doc.completed_qty = qty_done
		# apply_workflow saves the doc via the IB Work Order Workflow, which fires
		# standard Document events — IB Work Order.on_update (on_work_order_update_notify)
		# runs automatically, no manual call needed.
		apply_workflow(doc, "Complete")
		# apply_workflow() internally does frappe.get_doc(doc).load_from_db() before
		# applying the transition — load_from_db() re-inits every field from the DB
		# row, silently discarding the completed_at/completed_qty we just set above
		# in memory (doc.save() inside apply_workflow then persists the DISCARDED/
		# stale values, not ours). Confirmed live: real WOs completed since the
		# apply_workflow migration (2026-07-30) have completed_qty=0/completed_at=
		# NULL despite this function's own return value claiming otherwise. Set
		# them explicitly after the transition so they actually persist.
		frappe.db.set_value("IB Work Order", doc.name, {"completed_at": completed_at, "completed_qty": qty_done})

		# Update Order Sheet Item completed_qty and status
		if doc.order_sheet and doc.item_code:
			_update_order_sheet_item(doc.order_sheet, doc.item_code, qty_done,
									 order_sheet_item=doc.order_sheet_item or None)
			_update_order_sheet_progress(doc.order_sheet)

		frappe.db.commit()
		_notify_floor_update()
		return {"status": "ok", "completed_at": completed_at}
	finally:
		frappe.db.sql("SELECT RELEASE_LOCK(%s)", lock_name)


@frappe.whitelist()
def put_on_hold(work_order):
	"""Set status=On Hold."""
	_require_production_role()
	lock_name = f"IB-WO-{work_order}"
	locked = frappe.db.sql("SELECT GET_LOCK(%s, 5)", lock_name)[0][0]
	if not locked:
		frappe.throw(_("Could not acquire lock for Work Order {0}. Please try again.").format(work_order))
	try:
		doc = frappe.get_doc("IB Work Order", work_order)
		if doc.status == "On Hold":
			frappe.throw(_("Work Order {0} is already On Hold.").format(work_order))
		apply_workflow(doc, "Hold")
		_notify_production_hold(doc)
		frappe.db.commit()
		_notify_floor_update()
		return {"status": "ok"}
	finally:
		frappe.db.sql("SELECT RELEASE_LOCK(%s)", lock_name)


@frappe.whitelist()
def create_work_orders_for_item(order_sheet, item_code, stages):
	"""Create IB Work Order records for specified stages for an item."""
	_require_production_role()
	if isinstance(stages, str):
		stages = json.loads(stages)

	# Look up the Order Sheet Item row by item_code
	osi_name = frappe.db.get_value(
		"IB Order Sheet Item",
		{"parent": order_sheet, "item_code": item_code},
		"name",
	)
	if not osi_name:
		frappe.throw(_("Item {0} not found in Order Sheet {1}").format(item_code, order_sheet))
	osi = frappe.get_doc("IB Order Sheet Item", osi_name)

	# Requested stage must be part of THIS item's actual route (route-aware — item
	# group / warehouse-only location can both drop stages). Without this check, the
	# manual "+" picker (which lists all 7 canonical stages regardless of route)
	# could silently create an orphan Work Order for a stage the item never needs —
	# same bug class already fixed in move_work_order_stage() (see its comment).
	location = _get_os_location(order_sheet)
	stage_route = _get_stage_route(osi.item_code, location)

	created = []
	for stage in stages:
		if stage not in stage_route:
			frappe.throw(
				_("{0} is not a valid stage for item {1}'s production route ({2}).").format(
					stage, osi.item_code, " → ".join(stage_route)
				)
			)
		# Skip if a WO already exists for this order_sheet + item_code + stage
		existing = frappe.db.exists(
			"IB Work Order",
			{"order_sheet": order_sheet, "item_code": osi.item_code, "stage": stage},
		)
		if existing:
			continue

		wo = frappe.new_doc("IB Work Order")
		wo.order_sheet = order_sheet
		wo.item_code = osi.item_code
		wo.stage = stage
		wo.status = "Pending"
		wo.target_qty = osi.qty
		wo.completed_qty = 0.0
		wo.wastage_qty = 0.0
		wo.wastage_pct = 0.0
		wo.insert(ignore_permissions=True)
		created.append(wo.name)

	frappe.db.commit()
	return {"created": created}


# ---------------------------------------------------------------------------
# 7. DPR (Daily Production Report)
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_dpr(date=None):
	"""Return daily production report data.

	Sourced entirely from IB Work Order completions. This report originally
	read from IB Production Entry — that doctype has zero rows system-wide
	by design (confirmed repeatedly: get_weekly_dpr's and
	get_machine_wise_dashboard's own comments, and complete_work_order()'s
	own docstring), so every branch below the old "if not entries" check was
	dead code that never once ran against real data.

	Wastage is deliberately absent from this report, not just zeroed out:
	IB Work Order.wastage_qty/wastage_pct are hardcoded 0.0 at WO creation
	(see auto_create_all_stage_wos) and never written by any real completion
	path — Production Entry submission was the only place that ever set them
	to something real, and it never fires. Showing "0% wastage, 0 above
	norm" would read as measured quality control that was never actually
	captured; better to not claim a number this system has never recorded.
	"""
	_require_production_role()
	if not date:
		date = today()

	rows = frappe.db.sql(
		"""
		SELECT wo.stage, wo.machine, wo.completed_qty, wo.target_uom,
			TIMESTAMPDIFF(MINUTE, wo.started_at, wo.completed_at) AS duration_min
		FROM `tabIB Work Order` wo
		WHERE wo.status = 'Completed' AND DATE(COALESCE(wo.completed_at, wo.modified)) = %s
		ORDER BY wo.stage, wo.machine
		""",
		(date,),
		as_dict=True,
	)

	summary = {
		"wo_completed": len(rows),
		"total_output": sum(flt(r.completed_qty) for r in rows),
		"total_hours": round(sum(flt(r.duration_min) for r in rows if r.duration_min) / 60, 2),
	}

	if not rows:
		return {"date": date, "summary": summary, "stages": [], "machine_breakdown": {}}

	stage_data = {}
	for r in rows:
		stage = r.stage or "Unknown"
		sd = stage_data.setdefault(stage, {
			"stage": stage, "wo_completed": 0, "output_qty": 0.0, "minutes": 0.0, "machines": {},
		})
		sd["wo_completed"] += 1
		sd["output_qty"] += flt(r.completed_qty)
		sd["minutes"] += flt(r.duration_min) if r.duration_min else 0.0

		mkey = r.machine or "Unassigned"
		m = sd["machines"].setdefault(mkey, {"machine": mkey, "wo_completed": 0, "output_qty": 0.0})
		m["wo_completed"] += 1
		m["output_qty"] += flt(r.completed_qty)

	ordered_stages = [s for s in STAGES if s in stage_data] + [s for s in stage_data if s not in STAGES]
	stage_table = []
	machine_breakdown = {}
	for stage in ordered_stages:
		sd = stage_data[stage]
		hours = round(sd["minutes"] / 60, 2)
		machines = list(sd["machines"].values())
		stage_table.append({
			"stage": stage,
			"wo_completed": sd["wo_completed"],
			"output_qty": sd["output_qty"],
			"hours": hours,
			"hourly_avg": round(sd["output_qty"] / hours, 2) if hours else 0.0,
			"machines": machines,
		})
		machine_breakdown[stage] = machines

	return {
		"date": date,
		"stages": stage_table,
		"summary": summary,
		"machine_breakdown": machine_breakdown,
	}


@frappe.whitelist()
def get_weekly_dpr(week_start=None, date=None):
	"""Return 7-day production summary. `date` is an alias for `week_start` (JS sends `date`).

	Sourced from IB Work Order completions — see get_dpr()'s docstring for
	why IB Production Entry (this function's original source) is permanently
	empty, and why wastage isn't reported (never written by any real
	completion path, would misleadingly always show 0%).
	"""
	_require_production_role()
	if not week_start:
		week_start = date or today()
		today_dt = getdate(week_start)
		week_start = add_days(today_dt, -today_dt.weekday())
	else:
		week_start = getdate(week_start)

	week_end = add_days(week_start, 6)

	wo_rows = frappe.db.sql(
		"""
		SELECT DATE(COALESCE(completed_at, modified)) AS day,
			COUNT(*) AS wo_completed,
			SUM(completed_qty) AS total_output_qty,
			SUM(TIMESTAMPDIFF(MINUTE, started_at, completed_at)) AS total_minutes
		FROM `tabIB Work Order`
		WHERE status = 'Completed'
			AND DATE(COALESCE(completed_at, modified)) BETWEEN %s AND %s
		GROUP BY DATE(COALESCE(completed_at, modified))
		""",
		(week_start, week_end),
		as_dict=True,
	)
	wo_row_map = {str(r.day): r for r in wo_rows}

	result = []
	for i in range(7):
		day = add_days(week_start, i)
		day_str = str(day)
		wr = wo_row_map.get(day_str)
		result.append({
			"date": day_str,
			"wo_completed": wr.wo_completed if wr else 0,
			"output_qty":   flt(wr.total_output_qty) if wr else 0.0,
			"hours":        round(flt(wr.total_minutes) / 60, 2) if wr and wr.total_minutes else 0.0,
		})

	total_output = sum(d["output_qty"] for d in result)
	days_with_data = sum(1 for d in result if d["wo_completed"] > 0)
	avg_daily = round(total_output / days_with_data, 1) if days_with_data else 0.0

	return {
		"week_start": str(week_start),
		"week_end": str(week_end),
		"summary": {
			"total_output": total_output,
			"avg_daily": avg_daily,
		},
		"days": result,
	}


# ---------------------------------------------------------------------------
# Helpers (not whitelisted)
# ---------------------------------------------------------------------------

def _update_order_sheet_item(order_sheet, item_code, completed_qty, order_sheet_item=None):
	"""Update IB Order Sheet Item completed_qty and flip status.

	Uses order_sheet_item (child row name) as direct key when available — avoids
	updating all rows when the same item_code appears multiple times in one OS.
	Falls back to item_code scan for legacy WOs.

	Status is "Completed" only once every one of this item's Work Orders (across
	every stage in its route) is itself Completed. Previously this compared
	completed_qty >= qty — but qty_done always equals the item's full target_qty
	at every single stage (IB Production Entry, which would track real partial
	per-stage output, is unused by design — see complete_work_order), so that
	check was true after the very first stage of any multi-stage route, marking
	items (and via _update_order_sheet_progress, whole Order Sheets) "Completed"
	while most of the route was still outstanding. Confirmed live: 8/17
	Completed items and 2/7 Completed Order Sheets were wrongly flagged before
	this fix; corrected via a one-off bench execute, see production.py history.
	"""
	if order_sheet_item:
		row = frappe.db.get_value("IB Order Sheet Item", order_sheet_item, ["name", "qty"], as_dict=True)
		rows = [row] if row else []
	else:
		rows = frappe.db.get_all(
			"IB Order Sheet Item",
			filters={"parent": order_sheet, "item_code": item_code},
			fields=["name", "qty"],
		)
	if not rows:
		return
	for row in rows:
		wo_filters = {"order_sheet": order_sheet, "status": ["not in", ["Cancelled"]]}
		if order_sheet_item:
			wo_filters["order_sheet_item"] = row.name
		else:
			wo_filters["item_code"] = item_code
		wo_statuses = frappe.db.get_all("IB Work Order", filters=wo_filters, pluck="status")
		all_done = bool(wo_statuses) and all(s == "Completed" for s in wo_statuses)
		new_status = "Completed" if all_done else "In Progress"
		frappe.db.set_value(
			"IB Order Sheet Item",
			row.name,
			{
				"completed_qty": completed_qty,
				"status": new_status,
			},
		)


def _update_order_sheet_progress(order_sheet_name):
	"""Check if all items complete → mark OS as Completed.

	Symmetric: also reopens a previously-Completed OS back to "In Progress" if
	it no longer has every item Completed. Originally one-directional (Completed
	only ever got set, never unset) — harmless as long as an item's status only
	ever moves forward, but move_work_order_stage's rework path can legitimately
	un-complete an item (moving a later stage back to an earlier, already-
	Completed one for rework — see its own comment). Without this, an Order
	Sheet reopened that way would stay stuck showing "Completed" indefinitely,
	since nothing else ever re-evaluates it downward.
	"""
	items = frappe.db.get_all(
		"IB Order Sheet Item",
		filters={"parent": order_sheet_name},
		fields=["status"],
	)
	if not items:
		return
	all_done = all(item.status == "Completed" for item in items)
	current_status = frappe.db.get_value("IB Order Sheet", order_sheet_name, "status")
	if all_done and current_status != "Completed":
		frappe.db.set_value("IB Order Sheet", order_sheet_name, "status", "Completed")
	elif not all_done and current_status == "Completed":
		frappe.db.set_value("IB Order Sheet", order_sheet_name, "status", "In Progress")


@frappe.whitelist()
def advance_to_next_stage(work_order):
	"""Complete current WO and auto-create + auto-assign the next stage WO.

	This is the primary production automation entry point. The production
	manager clicks 'Next Stage' once physical work is done — the system handles
	the rest: completing the current WO, determining the next stage, creating
	the new WO, and auto-assigning a machine.
	"""
	_require_production_role()
	lock_name = f"IB-WO-{work_order}"
	locked = frappe.db.sql("SELECT GET_LOCK(%s, 5)", lock_name)[0][0]
	if not locked:
		frappe.throw(_("Could not acquire lock for Work Order {0}. Please try again.").format(work_order))
	try:
		doc = frappe.get_doc("IB Work Order", work_order)
		location = _get_os_location(doc.order_sheet)

		# Idempotency: already completed — find the next-stage WO that was activated and return it
		if doc.status == "Completed":
			stage_route = _get_stage_route(doc.item_code, location)
			try:
				route_idx = stage_route.index(doc.stage)
			except ValueError:
				return {"status": "ok", "next_stage": None, "message": "Already completed"}
			if route_idx >= len(stage_route) - 1:
				return {"status": "ok", "next_stage": None, "message": "Production complete — item delivered"}
			next_stage = stage_route[route_idx + 1]
			lf = {"order_sheet": doc.order_sheet, "stage": next_stage, "status": ["not in", ["Cancelled"]]}
			if doc.order_sheet_item:
				lf["order_sheet_item"] = doc.order_sheet_item
			else:
				lf["item_code"] = doc.item_code
			existing_name = frappe.db.get_value("IB Work Order", lf, "name")
			return {"status": "ok", "next_stage": next_stage, "new_work_order": existing_name or ""}

		if doc.status != "In Progress":
			frappe.throw(_("Work Order {0} must be In Progress to advance. Current status: {1}").format(work_order, doc.status))

		# Complete current stage
		completed_at = now()
		# completed_qty is never populated (IB Production Entry is unused by design) — fall back
		# to target_qty so the WO/Order Sheet Item actually reach "Completed" status.
		qty_done = flt(doc.completed_qty) or flt(doc.target_qty)
		doc.completed_at = completed_at
		doc.completed_qty = qty_done
		# apply_workflow saves the doc via the IB Work Order Workflow, which fires
		# standard Document events — IB Work Order.on_update (on_work_order_update_notify)
		# runs automatically, no manual call needed.
		apply_workflow(doc, "Complete")
		# See identical fix + comment in complete_work_order() — apply_workflow's
		# internal load_from_db() discards the completed_at/completed_qty set
		# above before its own doc.save(), so they must be persisted explicitly.
		frappe.db.set_value("IB Work Order", doc.name, {"completed_at": completed_at, "completed_qty": qty_done})
		_update_order_sheet_item(doc.order_sheet, doc.item_code, qty_done,
								 order_sheet_item=doc.order_sheet_item or None)

		# Determine next stage from item's route (route-aware, skips inapplicable stages)
		stage_route = _get_stage_route(doc.item_code, location)
		try:
			route_idx = stage_route.index(doc.stage)
		except ValueError:
			frappe.db.commit()
			_notify_floor_update()
			return {"status": "ok", "next_stage": None, "message": "Unknown stage"}

		if route_idx >= len(stage_route) - 1:
			_update_order_sheet_progress(doc.order_sheet)
			frappe.db.commit()
			_notify_floor_update()
			return {"status": "ok", "next_stage": None, "message": "Production complete — item delivered"}

		next_stage = stage_route[route_idx + 1]

		location = _get_os_location(doc.order_sheet)

		# Check if WO for next stage was pre-created (by auto_create_all_stage_wos)
		# Prefer per-row key (order_sheet_item) — falls back to item_code for legacy WOs
		lookup_filters = {"order_sheet": doc.order_sheet, "stage": next_stage, "status": ["not in", ["Cancelled"]]}
		if doc.order_sheet_item:
			lookup_filters["order_sheet_item"] = doc.order_sheet_item
		else:
			lookup_filters["item_code"] = doc.item_code
		existing = frappe.db.get_value(
			"IB Work Order",
			lookup_filters,
			["name", "machine"],
			as_dict=True,
		)
		if existing:
			# Pre-created WO found — assign machine now if not already assigned
			if not existing.machine:
				machine = _assign_machine_load_balanced(next_stage, location) or ""
				if machine:
					frappe.db.set_value("IB Work Order", existing.name, "machine", machine)
			# Update target_qty to actual output of completed stage
			output_qty = flt(doc.completed_qty) or flt(doc.target_qty)
			frappe.db.set_value("IB Work Order", existing.name, "target_qty", output_qty)
			_update_order_sheet_progress(doc.order_sheet)
			frappe.db.commit()
			_notify_floor_update()
			return {
				"status": "ok",
				"next_stage": next_stage,
				"new_work_order": existing.name,
				"machine_assigned": bool(existing.machine or machine if not existing.machine else existing.machine),
				"message": f"Advanced to {next_stage} — WO {existing.name} activated",
			}

		# WO doesn't exist yet — create it now (fallback for Order Sheets created before this feature)
		new_wo = frappe.new_doc("IB Work Order")
		new_wo.order_sheet      = doc.order_sheet
		new_wo.order_sheet_item = doc.order_sheet_item or ""
		new_wo.sales_order      = doc.sales_order or ""
		new_wo.item_code        = doc.item_code
		new_wo.item_name        = doc.item_name
		new_wo.stage            = next_stage
		new_wo.priority         = doc.priority
		new_wo.target_qty       = flt(doc.completed_qty) or flt(doc.target_qty)
		new_wo.target_uom       = doc.target_uom
		new_wo.status           = "Pending"
		new_wo.machine          = _assign_machine_load_balanced(next_stage, location) or ""
		new_wo.insert(ignore_permissions=True)

		_update_order_sheet_progress(doc.order_sheet)
		frappe.db.commit()
		_notify_floor_update()

		return {
			"status": "ok",
			"next_stage": next_stage,
			"new_work_order": new_wo.name,
			"machine_assigned": bool(new_wo.machine),
			"message": f"Advanced to {next_stage} — WO {new_wo.name} created",
		}
	finally:
		frappe.db.sql("SELECT RELEASE_LOCK(%s)", lock_name)


@frappe.whitelist()
def auto_create_all_stage_wos(order_sheet):
	"""Create Work Orders for ALL applicable stages for every item in an Order Sheet.

	Stage route is determined per item_group (e.g. PLASTIC gets Coating→Slitting→…,
	PVC skips Coating, Aerosol items only get Packing→RTD).

	Only the first stage gets a machine assigned immediately (load-balanced).
	Subsequent stages are created as Pending with no machine — machine is assigned
	when advance_to_next_stage() fires after the preceding stage completes.
	"""
	_require_production_role()
	os_doc = frappe.get_doc("IB Order Sheet", order_sheet)
	location = _get_os_location(order_sheet)
	created = []

	for item in os_doc.items:
		stage_route = _get_stage_route(item.item_code, location)

		for idx, stage in enumerate(stage_route):
			# Per-row key: order_sheet + order_sheet_item (child row name) + stage
			existing = frappe.db.get_value(
				"IB Work Order",
				{"order_sheet": order_sheet, "order_sheet_item": item.name,
				 "stage": stage, "status": ["not in", ["Cancelled"]]},
				"name",
			)
			if existing:
				created.append(existing)
				continue

			wo = frappe.new_doc("IB Work Order")
			wo.order_sheet       = order_sheet
			wo.order_sheet_item  = item.name   # per-row key
			wo.sales_order       = os_doc.sales_order or ""
			wo.item_code         = item.item_code
			wo.item_name         = item.item_name
			wo.stage             = stage
			wo.priority          = os_doc.priority or "Normal"
			wo.target_qty        = flt(item.qty)
			wo.target_uom        = item.uom
			wo.status            = "Pending"
			# Assign machine only to first stage — rest assigned when stage activates
			if idx == 0:
				wo.machine = _assign_machine_load_balanced(stage, location) or ""
			wo.insert(ignore_permissions=True)
			created.append(wo.name)

	frappe.db.set_value("IB Order Sheet", order_sheet, "status", "In Progress")
	frappe.db.commit()
	return {"created": created, "route_used": {
		item.item_code: _get_stage_route(item.item_code, location) for item in os_doc.items
	}}


# Backward-compat alias used by older callers
def auto_create_first_stage_wos(order_sheet):
	return auto_create_all_stage_wos(order_sheet)


@frappe.whitelist()
def get_production_plan(limit=None, start=0, location=None, search=None, priority=None):
	"""Return order-wise data for the Active Production Plan table.

	limit: max number of order sheets to return in order_wise (default: all).
	       Dashboard passes limit=25 per page for infinite scroll.
	start: offset for the order_wise page (infinite scroll).
	location: optional Sales Order custom_location filter (maharashtra/gujarat/chennai).
	search: optional match against Sales Order name or customer name.
	priority: optional Order Sheet priority filter (Urgent/High/Normal/Low).
	"""
	_require_production_role()
	limit = int(limit) if limit and str(limit).isdigit() else None
	start = int(start) if str(start).isdigit() else 0
	limit_clause = f"LIMIT {limit} OFFSET {start}" if limit else ""
	loc_join = "JOIN `tabSales Order` so ON so.name = os.sales_order" if location else ""
	loc_where = "AND so.custom_location = %(location)s" if location else ""
	search_where = "AND (os.sales_order LIKE %(search)s OR os.customer_name LIKE %(search)s)" if search else ""
	priority_where = "AND os.priority = %(priority)s" if priority else ""

	# ── Order-wise: active order sheets with item stage status ──────────────
	order_sheets = frappe.db.sql(
		f"""
		SELECT os.name, os.sales_order, os.customer_name, os.priority, os.status,
		       os.delivery_date, os.order_date, os.creation
		FROM `tabIB Order Sheet` os
		{loc_join}
		WHERE os.status IN ('Draft', 'In Progress')
		{loc_where}
		{search_where}
		{priority_where}
		ORDER BY
		  FIELD(os.priority, 'Urgent','High','Normal','Low'),
		  os.delivery_date ASC
		{limit_clause}
		""",
		{"location": location, "search": f"%{search}%" if search else None, "priority": priority},
		as_dict=True,
	)

	for os in order_sheets:
		items = frappe.db.get_all(
			"IB Order Sheet Item",
			filters={"parent": os.name},
			fields=["item_code", "item_name", "qty", "uom", "completed_qty", "status"],
		)
		# Per item: dict of stage → WO info
		for item in items:
			wos = frappe.db.get_all(
				"IB Work Order",
				filters={"order_sheet": os.name, "item_code": item.item_code,
				         "status": ["not in", ["Cancelled"]]},
				fields=["name", "stage", "status", "completed_qty", "target_qty", "machine"],
			)
			stage_map = {wo.stage: wo for wo in wos}
			item["stage_map"] = {s: {
				"status": stage_map[s].status if s in stage_map else None,
				"wo_name": stage_map[s].name if s in stage_map else None,
				"completed_qty": stage_map[s].completed_qty if s in stage_map else 0,
				"target_qty": stage_map[s].target_qty if s in stage_map else 0,
				"machine": stage_map[s].machine if s in stage_map else None,
			} for s in STAGES}
			item["current_stage"] = next(
				(s for s in STAGES if s in stage_map and stage_map[s].status == "In Progress"),
				next((s for s in STAGES if s in stage_map and stage_map[s].status == "Pending"), None)
			)
		os["items"] = items

	# Comment count per underlying Sales Order — one grouped query for the
	# whole page instead of an N+1 per-card lookup (the dashboard shows a
	# count badge next to each card's comment icon).
	so_names = list({os.sales_order for os in order_sheets if os.sales_order})
	comment_counts = {}
	if so_names:
		placeholders = ", ".join(["%s"] * len(so_names))
		count_rows = frappe.db.sql(
			f"""
			SELECT reference_name, COUNT(*) AS cnt
			FROM `tabComment`
			WHERE reference_doctype = 'Sales Order'
			  AND comment_type = 'Comment'
			  AND reference_name IN ({placeholders})
			GROUP BY reference_name
			""",
			tuple(so_names),
			as_dict=True,
		)
		comment_counts = {r.reference_name: r.cnt for r in count_rows}
	for os in order_sheets:
		os["comment_count"] = comment_counts.get(os.sales_order, 0)

	return {
		"stages": STAGES,
		"order_wise": order_sheets,
	}


@frappe.whitelist()
def hold_work_order(work_order):
	"""Alias for put_on_hold — called by the production stages JS."""
	return put_on_hold(work_order)


@frappe.whitelist()
def assign_machine_to_wo(work_order, machine):
	"""Alias for assign_machine — called by the production stages JS."""
	return assign_machine(work_order, machine)


@frappe.whitelist()
def get_wo_entries(work_order):
	"""Return all production entries for a work order."""
	_require_production_role()
	return frappe.db.get_all(
		"IB Production Entry",
		filters={"work_order": work_order, "docstatus": ["in", [0, 1]]},
		fields=[
			"name", "entry_date", "stage", "machine", "operator",
			"input_qty", "output_qty", "wastage_qty", "wastage_pct",
			"hours_worked", "wastage_reason", "docstatus",
		],
		order_by="entry_date desc, creation desc",
	)


@frappe.whitelist()
def get_jumbo_rolls_available(search=None, limit=20):
	"""Return In Stock + In Production IB Jumbo Rolls for the picker."""
	_require_production_role()
	filters = {"status": ["in", ["In Stock", "In Production"]]}
	if search:
		filters["name"] = ["like", f"%{search}%"]
	return frappe.db.get_all(
		"IB Jumbo Roll",
		filters=filters,
		fields=["name", "batch_no", "supplier", "received_date", "status",
		        "gsm", "width_mm", "length_mtr", "sqm", "liner_type"],
		order_by="received_date desc",
		limit=int(limit),
	)


@frappe.whitelist()
def link_jumbo_roll_to_wo(work_order, jumbo_roll):
	"""Link a Jumbo Roll to a Work Order. Updates JR status to In Production."""
	_require_production_role()
	# Advisory lock on the roll itself — without it, two concurrent calls can both
	# pass the "already linked?" check before either write lands, double-linking
	# the same physical roll to two Work Orders.
	lock_name = f"IB-JR-{jumbo_roll}"
	locked = frappe.db.sql("SELECT GET_LOCK(%s, 5)", lock_name)[0][0]
	if not locked:
		frappe.throw(_("Could not acquire lock for Jumbo Roll {0}. Please try again.").format(jumbo_roll))
	try:
		if not frappe.db.exists("IB Jumbo Roll", jumbo_roll):
			frappe.throw(_("Jumbo Roll {0} does not exist").format(jumbo_roll))
		# Prevent the same JR from being linked to multiple active WOs
		already = frappe.db.get_value(
			"IB Work Order",
			{"jumbo_roll": jumbo_roll, "name": ["!=", work_order], "status": ["not in", ["Cancelled"]]},
			"name",
		)
		if already:
			frappe.throw(_("Jumbo Roll {0} is already linked to Work Order {1}").format(jumbo_roll, already))
		frappe.db.set_value("IB Work Order", work_order, "jumbo_roll", jumbo_roll)
		frappe.db.set_value("IB Jumbo Roll", jumbo_roll, "status", "In Production")
		frappe.db.commit()
		return {"ok": True}
	finally:
		frappe.db.sql("SELECT RELEASE_LOCK(%s)", lock_name)


@frappe.whitelist()
def get_item_wise_view(from_date=None, to_date=None, item_code=None):
	"""Item-wise production view.

	Returns per-item: active WOs, jumbo roll batches, stage progress.
	Groups by item_code across all order sheets.
	"""
	_require_production_role()
	filters = {"status": ["not in", ["Cancelled"]]}
	if item_code:
		filters["item_code"] = item_code

	wos = frappe.db.get_all(
		"IB Work Order",
		filters=filters,
		fields=[
			"name", "item_code", "item_name", "stage", "status",
			"machine", "jumbo_roll", "target_qty", "completed_qty",
			"wastage_qty", "wastage_pct", "order_sheet",
			"started_at", "completed_at", "creation",
		],
		order_by="item_code asc, stage asc",
	)

	# WOs here are grouped by item_code across ALL order sheets — no single
	# shared parent ETD like the single-Order-Sheet item detail view has — so
	# fetch each WO's own Order Sheet delivery_date to show alongside its
	# own creation date.
	os_names = list({wo.order_sheet for wo in wos if wo.order_sheet})
	etd_map = {}
	if os_names:
		etd_map = {
			d.name: d.delivery_date
			for d in frappe.get_all(
				"IB Order Sheet",
				filters={"name": ["in", os_names]},
				fields=["name", "delivery_date"],
			)
		}
	for wo in wos:
		wo["delivery_date"] = etd_map.get(wo.order_sheet)

	# Group by item_code
	item_map = {}
	for wo in wos:
		ic = wo.item_code or "Unknown"
		if ic not in item_map:
			item_map[ic] = {
				"item_code": ic,
				"item_name": wo.item_name or ic,
				"work_orders": [],
				"jumbo_rolls": set(),
				"stages_active": set(),
				"stages_done": set(),
			}
		item_map[ic]["work_orders"].append(dict(wo))
		if wo.jumbo_roll:
			item_map[ic]["jumbo_rolls"].add(wo.jumbo_roll)
		if wo.status == "In Progress":
			item_map[ic]["stages_active"].add(wo.stage)
		elif wo.status == "Completed":
			item_map[ic]["stages_done"].add(wo.stage)

	# Fetch JR details for linked rolls
	all_jr_names = list({jr for data in item_map.values() for jr in data["jumbo_rolls"]})
	jr_detail_map = {}
	if all_jr_names:
		jrs = frappe.db.get_all(
			"IB Jumbo Roll",
			filters={"name": ["in", all_jr_names]},
			fields=["name", "batch_no", "supplier", "gsm", "width_mm",
			        "length_mtr", "sqm", "liner_type", "status"],
		)
		jr_detail_map = {jr.name: dict(jr) for jr in jrs}

	# Build result list
	result = []
	for ic, data in sorted(item_map.items()):
		jr_list = [jr_detail_map.get(jr, {"name": jr}) for jr in data["jumbo_rolls"]]

		# Build stage progress from STAGES order
		stage_progress = {}
		for wo in data["work_orders"]:
			s = wo.get("stage", "")
			if s not in stage_progress or wo["status"] == "In Progress":
				stage_progress[s] = {
					"stage": s,
					"status": wo["status"],
					"wo_name": wo["name"],
					"completed_qty": wo["completed_qty"],
					"target_qty": wo["target_qty"],
					"machine": wo["machine"],
					"jumbo_roll": wo.get("jumbo_roll"),
				}

		# Batch lineage: per JR, chain the WOs that reference it
		batch_chains = []
		for jr_name in data["jumbo_rolls"]:
			chain_wos = [wo for wo in data["work_orders"] if wo.get("jumbo_roll") == jr_name]
			batch_chains.append({
				"jumbo_roll": jr_detail_map.get(jr_name, {"name": jr_name}),
				"work_orders": chain_wos,
			})

		total_wos = len(data["work_orders"])
		completed_wos = sum(1 for wo in data["work_orders"] if wo["status"] == "Completed")
		pct = round(completed_wos / total_wos * 100, 1) if total_wos else 0.0

		result.append({
			"item_code": ic,
			"item_name": data["item_name"],
			"total_wos": total_wos,
			"completed_wos": completed_wos,
			"completion_pct": pct,
			"stages_active": list(data["stages_active"]),
			"stages_done": list(data["stages_done"]),
			"jumbo_rolls": jr_list,
			"stage_progress": stage_progress,
			"batch_chains": batch_chains,
			"work_orders": data["work_orders"],
		})

	return result


@frappe.whitelist()
def get_machine_wise_dashboard(location=None):
	"""Machine-wise dashboard: per machine — current WOs, today stats, load %.

	location: optional (maharashtra/gujarat/chennai) — matches the shared
	Location filter already honored by Order-wise/Job Bundles on this page;
	previously ignored here so switching locations silently kept showing
	every machine regardless of tab.
	"""
	_require_production_role()
	machine_filters = {"status": "Active"}
	if location:
		machine_filters["location"] = location
	machines = frappe.db.get_all(
		"IB Machine",
		filters=machine_filters,
		fields=["name", "machine_code", "machine_name", "machine_type",
		        "location", "capacity", "capacity_uom", "wastage_norm_pct"],
		order_by="machine_type asc, machine_code asc",
	)

	today_date = today()
	result = []
	for m in machines:
		current_wos = frappe.db.get_all(
			"IB Work Order",
			filters={"machine": m.name, "status": ["in", ["Pending", "In Progress"]]},
			fields=["name", "item_code", "item_name", "stage", "status",
			        "target_qty", "completed_qty", "order_sheet", "jumbo_roll",
			        "started_at", "priority", "creation"],
			order_by="started_at asc",
		)
		# WOs on one machine can belong to different orders (no single shared
		# parent ETD like the order-scoped views have), so fetch each WO's own
		# Order Sheet delivery_date + customer here. Also carries customer_name
		# for the Machine-wise tab's WO table (added 2026-08-05 — that table
		# previously showed item_code only, with no customer column, unlike
		# every other WO table on this page).
		os_names = list({wo.order_sheet for wo in current_wos if wo.order_sheet})
		os_map = {}
		if os_names:
			os_map = {
				d.name: d
				for d in frappe.get_all(
					"IB Order Sheet",
					filters={"name": ["in", os_names]},
					fields=["name", "delivery_date", "customer", "customer_name"],
				)
			}
		for wo in current_wos:
			os_row = os_map.get(wo.order_sheet)
			wo["delivery_date"] = os_row.delivery_date if os_row else None
			wo["customer_name"] = (os_row.customer_name or os_row.customer) if os_row else None

		# Today's stats from IB Work Order directly — NOT tabIB Production Entry,
		# which has zero rows ever (same fallback pattern already used by
		# get_production_dashboard()'s wastage_today: that table is unused by
		# design, real completions live on the WO itself). completed_qty/
		# completed_at are now reliably persisted by complete_work_order()/
		# advance_to_next_stage() (see fix alongside this one — apply_workflow's
		# internal load_from_db() was silently discarding them).
		today_stats = frappe.db.sql(
			"""
			SELECT
				COALESCE(SUM(completed_qty), 0) AS total_output,
				COALESCE(AVG(wastage_pct), 0) AS avg_wastage
			FROM `tabIB Work Order`
			WHERE machine = %s AND status = 'Completed'
			  AND DATE(COALESCE(completed_at, modified)) = %s
			""",
			(m.name, today_date),
			as_dict=True,
		)
		stats = today_stats[0] if today_stats else {}
		avg_wastage = round(flt(stats.get("avg_wastage")), 1)
		# Yield = the good-output fraction, the inverse of wastage — no other
		# "yield" definition exists anywhere else in this codebase (grepped).
		# NOTE: wastage_pct is never actually computed/written anywhere on IB
		# Work Order outside its 0.0 default at creation (create_work_orders_for_item) —
		# there is no capture flow that records real wastage per WO (same
		# unused-IB-Production-Entry gap noted above, one level deeper: even if
		# a real entry existed, nothing copies it onto the WO). So today_avg_wastage
		# and today_yield_pct are structurally correct but will read 0% / 100%
		# for every machine until a real wastage-capture flow is built — this is
		# a data-capture gap, not a bug in this query.
		yield_pct = round(100 - avg_wastage, 1)

		active_load = sum(1 for wo in current_wos if wo.status == "In Progress")
		# load_pct: each machine handles 1 WO at a time; >1 active = overloaded
		load_pct = min(200.0, round(active_load * 100.0, 1))

		result.append({
			**dict(m),
			"current_wos": [dict(wo) for wo in current_wos],
			"today_output": flt(stats.get("total_output")),
			"today_avg_wastage": avg_wastage,
			"today_yield_pct": yield_pct,
			"active_load": active_load,
			"load_pct": load_pct,
		})

	return result


def _priority_from_delivery_date(delivery_date):
	"""Derive Order Sheet priority from delivery urgency (days remaining from today)."""
	if not delivery_date:
		return "Normal"
	days = (getdate(delivery_date) - getdate(today())).days
	if days <= 2:
		return "Urgent"
	if days <= 5:
		return "High"
	if days <= 10:
		return "Normal"
	return "Low"


def on_so_submit_create_order_sheet(doc, method=None):
	"""Sales Order on_submit doc_event: enqueue Order Sheet auto-creation.

	Runs in the background (after commit) rather than inline — create_order_sheet()
	does its own frappe.db.commit() and can throw (lock timeout, duplicate guard),
	neither of which should be coupled to the Sales Order's own submit transaction
	or ever block a sales user from submitting an SO.
	"""
	frappe.enqueue(
		"instabiz.overrides.production._create_order_sheet_for_so",
		queue="short",
		enqueue_after_commit=True,
		sales_order=doc.name,
	)


def _create_order_sheet_for_so(sales_order):
	"""Background job: create the Order Sheet (+ full WO chain) for one just-submitted SO."""
	# Runs as the submitting user (frappe.enqueue captures frappe.session.user) — that
	# user is typically a Sales role, not Factory Management, so _require_production_role()
	# would reject it. Elevate to Administrator, same as the old nightly scheduler did.
	frappe.set_user("Administrator")
	try:
		if frappe.db.exists(
			"IB Order Sheet", {"sales_order": sales_order, "status": ["!=", "Cancelled"]}
		):
			return
		delivery_date = frappe.db.get_value("Sales Order", sales_order, "delivery_date")
		priority = _priority_from_delivery_date(delivery_date)
		create_order_sheet(sales_order, priority=priority)
	except Exception:
		frappe.log_error(
			title=f"Production Auto-Create (on-submit): {sales_order}",
			message=frappe.get_traceback(),
		)


@frappe.whitelist()
def get_so_production_status(sales_order):
	"""Return full production status for a Sales Order.

	Shows per-item: route, current stage, completed stages, machine assignments.
	Used by the production dashboard SO-drill-down and the SO-form panel.
	"""
	_check_so_production_access(sales_order)
	os_name = frappe.db.get_value(
		"IB Order Sheet",
		{"sales_order": sales_order, "status": ["!=", "Cancelled"]},
		"name",
	)
	if not os_name:
		return {"has_order_sheet": False, "sales_order": sales_order}

	os_doc = frappe.get_doc("IB Order Sheet", os_name)
	location = frappe.db.get_value("Sales Order", sales_order, "custom_location")
	items_out = []

	# Fetch all non-cancelled WOs for the order sheet once, then partition per
	# item by order_sheet_item (preferred) with item_code as a legacy-only
	# fallback — same pattern already used in get_order_sheet_detail's
	# order_wise_view. Without this, two Order Sheet Items sharing the same
	# item_code (e.g. one SKU ordered as two line items at different qty)
	# both matched every WO for that item_code, so both items displayed the
	# same merged/wrong stage data (confirmed live via a disposable Order
	# Sheet with a duplicate item_code: the qty=1500 row showed the qty=500
	# row's Work Orders).
	all_wos = frappe.db.get_all(
		"IB Work Order",
		filters={"order_sheet": os_name, "status": ["not in", ["Cancelled"]]},
		fields=["name", "item_code", "order_sheet_item", "stage", "status", "machine",
		        "target_qty", "completed_qty", "wastage_pct", "started_at", "completed_at"],
	)
	wo_by_osi = {}
	wo_by_item_legacy = {}
	for wo in all_wos:
		if wo.order_sheet_item:
			wo_by_osi.setdefault(wo.order_sheet_item, []).append(wo)
		else:
			wo_by_item_legacy.setdefault(wo.item_code, []).append(wo)

	for item in os_doc.items:
		stage_route = _get_stage_route(item.item_code, location)
		wos = wo_by_osi.get(item.name) or wo_by_item_legacy.get(item.item_code, [])
		wo_by_stage = {wo.stage: wo for wo in wos}

		stages_out = []
		current_stage = None
		for stage in stage_route:
			wo = wo_by_stage.get(stage)
			entry = {
				"stage":        stage,
				"wo_name":      wo.name if wo else None,
				"status":       wo.status if wo else "Not Created",
				"machine":      wo.machine if wo else None,
				"target_qty":   flt(wo.target_qty) if wo else 0,
				"completed_qty": flt(wo.completed_qty) if wo else 0,
				"wastage_pct":  flt(wo.wastage_pct) if wo else 0,
				"started_at":   wo.started_at if wo else None,
				"completed_at": wo.completed_at if wo else None,
			}
			stages_out.append(entry)
			if wo and wo.status in ("Pending", "In Progress") and not current_stage:
				current_stage = stage

		completion_pct = 0.0
		completed_count = sum(1 for s in stages_out if s["status"] == "Completed")
		if stage_route:
			completion_pct = round(completed_count / len(stage_route) * 100, 1)

		items_out.append({
			"item_code":      item.item_code,
			"item_name":      item.item_name,
			"qty":            flt(item.qty),
			"uom":            item.uom,
			"current_stage":  current_stage,
			"completion_pct": completion_pct,
			"stages":         stages_out,
		})

	return {
		"has_order_sheet": True,
		"sales_order":     sales_order,
		"order_sheet":     os_name,
		"priority":        os_doc.priority,
		"status":          os_doc.status,
		"delivery_date":   str(os_doc.delivery_date) if os_doc.delivery_date else None,
		"items":           items_out,
	}


# ── Drag-and-drop stage move (Pipeline view) ──────────────────────────────────

_VALID_STAGES = {"Coating", "Slitting", "Rewinding", "Cutting", "Packing", "Ready to Deliver", "Delivered"}


@frappe.whitelist()
def move_work_order_stage(work_order, new_stage):
	"""Manually move an item to a chosen stage (stage-picker in Active Production
	Plan / WO side panel) — activates that stage's own Work Order and cancels
	the one being bypassed, and auto-assigns the least-loaded available machine
	for the target stage.

	Every stage in an item's route already has its own pre-created Work Order
	(auto_create_all_stage_wos creates the full chain upfront at Order Sheet
	creation) — a previous version of this function mutated `doc.stage` on the
	WO being moved instead, which silently deleted the source stage's record
	(e.g. moving a Slitting WO to Ready to Deliver renamed it *to* Ready to
	Deliver, leaving zero Slitting WOs and two conflicting Ready to Deliver
	ones — confirmed live: "if that item had 3 stages then it is deleting
	one"). Fixed to activate the pre-existing target-stage WO and cancel the
	source instead, preserving one real record per stage.
	"""
	_require_production_role()
	if new_stage not in _VALID_STAGES:
		frappe.throw(frappe._("Invalid stage: {0}").format(new_stage))
	doc = frappe.get_doc("IB Work Order", work_order)
	if doc.status == "Completed":
		frappe.throw(frappe._("Cannot move completed Work Order {0} to a different stage.").format(work_order))
	old_stage = doc.stage
	if old_stage == new_stage:
		return {"ok": True, "changed": False}

	location = _get_os_location(doc.order_sheet)

	# new_stage must be physically possible at THIS order's location — not
	# restricted to the item's own item-group route. Production users move
	# items stage-to-stage as routine work (not just out-of-sequence
	# correction), and an item-group route can be wrong or incomplete for a
	# one-off real-world need (e.g. a PVC item that unexpectedly needs
	# Coating this one time) — the item-group table is a default routing
	# hint, not a hard ceiling on what a production user is allowed to do.
	# Location is still enforced: Maharashtra/Chennai have no factory
	# machines at all (Coating/Slitting/Rewinding/Cutting), so a move there
	# is blocked the same way it always was — only Gujarat can reach those
	# stages. See git history for the earlier, stricter item-route check
	# this replaced (blocked here 2026-07-31, reopened 2026-08-05 at user's
	# explicit request).
	allowed_stages = (
		_WAREHOUSE_STAGE_ROUTE
		if (location or "").lower() in _WAREHOUSE_ONLY_LOCATIONS
		else list(_VALID_STAGES)
	)
	if new_stage not in allowed_stages:
		frappe.throw(
			frappe._("{0} is not available at this order's location ({1}).").format(
				new_stage, ", ".join(allowed_stages)
			)
		)

	machine = _assign_machine_load_balanced(new_stage, location) or ""

	target_filters = {"order_sheet": doc.order_sheet, "stage": new_stage, "status": ["not in", ["Cancelled"]]}
	if doc.order_sheet_item:
		target_filters["order_sheet_item"] = doc.order_sheet_item
	else:
		target_filters["item_code"] = doc.item_code
	target_row = frappe.db.get_value("IB Work Order", target_filters, ["name", "status"], as_dict=True)
	target_name = target_row.name if target_row else None

	if target_name:
		if machine:
			frappe.db.set_value("IB Work Order", target_name, "machine", machine)
		# Reactivating a target WO that's already Completed (moving a later stage
		# back to an earlier one for rework — e.g. a quality issue found at RTD
		# sends the item back to Packing). "Completed" is a terminal state in the
		# IB Work Order Workflow (fixtures/workflow.json — no transition leads
		# out of it), so there is no apply_workflow() path back to Pending here.
		# Bypass via a direct db write instead, same precedent already used
		# elsewhere in this file to work around apply_workflow's own data-loss
		# bug (see complete_work_order/advance_to_next_stage comments). Without
		# this, the target stays permanently stuck "Completed" — and since
		# _update_order_sheet_item's all-done check only counts non-Cancelled
		# WOs, cancelling the source stage below would then make every
		# remaining WO for the item look Completed, wrongly flipping the whole
		# item (and possibly the whole Order Sheet) to Completed despite the
		# rework never having happened.
		if target_row.status == "Completed":
			frappe.db.set_value(
				"IB Work Order", target_name,
				{"status": "Pending", "started_at": None, "completed_at": None, "completed_qty": 0},
			)
	else:
		# No pre-created WO for this stage (legacy data) — create one, same
		# shape as advance_to_next_stage's own fallback branch.
		new_wo = frappe.new_doc("IB Work Order")
		new_wo.order_sheet = doc.order_sheet
		new_wo.order_sheet_item = doc.order_sheet_item or ""
		new_wo.sales_order = doc.sales_order or ""
		new_wo.item_code = doc.item_code
		new_wo.item_name = doc.item_name
		new_wo.stage = new_stage
		new_wo.priority = doc.priority
		new_wo.target_qty = doc.target_qty
		new_wo.target_uom = doc.target_uom
		new_wo.status = "Pending"
		new_wo.machine = machine
		new_wo.insert(ignore_permissions=True)
		target_name = new_wo.name

	# Cancel the source WO via the workflow (not a raw db.set_value) — Cancel is
	# a valid transition from Pending, In Progress, and On Hold, so this covers
	# every state the WO being moved-away-from could realistically be in.
	apply_workflow(doc, "Cancel")

	# Recompute this item's (and the Order Sheet's) status immediately —
	# previously this function never touched either, so a status set before the
	# move (e.g. "Completed") could survive stale until some unrelated future
	# complete/advance call happened to touch this same item again. Preserve the
	# item's existing completed_qty (this call isn't completing anything, just
	# refreshing status) rather than guessing a new value.
	current_qty = None
	if doc.order_sheet_item:
		current_qty = frappe.db.get_value("IB Order Sheet Item", doc.order_sheet_item, "completed_qty")
	_update_order_sheet_item(
		doc.order_sheet, doc.item_code,
		flt(current_qty) if current_qty is not None else flt(doc.completed_qty) or flt(doc.target_qty),
		order_sheet_item=doc.order_sheet_item or None,
	)
	_update_order_sheet_progress(doc.order_sheet)

	frappe.db.commit()
	_notify_floor_update()
	return {
		"ok": True, "changed": True, "old_stage": old_stage, "new_stage": new_stage,
		"machine": machine, "target_work_order": target_name,
	}


# ── Sales Order production panel ──────────────────────────────────────────────

@frappe.whitelist()
def get_so_production_panel(sales_order):
	"""Production stage progress + dispatch status for SO form panel."""
	result = get_so_production_status(sales_order)
	result["dispatch"] = _get_dispatch_info(sales_order)

	if result.get("has_order_sheet"):
		items = result.get("items", [])
		rtd_done = bool(items) and all(
			any(s["status"] == "Completed" and s["stage"] == "Ready to Deliver"
				for s in item.get("stages", []))
			for item in items
		)
		result["ready_to_deliver"] = rtd_done

		# Overall order-level pct/stage/risk — same numbers the Production
		# Tracker page shows, so the SO form and the tracker never disagree.
		overall_pct, overall_stage = _order_progress_summary(result["order_sheet"], items)
		result["overall_pct"] = overall_pct
		result["overall_current_stage"] = overall_stage
		if result.get("delivery_date"):
			days_left = date_diff(getdate(result["delivery_date"]), getdate(today()))
			result["days_left"] = days_left
			if days_left < 0 and overall_pct < 100:
				result["risk"] = "overdue"
			elif days_left <= 2 and overall_pct < 100:
				result["risk"] = "at-risk"
			else:
				result["risk"] = "on-track"
		else:
			result["days_left"] = None
			result["risk"] = "none"
	else:
		result["ready_to_deliver"] = False

	return result


# ── Sales-facing Production Tracker ───────────────────────────────────────────

def _order_progress_summary(os_name, items):
	"""Aggregate per-item stage entries (from get_so_production_status) into one
	order-level pct + current stage, for the tracker list view."""
	total_steps = 0
	completed_steps = 0
	active_stages = []
	for item in items:
		stages = item.get("stages", [])
		total_steps += len(stages)
		completed_steps += sum(1 for s in stages if s["status"] == "Completed")
		if item.get("current_stage"):
			active_stages.append(item["current_stage"])

	pct = round(completed_steps / total_steps * 100, 1) if total_steps else 0.0
	# "Current stage" for the whole order = the earliest stage among items still
	# in progress (the bottleneck) — matches how a sales person would ask
	# "what's holding this order up".
	current_stage = None
	if active_stages:
		order_idx = {s: i for i, s in enumerate(STAGES)}
		current_stage = min(active_stages, key=lambda s: order_idx.get(s, 999))
	elif pct >= 100:
		current_stage = "Ready to Deliver"
	return pct, current_stage


@frappe.whitelist()
def get_my_production_orders(sales_person_user=None, show_completed=0):
	"""In-flight Sales Orders with a production progress summary, for the sales-
	facing Production Tracker page. Non-privileged users always see only their
	own orders regardless of sales_person_user; Sales Manager/System Manager/
	production roles may pass sales_person_user to view a specific rep, or
	omit it to see everyone.
	"""
	from instabiz.overrides.permissions import _is_privileged
	privileged = _is_privileged(frappe.session.user) or bool(_PRODUCTION_ROLES & set(frappe.get_roles()))
	target_user = frappe.session.user if not privileged else sales_person_user

	show_completed = int(show_completed or 0)
	conditions = ["os.status != 'Cancelled'", "so.docstatus = 1"]
	params = {}
	if target_user:
		conditions.append("so.custom_sales_person_user = %(user)s")
		params["user"] = target_user
	if not show_completed:
		conditions.append("os.status != 'Completed'")

	order_sheets = frappe.db.sql(f"""
		SELECT os.name AS order_sheet, os.sales_order, os.priority, os.status,
		       os.delivery_date, so.customer, so.customer_name,
		       so.custom_sales_person_user, so.custom_sales_person
		FROM `tabIB Order Sheet` os
		JOIN `tabSales Order` so ON so.name = os.sales_order
		WHERE {" AND ".join(conditions)}
		ORDER BY os.delivery_date ASC
	""", params, as_dict=True)

	today_date = getdate(today())
	out = []
	for row in order_sheets:
		# _so_progress_pct re-derives the order sheet by sales_order — cheap
		# enough at this scale and keeps one single source of truth for the
		# pct/stage math shared with the milestone notifier.
		pct, current_stage, _os_name = _so_progress_pct(row.sales_order)
		item_count = frappe.db.count("IB Order Sheet Item", {"parent": row.order_sheet})

		days_left = date_diff(row.delivery_date, today_date) if row.delivery_date else None
		if days_left is None:
			risk = "none"
		elif days_left < 0 and pct < 100:
			risk = "overdue"
		elif days_left <= 2 and pct < 100:
			risk = "at-risk"
		else:
			risk = "on-track"

		out.append({
			"sales_order": row.sales_order,
			"order_sheet": row.order_sheet,
			"customer": row.customer_name or row.customer,
			"sales_person": row.custom_sales_person or row.custom_sales_person_user,
			"priority": row.priority,
			"os_status": row.status,
			"delivery_date": str(row.delivery_date) if row.delivery_date else None,
			"days_left": days_left,
			"risk": risk,
			"pct": pct,
			"current_stage": current_stage,
			"item_count": item_count,
		})

	return out


@frappe.whitelist()
def get_so_production_timeline(sales_order):
	"""Full per-item stage timeline for one Sales Order — drill-down behind
	get_my_production_orders(). Reuses get_so_production_status's own access
	check (rep/owner/Sales Manager/System Manager/production role)."""
	return get_so_production_status(sales_order)


def _get_dispatch_info(sales_order):
	"""Return dispatch status from linked Delivery Notes."""
	dns = frappe.db.sql("""
		SELECT DISTINCT dn.name, dn.status, dn.posting_date,
		       dn.custom_lr_number, dn.lr_no, dn.transporter_name, dn.vehicle_no
		FROM `tabDelivery Note` dn
		JOIN `tabDelivery Note Item` dni ON dni.parent = dn.name
		WHERE dn.docstatus = 1 AND dni.against_sales_order = %s
		ORDER BY dn.posting_date DESC
		LIMIT 5
	""", (sales_order,), as_dict=True)

	if not dns:
		return {"status": "Not Dispatched", "dns": []}

	latest = dns[0]
	lr = latest.get("custom_lr_number") or latest.get("lr_no") or ""

	si_exists = frappe.db.sql("""
		SELECT 1 FROM `tabSales Invoice` si
		JOIN `tabSales Invoice Item` sii ON sii.parent = si.name
		WHERE si.docstatus = 1 AND sii.sales_order = %s LIMIT 1
	""", (sales_order,))

	if si_exists or latest.status == "Completed":
		dispatch_status = "Delivered"
	elif lr:
		dispatch_status = "In Transit"
	else:
		dispatch_status = "Dispatched"

	return {
		"status": dispatch_status,
		"latest_dn": latest.name,
		"lr_number": lr,
		"transporter": latest.transporter_name or "",
		"vehicle": latest.vehicle_no or "",
		"posting_date": str(latest.posting_date) if latest.posting_date else None,
		"dns": [dict(dn) for dn in dns],
	}


@frappe.whitelist()
def get_so_list_badges(sales_orders):
	"""Batch fetch production + dispatch badge for a list of SO names.

	Called from the Sales Order list view with whatever rows are already
	visible there (already scoped by the standard Sales Order row-level
	permission — see sales_order_has_permission in overrides/permissions.py).
	A direct API caller could otherwise pass arbitrary SO names to peek at
	other reps' dispatch/production badges, so re-check per name here rather
	than trusting the caller's list — same has_permission hook the SO
	list/doctype itself already uses, just applied explicitly since this is a
	raw-SQL endpoint that would otherwise bypass it.
	"""
	if isinstance(sales_orders, str):
		sales_orders = json.loads(sales_orders)
	if not sales_orders:
		return {}

	sales_orders = [so for so in sales_orders if frappe.has_permission("Sales Order", "read", so)]
	if not sales_orders:
		return {}

	ph = ", ".join(["%s"] * len(sales_orders))
	t = tuple(sales_orders)

	os_rows = frappe.db.sql(
		f"SELECT sales_order, name, status FROM `tabIB Order Sheet` WHERE sales_order IN ({ph}) AND status != 'Cancelled'",
		t, as_dict=True,
	)
	os_map = {r.sales_order: r for r in os_rows}

	dn_rows = frappe.db.sql(f"""
		SELECT DISTINCT dni.against_sales_order AS so, dn.name, dn.status,
		       dn.custom_lr_number, dn.lr_no
		FROM `tabDelivery Note` dn
		JOIN `tabDelivery Note Item` dni ON dni.parent = dn.name
		WHERE dn.docstatus = 1 AND dni.against_sales_order IN ({ph})
		ORDER BY dn.posting_date DESC
	""", t, as_dict=True)
	dn_map = {}
	for r in dn_rows:
		if r.so not in dn_map:
			dn_map[r.so] = r

	rtd_rows = frappe.db.sql(f"""
		SELECT os.sales_order, COUNT(*) AS cnt
		FROM `tabIB Work Order` wo
		JOIN `tabIB Order Sheet` os ON os.name = wo.order_sheet
		WHERE os.sales_order IN ({ph})
		  AND wo.stage = 'Ready to Deliver' AND wo.status = 'Completed'
		GROUP BY os.sales_order
	""", t, as_dict=True)
	rtd_map = {r.sales_order: r.cnt for r in rtd_rows}

	result = {}
	for so in sales_orders:
		os = os_map.get(so)
		dn = dn_map.get(so)
		rtd = rtd_map.get(so, 0)

		if dn:
			lr = dn.custom_lr_number or dn.lr_no or ""
			if dn.status == "Completed":
				badge, color = "Delivered", "#059669"
			elif lr:
				badge, color = "In Transit", "#0891b2"
			else:
				badge, color = "Dispatched", "#2563eb"
		elif rtd > 0:
			badge, color = "Ready to Deliver", "#ea580c"
		elif os:
			badge, color = "In Production", "#7c3aed"
		else:
			badge, color = "Not Started", "#9ca3af"

		result[so] = {"badge": badge, "color": color}

	return result


# ── Job bundles ───────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_job_bundles(location=None, search=None):
	"""Group Pending, not-yet-machine-assigned WOs by item_code+stage across order
	sheets for efficient batch assignment.

	Excludes WOs that already have a machine — without this, a bundle you just
	ran "Batch Assign" on reappeared identically on refresh (same Pending status,
	same item+stage grouping key), since only the machine field had changed.
	"""
	_require_production_role()
	loc_where = "AND so.custom_location = %(location)s" if location else ""
	search_where = "AND (wo.item_code LIKE %(search)s OR os.sales_order LIKE %(search)s OR os.customer_name LIKE %(search)s)" if search else ""
	rows = frappe.db.sql(f"""
		SELECT wo.name, wo.item_code, wo.item_name, wo.stage, wo.target_qty,
		       wo.target_uom, wo.machine, wo.batch_group, wo.order_sheet, wo.creation,
		       os.priority, os.sales_order, os.customer_name, os.delivery_date
		FROM `tabIB Work Order` wo
		JOIN `tabIB Order Sheet` os ON os.name = wo.order_sheet
		JOIN `tabSales Order` so ON so.name = os.sales_order
		WHERE wo.status = 'Pending'
		AND (wo.machine IS NULL OR wo.machine = '')
		{loc_where}
		{search_where}
		ORDER BY wo.item_code, wo.stage,
		         FIELD(os.priority, 'Urgent', 'High', 'Normal', 'Low')
	""", {"location": location, "search": f"%{search}%" if search else None}, as_dict=True)

	bundle_map = {}
	for wo in rows:
		key = f"{wo.item_code}|||{wo.stage}"
		if key not in bundle_map:
			bundle_map[key] = {
				"item_code": wo.item_code,
				"item_name": wo.item_name or wo.item_code,
				"stage": wo.stage,
				"wos": [],
				"total_qty": 0.0,
				"uom": wo.target_uom or "",
				"existing_batch_group": None,
			}
		b = bundle_map[key]
		b["wos"].append({
			"name": wo.name,
			"order_sheet": wo.order_sheet,
			"sales_order": wo.sales_order,
			"customer_name": wo.customer_name,
			"priority": wo.priority,
			"target_qty": flt(wo.target_qty),
			"delivery_date": str(wo.delivery_date) if wo.delivery_date else None,
			"creation": wo.creation,
			"machine": wo.machine or "",
			"batch_group": wo.batch_group or "",
		})
		b["total_qty"] += flt(wo.target_qty)
		if wo.batch_group and not b["existing_batch_group"]:
			b["existing_batch_group"] = wo.batch_group

	bundles = [v for v in bundle_map.values() if len(v["wos"]) >= 2]
	for bundle in bundles:
		bundle["suggested_machine"] = _assign_machine_load_balanced(bundle["stage"]) or ""
	bundles.sort(key=lambda b: -len(b["wos"]))
	return bundles


@frappe.whitelist()
def batch_assign_machine(work_orders, machine, batch_group=None):
	"""Assign the same machine (and batch_group tag) to multiple Pending WOs."""
	_require_production_role()
	if isinstance(work_orders, str):
		work_orders = json.loads(work_orders)
	machine_row = frappe.db.get_value("IB Machine", machine, ["name", "capacity", "machine_type"], as_dict=True)
	if not machine_row:
		frappe.throw(_("Machine {0} does not exist").format(machine))

	# Machine type must match the stage of every WO in the batch — same mapping
	# _assign_machine_load_balanced() already respects for its own suggestions;
	# this endpoint previously let any machine be batch-assigned to any stage.
	if work_orders:
		wo_stages = frappe.db.get_all("IB Work Order", filters={"name": ["in", work_orders]}, fields=["name", "stage"])
		for wo in wo_stages:
			required_type = _STAGE_MACHINE_TYPE.get(wo.stage)
			if required_type and machine_row.machine_type != required_type:
				frappe.throw(
					_("Machine {0} is a {1} machine; Work Order {2} (stage {3}) requires a {4} machine.").format(
						machine, machine_row.machine_type, wo.name, wo.stage, required_type
					)
				)

	# Capacity check — _assign_machine_load_balanced() only ever *suggests* a
	# machine respecting capacity; this endpoint previously assigned an unlimited
	# number of WOs to one machine with no check at all.
	#
	# Advisory lock on the machine itself (same pattern as the per-WO locks
	# elsewhere in this file, e.g. link_jumbo_roll_to_wo's IB-JR-{jumbo_roll}):
	# without it, two concurrent batch-assign calls to the SAME machine can
	# both read current_load before either write lands, both pass the
	# capacity check, and together push the machine over capacity.
	lock_name = f"IB-MACHINE-{machine}"
	locked = frappe.db.sql("SELECT GET_LOCK(%s, 5)", lock_name)[0][0]
	if not locked:
		frappe.throw(_("Could not acquire lock for Machine {0}. Please try again.").format(machine))
	try:
		capacity = flt(machine_row.capacity)
		if capacity > 0:
			current_load = frappe.db.count(
				"IB Work Order",
				{"machine": machine, "status": ["in", ["Pending", "In Progress"]]},
			)
			if current_load + len(work_orders) > capacity:
				frappe.throw(
					_("Machine {0} capacity is {1}; it already has {2} WOs and cannot take {3} more.").format(
						machine, int(capacity), current_load, len(work_orders)
					)
				)

		if not batch_group:
			batch_group = f"BATCH-{today()}-{machine}"

		updated = []
		for wo_name in work_orders:
			doc = frappe.get_doc("IB Work Order", wo_name)
			if doc.status != "Pending":
				continue
			doc.machine = machine
			doc.batch_group = batch_group
			doc.save(ignore_permissions=True)
			updated.append(wo_name)

		frappe.db.commit()
		_notify_floor_update()
		return {"updated": updated, "machine": machine, "batch_group": batch_group}
	finally:
		frappe.db.sql("SELECT RELEASE_LOCK(%s)", lock_name)


def _notify_floor_update():
	"""Fire on every WO status/machine-assignment change so any open Production
	page Stages tab live-refreshes across terminals (ib_production_dashboard.js's
	IBProductionStages._start_live_updates — merged into that file 2026-08-05,
	formerly its own ib_production_stages.js). Originally added for the
	since-removed Seat Map/Live Floor UI, but the event itself is a separate,
	still-active cross-terminal refresh mechanism — do not remove without also
	removing that listener."""
	frappe.publish_realtime("ib_floor_update", {}, after_commit=True)


# ── Production progress notifications (doc event) ────────────────────────────

def _so_progress_pct(so_name):
	"""Return (pct, current_stage, order_sheet_name) for a Sales Order's active
	Order Sheet, or (None, None, None) if it has none. Internal — no permission
	check, callers must already be in a trusted/system context (this is what
	the sales-facing whitelisted APIs call, after their own access check)."""
	os_name = frappe.db.get_value(
		"IB Order Sheet", {"sales_order": so_name, "status": ["!=", "Cancelled"]}, "name"
	)
	if not os_name:
		return None, None, None

	location = frappe.db.get_value("Sales Order", so_name, "custom_location")
	items = frappe.db.get_all("IB Order Sheet Item", filters={"parent": os_name}, fields=["item_code"])
	wos = frappe.db.get_all(
		"IB Work Order",
		filters={"order_sheet": os_name, "status": ["!=", "Cancelled"]},
		fields=["item_code", "stage", "status"],
	)
	wo_by_item = {}
	for wo in wos:
		wo_by_item.setdefault(wo.item_code, []).append(wo)

	items_summary = []
	for item in items:
		route = _get_stage_route(item.item_code, location)
		item_wos = {w.stage: w for w in wo_by_item.get(item.item_code, [])}
		stages = [{"stage": s, "status": item_wos[s].status if s in item_wos else "Not Created"} for s in route]
		current = next((s["stage"] for s in stages if s["status"] in ("Pending", "In Progress")), None)
		items_summary.append({"stages": stages, "current_stage": current})

	pct, current_stage = _order_progress_summary(os_name, items_summary)
	return pct, current_stage, os_name


_PROGRESS_MILESTONES = [25, 50, 75, 100]


def on_work_order_update_notify(doc, method=None):
	"""Notify the sales person as their order's production progresses, at
	25/50/75/100% milestones — not just the old Ready-to-Deliver-only signal.
	Each milestone fires once ever per Sales Order (dedup via subject marker,
	no date bound — unlike the old RTD-only version, a milestone should never
	repeat, not just never-repeat-same-day)."""
	if doc.status != "Completed":
		return
	if not doc.order_sheet:
		return

	so_name = frappe.db.get_value("IB Order Sheet", doc.order_sheet, "sales_order")
	if not so_name:
		return

	sales_person_user = frappe.db.get_value("Sales Order", so_name, "custom_sales_person_user")
	if not sales_person_user:
		return

	pct, current_stage, _os_name = _so_progress_pct(so_name)
	if pct is None:
		return

	milestone = max((m for m in _PROGRESS_MILESTONES if pct >= m), default=None)
	if milestone is None:
		return

	marker = f"[ib-prod-{so_name}-{milestone}]"
	if frappe.db.exists("Notification Log", {"for_user": sales_person_user, "subject": ["like", f"%{marker}%"]}):
		return

	customer = frappe.db.get_value("Sales Order", so_name, "customer_name") or ""
	if milestone == 100:
		subject = f"Order Ready for Dispatch: {so_name}"
		body = (
			f"<p>Sales Order <strong>{so_name}</strong> for <strong>{customer}</strong> "
			f"has completed all production stages and is <strong>Ready to Deliver</strong>. "
			f"Please arrange packaging and dispatch to the customer's delivery address.</p>"
		)
	else:
		stage_txt = f" — now in <strong>{current_stage}</strong>" if current_stage else ""
		subject = f"Production Update: {so_name} is {milestone}% complete"
		body = (
			f"<p>Sales Order <strong>{so_name}</strong> for <strong>{customer}</strong> "
			f"is now <strong>{milestone}% through production</strong>{stage_txt}.</p>"
		)

	frappe.get_doc({
		"doctype": "Notification Log",
		"subject": f"{subject} {marker}"[:140],
		"email_content": body,
		"for_user": sales_person_user,
		"type": "Alert",
		"document_type": "Sales Order",
		"document_name": so_name,
		"from_user": "Administrator",
	}).insert(ignore_permissions=True)
	frappe.db.commit()


@frappe.whitelist()
def update_production_qty(work_order, pcs_to_make=None, logs_to_make=None):
	"""Factory manager reconciliation: set pcs_to_make / logs_to_make on a WO to
	account for wastage and plan how many pieces/logs to actually make from the
	target qty. Simple field update — IB Work Order is not submittable, so no
	need for a full doc.save() cycle here."""
	_require_production_role()
	if not frappe.db.exists("IB Work Order", work_order):
		frappe.throw(_("Work Order {0} not found").format(work_order))

	values = {}
	if pcs_to_make is not None and pcs_to_make != "":
		values["pcs_to_make"] = int(pcs_to_make)
	if logs_to_make is not None and logs_to_make != "":
		values["logs_to_make"] = int(logs_to_make)

	if not values:
		frappe.throw(_("Provide at least one of pcs_to_make or logs_to_make"))

	# Was previously silently accepting negative values (confirmed live: -5 and
	# -100 both persisted with no error) — a negative pieces/logs count is never
	# meaningful here and prints garbage onto the Job Order ("Pieces to Make: -5").
	for field, val in values.items():
		if val < 0:
			frappe.throw(_("{0} cannot be negative").format(field))

	frappe.db.set_value("IB Work Order", work_order, values)
	frappe.db.commit()

	return frappe.db.get_value(
		"IB Work Order", work_order, ["pcs_to_make", "logs_to_make"], as_dict=True
	)


def _notify_production_hold(doc):
	"""Alert the sales person when one of their order's items goes On Hold —
	a real delivery-delay risk they'd otherwise only discover by asking."""
	if not doc.order_sheet:
		return
	so_name = frappe.db.get_value("IB Order Sheet", doc.order_sheet, "sales_order")
	if not so_name:
		return
	sales_person_user = frappe.db.get_value("Sales Order", so_name, "custom_sales_person_user")
	if not sales_person_user:
		return

	marker = f"[ib-prod-hold-{doc.name}]"
	if frappe.db.exists("Notification Log", {"for_user": sales_person_user, "subject": ["like", f"%{marker}%"]}):
		return

	customer = frappe.db.get_value("Sales Order", so_name, "customer_name") or ""
	notes = frappe.utils.escape_html(doc.notes) if doc.notes else ""
	frappe.get_doc({
		"doctype": "Notification Log",
		"subject": f"Production Paused: {so_name} — {doc.stage} on hold {marker}"[:140],
		"email_content": (
			f"<p>Sales Order <strong>{so_name}</strong> for <strong>{customer}</strong> "
			f"has been placed <strong>On Hold</strong> at the <strong>{doc.stage}</strong> stage."
			f"{f' Note: {notes}' if notes else ''} This may affect the delivery date.</p>"
		),
		"for_user": sales_person_user,
		"type": "Alert",
		"document_type": "Sales Order",
		"document_name": so_name,
		"from_user": "Administrator",
	}).insert(ignore_permissions=True)

