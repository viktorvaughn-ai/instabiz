"""instabiz.overrides.insight_correlation — Wave 2: Cross-module Correlation + Anomaly/Fraud Watch.

Writes to the shared `IB Insight` doctype (schema owned jointly with the sibling
IB Command Chain build — see CLAUDE.md Wave 2 notes). This module never creates or
alters the `IB Insight` DocType itself; it only reads/inserts documents against it,
and every entry point below no-ops cleanly if the doctype doesn't exist yet (e.g. on
a fresh site before the first `bench migrate` after either Wave-2 agent lands it).

FEATURE 1 — run_insight_correlation(): if 2+ open/escalated Insights concern the same
customer across 2+ different domains within the last 7 days, merge them into one new
consolidated Insight (root_cause_tag="customer-wide-risk"). "Merge" here means: create
one new consolidated Insight whose narrative lists every contributing Insight by name
and domain — the originals are left untouched (no new field added to the shared
IB Insight schema, since that schema is fixed and shared with the sibling agent).
Dedup is by an existing open Cross-module Insight already covering that customer
within the lookback window (source_doctype="Customer", source_name=customer).

Note: IB Insight.domain has no "Cross-Module" option (Select: Sales/Finance/Production/
Procurement/Stock/HR only, per the fixed shared schema) — the consolidated Insight's
`domain` is set to the domain of its highest-severity contributing Insight instead,
with the title prefixed "[Cross-Module]" and root_cause_tag="customer-wide-risk" to
preserve the cross-module intent without deviating from the schema.

FEATURE 2 — run_fraud_watch(): three independent checks (duplicate Purchase Invoice
bill numbers, duplicate Payment Entries, off-market Sales Order/Quotation line rates),
each wrapped in its own try/except so one check's failure never blocks the others.
Every finding creates an IB Insight (severity=Critical) unless a matching open Insight
already exists for that exact source record (source_doctype+source_name dedup).
"""

import frappe
from frappe.utils import add_days, flt, nowdate

from instabiz.instabiz.page.ib_item_price_history.ib_item_price_history import (
	get_item_price_history,
)

_LOOKBACK_DAYS = 7
_OFF_MARKET_PCT = 15.0
_RATE_HISTORY_LIMIT = 30
_MIN_RATE_SAMPLE = 4

_SEVERITY_RANK = {"Info": 0, "Warning": 1, "Critical": 2}


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _insight_doctype_ready():
	return bool(frappe.db.exists("DocType", "IB Insight"))


def _insight_exists(source_doctype, source_name):
	if not source_doctype or not source_name:
		return False
	return bool(
		frappe.db.exists(
			"IB Insight",
			{
				"source_doctype": source_doctype,
				"source_name": source_name,
				"status": ["in", ["Open", "Escalated"]],
			},
		)
	)


def _create_insight(title, domain, severity, narrative, source_doctype=None,
		source_name=None, root_cause_tag=None, owner_role=None):
	doc = frappe.new_doc("IB Insight")
	doc.title = (title or "")[:140]
	doc.domain = domain
	doc.severity = severity
	doc.status = "Open"
	doc.narrative = narrative
	if source_doctype:
		doc.source_doctype = source_doctype
	if source_name:
		doc.source_name = source_name
	if root_cause_tag:
		doc.root_cause_tag = root_cause_tag[:140]
	doc.owner_role = owner_role or "System Manager"
	doc.insert(ignore_permissions=True)
	return doc.name


# ---------------------------------------------------------------------------
# FEATURE 1 — Cross-module correlation
# ---------------------------------------------------------------------------

def run_insight_correlation():
	"""Daily. Merge 2+ open/escalated Insights concerning the same customer
	across 2+ domains within the last 7 days into one consolidated Insight.
	"""
	if not _insight_doctype_ready():
		return {"skipped": "IB Insight doctype not yet migrated"}

	since = add_days(nowdate(), -_LOOKBACK_DAYS)
	insights = frappe.get_all(
		"IB Insight",
		filters={"status": ["in", ["Open", "Escalated"]], "creation": [">=", since]},
		fields=["name", "domain", "severity", "narrative", "source_doctype", "source_name"],
	)

	by_customer = {}
	for ins in insights:
		customer = _resolve_customer(ins.source_doctype, ins.source_name)
		if not customer:
			continue
		by_customer.setdefault(customer, []).append(ins)

	merged = 0
	for customer, rows in by_customer.items():
		domains = {r.domain for r in rows}
		if len(domains) < 2:
			continue
		try:
			if _merge_customer_insights(customer, rows):
				merged += 1
		except Exception:
			frappe.log_error(f"IB Insight correlation: {customer}"[:140], frappe.get_traceback())

	frappe.db.commit()
	return {"customers_scanned": len(by_customer), "merged": merged}


def _resolve_customer(source_doctype, source_name):
	"""Which customer (if any) an Insight's source record concerns.

	Generic by design: any source_doctype that has its own `customer` field
	(Sales Order, Quotation, Sales Invoice, Delivery Note, IB Customer Score, ...)
	resolves automatically. Vendor-side sources (e.g. IB Supplier Score) have no
	`customer` field and correctly resolve to None — skipped from this correlation
	per spec ("that's vendor-side, skip it for this specific correlation").
	"""
	if not source_doctype or not source_name:
		return None
	if source_doctype == "Customer":
		return source_name if frappe.db.exists("Customer", source_name) else None
	if not frappe.db.exists("DocType", source_doctype):
		return None
	try:
		meta = frappe.get_meta(source_doctype)
	except Exception:
		return None
	if not meta.has_field("customer"):
		return None
	try:
		return frappe.db.get_value(source_doctype, source_name, "customer")
	except Exception:
		return None


def _merge_customer_insights(customer, rows):
	since = add_days(nowdate(), -_LOOKBACK_DAYS)
	already = frappe.db.exists(
		"IB Insight",
		{
			"source_doctype": "Customer",
			"source_name": customer,
			"root_cause_tag": "customer-wide-risk",
			"status": ["in", ["Open", "Escalated"]],
			"creation": [">=", since],
		},
	)
	if already:
		return None

	customer_name = frappe.db.get_value("Customer", customer, "customer_name") or customer
	domains = sorted({r.domain for r in rows})
	top = max(rows, key=lambda r: _SEVERITY_RANK.get(r.severity, 0))

	lines = []
	for r in rows:
		snippet = (r.narrative or "").strip().replace("\n", " ")
		if len(snippet) > 200:
			snippet = snippet[:200] + "..."
		lines.append(f"- [{r.domain}] {r.name}: {snippet}")

	narrative = (
		f"Customer {customer_name} ({customer}) has {len(rows)} open Insight(s) across "
		f"{len(domains)} domains ({', '.join(domains)}) within the last {_LOOKBACK_DAYS} days "
		f"— possible customer-wide risk. Contributing Insights:\n" + "\n".join(lines)
	)

	return _create_insight(
		title=f"[Cross-Module] Customer-wide risk: {customer_name}",
		domain=top.domain,
		severity=top.severity,
		narrative=narrative,
		source_doctype="Customer",
		source_name=customer,
		root_cause_tag="customer-wide-risk",
		owner_role="Sales Manager",
	)


# ---------------------------------------------------------------------------
# FEATURE 2 — Anomaly & Fraud Watch
# ---------------------------------------------------------------------------

def run_fraud_watch():
	"""Daily. Three independent checks, each isolated so one failing check
	(e.g. a field-name mismatch) never blocks the others.
	"""
	if not _insight_doctype_ready():
		return {"skipped": "IB Insight doctype not yet migrated"}

	results = {}

	try:
		results["duplicate_purchase_invoices"] = _check_duplicate_purchase_invoices()
	except Exception:
		frappe.log_error("IB Fraud Watch: dup PI", frappe.get_traceback())
		results["duplicate_purchase_invoices"] = 0

	try:
		results["duplicate_payments"] = _check_duplicate_payments()
	except Exception:
		frappe.log_error("IB Fraud Watch: dup payment", frappe.get_traceback())
		results["duplicate_payments"] = 0

	try:
		results["off_market_rates"] = _check_off_market_rates()
	except Exception:
		frappe.log_error("IB Fraud Watch: off-market", frappe.get_traceback())
		results["off_market_rates"] = 0

	frappe.db.commit()
	return results


def _check_duplicate_purchase_invoices():
	"""Same bill_no + supplier across 2+ submitted Purchase Invoices — a real,
	common double-billing fraud vector. Field names verified live against
	frappe.get_meta("Purchase Invoice") before use (bill_no / bill_date).
	"""
	meta = frappe.get_meta("Purchase Invoice")
	if not meta.has_field("bill_no") or not meta.has_field("supplier"):
		return 0

	groups = frappe.db.sql(
		"""
		SELECT bill_no, supplier, GROUP_CONCAT(name ORDER BY creation ASC) AS names, COUNT(*) AS cnt
		FROM `tabPurchase Invoice`
		WHERE docstatus = 1 AND bill_no IS NOT NULL AND TRIM(bill_no) != '' AND supplier IS NOT NULL
		GROUP BY bill_no, supplier
		HAVING COUNT(*) > 1
		""",
		as_dict=True,
	)

	created = 0
	for g in groups:
		names = g.names.split(",")
		anchor = names[0]
		if _insight_exists("Purchase Invoice", anchor):
			continue
		supplier_name = frappe.db.get_value("Supplier", g.supplier, "supplier_name") or g.supplier
		narrative = (
			f"Duplicate Purchase Invoice bill_no '{g.bill_no}' from Supplier {supplier_name} "
			f"({g.supplier}) — {g.cnt} submitted invoices carry the same supplier invoice number: "
			f"{', '.join(names)}. Possible double-billing."
		)
		_create_insight(
			title=f"Duplicate supplier invoice no.: {g.bill_no}",
			domain="Finance",
			severity="Critical",
			narrative=narrative,
			source_doctype="Purchase Invoice",
			source_name=anchor,
			root_cause_tag="duplicate-bill-no",
			owner_role="Accounts Manager",
		)
		created += 1
	return created


def _check_duplicate_payments():
	"""Two signals: (1) same party+paid_amount+reference_no submitted more than
	once (strong signal), (2) same party+paid_amount+posting_date (same-day,
	catches duplicates even with a blank/differing reference_no — posting_date
	has no time component in this schema, so "within 24h" collapses to "same
	calendar day"). Dedup via _insight_exists means a doc already flagged by (1)
	is silently skipped by (2), no double-flagging of the same anchor doc.
	"""
	created = 0

	exact = frappe.db.sql(
		"""
		SELECT party, paid_amount, reference_no,
			GROUP_CONCAT(name ORDER BY creation ASC) AS names, COUNT(*) AS cnt
		FROM `tabPayment Entry`
		WHERE docstatus = 1 AND party IS NOT NULL
			AND reference_no IS NOT NULL AND TRIM(reference_no) != ''
		GROUP BY party, paid_amount, reference_no
		HAVING COUNT(*) > 1
		""",
		as_dict=True,
	)
	for g in exact:
		names = g.names.split(",")
		anchor = names[0]
		if _insight_exists("Payment Entry", anchor):
			continue
		narrative = (
			f"Duplicate Payment Entry: party {g.party}, amount {flt(g.paid_amount):.2f}, "
			f"reference '{g.reference_no}' — {g.cnt} submitted entries match exactly: "
			f"{', '.join(names)}. Possible double payment."
		)
		_create_insight(
			title=f"Possible duplicate payment: {g.reference_no}",
			domain="Finance",
			severity="Critical",
			narrative=narrative,
			source_doctype="Payment Entry",
			source_name=anchor,
			root_cause_tag="duplicate-payment-ref",
			owner_role="Accounts Manager",
		)
		created += 1

	same_day = frappe.db.sql(
		"""
		SELECT party, paid_amount, posting_date,
			GROUP_CONCAT(name ORDER BY creation ASC) AS names, COUNT(*) AS cnt
		FROM `tabPayment Entry`
		WHERE docstatus = 1 AND party IS NOT NULL AND paid_amount > 0
		GROUP BY party, paid_amount, posting_date
		HAVING COUNT(*) > 1
		""",
		as_dict=True,
	)
	for g in same_day:
		names = g.names.split(",")
		anchor = names[0]
		if _insight_exists("Payment Entry", anchor):
			continue
		narrative = (
			f"Duplicate Payment Entry: party {g.party}, amount {flt(g.paid_amount):.2f}, "
			f"same posting date {g.posting_date} — {g.cnt} submitted entries: "
			f"{', '.join(names)}. Possible double payment (same party/amount/day)."
		)
		_create_insight(
			title=f"Possible duplicate payment on {g.posting_date}",
			domain="Finance",
			severity="Critical",
			narrative=narrative,
			source_doctype="Payment Entry",
			source_name=anchor,
			root_cause_tag="duplicate-payment-sameday",
			owner_role="Accounts Manager",
		)
		created += 1

	return created


def _check_off_market_rates():
	"""Sales Order / Quotation line items whose rate deviates >15% from that
	item's recent average sold rate (reuses get_item_price_history() —
	ib_item_price_history.py — instead of reimplementing the "normal rate"
	lookup). Flags both directions: suspiciously high (inflated billing) and
	suspiciously low (unauthorized discount).

	Purchase Order lines are deliberately NOT checked here: the only reusable
	"normal rate" lookup in this app (get_item_price_history) is built off
	Sales Order history, i.e. what we charge customers — comparing a PO's cost
	rate (what we pay suppliers) against that would compare two structurally
	different economic quantities (price vs. cost) and produce a false positive
	on almost every PO line by construction, not a real fraud signal. No
	reusable purchase-side price-history function exists in this app to reuse
	instead, and the task spec explicitly says reuse existing logic rather than
	build a new averaging engine. Documented here as a known scope limitation.
	"""
	since = add_days(nowdate(), -_LOOKBACK_DAYS)
	created = 0
	created += _scan_off_market_doctype("Sales Order Item", "Sales Order", since)
	created += _scan_off_market_doctype("Quotation Item", "Quotation", since)
	return created


def _scan_off_market_doctype(child_doctype, parent_doctype, since):
	rows = frappe.db.sql(
		f"""
		SELECT ci.name AS row_name, ci.parent AS parent_name, ci.item_code, ci.rate
		FROM `tab{child_doctype}` ci
		INNER JOIN `tab{parent_doctype}` p ON p.name = ci.parent
		WHERE p.docstatus = 1 AND p.transaction_date >= %(since)s
			AND ci.rate > 0 AND ci.item_code IS NOT NULL
		""",
		{"since": since},
		as_dict=True,
	)
	if not rows:
		return 0

	avg_cache = {}
	created = 0
	for row in rows:
		if _insight_exists(child_doctype, row.row_name):
			continue

		item_code = row.item_code
		if item_code not in avg_cache:
			avg_cache[item_code] = _recent_avg_rate(item_code)
		avg = avg_cache[item_code]
		if not avg:
			continue

		deviation_pct = ((flt(row.rate) - avg) / avg) * 100
		if abs(deviation_pct) < _OFF_MARKET_PCT:
			continue

		direction = "above" if deviation_pct > 0 else "below"
		risk = "possible inflated billing" if direction == "above" else "possible unauthorized discount"
		narrative = (
			f"{parent_doctype} {row.parent_name}, item {item_code}: rate {flt(row.rate):.2f} is "
			f"{abs(deviation_pct):.1f}% {direction} this item's recent average sold rate "
			f"{avg:.2f} (last {_RATE_HISTORY_LIMIT} sales) — {risk}."
		)
		_create_insight(
			title=f"Off-market rate: {item_code} on {row.parent_name}",
			domain="Finance",
			severity="Critical",
			narrative=narrative,
			source_doctype=child_doctype,
			source_name=row.row_name,
			root_cause_tag="off-market-rate",
			owner_role="Accounts Manager",
		)
		created += 1

	return created


def _recent_avg_rate(item_code):
	"""Recent average sold rate for an item, via the existing Item Price History
	lookup. Requires at least _MIN_RATE_SAMPLE priced rows to avoid flagging
	noise off a brand-new item with barely any sales history.
	"""
	try:
		result = get_item_price_history(item_code=item_code, limit=_RATE_HISTORY_LIMIT)
	except Exception:
		return None
	data = (result or {}).get("data") or []
	rates = [flt(r.get("rate")) for r in data if flt(r.get("rate")) > 0]
	if len(rates) < _MIN_RATE_SAMPLE:
		return None
	return sum(rates) / len(rates)
