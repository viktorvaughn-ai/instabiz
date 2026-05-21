import random
import datetime
import frappe
from frappe import _
from frappe.utils import today, now, add_days
from instabiz.overrides.sales_target import get_target_map, _month_first


# ── WA Templates ─────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_wa_templates():
	rows = frappe.db.sql(
		"""
		SELECT template_name, message
		FROM `tabIB WA Template`
		WHERE is_active = 1
		ORDER BY display_order ASC, creation ASC
		""",
		as_dict=True,
	)
	return [{"name": r.template_name, "message": r.message} for r in rows]


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


def _all_leaf_territories():
	"""Return all non-group territory names."""
	rows = frappe.db.sql(
		"SELECT name FROM `tabTerritory` WHERE is_group = 0",
		as_dict=True,
	)
	return [r.name for r in rows]


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


def _next_working_day(date_str):
	"""Return date_str + 1, bumping Sunday to Monday."""
	nxt = add_days(date_str, 1)
	if datetime.date.fromisoformat(str(nxt)).weekday() == 6:
		nxt = add_days(nxt, 1)
	return nxt


# ── Pool queries ──────────────────────────────────────────────────────────────

def _already_assigned_customers(date):
	"""Return set of customers that must not be assigned on `date`.

	Excluded if:
	  - Already Pending for this specific date — no same-date duplicate
	  - Contacted within last 7 days (outcome != Not Interested)
	  - Contacted within last 30 days (outcome = Not Interested)
	  - Skipped within last 1 day — prevent same-day re-skip cycle
	"""
	cutoff_default        = add_days(date, -7)
	cutoff_not_interested = add_days(date, -30)
	cutoff_skipped        = add_days(date, -1)
	rows = frappe.db.sql(
		"""
		SELECT DISTINCT customer
		FROM `tabIB Customer Assignment`
		WHERE status = 'Pending'
		  AND assigned_date = %(date)s
		UNION
		SELECT DISTINCT customer
		FROM `tabIB Customer Assignment`
		WHERE status = 'Contacted'
		  AND (outcome IS NULL OR outcome != 'Not Interested')
		  AND completed_at >= %(cutoff_default)s
		UNION
		SELECT DISTINCT customer
		FROM `tabIB Customer Assignment`
		WHERE status = 'Contacted'
		  AND outcome = 'Not Interested'
		  AND completed_at >= %(cutoff_not_interested)s
		UNION
		SELECT DISTINCT customer
		FROM `tabIB Customer Assignment`
		WHERE status = 'Skipped'
		  AND completed_at >= %(cutoff_skipped)s
		""",
		{
			"date": date,
			"cutoff_default": cutoff_default,
			"cutoff_not_interested": cutoff_not_interested,
			"cutoff_skipped": cutoff_skipped,
		},
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
				  AND (c.ib_claimed_by IS NULL OR c.ib_claimed_by = '')
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
		       c.mobile_no, c.custom_contact_person_name, c.custom_primary_contact_person,
		       MAX(so.transaction_date) AS last_so_date
		FROM `tabCustomer` c
		LEFT JOIN `tabSales Order` so
		    ON so.customer = c.name AND so.docstatus = 1
		WHERE c.territory IN ({placeholders})
		  AND c.disabled = 0
		  AND (c.ib_claimed_by IS NULL OR c.ib_claimed_by = '')
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
				  AND (c.ib_claimed_by IS NULL OR c.ib_claimed_by = '')
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
		       c.mobile_no, c.custom_contact_person_name, c.custom_primary_contact_person,
		       MAX(so.transaction_date) AS last_so_date
		FROM `tabCustomer` c
		INNER JOIN `tabSales Order` so
		    ON so.customer = c.name AND so.docstatus = 1
		WHERE c.territory IN ({placeholders})
		  AND c.disabled = 0
		  AND (c.ib_claimed_by IS NULL OR c.ib_claimed_by = '')
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

	# Fetch generous headroom from both pools upfront
	dormant = get_dormant_pool(territories, exclude, config["dormant_threshold_days"], limit=slots * 2)
	regular = get_regular_pool(territories, exclude, config["dormant_threshold_days"], limit=slots * 2)

	dormant_pick = dormant[:dormant_slots]
	dormant_leftover = dormant_slots - len(dormant_pick)

	# Backfill regular if dormant was short
	effective_regular_slots = regular_slots + dormant_leftover
	regular_pick = regular[:effective_regular_slots]
	regular_leftover = effective_regular_slots - len(regular_pick)

	# Backfill dormant if regular was also short
	if regular_leftover > 0:
		extra = dormant[len(dormant_pick): len(dormant_pick) + regular_leftover]
		dormant_pick = dormant_pick + extra

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
	1. Roll over yesterday's Pending assignments.
	2. Auto-assign tomorrow's batch for each active sales user (skips Sunday).
	"""
	today_date = today()
	yesterday_date = add_days(today_date, -1)
	tomorrow_date = _next_working_day(today_date)

	# Roll over ALL past Pending → Rolled Over (covers missed scheduler days, not just yesterday)
	frappe.db.sql(
		"""
		UPDATE `tabIB Customer Assignment`
		SET status = 'Rolled Over', completed_at = %(now)s, modified = %(now)s
		WHERE assigned_date < %(today)s
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
	tomorrow = _next_working_day(date)
	config = get_assignment_config()
	territories = get_user_territories(user)

	# Today's assignments
	today_assignments = frappe.db.sql(
		"""
		SELECT ca.name, ca.customer, ca.status, ca.outcome, ca.source_pool, ca.territory,
		       c.customer_name, c.territory AS cust_territory, c.mobile_no,
		       c.custom_contact_person_name, c.custom_primary_contact_person,
		       c.ib_claimed_by,
		       MAX(so.transaction_date) AS last_so_date,
		       (SELECT prev.outcome FROM `tabIB Customer Assignment` prev
		        WHERE prev.customer = ca.customer AND prev.status = 'Contacted'
		          AND prev.name != ca.name
		        ORDER BY prev.completed_at DESC LIMIT 1) AS last_outcome,
		       (SELECT DATE(prev.completed_at) FROM `tabIB Customer Assignment` prev
		        WHERE prev.customer = ca.customer AND prev.status = 'Contacted'
		          AND prev.name != ca.name
		        ORDER BY prev.completed_at DESC LIMIT 1) AS last_contacted_at
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
		       c.customer_name, c.ib_claimed_by,
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
	is_manager = any(r in frappe.get_roles() for r in ["Sales Manager", "System Manager"])

	# Managers and territory-less users see all customers in the pool
	display_territories = territories or _all_leaf_territories()
	exclude = _already_assigned_customers(date)
	dormant_pool = get_dormant_pool(display_territories, exclude, config["dormant_threshold_days"], limit=50)
	regular_pool = get_regular_pool(display_territories, exclude, config["dormant_threshold_days"], limit=50)
	dormant_total = get_dormant_pool(display_territories, exclude, config["dormant_threshold_days"], count_only=True)
	regular_total = get_regular_pool(display_territories, exclude, config["dormant_threshold_days"], count_only=True)
	claimed_pool = _get_claimed_pool(user) if is_manager else []

	return {
		"today": today_assignments,
		"tomorrow": tomorrow_assignments,
		"dormant": dormant_pool,
		"regular": regular_pool,
		"dormant_total": dormant_total,
		"regular_total": regular_total,
		"claimed": claimed_pool,
		"is_manager": is_manager,
		"date": date,
		"tomorrow_date": tomorrow,
	}


@frappe.whitelist()
def search_customer_pool(pool_type, search):
	"""Multi-token pool search for the current user's board."""
	user = frappe.session.user
	config = get_assignment_config()
	territories = get_user_territories(user) or _all_leaf_territories()
	exclude = _already_assigned_customers(today())
	threshold = config["dormant_threshold_days"]
	cutoff = frappe.utils.add_days(today(), -threshold)

	tokens = [t.strip() for t in (search or "").split() if t.strip()]
	if not tokens:
		return []

	placeholders = ", ".join(["%s"] * len(territories))
	excluded = list(exclude) if exclude else ["__none__"]
	excl_placeholders = ", ".join(["%s"] * len(excluded))

	token_clauses = []
	token_vals = []
	for token in tokens:
		t = f"%{token}%"
		token_clauses.append(
			"(c.name LIKE %s OR c.customer_name LIKE %s"
			" OR c.territory LIKE %s OR c.custom_contact_person_name LIKE %s)"
		)
		token_vals.extend([t, t, t, t])
	search_sql = " AND ".join(token_clauses)

	if pool_type == "dormant":
		sql = f"""
			SELECT c.name AS customer, c.customer_name, c.territory,
			       c.mobile_no, c.custom_contact_person_name, c.custom_primary_contact_person,
			       MAX(so.transaction_date) AS last_so_date
			FROM `tabCustomer` c
			LEFT JOIN `tabSales Order` so ON so.customer = c.name AND so.docstatus = 1
			WHERE c.territory IN ({placeholders})
			  AND c.disabled = 0
			  AND (c.ib_claimed_by IS NULL OR c.ib_claimed_by = '')
			  AND c.name NOT IN ({excl_placeholders})
			  AND {search_sql}
			GROUP BY c.name
			HAVING MAX(so.transaction_date) IS NULL OR MAX(so.transaction_date) < %s
			ORDER BY last_so_date ASC
			LIMIT 30
		"""
		params = territories + excluded + token_vals + [cutoff]
	else:
		sql = f"""
			SELECT c.name AS customer, c.customer_name, c.territory,
			       c.mobile_no, c.custom_contact_person_name, c.custom_primary_contact_person,
			       MAX(so.transaction_date) AS last_so_date
			FROM `tabCustomer` c
			INNER JOIN `tabSales Order` so ON so.customer = c.name AND so.docstatus = 1
			WHERE c.territory IN ({placeholders})
			  AND c.disabled = 0
			  AND (c.ib_claimed_by IS NULL OR c.ib_claimed_by = '')
			  AND c.name NOT IN ({excl_placeholders})
			  AND {search_sql}
			  AND so.transaction_date >= %s
			GROUP BY c.name
			ORDER BY last_so_date ASC
			LIMIT 30
		"""
		params = territories + excluded + token_vals + [cutoff]

	return frappe.db.sql(sql, params, as_dict=True)


def _get_claimed_pool(user):
	"""Return customers claimed by the given user."""
	return frappe.db.sql(
		"""
		SELECT c.name AS customer, c.customer_name, c.territory, c.mobile_no,
		       c.custom_contact_person_name, c.custom_primary_contact_person,
		       c.ib_claimed_by, c.ib_claimed_on,
		       MAX(so.transaction_date) AS last_so_date
		FROM `tabCustomer` c
		LEFT JOIN `tabSales Order` so ON so.customer = c.name AND so.docstatus = 1
		WHERE c.ib_claimed_by = %(user)s
		  AND c.disabled = 0
		GROUP BY c.name
		ORDER BY c.ib_claimed_on DESC
		""",
		{"user": user},
		as_dict=True,
	)


@frappe.whitelist()
def claim_customer(customer):
	"""Claim a customer for the current manager. Removes it from the general assignment pool."""
	_require_manager()
	existing = frappe.db.get_value("Customer", customer, "ib_claimed_by")
	if existing and existing != frappe.session.user:
		claimer_name = frappe.db.get_value("User", existing, "full_name") or existing
		frappe.throw(_(f"Already claimed by {claimer_name}."))
	frappe.db.set_value("Customer", customer, {
		"ib_claimed_by": frappe.session.user,
		"ib_claimed_on": now(),
	})
	frappe.db.commit()
	return {"status": "ok", "claimed_by": frappe.session.user}


@frappe.whitelist()
def bulk_claim_customers(customers):
	"""Claim multiple customers for the current manager."""
	import json
	_require_manager()
	if isinstance(customers, str):
		customers = json.loads(customers)
	user = frappe.session.user
	claimed = []
	skipped = []
	for customer in customers:
		existing = frappe.db.get_value("Customer", customer, "ib_claimed_by")
		if existing and existing != user:
			skipped.append(customer)
			continue
		frappe.db.set_value("Customer", customer, {
			"ib_claimed_by": user,
			"ib_claimed_on": now(),
		})
		claimed.append(customer)
	if claimed:
		frappe.db.commit()
	return {"status": "ok", "claimed": len(claimed), "skipped": skipped}


@frappe.whitelist()
def unclaim_customer(customer):
	"""Release a claimed customer back to the general assignment pool."""
	_require_manager()
	frappe.db.set_value("Customer", customer, {
		"ib_claimed_by": None,
		"ib_claimed_on": None,
	})
	frappe.db.commit()
	return {"status": "ok"}


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
def move_assignment(assignment_id, new_date):
	"""Move a Pending assignment to a different date (today ↔ tomorrow drag)."""
	doc = frappe.get_doc("IB Customer Assignment", assignment_id)
	if doc.assigned_to != frappe.session.user:
		_require_manager()
	if doc.status != "Pending":
		frappe.throw(_("Only Pending assignments can be moved."))
	duplicate = frappe.db.get_value(
		"IB Customer Assignment",
		{
			"customer": doc.customer,
			"assigned_date": new_date,
			"status": ["in", ["Pending", "Contacted"]],
			"name": ["!=", assignment_id],
		},
		"name",
	)
	if duplicate:
		frappe.throw(_(f"Customer already has an active assignment on {new_date}."))
	doc.assigned_date = new_date
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"status": "ok"}


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


@frappe.whitelist()
def remove_all_pending(user, date=None):
	"""Remove all Pending assignments for user on date. Manager only."""
	_require_manager()
	date = date or today()
	removed = frappe.db.sql(
		"""
		SELECT name FROM `tabIB Customer Assignment`
		WHERE assigned_to = %(user)s
		  AND assigned_date = %(date)s
		  AND status = 'Pending'
		""",
		{"user": user, "date": date},
		as_dict=True,
	)
	for row in removed:
		frappe.db.delete("IB Customer Assignment", {"name": row.name})
	frappe.db.commit()
	return {"removed": len(removed)}


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
		original_user = frappe.session.user
		frappe.session.user = view_as_user
		try:
			data = get_customer_board_data(date)
		finally:
			frappe.session.user = original_user
		return {"view_as": view_as_user, "board": data}

	# Build roster of all sales users with counts
	filters = {"assigned_date": date}
	if territory:
		filters["territory"] = territory

	# Build user→team map — ORDER BY creation ASC so newest membership wins when user is in multiple teams
	team_rows = frappe.db.sql(
		"SELECT user, parent AS team FROM `tabLead Sales Team Member` ORDER BY creation ASC",
		as_dict=True,
	)
	user_team_map = {r.user: r.team for r in team_rows}

	# Build team→leader map
	leader_rows = frappe.db.sql(
		"SELECT name, team_leader FROM `tabLead Sales Team` WHERE team_leader IS NOT NULL AND team_leader != ''",
		as_dict=True,
	)
	team_leader_map = {r.name: r.team_leader for r in leader_rows}

	# Build team→territories map for team header display
	terr_rows = frappe.db.sql(
		"SELECT parent AS team, territory FROM `tabLead Sales Team Territory`",
		as_dict=True,
	)
	team_territory_map = {}
	for r in terr_rows:
		team_territory_map.setdefault(r.team, []).append(r.territory)

	users = get_active_sales_users()
	target_map = get_target_map(_month_first(date))
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
			{"assigned_to": user, "assigned_date": _next_working_day(date), "status": "Pending"},
		)
		t = target_map.get(user, {})
		user_team = user_team_map.get(user)
		roster.append({
			"user": user,
			"full_name": full_name,
			"team": user_team,
			"is_leader": bool(user_team and team_leader_map.get(user_team) == user),
			"total": total,
			"done": done,
			"pending": status_map.get("Pending", 0),
			"completion_pct": round(done / total * 100) if total else 0,
			"tomorrow_count": tomorrow_count,
			"target": t.get("target", 0),
			"actual": t.get("actual", 0),
			"target_pct": t.get("pct", 0),
		})

	return {"date": date, "roster": roster, "team_territories": team_territory_map}


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
def transfer_assignments(from_user, to_user, date=None):
	"""Transfer all Pending assignments from from_user to to_user on date."""
	_require_manager()
	if from_user == to_user:
		frappe.throw(_("Cannot transfer to the same user."))
	date = date or today()

	assignments = frappe.db.sql(
		"""
		SELECT name FROM `tabIB Customer Assignment`
		WHERE assigned_to = %(from_user)s
		  AND assigned_date = %(date)s
		  AND status = 'Pending'
		""",
		{"from_user": from_user, "date": date},
		as_dict=True,
	)
	if not assignments:
		return {"transferred": 0}

	for a in assignments:
		frappe.db.set_value("IB Customer Assignment", a.name, "assigned_to", to_user, update_modified=True)

	frappe.db.commit()
	return {"transferred": len(assignments)}


@frappe.whitelist()
def get_manager_queue():
	"""Return all claimed customers grouped by claimer. Manager only."""
	_require_manager()
	rows = frappe.db.sql(
		"""
		SELECT c.name AS customer, c.customer_name, c.territory, c.mobile_no,
		       c.ib_claimed_by, c.ib_claimed_on,
		       u.full_name AS claimer_name,
		       MAX(so.transaction_date) AS last_so_date
		FROM `tabCustomer` c
		INNER JOIN `tabUser` u ON u.name = c.ib_claimed_by
		LEFT JOIN `tabSales Order` so ON so.customer = c.name AND so.docstatus = 1
		WHERE c.ib_claimed_by IS NOT NULL AND c.ib_claimed_by != ''
		  AND c.disabled = 0
		GROUP BY c.name
		ORDER BY c.ib_claimed_by, c.ib_claimed_on DESC
		""",
		as_dict=True,
	)
	return rows


@frappe.whitelist()
def assign_claimed_to_user(customer, assigned_to, date=None):
	"""Assign a claimed customer to a sales user and release the claim. Manager only."""
	_require_manager()
	date = date or today()

	if str(date) < str(today()):
		frappe.throw(_("Cannot assign to a past date."))

	claimed_by = frappe.db.get_value("Customer", customer, "ib_claimed_by")
	if not claimed_by:
		frappe.throw(_("Customer is not claimed."))

	existing = frappe.db.get_value(
		"IB Customer Assignment",
		{"customer": customer, "assigned_date": date, "status": ["in", ["Pending", "Contacted"]]},
		"name",
	)
	if existing:
		frappe.throw(_(f"Customer already has an active assignment on {date}."))

	config = get_assignment_config()
	existing_count = frappe.db.count(
		"IB Customer Assignment",
		{"assigned_to": assigned_to, "assigned_date": date, "status": ["in", ["Pending", "Contacted"]]},
	)
	if existing_count >= config["assignments_per_day"]:
		frappe.throw(_(
			f"{assigned_to} is at the daily quota ({config['assignments_per_day']}) on {date}."
		))

	territory = frappe.db.get_value("Customer", customer, "territory")
	source_pool = classify_customer(customer, config["dormant_threshold_days"])
	_create_assignment(customer, territory, assigned_to, date, source_pool)

	# Release the claim now that it's been actioned
	frappe.db.set_value("Customer", customer, {"ib_claimed_by": None, "ib_claimed_on": None})
	frappe.db.commit()
	return {"status": "ok"}


@frappe.whitelist()
def get_assignments_for_customers(customers):
	"""Return active assignment info for a list of customers. Manager only."""
	import json
	_require_manager()
	if isinstance(customers, str):
		customers = json.loads(customers)
	if not customers:
		return {}
	placeholders = ", ".join(["%s"] * len(customers))
	rows = frappe.db.sql(
		f"""
		SELECT ca.customer, ca.assigned_to, ca.assigned_date, ca.status,
		       u.full_name
		FROM `tabIB Customer Assignment` ca
		LEFT JOIN `tabUser` u ON u.name = ca.assigned_to
		WHERE ca.customer IN ({placeholders})
		  AND ca.status IN ('Pending', 'Contacted')
		ORDER BY ca.assigned_date ASC
		""",
		customers,
		as_dict=True,
	)
	result = {}
	for r in rows:
		if r.customer not in result:
			result[r.customer] = {
				"assigned_to": r.assigned_to,
				"full_name": r.full_name or r.assigned_to,
				"date": str(r.assigned_date),
				"status": r.status,
			}
	return result


@frappe.whitelist()
def bulk_assign_to_user(customers, assigned_to, date=None):
	"""Assign multiple customers to a sales user for a given date. Manager only."""
	import json
	_require_manager()
	if isinstance(customers, str):
		customers = json.loads(customers)
	date = date or today()

	# Block past dates — rolled-over immediately by scheduler
	if str(date) < str(today()):
		frappe.throw(_("Cannot assign to a past date."))

	config = get_assignment_config()

	# Quota: count existing active assignments for this user on this date
	existing_count = frappe.db.count(
		"IB Customer Assignment",
		{"assigned_to": assigned_to, "assigned_date": date, "status": ["in", ["Pending", "Contacted"]]},
	)
	remaining_slots = config["assignments_per_day"] - existing_count
	if remaining_slots <= 0:
		frappe.throw(_(
			f"{assigned_to} already has {existing_count} active assignments on {date} "
			f"(limit: {config['assignments_per_day']}). Remove some before adding more."
		))

	assigned = 0
	skipped_already_assigned = []
	skipped_claimed = []
	skipped_quota = []

	for customer in customers:
		# Quota cap — stop once slots exhausted
		if assigned >= remaining_slots:
			skipped_quota.append(customer)
			continue

		# Skip if already has active assignment on this date (any user)
		existing = frappe.db.get_value(
			"IB Customer Assignment",
			{"customer": customer, "assigned_date": date, "status": ["in", ["Pending", "Contacted"]]},
			"name",
		)
		if existing:
			skipped_already_assigned.append(customer)
			continue

		# Skip claimed customers (locked to another manager's pipeline)
		claimed_by = frappe.db.get_value("Customer", customer, "ib_claimed_by")
		if claimed_by:
			skipped_claimed.append(customer)
			continue

		territory = frappe.db.get_value("Customer", customer, "territory")
		source_pool = classify_customer(customer, config["dormant_threshold_days"])
		_create_assignment(customer, territory, assigned_to, date, source_pool)
		assigned += 1

	if assigned:
		frappe.db.commit()

	return {
		"assigned": assigned,
		"skipped_already_assigned": skipped_already_assigned,
		"skipped_claimed": skipped_claimed,
		"skipped_quota": skipped_quota,
	}


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


@frappe.whitelist()
def get_team_details(team_name):
	_require_manager()
	doc = frappe.get_doc("Lead Sales Team", team_name)
	members = []
	for m in doc.members:
		full_name = m.full_name or frappe.db.get_value("User", m.user, "full_name") or m.user
		members.append({"user": m.user, "full_name": full_name})
	territories = [{"territory": t.territory} for t in doc.territories]
	return {"name": doc.name, "members": members, "territories": territories}


@frappe.whitelist()
def add_team_member(team_name, user):
	_require_manager()
	doc = frappe.get_doc("Lead Sales Team", team_name)
	if any(m.user == user for m in doc.members):
		frappe.throw(_(f"{user} is already a member of {team_name}."))
	other_team = frappe.db.get_value("Lead Sales Team Member", {"user": user, "parent": ["!=", team_name]}, "parent")
	if other_team:
		frappe.throw(_(f"{user} is already in team \"{other_team}\". Remove them from that team first."))
	doc.append("members", {"user": user})
	doc.save()
	frappe.db.commit()
	return {"status": "ok"}


@frappe.whitelist()
def remove_team_member(team_name, user):
	_require_manager()
	doc = frappe.get_doc("Lead Sales Team", team_name)
	doc.members = [m for m in doc.members if m.user != user]
	doc.save()
	frappe.db.commit()
	return {"status": "ok"}


@frappe.whitelist()
def add_team_territory(team_name, territory):
	_require_manager()
	doc = frappe.get_doc("Lead Sales Team", team_name)
	if any(t.territory == territory for t in doc.territories):
		frappe.throw(_(f"{territory} is already in {team_name}."))
	other_team = frappe.db.get_value("Lead Sales Team Territory", {"territory": territory, "parent": ["!=", team_name]}, "parent")
	if other_team:
		frappe.throw(_(f"Territory \"{territory}\" is already assigned to team \"{other_team}\". Remove it from that team first."))
	doc.append("territories", {"territory": territory})
	doc.save()
	frappe.db.commit()
	return {"status": "ok"}


@frappe.whitelist()
def remove_team_territory(team_name, territory):
	_require_manager()
	doc = frappe.get_doc("Lead Sales Team", team_name)
	doc.territories = [t for t in doc.territories if t.territory != territory]
	doc.save()
	frappe.db.commit()
	return {"status": "ok"}
