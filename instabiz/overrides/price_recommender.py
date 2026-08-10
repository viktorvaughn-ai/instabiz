"""instabiz.overrides.price_recommender — weekly price suggestion engine.

Company-wide grain (item only, `customer` left blank) — checked live before
choosing this: last 6 months of submitted Sales Order lines cover ~318 distinct
items but 2,262 distinct (item, customer) pairs, so a full item×customer
cartesian isn't tractable to start (per the build brief's own guidance) and
would mostly produce single-order noise per pair. Company-wide suggestions are
the tractable, useful default; a customer-specific view can be layered on
later without a schema change (the `customer` field already exists on
`IB Price Suggestion` for that).

Data source: Sales Order (not Sales Invoice) — this app has zero submitted
Sales Invoices as of this build (billing not live yet, see
`instabiz.overrides.billing_mode`); every other "what was actually sold"
feature in this app (Item Price History, IB Gross Margin) already reads off
Sales Order for the same reason, so this reuses that same convention rather
than inventing a new one.

Inputs used (per the build spec):
  - Customer price history  → last sold rate + 6-month volume-weighted average,
    same SO-based query pattern as `ib_item_price_history.py`.
  - Margin                  → `Item.valuation_rate` vs actual sold rate, same
    field `ib_gross_margin.py` uses as COGS (NOT `Sales Order Item.valuation_rate`,
    which is always 0 in this app — see IB Gross Margin's own comment).
    **Known dataset limitation, confirmed live before writing this**:
    `Item.valuation_rate` is 0 for all 528 real Items in this system today (no
    costing data has been entered) — margin-driven repricing is therefore
    inactive company-wide until costing data exists; every suggestion below
    falls back to price-history + demand-velocity only whenever cost is 0.
    This mirrors IB Gross Margin's own pre-existing limitation, not a new bug.
  - Demand velocity          → self-contained recent-vs-prior 4-week sold-qty
    ratio within the 6-month window (Demand Forecast's own velocity calc
    wasn't visible/available in this repo at build time — built independently
    per the brief's own fallback instruction, not blocked on it).
  - Competitor market rates  → NOT AVAILABLE. This app has no competitor-rate
    data source anywhere. Deliberately skipped rather than inventing fake
    data — flagged here per the build spec's own instruction.

This module NEVER writes to Rate Card / Pricing Rule / any live price table —
it only ever writes `IB Price Suggestion` rows for a human to review. There is
no auto-apply path anywhere in this file.
"""

import frappe
from frappe.utils import flt, nowdate, add_days, getdate

# Reused as the margin target: IB Gross Margin's own "healthy" band cutoff
# (green >= 30%, see ib_gross_margin.py's color-coding) — no separately
# configured company margin target exists anywhere in this app, so this is
# the closest thing to a discoverable company standard. Documented per the
# build spec's own instruction ("else a flat reasonable default like 20%,
# documented" — 30% chosen instead since it IS discoverable here, matching
# the spec's preferred branch over the flat-default fallback).
DEFAULT_MARGIN_TARGET_PCT = 30.0

# Suggestions correspond to price *history* only when a real Sales Order
# window backs them — the same 6-month convention used by the Price Recommender
# spec below.
HISTORY_WINDOW_DAYS = 182  # ~6 months

# Velocity thresholds — >=15% up/down over the recent-vs-prior 4-week window
# before it's treated as a real signal rather than noise.
_RISING_RATIO = 1.15
_FALLING_RATIO = 0.85

# Deviation beyond this always flags needs_review, per the build spec.
_REVIEW_THRESHOLD_PCT = 5.0


def run_weekly_price_suggestions():
	"""Scheduler entry point (weekly). Computes one company-wide suggestion per
	item with real order history in the last 6 months, upserts `IB Price
	Suggestion`. Returns a summary dict (also used by the manual verification
	call from console)."""
	items = _items_with_recent_history()
	made = 0
	updated = 0
	skipped_applied = 0
	skipped_no_data = 0
	for item_code in items:
		try:
			result = _compute_and_save(item_code)
			if result == "created":
				made += 1
			elif result == "updated":
				updated += 1
			elif result == "skipped_applied":
				skipped_applied += 1
			else:
				skipped_no_data += 1
		except Exception:
			frappe.log_error(f"IB Price Recommender: {item_code}"[:140], frappe.get_traceback())
	frappe.db.commit()
	summary = {
		"items_scanned": len(items),
		"created": made,
		"updated": updated,
		"skipped_applied_or_dismissed": skipped_applied,
		"skipped_no_usable_price": skipped_no_data,
	}
	return summary


def _items_with_recent_history():
	# INNER JOIN tabItem — some Sales Order Item rows reference an item_code with
	# no matching live Item record (renamed/deleted items still on old SOs;
	# confirmed live, ~11% of distinct codes in the 6-month window). Without this
	# join `_compute_and_save()` would build a Link field pointing at a
	# non-existent Item and `doc.save()` throws LinkValidationError — every such
	# item silently failed and was swallowed by the per-item try/except in
	# `run_weekly_price_suggestions()`, with no counter reflecting it. Same
	# INNER JOIN pattern already used by `ib_price_history_report.py`'s
	# `_data_multi_item()` for the same reason.
	since = add_days(nowdate(), -HISTORY_WINDOW_DAYS)
	rows = frappe.db.sql(
		"""
		SELECT DISTINCT soi.item_code
		FROM `tabSales Order Item` soi
		INNER JOIN `tabSales Order` so ON so.name = soi.parent
		INNER JOIN `tabItem` i ON i.name = soi.item_code
		WHERE so.docstatus = 1 AND so.transaction_date >= %s
		""",
		(since,),
		as_dict=True,
	)
	return [r.item_code for r in rows]


def _sold_rows(item_code, since):
	return frappe.db.sql(
		"""
		SELECT so.transaction_date, soi.qty, soi.rate, soi.amount
		FROM `tabSales Order Item` soi
		INNER JOIN `tabSales Order` so ON so.name = soi.parent
		WHERE so.docstatus = 1 AND soi.item_code = %s AND so.transaction_date >= %s
		ORDER BY so.transaction_date ASC, so.creation ASC
		""",
		(item_code, since),
		as_dict=True,
	)


def _velocity(rows):
	"""Recent-4-week vs prior-4-week sold-qty ratio, calendar-based (not just
	the last N rows) — a slow item with one big order 5 months ago shouldn't
	look "hot" just because that row exists in the 6-month window."""
	today = getdate(nowdate())
	recent_start = add_days(today, -28)
	prior_start = add_days(today, -56)
	recent_qty = sum(flt(r.qty) for r in rows if getdate(r.transaction_date) >= recent_start)
	prior_qty = sum(
		flt(r.qty) for r in rows
		if prior_start <= getdate(r.transaction_date) < recent_start
	)
	if prior_qty > 0:
		ratio = recent_qty / prior_qty
	elif recent_qty > 0:
		ratio = 2.0  # went from nothing to something — treat as a strong rising signal
	else:
		ratio = 1.0  # no activity in either recent window — neutral, older history only

	if ratio >= _RISING_RATIO:
		label = "Rising"
	elif ratio <= _FALLING_RATIO:
		label = "Falling"
	else:
		label = "Stable"

	signal = f"{ratio:.2f}x vs prior 4wk ({label}) — recent {recent_qty:g} / prior {prior_qty:g} units"
	return ratio, label, signal


def _existing_suggestion(item_code):
	rows = frappe.db.sql(
		"""
		SELECT name, status FROM `tabIB Price Suggestion`
		WHERE item = %s AND (customer IS NULL OR customer = '')
		""",
		(item_code,),
		as_dict=True,
	)
	return rows[0] if rows else None


def _compute_and_save(item_code):
	since = add_days(nowdate(), -HISTORY_WINDOW_DAYS)
	rows = _sold_rows(item_code, since)
	if not rows:
		return "skipped_no_data"

	item = frappe.db.get_value("Item", item_code, ["item_name", "valuation_rate"], as_dict=True) or {}
	cost = flt(item.get("valuation_rate"))

	current_price = flt(rows[-1].rate)  # most recent sold rate
	total_qty = sum(flt(r.qty) for r in rows)
	total_amount = sum(flt(r.amount) for r in rows)
	avg_price = flt(total_amount / total_qty, 2) if total_qty else 0

	base = current_price or avg_price
	if not base:
		return "skipped_no_data"

	ratio, _label, signal = _velocity(rows)

	# Margin-driven reference price: what rate would hit the target margin,
	# given real cost data. Skipped (falls back to `base`) when cost is 0 —
	# see the module-level docstring's dataset-limitation note.
	if cost > 0:
		margin_driven_price = flt(cost / (1 - DEFAULT_MARGIN_TARGET_PCT / 100), 2)
	else:
		margin_driven_price = base

	# Demand tilts the blended price slightly — rising demand tolerates a small
	# upward nudge, slowing demand applies a small downward one. Deliberately
	# capped at +/-2%: this is a suggestion engine, never an aggressive
	# auto-discounting tool (explicit build-spec requirement).
	if ratio >= _RISING_RATIO:
		velocity_factor = 1.02
	elif ratio <= _FALLING_RATIO:
		velocity_factor = 0.98
	else:
		velocity_factor = 1.0

	suggested_price = flt((0.5 * base + 0.5 * margin_driven_price) * velocity_factor, 2)
	deviation_pct = flt((suggested_price - base) / base * 100, 2) if base else 0
	current_margin_pct = flt((base - cost) / base * 100, 2) if base else 0
	needs_review = abs(deviation_pct) > _REVIEW_THRESHOLD_PCT

	notes_parts = []
	if cost > 0:
		notes_parts.append(
			f"Margin-driven reference price {frappe.utils.fmt_money(margin_driven_price, currency='INR')} "
			f"at {DEFAULT_MARGIN_TARGET_PCT:.0f}% target margin."
		)
	else:
		notes_parts.append(
			"Item.valuation_rate is 0 (no costing data) — margin-driven repricing "
			"skipped; suggestion driven by price history + demand velocity only."
		)
	notes_parts.append(f"Demand: {signal}.")
	notes_parts.append("Competitor market rates: not available in this app — not used as an input.")
	notes = " ".join(notes_parts)

	existing = _existing_suggestion(item_code)
	if existing:
		if existing.status in ("Applied", "Dismissed"):
			# Respect the human decision — don't silently reopen a resolved
			# suggestion every week. A manager can reset status manually to
			# pick it back up on the next run.
			return "skipped_applied"
		doc = frappe.get_doc("IB Price Suggestion", existing.name)
	else:
		doc = frappe.new_doc("IB Price Suggestion")
		doc.item = item_code
		doc.status = "New"

	doc.item_name = item.get("item_name")
	doc.current_price = base
	doc.suggested_price = suggested_price
	doc.deviation_pct = deviation_pct
	doc.margin_target_pct = DEFAULT_MARGIN_TARGET_PCT
	doc.current_margin_pct = current_margin_pct
	doc.valuation_rate = cost
	doc.demand_velocity_signal = signal
	doc.needs_review = 1 if needs_review else 0
	doc.computed_on = nowdate()
	doc.notes = notes
	doc.save(ignore_permissions=True)
	return "updated" if existing else "created"
