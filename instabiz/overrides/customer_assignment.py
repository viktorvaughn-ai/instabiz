import random
import frappe
from frappe import _
from frappe.utils import today, now, add_days


# ── Config ────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_assignment_config():
	doc = frappe.get_single("IB Assignment Config")
	return {
		"assignments_per_day": int(doc.assignments_per_day or 10),
		"dormant_threshold_days": int(doc.dormant_threshold_days or 90),
		"dormant_ratio": float(doc.dormant_ratio or 50),
	}


# ── Territory helpers ─────────────────────────────────────────────────────────

def get_user_territories(user):
	"""Return list of territory names the user covers via Lead Sales Team."""
	rows = frappe.db.sql(
		"""
		SELECT DISTINCT lstt.territory
		FROM `tabLead Sales Team Member` lstm
		INNER JOIN `tabLead Sales Team Territory` lstt ON lstt.parent = lstm.parent
		WHERE lstm.user = %(user)s
		""",
		{"user": user},
		as_dict=True,
	)
	return [r.territory for r in rows]


def get_active_sales_users():
	"""Return all enabled users who have the Sales User role."""
	rows = frappe.db.sql(
		"""
		SELECT DISTINCT u.name
		FROM `tabUser` u
		INNER JOIN `tabHas Role` hr ON hr.parent = u.name
		WHERE hr.role = 'Sales User'
		  AND u.enabled = 1
		  AND u.name != 'Administrator'
		""",
		as_dict=True,
	)
	return [r.name for r in rows]


# ── Customer classification ───────────────────────────────────────────────────

def classify_customer(customer, threshold_days):
	"""Return 'Dormant' or 'Regular' based on last submitted SO date."""
	last_so = frappe.db.sql(
		"""
		SELECT MAX(transaction_date) AS last_date
		FROM `tabSales Order`
		WHERE customer = %(customer)s
		  AND docstatus = 1
		""",
		{"customer": customer},
		as_dict=True,
	)
	last_date = last_so[0].last_date if last_so else None
	if not last_date:
		return "Dormant"
	cutoff = frappe.utils.add_days(today(), -threshold_days)
	return "Regular" if str(last_date) >= str(cutoff) else "Dormant"


# ── Pool queries ──────────────────────────────────────────────────────────────

def _already_assigned_customers(date):
	"""Return set of customer names with active assignment on date."""
	rows = frappe.db.sql(
		"""
		SELECT DISTINCT customer
		FROM `tabIB Customer Assignment`
		WHERE assigned_date = %(date)s
		  AND status IN ('Pending', 'Contacted')
		""",
		{"date": date},
		as_dict=True,
	)
	return {r.customer for r in rows}


def get_dormant_pool(territories, exclude_customers, threshold_days, limit=50, offset=0, count_only=False, search=None):
	"""Customers in territories with no/old SO, not already assigned on target date."""
	if not territories:
		return 0 if count_only else []
	cutoff = frappe.utils.add_days(today(), -threshold_days)
	placeholders = ", ".join(["%s"] * len(territories))
	excluded = list(exclude_customers) if exclude_customers else ["__none__"]
	excl_placeholders = ", ".join(["%s"] * len(excluded))
	search_clause = " AND c.name LIKE %s" if search else ""
	search_val = [f"%{search}%"] if search else []
	if count_only:
		rows = frappe.db.sql(
			f"""
			SELECT COUNT(*) AS cnt FROM (
				SELECT c.name
				FROM `tabCustomer` c
				LEFT JOIN `tabSales Order` so ON so.customer = c.name AND so.docstatus = 1
				WHERE c.territory IN ({placeholders})
				  AND c.disabled = 0
				  AND c.name NOT IN ({excl_placeholders})
				  {search_clause}
				GROUP BY c.name, c.territory
				HAVING MAX(so.transaction_date) IS NULL OR MAX(so.transaction_date) < %s
			) sub
			""",
			territories + excluded + search_val + [cutoff],
			as_dict=True,
		)
		return rows[0].cnt if rows else 0
	rows = frappe.db.sql(
		f"""
		SELECT c.name AS customer, c.customer_name, c.territory, c.gstin,
		       MAX(so.transaction_date) AS last_so_date
		FROM `tabCustomer` c
		LEFT JOIN `tabSales Order` so
		    ON so.customer = c.name AND so.docstatus = 1
		WHERE c.territory IN ({placeholders})
		  AND c.disabled = 0
		  AND c.name NOT IN ({excl_placeholders})
		  {search_clause}
		GROUP BY c.name, c.territory
		HAVING last_so_date IS NULL OR last_so_date < %s
		ORDER BY last_so_date ASC
		LIMIT %s OFFSET %s
		""",
		territories + excluded + search_val + [cutoff, limit, offset],
		as_dict=True,
	)
	return rows


def get_regular_pool(territories, exclude_customers, threshold_days, limit=50, offset=0, count_only=False, search=None):
	"""Customers in territories with recent SO, not already assigned on target date."""
	if not territories:
		return 0 if count_only else []
	cutoff = frappe.utils.add_days(today(), -threshold_days)
	placeholders = ", ".join(["%s"] * len(territories))
	excluded = list(exclude_customers) if exclude_customers else ["__none__"]
	excl_placeholders = ", ".join(["%s"] * len(excluded))
	search_clause = " AND c.name LIKE %s" if search else ""
	search_val = [f"%{search}%"] if search else []
	if count_only:
		rows = frappe.db.sql(
			f"""
			SELECT COUNT(*) AS cnt FROM (
				SELECT c.name
				FROM `tabCustomer` c
				INNER JOIN `tabSales Order` so ON so.customer = c.name AND so.docstatus = 1
				WHERE c.territory IN ({placeholders})
				  AND c.disabled = 0
				  AND c.name NOT IN ({excl_placeholders})
				  {search_clause}
				  AND so.transaction_date >= %s
				GROUP BY c.name, c.territory
			) sub
			""",
			territories + excluded + search_val + [cutoff],
			as_dict=True,
		)
		return rows[0].cnt if rows else 0
	rows = frappe.db.sql(
		f"""
		SELECT c.name AS customer, c.customer_name, c.territory, c.gstin,
		       MAX(so.transaction_date) AS last_so_date
		FROM `tabCustomer` c
		INNER JOIN `tabSales Order` so
		    ON so.customer = c.name AND so.docstatus = 1
		WHERE c.territory IN ({placeholders})
		  AND c.disabled = 0
		  AND c.name NOT IN ({excl_placeholders})
		  {search_clause}
		  AND so.transaction_date >= %s
		GROUP BY c.name, c.territory
		ORDER BY last_so_date ASC
		LIMIT %s OFFSET %s
		""",
		territories + excluded + search_val + [cutoff, limit, offset],
		as_dict=True,
	)
	return rows


# ── Assignment creation ───────────────────────────────────────────────────────

def _create_assignment(customer, territory, assigned_to, date, source_pool):
	doc = frappe.new_doc("IB Customer Assignment")
	doc.customer = customer
	doc.assigned_to = assigned_to
	doc.assigned_date = date
	doc.status = "Pending"
	doc.source_pool = source_pool
	doc.territory = territory
	doc.insert(ignore_permissions=True)


def auto_assign_for_user(user, date):
	"""Create assignments for user on date up to assignments_per_day quota."""
	config = get_assignment_config()
	territories = get_user_territories(user)
	if not territories:
		return 0

	existing_count = frappe.db.count(
		"IB Customer Assignment",
		{"assigned_to": user, "assigned_date": date, "status": ["in", ["Pending", "Contacted"]]},
	)
	slots = config["assignments_per_day"] - existing_count
	if slots <= 0:
		return 0

	exclude = _already_assigned_customers(date)

	dormant_slots = round(slots * config["dormant_ratio"] / 100)
	regular_slots = slots - dormant_slots

	dormant = get_dormant_pool(territories, exclude, config["dormant_threshold_days"], limit=dormant_slots * 3)
	regular = get_regular_pool(territories, exclude, config["dormant_threshold_days"], limit=regular_slots * 3)

	# Pick and shuffle within each pool
	dormant_pick = dormant[:dormant_slots]
	regular_pick = regular[:regular_slots]
	batch = dormant_pick + regular_pick
	random.shuffle(batch)

	created = 0
	assigned_today = set(exclude)
	for row in batch:
		if row.customer in assigned_today:
			continue
		_create_assignment(row.customer, row.territory, user, date, "Dormant" if row in dormant_pick else "Regular")
		assigned_today.add(row.customer)
		created += 1

	frappe.db.commit()
	return created


# ── Scheduler entry (daily at midnight) ──────────────────────────────────────

def run_daily_assignment():
	"""
	1. Roll over today's Pending assignments.
	2. Auto-assign tomorrow's batch for each active sales user.
	"""
	today_date = today()
	tomorrow_date = add_days(today_date, 1)

	# Roll over today's Pending → Rolled Over
	frappe.db.sql(
		"""
		UPDATE `tabIB Customer Assignment`
		SET status = 'Rolled Over', completed_at = %(now)s, modified = %(now)s
		WHERE assigned_date = %(today)s
		  AND status = 'Pending'
		""",
		{"today": today_date, "now": now()},
	)
	frappe.db.commit()

	users = get_active_sales_users()
	total = 0
	for user in users:
		total += auto_assign_for_user(user, tomorrow_date)

	frappe.logger().info(f"IB Customer Board: assigned {total} slots across {len(users)} users for {tomorrow_date}")


# ── SO submit hook ────────────────────────────────────────────────────────────

def mark_assignment_done_on_so(doc, method):
	"""On SO submit, mark the assigned user's pending assignment as Order Placed."""
	assignment = frappe.db.get_value(
		"IB Customer Assignment",
		{
			"customer": doc.customer,
			"assigned_to": frappe.session.user,
			"assigned_date": today(),
			"status": ["in", ["Pending", "Contacted"]],
		},
		"name",
	)
	if not assignment:
		return
	frappe.db.set_value(
		"IB Customer Assignment",
		assignment,
		{"status": "Order Placed", "completed_at": now()},
		update_modified=True,
	)


# ── Whitelisted: user-facing ──────────────────────────────────────────────────

@frappe.whitelist()
def get_customer_board_data(date=None):
	"""Return board data for the current user: dormant pool, regular pool, today, tomorrow."""
	user = frappe.session.user
	date = date or today()
	tomorrow = add_days(date, 1)
	config = get_assignment_config()
	territories = get_user_territories(user)

	# Today's assignments
	today_assignments = frappe.db.sql(
		"""
		SELECT ca.name, ca.customer, ca.status, ca.source_pool, ca.territory,
		       c.customer_name, c.territory AS cust_territory, c.mobile_no,
		       MAX(so.transaction_date) AS last_so_date
		FROM `tabIB Customer Assignment` ca
		INNER JOIN `tabCustomer` c ON c.name = ca.customer
		LEFT JOIN `tabSales Order` so ON so.customer = ca.customer AND so.docstatus = 1
		WHERE ca.assigned_to = %(user)s
		  AND ca.assigned_date = %(date)s
		  AND ca.status IN ('Pending', 'Contacted', 'Order Placed', 'Skipped')
		GROUP BY ca.name
		ORDER BY ca.status = 'Pending' DESC, ca.creation DESC
		""",
		{"user": user, "date": date},
		as_dict=True,
	)

	# Tomorrow's assignments
	tomorrow_assignments = frappe.db.sql(
		"""
		SELECT ca.name, ca.customer, ca.status, ca.source_pool, ca.territory,
		       c.customer_name,
		       MAX(so.transaction_date) AS last_so_date
		FROM `tabIB Customer Assignment` ca
		INNER JOIN `tabCustomer` c ON c.name = ca.customer
		LEFT JOIN `tabSales Order` so ON so.customer = ca.customer AND so.docstatus = 1
		WHERE ca.assigned_to = %(user)s
		  AND ca.assigned_date = %(tomorrow)s
		  AND ca.status = 'Pending'
		GROUP BY ca.name
		ORDER BY ca.creation ASC
		""",
		{"user": user, "tomorrow": tomorrow},
		as_dict=True,
	)

	# Dormant pool (territory-filtered, info only)
	# Exclude customers already assigned today so pool stays clean after "Add to Today"
	dormant_pool = []
	regular_pool = []
	dormant_total = 0
	regular_total = 0
	if territories:
		exclude = _already_assigned_customers(date)
		dormant_pool = get_dormant_pool(territories, exclude, config["dormant_threshold_days"], limit=50)
		regular_pool = get_regular_pool(territories, exclude, config["dormant_threshold_days"], limit=50)
		dormant_total = get_dormant_pool(territories, exclude, config["dormant_threshold_days"], count_only=True)
		regular_total = get_regular_pool(territories, exclude, config["dormant_threshold_days"], count_only=True)

	return {
		"today": today_assignments,
		"tomorrow": tomorrow_assignments,
		"dormant": dormant_pool,
		"regular": regular_pool,
		"dormant_total": dormant_total,
		"regular_total": regular_total,
		"date": date,
		"tomorrow_date": tomorrow,
	}


@frappe.whitelist()
def mark_customer_contacted(assignment_id, notes, outcome):
	"""Mark assignment as Contacted. Notes and outcome are mandatory."""
	if not notes or not outcome:
		frappe.throw(_("Notes and Outcome are required."))

	doc = frappe.get_doc("IB Customer Assignment", assignment_id)
	if doc.assigned_to != frappe.session.user:
		frappe.throw(_("Not authorized."))
	if doc.status != "Pending":
		frappe.throw(_("Assignment is not in Pending status."))

	doc.status = "Contacted"
	doc.notes = notes
	doc.outcome = outcome
	doc.completed_at = now()
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"status": "ok"}


@frappe.whitelist()
def skip_assignment(assignment_id, reason=None):
	"""Mark assignment as Skipped."""
	doc = frappe.get_doc("IB Customer Assignment", assignment_id)
	if doc.assigned_to != frappe.session.user:
		frappe.throw(_("Not authorized."))
	if doc.status != "Pending":
		frappe.throw(_("Assignment is not in Pending status."))

	doc.status = "Skipped"
	if reason:
		doc.notes = reason
	doc.completed_at = now()
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"status": "ok"}


@frappe.whitelist()
def unskip_assignment(assignment_id):
	"""Revert a Skipped assignment back to Pending."""
	doc = frappe.get_doc("IB Customer Assignment", assignment_id)
	if doc.assigned_to != frappe.session.user:
		frappe.throw(_("Not authorized."))
	if doc.status != "Skipped":
		frappe.throw(_("Assignment is not Skipped."))
	doc.status = "Pending"
	doc.completed_at = None
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"status": "ok"}


@frappe.whitelist()
def add_customer_to_today(customer, date=None, target_user=None):
	"""Any sales user can manually add a customer to their own Today board. No quota limit.
	Managers may pass target_user to act on behalf of another user."""
	if target_user and target_user != frappe.session.user:
		_require_manager()
		user = target_user
	else:
		user = frappe.session.user
	date = date or today()

	existing = frappe.db.get_value(
		"IB Customer Assignment",
		{"customer": customer, "assigned_date": date, "status": ["in", ["Pending", "Contacted"]]},
		"name",
	)
	if existing:
		frappe.throw(_(f"Customer {customer} already has an active assignment on {date}."))

	territory = frappe.db.get_value("Customer", customer, "territory")
	config = get_assignment_config()
	source_pool = classify_customer(customer, config["dormant_threshold_days"])
	_create_assignment(customer, territory, user, date, source_pool)
	frappe.db.commit()

	assignment_name = frappe.db.get_value(
		"IB Customer Assignment",
		{"customer": customer, "assigned_to": user, "assigned_date": date, "status": "Pending"},
		"name",
		order_by="creation desc",
	)
	return {"status": "ok", "assignment": assignment_name}


@frappe.whitelist()
def remove_assignment(assignment_id, force=False):
	"""Remove a Pending assignment. Owner can always remove their own; managers can force-remove any."""
	doc = frappe.get_doc("IB Customer Assignment", assignment_id)
	if doc.assigned_to != frappe.session.user:
		if frappe.utils.cint(force):
			_require_manager()
		else:
			frappe.throw(_("Not authorized."))
	if doc.status != "Pending":
		frappe.throw(_("Can only remove Pending assignments."))
	doc.delete(ignore_permissions=True)
	frappe.db.commit()
	return {"status": "ok"}


# ── Whitelisted: admin-facing ─────────────────────────────────────────────────

def _require_manager():
	if not any(r in frappe.get_roles() for r in ["Sales Manager", "System Manager"]):
		frappe.throw(_("Not authorized."), frappe.PermissionError)


@frappe.whitelist()
def get_admin_overview(date=None, territory=None, view_as_user=None):
	"""Return all users' assignment counts for a date, or view as a specific user."""
	_require_manager()
	date = date or today()

	if view_as_user:
		# Return same data as get_customer_board_data but for another user
		original_user = frappe.session.user
		frappe.session.user = view_as_user
		data = get_customer_board_data(date)
		frappe.session.user = original_user
		return {"view_as": view_as_user, "board": data}

	# Build roster of all sales users with counts
	filters = {"assigned_date": date}
	if territory:
		filters["territory"] = territory

	# Build user→team map in one query
	team_rows = frappe.db.sql(
		"SELECT user, parent AS team FROM `tabLead Sales Team Member`",
		as_dict=True,
	)
	user_team_map = {r.user: r.team for r in team_rows}

	users = get_active_sales_users()
	roster = []
	for user in users:
		full_name = frappe.db.get_value("User", user, "full_name") or user
		counts = frappe.db.sql(
			"""
			SELECT status, COUNT(*) AS cnt
			FROM `tabIB Customer Assignment`
			WHERE assigned_to = %(user)s AND assigned_date = %(date)s
			GROUP BY status
			""",
			{"user": user, "date": date},
			as_dict=True,
		)
		status_map = {r.status: r.cnt for r in counts}
		total = sum(status_map.values())
		done = sum(v for k, v in status_map.items() if k in ("Contacted", "Order Placed"))
		tomorrow_count = frappe.db.count(
			"IB Customer Assignment",
			{"assigned_to": user, "assigned_date": add_days(date, 1), "status": "Pending"},
		)
		roster.append({
			"user": user,
			"full_name": full_name,
			"team": user_team_map.get(user),
			"total": total,
			"done": done,
			"pending": status_map.get("Pending", 0),
			"completion_pct": round(done / total * 100) if total else 0,
			"tomorrow_count": tomorrow_count,
		})

	return {"date": date, "roster": roster}


@frappe.whitelist()
def get_customer_pool(territory=None, pool_type=None, date=None, limit=50, offset=0, search=None):
	"""Return assignable customers for admin pool browser with pagination."""
	_require_manager()
	date = date or today()
	limit = int(limit)
	offset = int(offset)
	search = (search or "").strip() or None
	config = get_assignment_config()

	territories = [territory] if territory else frappe.db.sql(
		"SELECT name FROM `tabTerritory` WHERE is_group = 0",
		as_dict=True,
	)
	if territories and isinstance(territories[0], dict):
		territories = [t["name"] for t in territories]

	if not territories:
		return {"rows": [], "total": 0}

	exclude = _already_assigned_customers(date)
	threshold = config["dormant_threshold_days"]

	if pool_type == "Dormant":
		rows = get_dormant_pool(territories, exclude, threshold, limit=limit, offset=offset, search=search)
		total = get_dormant_pool(territories, exclude, threshold, count_only=True, search=search)
	elif pool_type == "Regular":
		rows = get_regular_pool(territories, exclude, threshold, limit=limit, offset=offset, search=search)
		total = get_regular_pool(territories, exclude, threshold, count_only=True, search=search)
	else:
		rows = get_dormant_pool(territories, exclude, threshold, limit=limit, offset=offset, search=search)
		total = get_dormant_pool(territories, exclude, threshold, count_only=True, search=search)

	return {"rows": rows, "total": total}



@frappe.whitelist()
def bulk_auto_assign(user, date=None, count=None):
	"""Admin triggers auto-assign for a specific user on demand."""
	_require_manager()
	date = date or today()
	created = auto_assign_for_user(user, date)
	return {"created": created}


@frappe.whitelist()
def save_assignment_config(assignments_per_day, dormant_threshold_days, dormant_ratio):
	"""Admin saves global assignment config."""
	_require_manager()
	doc = frappe.get_single("IB Assignment Config")
	doc.assignments_per_day = int(assignments_per_day)
	doc.dormant_threshold_days = int(dormant_threshold_days)
	doc.dormant_ratio = float(dormant_ratio)
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"status": "ok"}
