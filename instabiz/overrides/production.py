"""instabiz.overrides.production"""
import json

import frappe
from frappe import _
from frappe.utils import today, now, flt, add_days, getdate, nowdate

_PRODUCTION_ROLES = {"Factory Management", "Factory Production", "System Manager"}


def _require_production_role():
    if not (_PRODUCTION_ROLES & set(frappe.get_roles())):
        frappe.throw(_("Not permitted — Factory Management role required"), frappe.PermissionError)

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


def _get_stage_route(item_code):
	"""Return ordered list of production stages for an item based on its item_group."""
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
def get_production_dashboard():
	"""KPIs + stage pipeline counts + recent entries."""
	today_date = today()

	active_wo = frappe.db.sql(
		"SELECT COUNT(*) FROM `tabIB Work Order` WHERE status NOT IN ('Completed','Cancelled')"
	)[0][0]
	pending_wo = frappe.db.count("IB Work Order", {"status": "Pending"})

	completed_today = frappe.db.sql(
		"""
		SELECT COUNT(*) FROM `tabIB Work Order`
		WHERE status = 'Completed'
		  AND DATE(COALESCE(completed_at, modified)) = %s
		""",
		(today_date,),
	)[0][0]

	machines_active = frappe.db.count("IB Machine", {"status": "Active"})

	# Stage pipeline
	stage_rows = frappe.db.sql(
		"""
		SELECT stage, status, COUNT(*) AS cnt
		FROM `tabIB Work Order`
		GROUP BY stage, status
		""",
		as_dict=True,
	)
	# Use lowercase_underscore keys so JS STAGE_COLORS lookup works directly
	def _stage_key(s):
		return s.lower().replace(" ", "_")

	stage_map = {s: {"stage": _stage_key(s), "pending": 0, "in_progress": 0, "completed": 0} for s in STAGES}
	for row in stage_rows:
		if row.stage not in stage_map:
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
		"""
		SELECT os.priority, COUNT(*) AS cnt
		FROM `tabIB Work Order` wo
		JOIN `tabIB Order Sheet` os ON os.name = wo.order_sheet
		GROUP BY os.priority
		""",
		as_dict=True,
	)
	priority_overview = {"urgent": 0, "high": 0, "normal": 0, "low": 0}
	for row in priority_rows:
		if row.priority:
			priority_overview[row.priority.lower()] = row.cnt

	# Wastage today (avg of submitted entries)
	wastage_result = frappe.db.sql(
		"""
		SELECT AVG(wastage_pct) FROM `tabIB Production Entry`
		WHERE entry_date = %s AND docstatus = 1
		""",
		(today_date,),
	)
	wastage_today = round(flt(wastage_result[0][0]), 1) if wastage_result and wastage_result[0][0] else 0.0

	# Recent 10 entries
	recent_entries = frappe.db.sql(
		"""
		SELECT name, work_order, stage, machine, output_qty, wastage_pct, entry_date
		FROM `tabIB Production Entry`
		WHERE docstatus = 1
		ORDER BY creation DESC
		LIMIT 10
		""",
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

	if not machines:
		return []

	today_date = today()
	machine_codes = [m.machine_code for m in machines]
	# Build parameterised IN list
	placeholders = ", ".join(["%s"] * len(machine_codes))
	entry_counts = frappe.db.sql(
		f"""
		SELECT machine, COUNT(*) AS cnt
		FROM `tabIB Production Entry`
		WHERE entry_date = %s AND machine IN ({placeholders})
		GROUP BY machine
		""",
		tuple([today_date] + machine_codes),
		as_dict=True,
	)
	count_map = {row.machine: row.cnt for row in entry_counts}

	for m in machines:
		m["today_entries"] = count_map.get(m.machine_code, 0)

	return machines


@frappe.whitelist()
def save_machine(
	machine_code,
	machine_name,
	machine_type,
	location,
	capacity,
	capacity_uom,
	wastage_norm_pct,
	status,
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
	doc.capacity_uom = capacity_uom
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
def get_order_sheets(status=None, priority=None):
	"""Return order sheets with progress %."""
	filters = {}
	if status:
		filters["status"] = status
	if priority:
		filters["priority"] = priority

	sheets = frappe.get_all(
		"IB Order Sheet",
		filters=filters,
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

	# Customer name from Customer master
	customer_names = frappe.db.sql(
		f"""
		SELECT name, customer_name FROM `tabCustomer`
		WHERE name IN ({placeholders})
		""",
		tuple([s.customer for s in sheets if s.customer]),
		as_dict=True,
	) if any(s.customer for s in sheets) else []
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
		existing = frappe.db.get_value(
			"IB Order Sheet",
			{"sales_order": sales_order, "status": ["!=", "Cancelled"]},
			"name",
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

		# Pull items from SO
		for item in so.items:
			doc.append("items", {
				"item_code": item.item_code,
				"item_name": item.item_name,
				"qty": item.qty,
				"uom": item.uom,
				"completed_qty": 0.0,
				"status": "Pending",
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
def get_stage_pipeline(date=None):
	"""Return all In Progress + Pending work orders grouped by stage."""
	rows = frappe.db.sql(
		"""
		SELECT wo.name, wo.item_code, wo.stage, wo.machine, wo.status,
			wo.target_qty, wo.target_uom, wo.completed_qty, wo.wastage_pct,
			wo.order_sheet, wo.order_sheet_item, wo.priority AS wo_priority,
			COALESCE(osi.item_name, wo.item_name) AS item_name,
			os.priority, os.customer_name
		FROM `tabIB Work Order` wo
		LEFT JOIN `tabIB Order Sheet` os ON os.name = wo.order_sheet
		LEFT JOIN `tabIB Order Sheet Item` osi ON osi.name = wo.order_sheet_item
		WHERE wo.status IN ('Pending', 'In Progress')
		ORDER BY wo.stage, FIELD(os.priority, 'Urgent', 'High', 'Normal', 'Low'), wo.creation
		""",
		as_dict=True,
	)

	def _sk(s):
		return s.lower().replace(" ", "_")

	pipeline = {_sk(stage): [] for stage in STAGES}
	for row in rows:
		stage = row.get("stage", "")
		key = _sk(stage)
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
			"customer_name": row.customer_name,
		}
		if key in pipeline:
			pipeline[key].append(entry)
		else:
			pipeline[key] = [entry]

	return pipeline


# ---------------------------------------------------------------------------
# 5. Order Sheet Detail
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_order_sheet_detail(order_sheet):
	"""Full detail for one Order Sheet: doc, work_orders, views."""
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
		],
		order_by="creation asc",
	)

	# Order-wise view: items with their WOs listed per item
	order_wise_view = []
	wo_by_item = {}
	for wo in work_orders:
		wo_by_item.setdefault(wo.item_code, []).append(wo)

	for item in items:
		order_wise_view.append({
			**item,
			"work_orders": wo_by_item.get(item["item_code"], []),
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


# ---------------------------------------------------------------------------
# 6. Work Order operations
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_work_order_detail(work_order):
	"""Full WO detail + production entries history."""
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
	doc = frappe.get_doc("IB Work Order", work_order)
	if doc.status != "Pending":
		frappe.throw(_("Machine can only be assigned to a Pending work order. Current status: {0}").format(doc.status))
	if not frappe.db.exists("IB Machine", machine):
		frappe.throw(_("Machine {0} does not exist").format(machine))
	doc.machine = machine
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"status": "ok", "machine": machine}


@frappe.whitelist()
def start_work_order(work_order):
	"""Set status=In Progress, record started_at."""
	_require_production_role()
	current_status = frappe.db.get_value("IB Work Order", work_order, "status")
	if current_status == "In Progress":
		return {"status": "ok", "started_at": frappe.db.get_value("IB Work Order", work_order, "started_at")}
	if current_status not in ("Pending", "On Hold"):
		frappe.throw(
			_("Work Order {0} cannot be started from status '{1}'. Expected: Pending or On Hold.").format(
				work_order, current_status
			)
		)
	started_at = now()
	frappe.db.set_value("IB Work Order", work_order, {"status": "In Progress", "started_at": started_at})
	# frappe.db.set_value bypasses Document events — fire the n8n webhook explicitly.
	from instabiz.overrides.n8n_hooks import on_work_order_update
	doc = frappe.get_doc("IB Work Order", work_order)
	on_work_order_update(doc)
	frappe.db.commit()
	return {"status": "ok", "started_at": started_at}


@frappe.whitelist()
def complete_work_order(work_order):
	"""Set status=Completed, record completed_at. Also updates Order Sheet Item status."""
	_require_production_role()
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
	frappe.db.set_value(
		"IB Work Order", work_order,
		{"status": "Completed", "completed_at": completed_at, "completed_qty": qty_done},
	)
	# frappe.db.set_value bypasses Document events — the IB Work Order.on_update hook
	# (on_work_order_update_notify + n8n's on_work_order_update) never fires from this
	# path. Call both directly so the bell + webhook actually fire.
	doc.status = "Completed"
	doc.completed_at = completed_at
	doc.completed_qty = qty_done
	on_work_order_update_notify(doc)
	from instabiz.overrides.n8n_hooks import on_work_order_update
	on_work_order_update(doc)

	# Update Order Sheet Item completed_qty and status
	if doc.order_sheet and doc.item_code:
		_update_order_sheet_item(doc.order_sheet, doc.item_code, qty_done,
								 order_sheet_item=doc.order_sheet_item or None)
		_update_order_sheet_progress(doc.order_sheet)

	frappe.db.commit()
	return {"status": "ok", "completed_at": completed_at}


@frappe.whitelist()
def put_on_hold(work_order):
	"""Set status=On Hold."""
	_require_production_role()
	current_status = frappe.db.get_value("IB Work Order", work_order, "status")
	if current_status == "On Hold":
		frappe.throw(_("Work Order {0} is already On Hold.").format(work_order))
	frappe.db.set_value("IB Work Order", work_order, "status", "On Hold")
	# frappe.db.set_value bypasses Document events — fire the n8n webhook explicitly.
	from instabiz.overrides.n8n_hooks import on_work_order_update
	doc = frappe.get_doc("IB Work Order", work_order)
	on_work_order_update(doc)
	frappe.db.commit()
	return {"status": "ok"}


@frappe.whitelist()
def create_work_orders_for_item(order_sheet, item_code, stages):
	"""Create IB Work Order records for specified stages for an item."""
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

	created = []
	for stage in stages:
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
	"""Return daily production report data."""
	if not date:
		date = today()

	entries = frappe.db.sql(
		"""
		SELECT pe.name, pe.work_order, pe.stage, pe.machine,
			pe.operator, pe.entry_date,
			pe.input_qty, pe.output_qty, pe.wastage_qty, pe.wastage_pct,
			TIMESTAMPDIFF(MINUTE, pe.start_time, pe.end_time) AS duration_min
		FROM `tabIB Production Entry` pe
		WHERE pe.entry_date = %s AND pe.docstatus = 1
		ORDER BY pe.stage, pe.machine
		""",
		(date,),
		as_dict=True,
	)

	# WO completions for the day — visible even when no entries are logged
	wo_done = frappe.db.sql(
		"""
		SELECT stage, COUNT(*) AS cnt, SUM(completed_qty) AS qty
		FROM `tabIB Work Order`
		WHERE status = 'Completed' AND DATE(COALESCE(completed_at, modified)) = %s
		GROUP BY stage
		""",
		(date,),
		as_dict=True,
	)
	wo_summary = {
		"wo_completed": sum(r.cnt for r in wo_done),
		"wo_by_stage": {r.stage: {"count": r.cnt, "qty": flt(r.qty)} for r in wo_done},
	}

	if not entries:
		return {
			"date": date,
			"summary": {
				"total_entries": 0,
				"total_input": 0,
				"total_output": 0,
				"avg_wastage_pct": 0,
				"total_hours": 0,
				**wo_summary,
			},
			"stages": [],
			"machine_breakdown": {},
		}

	# Gather machine norm map
	machine_norms = {}
	machines_in_entries = list({e.machine for e in entries if e.machine})
	if machines_in_entries:
		placeholders = ", ".join(["%s"] * len(machines_in_entries))
		norm_rows = frappe.db.sql(
			f"SELECT machine_code, wastage_norm_pct FROM `tabIB Machine` WHERE machine_code IN ({placeholders})",
			tuple(machines_in_entries),
			as_dict=True,
		)
		machine_norms = {r.machine_code: flt(r.wastage_norm_pct) for r in norm_rows}
		# Also get machine names and types
		machine_info = frappe.db.sql(
			f"SELECT machine_code, machine_name, machine_type FROM `tabIB Machine` WHERE machine_code IN ({placeholders})",
			tuple(machines_in_entries),
			as_dict=True,
		)
		machine_meta = {r.machine_code: r for r in machine_info}
	else:
		machine_meta = {}

	# Summary
	total_input = sum(flt(e.input_qty) for e in entries)
	total_output = sum(flt(e.output_qty) for e in entries)
	avg_wastage = round(sum(flt(e.wastage_pct) for e in entries) / len(entries), 1)
	total_min = sum(flt(e.duration_min) for e in entries if e.duration_min)
	total_hours = round(total_min / 60, 2)

	summary = {
		"total_entries": len(entries),
		"total_input":   total_input,
		"total_output":  total_output,
		"avg_wastage_pct": avg_wastage,
		"total_hours":   total_hours,
	}

	# Stage table
	stage_data = {}
	for e in entries:
		stage = e.stage or "Unknown"
		if stage not in stage_data:
			stage_data[stage] = {
				"stage": stage,
				"entries": 0,
				"input_qty": 0.0,
				"output_qty": 0.0,
				"wastage_qty": 0.0,
				"wastage_pct_sum": 0.0,
				"minutes": 0.0,
				"above_norm_count": 0,
				"machines": {},
			}
		sd = stage_data[stage]
		sd["entries"] += 1
		sd["input_qty"] += flt(e.input_qty)
		sd["output_qty"] += flt(e.output_qty)
		sd["wastage_qty"] += flt(e.wastage_qty)
		sd["wastage_pct_sum"] += flt(e.wastage_pct)
		sd["minutes"] += flt(e.duration_min) if e.duration_min else 0.0

		norm = machine_norms.get(e.machine, 2.0)
		above_norm = flt(e.wastage_pct) > norm
		if above_norm:
			sd["above_norm_count"] += 1

		# Machine breakdown within stage
		mkey = e.machine or "Unknown"
		if mkey not in sd["machines"]:
			minfo = machine_meta.get(mkey, frappe._dict())
			sd["machines"][mkey] = {
				"machine_code": mkey,
				"machine_name": minfo.get("machine_name", mkey),
				"entries": 0,
				"output_qty": 0.0,
				"wastage_pct_sum": 0.0,
				"above_norm": False,
			}
		m = sd["machines"][mkey]
		m["entries"] += 1
		m["output_qty"] += flt(e.output_qty)
		m["wastage_pct_sum"] += flt(e.wastage_pct)
		if above_norm:
			m["above_norm"] = True

	stage_table = []
	machine_breakdown = {}
	for stage in STAGES:
		if stage not in stage_data:
			continue
		sd = stage_data[stage]
		hours = round(sd["minutes"] / 60, 2)
		hourly_avg = round(sd["output_qty"] / hours, 2) if hours else 0.0
		avg_wp = round(sd["wastage_pct_sum"] / sd["entries"], 1) if sd["entries"] else 0.0
		stage_table.append({
			"stage": stage,
			"entries": sd["entries"],
			"input_qty": sd["input_qty"],
			"output_qty": sd["output_qty"],
			"wastage_qty": sd["wastage_qty"],
			"wastage_pct": avg_wp,
			"hours": hours,
			"hourly_avg": hourly_avg,
			"above_norm_count": sd["above_norm_count"],
		})

		# Machine breakdown for this stage
		mb_list = []
		for mkey, m in sd["machines"].items():
			m_avg_wp = round(m["wastage_pct_sum"] / m["entries"], 1) if m["entries"] else 0.0
			mb_list.append({
				"machine_code": m["machine_code"],
				"machine_name": m["machine_name"],
				"entries": m["entries"],
				"output_qty": m["output_qty"],
				"wastage_pct": m_avg_wp,
				"above_norm": m["above_norm"],
			})
		machine_breakdown[stage] = mb_list

	# Include any extra stages not in STAGES list
	for stage, sd in stage_data.items():
		if stage not in {row["stage"] for row in stage_table}:
			hours = round(sd["minutes"] / 60, 2)
			hourly_avg = round(sd["output_qty"] / hours, 2) if hours else 0.0
			avg_wp = round(sd["wastage_pct_sum"] / sd["entries"], 1) if sd["entries"] else 0.0
			stage_table.append({
				"stage": stage,
				"entries": sd["entries"],
				"input_qty": sd["input_qty"],
				"output_qty": sd["output_qty"],
				"wastage_qty": sd["wastage_qty"],
				"wastage_pct": avg_wp,
				"hours": hours,
				"hourly_avg": hourly_avg,
				"above_norm_count": sd["above_norm_count"],
			})
			mb_list = []
			for mkey, m in sd["machines"].items():
				m_avg_wp = round(m["wastage_pct_sum"] / m["entries"], 1) if m["entries"] else 0.0
				mb_list.append({
					"machine_code": m["machine_code"],
					"machine_name": m["machine_name"],
					"entries": m["entries"],
					"output_qty": m["output_qty"],
					"wastage_pct": m_avg_wp,
					"above_norm": m["above_norm"],
				})
			machine_breakdown[stage] = mb_list

	# Embed machines list into each stage row for JS consumption
	for row in stage_table:
		raw_machines = machine_breakdown.get(row["stage"], [])
		row["machines"] = [
			{
				"machine": m.get("machine_name") or m.get("machine_code") or "",
				"entries": m.get("entries", 0),
				"output_qty": m.get("output_qty", 0),
				"wastage_pct": m.get("wastage_pct", 0),
				"above_norm": m.get("above_norm", False),
				"status": "Above Norm" if m.get("above_norm") else "Normal",
			}
			for m in raw_machines
		]

	return {
		"date": date,
		"stages": stage_table,
		"summary": {**summary, **wo_summary},
		"machine_breakdown": machine_breakdown,
	}


@frappe.whitelist()
def get_weekly_dpr(week_start=None, date=None):
	"""Return 7-day production summary. `date` is an alias for `week_start` (JS sends `date`)."""
	if not week_start:
		week_start = date or today()
		today_dt = getdate(week_start)
		week_start = add_days(today_dt, -today_dt.weekday())
	else:
		week_start = getdate(week_start)

	week_end = add_days(week_start, 6)

	rows = frappe.db.sql(
		"""
		SELECT entry_date,
			COUNT(*) AS entries,
			SUM(input_qty) AS total_input_qty,
			SUM(output_qty) AS total_output_qty,
			SUM(wastage_qty) AS total_wastage_qty,
			AVG(wastage_pct) AS avg_wastage_pct,
			SUM(TIMESTAMPDIFF(MINUTE, start_time, end_time)) AS total_minutes
		FROM `tabIB Production Entry`
		WHERE entry_date BETWEEN %s AND %s
		AND docstatus = 1
		GROUP BY entry_date
		ORDER BY entry_date
		""",
		(week_start, week_end),
		as_dict=True,
	)

	# Build day-by-day map with zeros for missing days
	row_map = {str(r.entry_date): r for r in rows}
	result = []
	for i in range(7):
		day = add_days(week_start, i)
		day_str = str(day)
		r = row_map.get(day_str)
		result.append({
			"date": day_str,
			"entries":     r.entries if r else 0,
			"input_qty":   flt(r.total_input_qty)  if r else 0.0,
			"output_qty":  flt(r.total_output_qty) if r else 0.0,
			"wastage_qty": flt(r.total_wastage_qty) if r else 0.0,
			"wastage_pct": round(flt(r.avg_wastage_pct), 1) if r else 0.0,
			"hours":       round(flt(r.total_minutes) / 60, 2) if r else 0.0,
		})

	total_output = sum(d["output_qty"] for d in result)
	days_with_data = sum(1 for d in result if d["entries"] > 0)
	avg_daily = round(total_output / days_with_data, 1) if days_with_data else 0.0
	avg_wastage = round(
		sum(d["wastage_pct"] for d in result if d["entries"] > 0) / days_with_data, 1
	) if days_with_data else 0.0

	return {
		"week_start": str(week_start),
		"week_end": str(week_end),
		"summary": {
			"total_output": total_output,
			"avg_daily": avg_daily,
			"avg_wastage_pct": avg_wastage,
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
		new_status = "Completed" if flt(completed_qty) >= flt(row.qty) else "In Progress"
		frappe.db.set_value(
			"IB Order Sheet Item",
			row.name,
			{
				"completed_qty": completed_qty,
				"status": new_status,
			},
		)


def _update_order_sheet_progress(order_sheet_name):
	"""Check if all items complete → mark OS as Completed."""
	items = frappe.db.get_all(
		"IB Order Sheet Item",
		filters={"parent": order_sheet_name},
		fields=["status"],
	)
	if not items:
		return
	if all(item.status == "Completed" for item in items):
		already_completed = frappe.db.get_value("IB Order Sheet", order_sheet_name, "status") == "Completed"
		frappe.db.set_value("IB Order Sheet", order_sheet_name, "status", "Completed")
		if not already_completed:
			# frappe.db.set_value bypasses Document events — the n8n order_sheet_completed
			# webhook (wired to IB Order Sheet.on_update) never fires from this path.
			from instabiz.overrides.n8n_hooks import on_order_sheet_updated
			on_order_sheet_updated(frappe.get_doc("IB Order Sheet", order_sheet_name))


@frappe.whitelist()
def advance_to_next_stage(work_order):
	"""Complete current WO and auto-create + auto-assign the next stage WO.

	This is the primary production automation entry point. The production
	manager clicks 'Next Stage' once physical work is done — the system handles
	the rest: completing the current WO, determining the next stage, creating
	the new WO, and auto-assigning a machine.
	"""
	_require_production_role()
	doc = frappe.get_doc("IB Work Order", work_order)

	# Idempotency: already completed — find the next-stage WO that was activated and return it
	if doc.status == "Completed":
		stage_route = _get_stage_route(doc.item_code)
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
	frappe.db.set_value(
		"IB Work Order", work_order,
		{"status": "Completed", "completed_at": completed_at, "completed_qty": qty_done},
	)
	doc.status = "Completed"
	doc.completed_at = completed_at
	doc.completed_qty = qty_done
	# frappe.db.set_value bypasses Document events — the IB Work Order.on_update hook
	# (on_work_order_update_notify + n8n's on_work_order_update) never fires from this
	# path. Call both directly so the bell + webhook actually fire.
	on_work_order_update_notify(doc)
	from instabiz.overrides.n8n_hooks import on_work_order_update
	on_work_order_update(doc)
	_update_order_sheet_item(doc.order_sheet, doc.item_code, qty_done,
							 order_sheet_item=doc.order_sheet_item or None)

	# Determine next stage from item's route (route-aware, skips inapplicable stages)
	stage_route = _get_stage_route(doc.item_code)
	try:
		route_idx = stage_route.index(doc.stage)
	except ValueError:
		frappe.db.commit()
		return {"status": "ok", "next_stage": None, "message": "Unknown stage"}

	if route_idx >= len(stage_route) - 1:
		_update_order_sheet_progress(doc.order_sheet)
		frappe.db.commit()
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

	return {
		"status": "ok",
		"next_stage": next_stage,
		"new_work_order": new_wo.name,
		"machine_assigned": bool(new_wo.machine),
		"message": f"Advanced to {next_stage} — WO {new_wo.name} created",
	}


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
		stage_route = _get_stage_route(item.item_code)

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
		item.item_code: _get_stage_route(item.item_code) for item in os_doc.items
	}}


# Backward-compat alias used by older callers
def auto_create_first_stage_wos(order_sheet):
	return auto_create_all_stage_wos(order_sheet)


@frappe.whitelist()
def get_production_plan(limit=None):
	"""Return data for all 3 production views (order-wise, product-wise, machine-wise).

	limit: max number of order sheets to return in order_wise (default: all).
	       Dashboard passes limit=25 to keep the view fast.
	"""
	limit_clause = f"LIMIT {int(limit)}" if limit and str(limit).isdigit() else ""

	# ── Order-wise: active order sheets with item stage status ──────────────
	order_sheets = frappe.db.sql(
		f"""
		SELECT os.name, os.sales_order, os.customer_name, os.priority, os.status,
		       os.delivery_date, os.order_date
		FROM `tabIB Order Sheet` os
		WHERE os.status IN ('Draft', 'In Progress')
		ORDER BY
		  FIELD(os.priority, 'Urgent','High','Normal','Low'),
		  os.delivery_date ASC
		{limit_clause}
		""",
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

	# ── Product-wise: all active WOs grouped by stage (for kanban) ──────────
	wos = frappe.db.sql(
		"""
		SELECT wo.name, wo.item_code, wo.item_name, wo.stage, wo.status,
		       wo.machine, wo.priority, wo.target_qty, wo.completed_qty,
		       wo.wastage_pct, wo.started_at, wo.order_sheet,
		       os.customer_name, os.sales_order, os.priority AS os_priority
		FROM `tabIB Work Order` wo
		LEFT JOIN `tabIB Order Sheet` os ON os.name = wo.order_sheet
		WHERE wo.status IN ('Pending', 'In Progress')
		ORDER BY FIELD(wo.priority,'Urgent','High','Normal','Low'), wo.creation ASC
		""",
		as_dict=True,
	)
	pipeline = {s: [] for s in STAGES}
	for wo in wos:
		if wo.stage in pipeline:
			pipeline[wo.stage].append(wo)

	# ── Machine-wise: active machines with current WO ───────────────────────
	machines = frappe.db.get_all(
		"IB Machine",
		filters={"status": "Active"},
		fields=["name", "machine_code", "machine_name", "machine_type",
		        "location", "capacity", "capacity_uom", "wastage_norm_pct"],
		order_by="machine_type, machine_code",
	)
	for m in machines:
		m["current_wos"] = frappe.db.get_all(
			"IB Work Order",
			filters={"machine": m.name, "status": ["in", ["Pending", "In Progress"]]},
			fields=["name", "item_code", "item_name", "stage", "status",
			        "target_qty", "completed_qty", "order_sheet"],
		)
		# Today's output from production entries
		today_out = frappe.db.sql(
			"""
			SELECT SUM(output_qty) AS output, AVG(wastage_pct) AS avg_wastage
			FROM `tabIB Production Entry`
			WHERE machine = %(machine)s AND entry_date = %(today)s AND docstatus = 1
			""",
			{"machine": m.name, "today": today()},
			as_dict=True,
		)
		m["today_output"] = flt(today_out[0].output) if today_out else 0
		m["today_wastage"] = flt(today_out[0].avg_wastage) if today_out else 0

	return {
		"stages": STAGES,
		"order_wise": order_sheets,
		"product_wise": pipeline,
		"machine_wise": machines,
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


@frappe.whitelist()
def get_item_wise_view(from_date=None, to_date=None, item_code=None):
	"""Item-wise production view.

	Returns per-item: active WOs, jumbo roll batches, stage progress.
	Groups by item_code across all order sheets.
	"""
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
			"started_at", "completed_at",
		],
		order_by="item_code asc, stage asc",
	)

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
def get_machine_wise_dashboard():
	"""Machine-wise dashboard: per machine — current WOs, today stats, load %."""
	machines = frappe.db.get_all(
		"IB Machine",
		filters={"status": "Active"},
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
			        "started_at", "priority"],
			order_by="started_at asc",
		)

		# Today's stats from submitted Production Entries
		today_stats = frappe.db.sql(
			"""
			SELECT
				COUNT(*) AS entry_count,
				COALESCE(SUM(output_qty), 0) AS total_output,
				COALESCE(SUM(input_qty), 0) AS total_input,
				COALESCE(AVG(wastage_pct), 0) AS avg_wastage
			FROM `tabIB Production Entry`
			WHERE machine = %s AND entry_date = %s AND docstatus = 1
			""",
			(m.name, today_date),
			as_dict=True,
		)
		stats = today_stats[0] if today_stats else {}

		active_load = sum(1 for wo in current_wos if wo.status == "In Progress")
		# load_pct: each machine handles 1 WO at a time; >1 active = overloaded
		load_pct = min(200.0, round(active_load * 100.0, 1))

		result.append({
			**dict(m),
			"current_wos": [dict(wo) for wo in current_wos],
			"today_entry_count": int(stats.get("entry_count") or 0),
			"today_output": flt(stats.get("total_output")),
			"today_input": flt(stats.get("total_input")),
			"today_avg_wastage": round(flt(stats.get("avg_wastage")), 1),
			"active_load": active_load,
			"load_pct": load_pct,
		})

	return result


def run_daily_production_snapshot():
	"""Daily: auto-create Order Sheets for recently submitted SOs that have none yet.

	Priority is derived from delivery urgency:
	  <= 2 days  → Urgent
	  <= 5 days  → High
	  <= 10 days → Normal
	  > 10 days  → Low
	Only SOs from the last 30 days are considered (avoids processing old backlog all at once).
	"""
	# Scheduler runs without a user session; set Administrator so _require_production_role passes
	frappe.set_user("Administrator")

	rows = frappe.db.sql(
		"""
		SELECT so.name,
		       CASE
		           WHEN DATEDIFF(so.delivery_date, CURDATE()) <= 2 THEN 'Urgent'
		           WHEN DATEDIFF(so.delivery_date, CURDATE()) <= 5 THEN 'High'
		           WHEN DATEDIFF(so.delivery_date, CURDATE()) <= 10 THEN 'Normal'
		           ELSE 'Low'
		       END AS priority
		FROM `tabSales Order` so
		WHERE so.docstatus = 1
		  AND so.transaction_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
		  AND so.name NOT IN (
		      SELECT os.sales_order FROM `tabIB Order Sheet` os
		      WHERE os.status != 'Cancelled' AND os.sales_order IS NOT NULL
		  )
		ORDER BY so.delivery_date ASC
		""",
		as_dict=True,
	)

	created, errors = [], []
	for row in rows:
		try:
			os_name = create_order_sheet(row.name, priority=row.priority)
			created.append(os_name)
		except Exception as e:
			errors.append(row.name)
			frappe.log_error(
				title=f"Production Auto-Schedule: {row.name}",
				message=frappe.get_traceback(),
			)

	frappe.logger().info(
		f"Production Auto-Schedule: {len(created)} order sheets created, {len(errors)} errors"
	)
	return {"created": created, "errors": errors}


@frappe.whitelist()
def get_so_production_status(sales_order):
	"""Return full production status for a Sales Order.

	Shows per-item: route, current stage, completed stages, machine assignments.
	Used by the production dashboard SO-drill-down.
	"""
	os_name = frappe.db.get_value(
		"IB Order Sheet",
		{"sales_order": sales_order, "status": ["!=", "Cancelled"]},
		"name",
	)
	if not os_name:
		return {"has_order_sheet": False, "sales_order": sales_order}

	os_doc = frappe.get_doc("IB Order Sheet", os_name)
	items_out = []

	for item in os_doc.items:
		stage_route = _get_stage_route(item.item_code)
		wos = frappe.db.get_all(
			"IB Work Order",
			filters={"order_sheet": os_name, "item_code": item.item_code,
			         "status": ["not in", ["Cancelled"]]},
			fields=["name", "stage", "status", "machine", "target_qty",
			        "completed_qty", "wastage_pct", "started_at", "completed_at"],
		)
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
	"""Reassign a Work Order to a different pipeline stage (drag-and-drop in Pipeline view)."""
	_require_production_role()
	if new_stage not in _VALID_STAGES:
		frappe.throw(frappe._("Invalid stage: {0}").format(new_stage))
	doc = frappe.get_doc("IB Work Order", work_order)
	if doc.status == "Completed":
		frappe.throw(frappe._("Cannot move completed Work Order {0} to a different stage.").format(work_order))
	old_stage = doc.stage
	if old_stage == new_stage:
		return {"ok": True, "changed": False}
	doc.stage = new_stage
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"ok": True, "changed": True, "old_stage": old_stage, "new_stage": new_stage}


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
	else:
		result["ready_to_deliver"] = False

	return result


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
	"""Batch fetch production + dispatch badge for a list of SO names."""
	if isinstance(sales_orders, str):
		sales_orders = json.loads(sales_orders)
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
def get_job_bundles():
	"""Group Pending WOs by item_code+stage across order sheets for efficient batch assignment."""
	rows = frappe.db.sql("""
		SELECT wo.name, wo.item_code, wo.item_name, wo.stage, wo.target_qty,
		       wo.target_uom, wo.machine, wo.batch_group, wo.order_sheet,
		       os.priority, os.sales_order, os.customer_name, os.delivery_date
		FROM `tabIB Work Order` wo
		JOIN `tabIB Order Sheet` os ON os.name = wo.order_sheet
		WHERE wo.status = 'Pending'
		ORDER BY wo.item_code, wo.stage,
		         FIELD(os.priority, 'Urgent', 'High', 'Normal', 'Low')
	""", as_dict=True)

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
	if not frappe.db.exists("IB Machine", machine):
		frappe.throw(_("Machine {0} does not exist").format(machine))

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
	return {"updated": updated, "machine": machine, "batch_group": batch_group}


# ── Ready-to-Deliver notification (doc event) ─────────────────────────────────

def on_work_order_update_notify(doc, method=None):
	"""Bell to sales person when all items on an Order Sheet reach Ready to Deliver."""
	if doc.stage != "Ready to Deliver" or doc.status != "Completed":
		return
	if not doc.order_sheet:
		return

	so_name = frappe.db.get_value("IB Order Sheet", doc.order_sheet, "sales_order")
	if not so_name:
		return

	sales_person_user = frappe.db.get_value("Sales Order", so_name, "custom_sales_person_user")
	if not sales_person_user:
		return

	marker = f"[ib-prod-rtd-{so_name}]"
	already = frappe.db.sql("""
		SELECT name FROM `tabNotification Log`
		WHERE for_user = %s AND subject LIKE %s AND DATE(creation) = %s LIMIT 1
	""", (sales_person_user, f"%{marker}%", today()))
	if already:
		return

	os_item_count = frappe.db.sql(
		"SELECT COUNT(DISTINCT item_code) FROM `tabIB Order Sheet Item` WHERE parent = %s",
		(doc.order_sheet,),
	)[0][0]
	if not os_item_count:
		return

	rtd_done = frappe.db.sql("""
		SELECT COUNT(DISTINCT item_code) FROM `tabIB Work Order`
		WHERE order_sheet = %s AND stage = 'Ready to Deliver' AND status = 'Completed'
	""", (doc.order_sheet,))[0][0]

	if rtd_done < os_item_count:
		return

	customer = frappe.db.get_value("IB Order Sheet", doc.order_sheet, "customer_name") or ""
	frappe.get_doc({
		"doctype": "Notification Log",
		"subject": f"Order Ready for Dispatch: {so_name} {marker}",
		"email_content": (
			f"<p>Sales Order <strong>{so_name}</strong> for <strong>{customer}</strong> "
			f"has completed all production stages and is <strong>Ready to Deliver</strong>. "
			f"Please arrange packaging and dispatch to the customer's delivery address.</p>"
		),
		"for_user": sales_person_user,
		"type": "Alert",
		"document_type": "Sales Order",
		"document_name": so_name,
		"from_user": "Administrator",
	}).insert(ignore_permissions=True)
	frappe.db.commit()


# ── n8n connectivity helpers ──────────────────────────────────────────────────

@frappe.whitelist()
def test_n8n_connection():
	"""Test n8n webhook connectivity. Returns ok/error for dashboard display."""
	url = frappe.conf.get("n8n_webhook_url") or ""
	if not url:
		return {"ok": False, "error": "n8n_webhook_url not configured in site_config.json"}
	try:
		import requests
		resp = requests.post(
			url,
			json={"event": "ping", "payload": {"test": True, "site": frappe.local.site}},
			timeout=5,
		)
		return {"ok": resp.status_code < 400, "status_code": resp.status_code, "url": url}
	except Exception as e:
		return {"ok": False, "error": str(e), "url": url}


@frappe.whitelist()
def get_n8n_status():
	"""Return n8n configuration state for the dashboard panel."""
	url = frappe.conf.get("n8n_webhook_url") or ""
	return {
		"configured": bool(url),
		"webhook_url": url,
		"n8n_ui": "http://localhost:5678",
	}
