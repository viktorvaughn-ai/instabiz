"""instabiz.overrides.cpq — CPQ (Configure-Price-Quote) engine.

Backs the `ib-cpq` page. Two jobs:
  1. `get_cpq_price()` — given item + qty + customer/territory, resolve the best
     matching `IB CPQ Setting` slab and compute a rate.
  2. `create_quotation_from_cpq()` — take the configurator's line items and
     create a **draft** Quotation (docstatus=0) via the normal ORM path so every
     existing `validate()`/doc_event on Quotation still fires (GST template
     auto-correct, sales person, dimension recalculation, etc — see
     `instabiz/overrides/quotation.py`). Never bypasses those hooks.

This app has no Item Variant usage anywhere (`has_variants`/`variant_of` are
both 0 across all 528 real Items, confirmed live) — "options" in the CPQ sense
is therefore modeled as plain additional Quotation line items the user adds in
the configurator (e.g. an add-on item code), not ERPNext Item Attributes.

Matching logic (best-slab-wins, most specific first):
  - Header: exact `item` match outranks an `item_group` match.
  - Slab: a `customer_group`/`territory` set on the slab must match the
    resolved customer's group/territory to qualify at all (not a soft
    preference) — a slab scoped to "Commercial" customers never applies to a
    "Government" customer, even as a fallback. A blank slab field means
    "applies to everyone" and scores lower than an explicit match.
  - Qty tier: `qty_from <= qty <= qty_to` (qty_to=0 means unbounded) qualifies
    directly; if no tier qualifies for that qty, the nearest tier by
    `qty_from` is used as a fallback (`fallback_used=True` in the response) —
    the caller/UI should surface that so a rep can override the rate.
"""

import json

import frappe
from frappe import _
from frappe.utils import flt, nowdate, cint

from instabiz.overrides.utils import set_sales_person  # noqa: F401  (kept for parity/readability)

_VALID_LOCATIONS = {"MAHARASHTRA", "GUJARAT", "CHENNAI"}


def get_context(context):
	context.no_cache = 1


# ── Helpers ────────────────────────────────────────────────────────────────

def _customer_context(customer):
	if not customer:
		return {"customer_group": None, "territory": None, "customer_name": None}
	row = frappe.db.get_value(
		"Customer", customer, ["customer_group", "territory", "customer_name"], as_dict=True
	)
	return row or {"customer_group": None, "territory": None, "customer_name": None}


def _item_context(item_code):
	row = frappe.db.get_value(
		"Item", item_code,
		["item_name", "item_group", "stock_uom", "valuation_rate", "standard_rate", "disabled"],
		as_dict=True,
	)
	if not row:
		frappe.throw(_("Item {0} not found").format(item_code))
	return row


def _candidate_slabs(item_code, item_group):
	"""All slab rows belonging to an active header matching this item/item_group."""
	return frappe.db.sql(
		"""
		SELECT
			h.name AS header, h.item AS header_item, h.item_group AS header_item_group,
			s.name AS slab_name, s.customer_group, s.territory,
			s.qty_from, s.qty_to, s.rate, s.discount_pct
		FROM `tabIB CPQ Setting` h
		INNER JOIN `tabIB CPQ Setting Slab` s ON s.parent = h.name
		WHERE h.is_active = 1
		  AND (h.item = %(item_code)s OR (h.item_group = %(item_group)s AND (h.item IS NULL OR h.item = '')))
		""",
		{"item_code": item_code, "item_group": item_group},
		as_dict=True,
	)


def _qty_qualifies(row, qty):
	qty_from = flt(row.qty_from)
	qty_to = flt(row.qty_to)
	return qty_from <= qty and (qty_to == 0 or qty <= qty_to)


@frappe.whitelist()
def get_cpq_price(item_code, qty=1, customer=None, territory=None):
	"""Resolve the best-matching CPQ rate for one item/qty/customer/territory.

	Returns a dict — see inline `result` fields below. `found=False` means no
	`IB CPQ Setting` exists at all for this item/item_group; caller should fall
	back to a manual rate (Item Standard Selling Rate is included as a hint).
	"""
	frappe.only_for(["System Manager", "Sales Manager", "Sales User"])
	qty = flt(qty) or 1
	item = _item_context(item_code)
	cust_ctx = _customer_context(customer)
	customer_group = cust_ctx.get("customer_group")
	resolved_territory = territory or cust_ctx.get("territory")

	candidates = _candidate_slabs(item_code, item.item_group)

	result = {
		"found": False,
		"item_code": item_code,
		"item_name": item.item_name,
		"uom": item.stock_uom,
		"qty": qty,
		"rate": flt(item.standard_rate),
		"discount_pct": 0,
		"matched_on": None,
		"header": None,
		"fallback_used": False,
		"note": _("No CPQ price matrix configured for this item — using Item Standard Selling Rate."),
	}
	if not candidates:
		return result

	def score(row):
		header_score = 2 if row.header_item == item_code else 1
		cg_score = 2 if (row.customer_group and row.customer_group == customer_group) else 0
		terr_score = 2 if (row.territory and row.territory == resolved_territory) else 0
		return header_score * 100 + cg_score * 10 + terr_score

	# Rows whose customer_group/territory is set to something OTHER than the
	# resolved context are hard-excluded — a slab scoped to "Commercial" is
	# never used for a "Government" customer, not even as a fallback.
	eligible = [
		row for row in candidates
		if (not row.customer_group or row.customer_group == customer_group)
		and (not row.territory or row.territory == resolved_territory)
	]
	if not eligible and not customer_group and not resolved_territory:
		# No customer/territory context at all to score scoping against (e.g. a
		# rep configuring a line before a Customer is picked) — try every
		# candidate on qty/header alone rather than refusing outright. This
		# must NOT fire when a concrete customer_group/territory is known but
		# simply doesn't match any slab's scope — that case stays hard-excluded
		# per the rule above (was previously falling through here, silently
		# applying a mismatched-scope slab).
		eligible = candidates

	qty_matches = [row for row in eligible if _qty_qualifies(row, qty)]
	fallback_used = False
	if qty_matches:
		pool = qty_matches
	else:
		# Nearest tier by qty_from — highest qty_from that is still <= qty, else
		# the lowest qty_from tier available (closest above).
		fallback_used = True
		below = [row for row in eligible if flt(row.qty_from) <= qty]
		pool = [max(below, key=lambda r: flt(r.qty_from))] if below else \
			[min(eligible, key=lambda r: flt(r.qty_from))] if eligible else []

	if not pool:
		return result

	best = max(pool, key=score)

	if best.rate:
		rate = flt(best.rate)
	elif best.discount_pct:
		base = flt(item.standard_rate) or flt(item.valuation_rate)
		rate = flt(base * (1 - flt(best.discount_pct) / 100), 2)
	else:
		rate = flt(item.standard_rate)

	result.update({
		"found": True,
		"rate": rate,
		"discount_pct": flt(best.discount_pct),
		"matched_on": "item" if best.header_item == item_code else "item_group",
		"header": best.header,
		"slab": best.slab_name,
		"fallback_used": fallback_used,
		"note": (
			_("Nearest quantity tier used — no exact qty-break match for {0}.").format(cint(qty))
			if fallback_used else
			_("Matched CPQ slab {0}.").format(best.slab_name)
		),
	})
	return result


@frappe.whitelist()
def get_cpq_settings_for_item(item_code):
	"""All active CPQ Setting headers (+ slab rows) touching this item/item_group —
	powers a "why this price" transparency panel in the configurator."""
	frappe.only_for(["System Manager", "Sales Manager", "Sales User"])
	item = _item_context(item_code)
	return _candidate_slabs(item_code, item.item_group)


# ── Draft Quotation output ───────────────────────────────────────────────────

@frappe.whitelist()
def create_quotation_from_cpq(customer, location, items, territory=None):
	"""Create a draft Quotation (docstatus=0) from the configurator's line items.

	`items` is a JSON string/list of {item_code, qty, rate, uom}. Uses the
	normal `frappe.new_doc("Quotation") -> .insert()` path (no `ignore_permissions`,
	no direct SQL) so every existing Quotation `validate()`/doc_event still runs
	exactly as it would for a manually created Quotation — GST template
	auto-correction, sales person, dimension qty recalculation, item lifecycle
	checks, etc (see `instabiz/overrides/quotation.py`).
	"""
	if isinstance(items, str):
		items = json.loads(items)
	if not customer:
		frappe.throw(_("Select a Customer"))
	if not items:
		frappe.throw(_("Add at least one line item"))
	location = (location or "").upper()
	if location not in _VALID_LOCATIONS:
		frappe.throw(_("Select a valid Location (Maharashtra / Gujarat / Chennai)"))

	cust_ctx = _customer_context(customer)

	q = frappe.new_doc("Quotation")
	q.quotation_to = "Customer"
	q.party_name = customer
	q.customer_name = cust_ctx.get("customer_name")
	q.transaction_date = nowdate()
	q.custom_location = location
	if territory or cust_ctx.get("territory"):
		q.territory = territory or cust_ctx.get("territory")

	for row in items:
		item_code = row.get("item_code")
		if not item_code:
			continue
		qty = flt(row.get("qty")) or 1
		rate = flt(row.get("rate"))
		uom = row.get("uom") or frappe.db.get_value("Item", item_code, "stock_uom")
		q.append("items", {
			"item_code": item_code,
			"qty": qty,
			"rate": rate,
			"uom": uom,
		})

	q.insert()

	# Guardrailed Autonomy (Wave 2, additive only) — auto-submits this draft
	# Quotation if a System Manager has explicitly enabled+configured
	# autonomy for "CPQ Draft Quotation" (instabiz.overrides.autonomy) and
	# it matches the configured conditions (amount / customer credit) and
	# today's cap isn't exceeded. Leaves it as the draft it already is
	# (today's unchanged default) otherwise. Never allowed to block draft
	# creation itself.
	try:
		from instabiz.overrides.autonomy import maybe_auto_submit_quotation
		maybe_auto_submit_quotation(q)
	except Exception:
		frappe.log_error(
			title=f"CPQ autonomy hook failed for {q.name}",
			message=frappe.get_traceback(),
		)

	return {"name": q.name}
