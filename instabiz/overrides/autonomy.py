"""instabiz.overrides.autonomy — Guardrailed Autonomy (Wave 2).

Lets a System Manager explicitly allow specific Wave-1 draft-creation actions
(MRP's draft Material Requests, CPQ's draft Quotations) to auto-submit
without a human sitting in the AI Inbox — but only for the exact action
types configured, only when `IB Autonomy Setting.enabled=1`, only when the
document actually matches the configured conditions, and only up to a hard
daily cap. Every other document, and everything for an action type with no
enabled row, keeps behaving exactly as it does today (draft, human-approved
via the existing `ai_agents.py` flow) — this module only ever ADDS a
submit, never changes what gets created.

Deliberately a *different, higher* trust tier than the 23 existing AI
agents in `ai_agents.py`: those always stop at a pending `IB AI Action` for
a human to approve/reject. This module is the first thing in the app
allowed to skip that step, so every auto-approval it performs still writes
a normal, visible `IB AI Action` record (reusing that exact doctype — no
parallel logging table) with `status="Approved"`, a `decided_by` value that
can never be mistaken for a real human user, and a `summary` stating
exactly which condition matched. Nothing here is hidden.

Condition schema is intentionally a small flat dict, not a rule engine —
see `ib_autonomy_setting.ALLOWED_CONDITION_KEYS` for the full supported set:
  - max_qty       — Material Request: total qty across the draft's items.
  - max_amount    — Material Request: total value (qty x Item valuation
                     rate); Quotation: grand_total.
  - customer_credit_ok — Quotation only. Reuses the app's existing
                     Customer Credit Limit check (`sales_order._check_credit_limit`)
                     rather than reimplementing customer risk assessment.

An action type with no condition keys configured at all (empty dict) never
auto-approves, even if `enabled=1` — an "enabled but unconfigured" row is
treated the same as a disabled one, not as "approve everything".
"""

import json

import frappe
from frappe.utils import flt, now_datetime, nowdate

ACTION_TYPE_MRP_MR = "MRP Draft Material Request"
ACTION_TYPE_CPQ_QUOTATION = "CPQ Draft Quotation"

#: Never a real human user — this is what makes an auto-approval
#: unmistakably distinguishable from a human decision in the AI Inbox /
#: IB AI Action history. `decided_by` is a Link->User field, so writing
#: this label requires `ignore_links=True` on insert (same technique
#: `ai_agents.py`'s own `_queue()` already uses for its doctype-less
#: dedup case).
AUTOMATION_ACTOR = "Automation (IB Autonomy Setting)"


# ── config lookup ────────────────────────────────────────────────────────

def _get_enabled_setting(action_type):
	"""IB Autonomy Setting row for this action_type, or None if it doesn't
	exist or isn't enabled. Name == action_type (autoname: field:action_type)."""
	if not frappe.db.exists("IB Autonomy Setting", action_type):
		return None
	doc = frappe.get_doc("IB Autonomy Setting", action_type)
	if not doc.enabled:
		return None
	return doc


def _safe_parse_conditions(raw):
	"""Defensive re-parse at evaluation time. The doctype's own validate()
	already rejects bad JSON at save time, so this should always succeed for
	a row that made it into the DB — but never let a malformed/edited-around
	condition string blow up MRP/CPQ's own draft-creation flow. Falls back
	to "no conditions" (== never auto-approves) on any parse problem.
	"""
	if not raw or not str(raw).strip():
		return {}
	try:
		data = json.loads(raw)
	except (TypeError, ValueError):
		frappe.log_error(
			title="IB Autonomy Setting: bad conditions JSON",
			message=f"Could not parse auto_approve_conditions: {raw!r}",
		)
		return {}
	return data if isinstance(data, dict) else {}


def _today_auto_approval_count(action_type):
	"""How many documents of this action_type this module has already
	auto-approved today. Backed by the IB AI Action audit trail itself
	(no separate counter to drift out of sync) — counts rows this module
	wrote (decided_by=AUTOMATION_ACTOR) with status=approved, decided today.
	"""
	rows = frappe.db.sql(
		"""
		SELECT COUNT(*) AS cnt
		FROM `tabIB AI Action`
		WHERE action_type = %s
		  AND decided_by = %s
		  AND status = 'approved'
		  AND DATE(decided_at) = %s
		""",
		(action_type, AUTOMATION_ACTOR, nowdate()),
	)
	return rows[0][0] if rows else 0


def _under_daily_cap(setting, action_type):
	cap = setting.max_auto_approvals_per_day or 0
	if cap <= 0:
		# Cap left at the safe default (0) — treat as "auto-approval fully
		# capped off" even though Enabled is checked, per the field's own
		# description. A System Manager must explicitly raise this.
		return False
	return _today_auto_approval_count(action_type) < cap


# ── audit trail ──────────────────────────────────────────────────────────

def _log_auto_approval(doc, action_type, agent, reason):
	"""Write the normal, visible IB AI Action record every auto-approval
	must produce — same doctype the 23 human-approval agents already use,
	clearly marked as automated, never attributed to a real user."""
	action = frappe.get_doc({
		"doctype": "IB AI Action",
		"agent": agent,
		"module": "Instabiz",
		"action_type": action_type,
		"status": "approved",
		"title": f"Auto-approved: {doc.doctype} {doc.name}"[:140],
		"summary": reason,
		"reference_doctype": doc.doctype,
		"reference_name": doc.name,
		"ai_generated": 1,
		"decided_by": AUTOMATION_ACTOR,
		"decided_at": now_datetime(),
	})
	# ignore_links: decided_by (Link->User) intentionally holds a label,
	# not a real User docname — see AUTOMATION_ACTOR's own comment.
	action.insert(ignore_permissions=True, ignore_links=True)
	frappe.db.commit()


# ── Material Request (MRP) ─────────────────────────────────────────────────

def _mr_metrics(mr_doc):
	"""`Item.valuation_rate` is a manual/vestigial field that this app's real
	data never populates (confirmed live: 0 across all 528 Items) — the actual
	weighted-average cost lives per-warehouse on `Bin.valuation_rate`, same
	source the rest of the stock module treats as ground truth. Reading
	Item.valuation_rate here would make `max_amount` a silent no-op (total
	value always 0.00, so any positive cap always "passes") — falls back to
	Item.valuation_rate only if the row's warehouse has no Bin yet (never
	received stock there), same as the field's original intent for that edge
	case.
	"""
	total_qty = 0.0
	total_value = 0.0
	for row in mr_doc.items:
		qty = flt(row.qty)
		total_qty += qty
		rate = flt(
			frappe.db.get_value("Bin", {"item_code": row.item_code, "warehouse": row.warehouse}, "valuation_rate")
			or frappe.db.get_value("Item", row.item_code, "valuation_rate")
			or 0
		)
		total_value += qty * rate
	return {"total_qty": total_qty, "total_value": total_value}


def maybe_auto_submit_mr(mr_doc):
	"""Called additively right after a draft MRP Material Request is
	inserted (instabiz/overrides/mrp.py). Submits it in place (docstatus
	0 -> 1) and writes the audit entry if IB Autonomy Setting says yes;
	otherwise leaves it exactly as the draft it already is — today's
	unchanged default behavior. Never raises: a problem here must not
	break MRP's own run.
	"""
	try:
		if mr_doc.docstatus != 0:
			# Already submitted/cancelled by something else before this hook
			# ran — never a real path today (called synchronously right after
			# insert), but submit() on a non-draft doc would raise; treat as
			# a clean no-op instead of letting the broad except below log a
			# spurious error.
			return False

		setting = _get_enabled_setting(ACTION_TYPE_MRP_MR)
		if not setting:
			return False
		if not _under_daily_cap(setting, ACTION_TYPE_MRP_MR):
			return False

		conditions = _safe_parse_conditions(setting.auto_approve_conditions)
		if not conditions:
			return False

		metrics = _mr_metrics(mr_doc)
		reasons = []

		if "max_qty" in conditions:
			max_qty = flt(conditions["max_qty"])
			if metrics["total_qty"] > max_qty:
				return False
			reasons.append(f"total qty {metrics['total_qty']:.2f} <= configured max_qty {max_qty:.2f}")

		if "max_amount" in conditions:
			max_amount = flt(conditions["max_amount"])
			if metrics["total_value"] > max_amount:
				return False
			reasons.append(
				f"total value Rs.{metrics['total_value']:,.2f} <= configured max_amount Rs.{max_amount:,.2f}"
			)

		if not reasons:
			# Conditions dict had only unrecognised/irrelevant keys for this
			# action type -> nothing was actually verified. Stay a draft.
			return False

		mr_doc.submit()
		_log_auto_approval(
			mr_doc, ACTION_TYPE_MRP_MR, "autonomy_mrp",
			"Auto-approved (MRP Draft Material Request) for " + mr_doc.name + ": " + "; ".join(reasons) + ".",
		)
		return True
	except Exception:
		frappe.log_error(
			title=f"autonomy.maybe_auto_submit_mr failed for {mr_doc.name}",
			message=frappe.get_traceback(),
		)
		return False


# ── Quotation (CPQ) ──────────────────────────────────────────────────────

def _quotation_metrics(q_doc):
	return {"grand_total": flt(q_doc.grand_total)}


def _customer_credit_ok(customer, company):
	"""True if the customer is within their configured credit limit /
	overdue-days allowance. Reuses the app's existing Customer Credit Limit
	check (instabiz.overrides.sales_order._check_credit_limit) instead of
	reimplementing customer risk assessment — that function only reads
	doc.customer / doc.company, throws frappe.ValidationError on a real
	breach, and returns silently (no config row, bypass flag, or no
	unpaid-past-due-days invoice) when the customer is fine. A missing
	Customer Credit Limit row for this customer is treated as "fine" by
	that function already (returns early) — same behavior a real Sales
	Order submit gets today, not loosened here.
	"""
	from instabiz.overrides.sales_order import _check_credit_limit
	try:
		_check_credit_limit(frappe._dict({"customer": customer, "company": company}))
		return True
	except frappe.ValidationError:
		return False


def maybe_auto_submit_quotation(q_doc):
	"""Called additively right after a draft CPQ Quotation is inserted
	(instabiz/overrides/cpq.py). Submitting a Quotation is a real
	customer-facing commitment, so this deliberately requires a
	meaningfully-checked condition (amount and/or the existing credit-limit
	logic), never a token pass-through. Never raises.
	"""
	try:
		if q_doc.docstatus != 0:
			# Same defensive check as maybe_auto_submit_mr — never a real path
			# today, but avoids a spurious logged error if it ever is.
			return False

		setting = _get_enabled_setting(ACTION_TYPE_CPQ_QUOTATION)
		if not setting:
			return False
		if not _under_daily_cap(setting, ACTION_TYPE_CPQ_QUOTATION):
			return False

		conditions = _safe_parse_conditions(setting.auto_approve_conditions)
		if not conditions:
			return False

		metrics = _quotation_metrics(q_doc)
		reasons = []

		if "max_amount" in conditions:
			max_amount = flt(conditions["max_amount"])
			if metrics["grand_total"] > max_amount:
				return False
			reasons.append(
				f"grand total Rs.{metrics['grand_total']:,.2f} <= configured max_amount Rs.{max_amount:,.2f}"
			)

		if conditions.get("customer_credit_ok"):
			customer = q_doc.party_name if q_doc.quotation_to == "Customer" else None
			if not customer:
				# CPQ quotations are always quotation_to="Customer" in
				# practice (see cpq.create_quotation_from_cpq), but a
				# Lead-party quotation has no Customer Credit Limit row to
				# check against at all -> can't verify, stay a draft.
				return False
			if not _customer_credit_ok(customer, q_doc.company):
				return False
			reasons.append(f"customer {customer} within configured credit limit")

		if not reasons:
			return False

		q_doc.submit()
		_log_auto_approval(
			q_doc, ACTION_TYPE_CPQ_QUOTATION, "autonomy_cpq",
			"Auto-approved (CPQ Draft Quotation) for " + q_doc.name + ": " + "; ".join(reasons) + ".",
		)
		return True
	except Exception:
		frappe.log_error(
			title=f"autonomy.maybe_auto_submit_quotation failed for {q_doc.name}",
			message=frappe.get_traceback(),
		)
		return False


# ── whitelisted management methods (System Manager only) ───────────────────

def _require_system_manager():
	if "System Manager" not in frappe.get_roles():
		frappe.throw(frappe._("Only System Manager can manage Autonomy Settings."), frappe.PermissionError)


@frappe.whitelist()
def get_autonomy_settings():
	"""All configured IB Autonomy Setting rows (there are at most 2 today —
	one per real Wave-1 action type). System Manager only — this is the
	surface that decides whether documents can auto-submit without human
	review, matching how sensitive the capability is."""
	_require_system_manager()
	return frappe.get_all(
		"IB Autonomy Setting",
		fields=["name", "action_type", "enabled", "max_auto_approvals_per_day",
				"auto_approve_conditions", "modified"],
		order_by="action_type",
	)


@frappe.whitelist()
def update_autonomy_setting(action_type, enabled=0, conditions_json=None, max_per_day=0):
	"""Create or update the one IB Autonomy Setting row for this action_type.
	Validates conditions_json parses and only uses recognised keys before
	saving anything — a bad payload never reaches the DB."""
	_require_system_manager()
	from instabiz.instabiz.doctype.ib_autonomy_setting.ib_autonomy_setting import (
		validate_conditions_json,
	)

	valid_action_types = {ACTION_TYPE_MRP_MR, ACTION_TYPE_CPQ_QUOTATION}
	if action_type not in valid_action_types:
		frappe.throw(frappe._("Unknown action_type: {0}").format(action_type))

	# Throws on bad JSON / unknown keys before anything is written.
	validate_conditions_json(conditions_json)

	if frappe.db.exists("IB Autonomy Setting", action_type):
		doc = frappe.get_doc("IB Autonomy Setting", action_type)
	else:
		doc = frappe.new_doc("IB Autonomy Setting")
		doc.action_type = action_type

	doc.enabled = 1 if frappe.utils.cint(enabled) else 0
	doc.auto_approve_conditions = conditions_json or ""
	doc.max_auto_approvals_per_day = frappe.utils.cint(max_per_day) or 0
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"name": doc.name, "enabled": doc.enabled}


@frappe.whitelist()
def get_autonomy_audit_log(action_type=None, from_date=None):
	"""IB AI Action rows this module auto-approved (decided_by=AUTOMATION_ACTOR),
	for a System Manager to review exactly what's been auto-approved and why.
	Optional action_type / from_date (on decided_at) filters."""
	_require_system_manager()
	filters = {"decided_by": AUTOMATION_ACTOR, "status": "approved"}
	if action_type:
		filters["action_type"] = action_type
	if from_date:
		filters["decided_at"] = [">=", from_date]
	return frappe.get_all(
		"IB AI Action",
		filters=filters,
		fields=["name", "action_type", "title", "summary", "reference_doctype",
				"reference_name", "decided_by", "decided_at"],
		order_by="decided_at desc",
	)
