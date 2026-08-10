"""
instabiz/overrides/copilot.py — Business Copilot (natural-language Q&A).

SAFETY MODEL (read this before adding a function):
  The LLM is NEVER allowed to generate or execute SQL/ORM calls against real
  data. It only picks a key from FUNCTION_REGISTRY below — a small, fixed
  menu of pre-written, parameterized, permission-scoped Python functions.
  Even the "params" Claude returns are re-validated/coerced against a strict
  per-function allow-list before use (see _sanitize_params) and are always
  passed into `frappe.db.sql` as bound parameters, never string-interpolated.
  If Claude is unavailable, unreachable, or returns anything that doesn't
  parse to {"function": "<key-in-menu>", "params": {...}}, a deterministic
  keyword matcher takes over — the safety property (fixed function menu,
  bound params) holds either way.

  Row-level scoping reuses this app's existing convention: for Sales-domain
  functions we import `_is_privileged` from instabiz.overrides.permissions
  (the same helper `sales_order_has_permission` / `_sales_doc_query_conditions`
  use) and add a `custom_sales_person_user = <session user>` filter whenever
  the caller is not privileged — a Sales User's copilot answer is scoped
  exactly like their Sales Order list already is.

Whitelisted entry points:
  ask(question)      — main NL Q&A endpoint
  get_menu()          — role-appropriate function menu, for the page's
                         "try asking..." suggestion chips
"""
import json
import re

import frappe
from frappe import _
from frappe.utils import (
	add_days, add_months, cint, flt, get_first_day, getdate, nowdate,
)

from instabiz.overrides import llm
from instabiz.overrides.billing_mode import (
	is_dev_billing_mode, sales_doctype, sales_outstanding_expr,
)
from instabiz.overrides.permissions import _is_privileged

_ALLOWED_PERIODS = {"week", "month", "quarter", "year"}
_ALLOWED_METRICS = {"revenue", "qty"}


# ── row-level scoping helper (mirrors permissions._sales_doc_query_conditions) ─

_FINANCE_UNSCOPED_ROLES = {"Accounts User", "Accounts Manager"}


def _scope_clause(alias, user=None):
	"""SQL fragment + bound params restricting a sales-doctype query to the
	current user's own docs, unless they hold a privileged role. Same
	semantics as instabiz.overrides.permissions._is_privileged, reused as-is
	rather than reinvented — Sales User sees only what their SO/SI list
	already shows them.

	Accounts User/Accounts Manager are also treated as unscoped here: they're
	explicitly in the `roles` menu for overdue_customers/sales_summary/
	ar_aging_summary (Finance-domain questions), and every native equivalent
	of this data in the app (ib_ar_aging.py's Script Report, Party Outstanding
	Summary, Business Pulse/Finance Dashboard's AR figures) is company-wide
	with zero per-sales-person row scoping — an Accounts User has no
	custom_sales_person_user of their own, so scoping them the same way a
	Sales User is scoped would silently return an empty/wrong answer instead
	of the real company-wide picture (same bug class already found and fixed
	for Analytics Hub's Finance tab, see CLAUDE.md item 131)."""
	user = user or frappe.session.user
	if _is_privileged(user) or _FINANCE_UNSCOPED_ROLES & set(frappe.get_roles(user)):
		return "", {}
	return f" AND {alias}.custom_sales_person_user = %(_scope_user)s", {"_scope_user": user}


def _resolve_territory(text):
	"""Exact match first, then substring LIKE fallback, against real
	Territory records — never trust the raw string into SQL directly."""
	if not text:
		return None
	text = str(text).strip()
	if not text:
		return None
	if frappe.db.exists("Territory", text):
		return text
	row = frappe.db.sql(
		"SELECT name FROM `tabTerritory` WHERE LOWER(name) = LOWER(%s) LIMIT 1", (text,)
	)
	if row:
		return row[0][0]
	row = frappe.db.sql(
		"SELECT name FROM `tabTerritory` WHERE name LIKE %s LIMIT 1", (f"%{text}%",)
	)
	return row[0][0] if row else None


def _period_from_date(period):
	period = period if period in _ALLOWED_PERIODS else "month"
	today = getdate(nowdate())
	if period == "week":
		return add_days(today, -7), today, period
	if period == "quarter":
		return add_months(today, -3), today, period
	if period == "year":
		return add_months(today, -12), today, period
	return get_first_day(today), today, period


# ── function 1: overdue customers (AR) ─────────────────────────────────────
# Reuses the same date-field / status / outstanding-amount logic as
# ib_ar_aging.py (billing_mode aware), aggregated per customer instead of
# per invoice, and adds session-scoped row filtering.

def get_overdue_customers(territory=None, limit=15):
	territory = _resolve_territory(territory)
	limit = min(cint(limit) or 15, 50)
	dev_mode = is_dev_billing_mode()
	doctype = sales_doctype()
	date_field = "transaction_date" if dev_mode else "posting_date"
	amount_expr = sales_outstanding_expr("t")
	status_cond = "AND t.status != 'Cancelled'" if dev_mode else "AND t.outstanding_amount > 0"
	scope_sql, scope_params = _scope_clause("t")
	terr_sql = " AND t.territory = %(territory)s" if territory else ""

	rows = frappe.db.sql(
		f"""
		SELECT t.customer, t.territory,
		       SUM({amount_expr}) AS outstanding,
		       MAX(t.{date_field}) AS last_doc_date,
		       COUNT(*) AS doc_count
		FROM `tab{doctype}` t
		WHERE t.docstatus = 1 AND t.grand_total > 0 {status_cond} {terr_sql} {scope_sql}
		GROUP BY t.customer, t.territory
		HAVING outstanding > 0
		ORDER BY outstanding DESC
		LIMIT %(limit)s
		""",
		{"territory": territory, "limit": limit, **scope_params},
		as_dict=True,
	)
	return {
		"function": "overdue_customers",
		"territory": territory,
		"count": len(rows),
		"total_outstanding": flt(sum(flt(r.outstanding) for r in rows), 2),
		"rows": rows,
	}


# ── function 2: top-selling items ───────────────────────────────────────────
# Reuses ib_sku_report.py's item-performance query shape.

def get_top_items(period="month", metric="revenue", limit=10):
	from_date, to_date, period = _period_from_date(period)
	metric = metric if metric in _ALLOWED_METRICS else "revenue"
	limit = min(cint(limit) or 10, 30)
	scope_sql, scope_params = _scope_clause("so")
	order_col = "revenue" if metric == "revenue" else "qty_sold"

	rows = frappe.db.sql(
		f"""
		SELECT soi.item_code, soi.item_name, i.item_group,
		       COUNT(DISTINCT so.name) AS orders,
		       SUM(soi.qty)    AS qty_sold,
		       SUM(soi.amount) AS revenue
		FROM `tabSales Order Item` soi
		INNER JOIN `tabSales Order` so ON so.name = soi.parent
		INNER JOIN `tabItem` i ON i.name = soi.item_code
		WHERE so.docstatus = 1
		AND so.transaction_date BETWEEN %(from_date)s AND %(to_date)s
		{scope_sql}
		GROUP BY soi.item_code
		ORDER BY {order_col} DESC
		LIMIT %(limit)s
		""",
		{"from_date": from_date, "to_date": to_date, "limit": limit, **scope_params},
		as_dict=True,
	)
	return {
		"function": "top_items",
		"period": period,
		"metric": metric,
		"from_date": str(from_date),
		"to_date": str(to_date),
		"rows": rows,
	}


# ── function 3: low stock items ─────────────────────────────────────────────
# Same "actual_qty <= reorder_level" definition as ib_main_dashboard.py /
# reorder_alert.py. Stock levels aren't customer-specific, so no
# custom_sales_person_user scoping applies here — every role that can see
# this function sees the same company-wide numbers.

def get_low_stock_items(limit=15):
	limit = min(cint(limit) or 15, 50)
	rows = frappe.db.sql(
		"""
		SELECT b.item_code, i.item_name, b.warehouse,
		       b.actual_qty, r.warehouse_reorder_level AS reorder_level
		FROM `tabBin` b
		JOIN `tabItem` i ON i.item_code = b.item_code
		JOIN `tabItem Reorder` r
		     ON r.parent = b.item_code AND r.warehouse = b.warehouse
		WHERE i.disabled = 0
		  AND r.warehouse_reorder_level > 0
		  AND b.actual_qty <= r.warehouse_reorder_level
		ORDER BY (r.warehouse_reorder_level - b.actual_qty) DESC
		LIMIT %(limit)s
		""",
		{"limit": limit},
		as_dict=True,
	)
	return {"function": "low_stock_items", "count": len(rows), "rows": rows}


# ── function 4: production status ───────────────────────────────────────────
# Company-wide aggregate is gated to production/manager roles at the menu
# level (see FUNCTION_REGISTRY). A specific sales_order lookup reuses the
# EXISTING Sales Order has_permission hook (sales_order_has_permission,
# registered in hooks.py) instead of re-implementing row scoping here.

def get_production_status(sales_order=None):
	if sales_order:
		if not frappe.db.exists("Sales Order", sales_order):
			return {"function": "production_status", "error": f"Sales Order {sales_order} not found."}
		if not frappe.has_permission("Sales Order", ptype="read", doc=sales_order):
			frappe.throw(_("Not permitted to view this Sales Order"), frappe.PermissionError)
		wos = frappe.db.sql(
			"""
			SELECT wo.name, wo.item_code, wo.stage, wo.status,
			       wo.target_qty, wo.completed_qty, wo.machine
			FROM `tabIB Work Order` wo
			JOIN `tabIB Order Sheet` os ON os.name = wo.order_sheet
			WHERE os.sales_order = %(so)s AND wo.status != 'Cancelled'
			ORDER BY wo.creation
			""",
			{"so": sales_order},
			as_dict=True,
		)
		return {"function": "production_status", "sales_order": sales_order, "count": len(wos), "rows": wos}

	# Company-wide snapshot — menu already restricts this branch to
	# privileged/production roles, but re-check here too since `ask()` is a
	# single whitelisted entry point and params could theoretically be
	# supplied without going through the menu filter for a role that lost
	# access between page-load and submit.
	roles = set(frappe.get_roles(frappe.session.user))
	if not (_is_privileged(frappe.session.user) or roles & {"Factory Management", "Factory Production", "System Manager"}):
		frappe.throw(_("Not permitted to view company-wide production status"), frappe.PermissionError)

	# NOTE: auto_create_all_stage_wos() (instabiz.overrides.production) pre-creates
	# one Work Order per stage in an item's whole route up front, all sitting
	# Pending until actually reached. A plain GROUP BY stage/status therefore
	# double(triple/...)-counts every future-stage placeholder as if it were
	# real backlog sitting at that station — the exact bug already found and
	# fixed in production.py's get_production_dashboard()/get_stage_pipeline()
	# and ib_analytics_hub.py's Production tab (see CLAUDE.md items 129/130).
	# "In Progress"/"Completed" counts are always real (those states only ever
	# occur on an item's genuine current/passed stage); "Pending" is resolved
	# per item's true current stage the same way those fixes do.
	from instabiz.overrides.production import STAGES as _STAGES

	all_wo_rows = frappe.db.sql(
		"""
		SELECT wo.stage, wo.status, wo.order_sheet, wo.order_sheet_item, wo.item_code
		FROM `tabIB Work Order` wo
		WHERE wo.status != 'Cancelled'
		""",
		as_dict=True,
	)
	stage_counts = {s: {"stage": s, "In Progress": 0, "Completed": 0, "Pending": 0} for s in _STAGES}
	item_groups = {}
	for row in all_wo_rows:
		sc = stage_counts.setdefault(row.stage, {"stage": row.stage, "In Progress": 0, "Completed": 0, "Pending": 0})
		if row.status == "In Progress":
			sc["In Progress"] += 1
		elif row.status == "Completed":
			sc["Completed"] += 1
		key = row.order_sheet_item or f"{row.order_sheet}::{row.item_code}"
		item_groups.setdefault(key, []).append(row)

	stage_rank = {s: i for i, s in enumerate(_STAGES)}
	for wos in item_groups.values():
		wos.sort(key=lambda r: stage_rank.get(r.stage, 999))
		current = next((r for r in wos if r.status != "Completed"), None)
		if current and current.status == "Pending":
			stage_counts[current.stage]["Pending"] += 1

	rows = []
	for s in _STAGES:
		sc = stage_counts.get(s)
		if not sc:
			continue
		for status_key in ("Pending", "In Progress", "Completed"):
			if sc[status_key]:
				rows.append({"stage": s, "status": status_key, "cnt": sc[status_key]})
	return {"function": "production_status", "sales_order": None, "rows": rows}


# ── function 5: pending leave approvals (HR) ────────────────────────────────

def get_pending_leaves(limit=15):
	frappe.only_for(["HR Manager", "System Manager"])
	limit = min(cint(limit) or 15, 50)
	rows = frappe.db.sql(
		"""
		SELECT la.employee_name, la.leave_type, la.from_date, la.to_date,
		       la.total_leave_days,
		       DATEDIFF(CURDATE(), DATE(la.creation)) AS days_waiting
		FROM `tabLeave Application` la
		WHERE la.docstatus = 0 AND la.status = 'Open'
		ORDER BY days_waiting DESC
		LIMIT %(limit)s
		""",
		{"limit": limit},
		as_dict=True,
	)
	return {"function": "pending_leaves", "count": len(rows), "rows": rows}


# ── function 6: sales summary (MTD-style KPIs) ──────────────────────────────

def get_sales_summary(period="month"):
	from_date, to_date, period = _period_from_date(period)
	dev_mode = is_dev_billing_mode()
	doctype = sales_doctype()
	date_field = "transaction_date" if dev_mode else "posting_date"
	status_cond = "AND t.status != 'Cancelled'" if dev_mode else "AND t.is_return = 0"
	scope_sql, scope_params = _scope_clause("t")

	revenue = flt(frappe.db.sql(
		f"""
		SELECT COALESCE(SUM(grand_total), 0) FROM `tab{doctype}` t
		WHERE t.docstatus=1 {status_cond} AND t.{date_field} BETWEEN %(from_date)s AND %(to_date)s {scope_sql}
		""",
		{"from_date": from_date, "to_date": to_date, **scope_params},
	)[0][0])

	open_so_sql, open_so_params = _scope_clause("t")
	open_so = cint(frappe.db.sql(
		f"""
		SELECT COUNT(*) FROM `tabSales Order` t
		WHERE t.docstatus=1 AND t.status NOT IN ('Completed','Cancelled','Closed') {open_so_sql}
		""",
		open_so_params,
	)[0][0])

	quote_sql, quote_params = _scope_clause("t")
	open_quotes = cint(frappe.db.sql(
		f"""
		SELECT COUNT(*) FROM `tabQuotation` t
		WHERE t.docstatus=1 AND t.status NOT IN ('Ordered','Lost','Cancelled','Expired') {quote_sql}
		""",
		quote_params,
	)[0][0])

	return {
		"function": "sales_summary",
		"period": period,
		"from_date": str(from_date),
		"to_date": str(to_date),
		"revenue": revenue,
		"open_sales_orders": open_so,
		"open_quotations": open_quotes,
	}


# ── function 7: AR aging summary (bucketed) ─────────────────────────────────

def get_ar_aging_summary(territory=None):
	territory = _resolve_territory(territory)
	dev_mode = is_dev_billing_mode()
	doctype = sales_doctype()
	date_field = "transaction_date" if dev_mode else "posting_date"
	amount_expr = sales_outstanding_expr("t")
	status_cond = "AND t.status != 'Cancelled'" if dev_mode else "AND t.outstanding_amount > 0"
	scope_sql, scope_params = _scope_clause("t")
	terr_sql = " AND t.territory = %(territory)s" if territory else ""

	rows = frappe.db.sql(
		f"""
		SELECT t.{date_field} AS doc_date, {amount_expr} AS outstanding
		FROM `tab{doctype}` t
		WHERE t.docstatus = 1 AND t.grand_total > 0 {status_cond} {terr_sql} {scope_sql}
		""",
		{"territory": territory, **scope_params},
		as_dict=True,
	)
	today_date = getdate(nowdate())
	buckets = {"0-30": 0.0, "31-60": 0.0, "61-90": 0.0, "90+": 0.0}
	total = 0.0
	for r in rows:
		amt = flt(r.outstanding)
		if amt <= 0:
			continue
		age = max((today_date - getdate(r.doc_date)).days, 0) if r.doc_date else 0
		total += amt
		if age <= 30:
			buckets["0-30"] += amt
		elif age <= 60:
			buckets["31-60"] += amt
		elif age <= 90:
			buckets["61-90"] += amt
		else:
			buckets["90+"] += amt
	return {
		"function": "ar_aging_summary",
		"territory": territory,
		"total_outstanding": round(total, 2),
		"buckets": {k: round(v, 2) for k, v in buckets.items()},
	}


# ── function registry (the ONLY thing the LLM is allowed to pick from) ─────

FUNCTION_REGISTRY = {
	"overdue_customers": {
		"fn": get_overdue_customers,
		"domain": "Sales",
		"roles": ["Sales User", "Sales Manager", "Accounts User", "Accounts Manager", "System Manager"],
		"description": "List customers with overdue outstanding balances, optionally filtered by territory.",
		"params": {"territory": "Territory name, optional"},
	},
	"top_items": {
		"fn": get_top_items,
		"domain": "Sales",
		"roles": ["Sales User", "Sales Manager", "System Manager"],
		"description": "Top-selling items by revenue or quantity over a period (week/month/quarter/year).",
		"params": {"period": "week|month|quarter|year, default month", "metric": "revenue|qty, default revenue"},
	},
	"low_stock_items": {
		"fn": get_low_stock_items,
		"domain": "Operations",
		"roles": ["Sales User", "Sales Manager", "Stock User", "Stock Manager", "Purchase User", "Purchase Manager", "System Manager"],
		"description": "Items currently at or below their warehouse reorder level.",
		"params": {},
	},
	"production_status": {
		"fn": get_production_status,
		"domain": "Production",
		"roles": ["Sales User", "Sales Manager", "Factory Management", "Factory Production", "System Manager"],
		"description": "Production stage status, either company-wide or for one Sales Order.",
		"params": {"sales_order": "Sales Order name, optional"},
	},
	"pending_leaves": {
		"fn": get_pending_leaves,
		"domain": "HR",
		"roles": ["HR Manager", "System Manager"],
		"description": "Leave applications awaiting approval.",
		"params": {},
	},
	"sales_summary": {
		"fn": get_sales_summary,
		"domain": "Sales",
		"roles": ["Sales User", "Sales Manager", "Accounts User", "Accounts Manager", "System Manager"],
		"description": "Revenue, open Sales Orders, and open Quotations for a period.",
		"params": {"period": "week|month|quarter|year, default month"},
	},
	"ar_aging_summary": {
		"fn": get_ar_aging_summary,
		"domain": "Finance",
		"roles": ["Accounts User", "Accounts Manager", "Sales Manager", "System Manager"],
		"description": "Outstanding AR bucketed into 0-30/31-60/61-90/90+ day aging, optionally by territory.",
		"params": {"territory": "Territory name, optional"},
	},
}


def _get_available_functions(user=None):
	user = user or frappe.session.user
	roles = set(frappe.get_roles(user))
	if "System Manager" in roles:
		return dict(FUNCTION_REGISTRY)
	return {k: v for k, v in FUNCTION_REGISTRY.items() if roles & set(v["roles"])}


# ── param sanitizing (defense in depth even for LLM-picked params) ─────────

def _sanitize_params(func_key, raw_params, question):
	raw_params = raw_params if isinstance(raw_params, dict) else {}
	clean = {}
	if func_key in ("overdue_customers", "ar_aging_summary"):
		territory = raw_params.get("territory") or _extract_territory_from_text(question)
		if territory:
			clean["territory"] = str(territory)[:140]
	elif func_key == "top_items":
		period = str(raw_params.get("period") or "").lower()
		clean["period"] = period if period in _ALLOWED_PERIODS else _extract_period_from_text(question)
		metric = str(raw_params.get("metric") or "").lower()
		clean["metric"] = metric if metric in _ALLOWED_METRICS else _extract_metric_from_text(question)
	elif func_key == "production_status":
		so = raw_params.get("sales_order")
		if so and frappe.db.exists("Sales Order", str(so)):
			clean["sales_order"] = str(so)
	elif func_key == "sales_summary":
		period = str(raw_params.get("period") or "").lower()
		clean["period"] = period if period in _ALLOWED_PERIODS else _extract_period_from_text(question)
	# low_stock_items / pending_leaves take no params
	return clean


def _extract_territory_from_text(question):
	territories = frappe.get_all("Territory", pluck="name")
	ql = question.lower()
	for t in territories:
		if t and t.lower() in ql:
			return t
	return None


def _extract_period_from_text(question):
	ql = question.lower()
	if "week" in ql:
		return "week"
	if "quarter" in ql:
		return "quarter"
	if "year" in ql or "annual" in ql:
		return "year"
	return "month"


def _extract_metric_from_text(question):
	ql = question.lower()
	if any(w in ql for w in ("qty", "quantity", "units", "volume")):
		return "qty"
	return "revenue"


# ── deterministic keyword matcher (used when Claude is unavailable, or as
#    the source of truth for extracted params regardless of routing path) ──

_KEYWORD_RULES = [
	(("aging", "bucket", "0-30", "ageing"), "ar_aging_summary"),
	(("overdue", "outstanding", "unpaid", "due amount", "who owes"), "overdue_customers"),
	(("top selling", "top item", "best seller", "top-selling", "most sold", "top product", "best performing item"), "top_items"),
	(("low stock", "stock out", "reorder", "running low", "short on stock"), "low_stock_items"),
	(("leave", "leaves pending", "pending approval"), "pending_leaves"),
	(("production", "work order", "wo status", "stage", "shop floor"), "production_status"),
	(("revenue", "sales summary", "how much did we sell", "mtd", "quotations open", "sales this"), "sales_summary"),
]


def _match_function_keyword(question, menu):
	ql = question.lower()
	for keywords, func_key in _KEYWORD_RULES:
		if func_key not in menu:
			continue
		if any(kw in ql for kw in keywords):
			params = _sanitize_params(func_key, {}, question)
			return func_key, params
	return None


def _parse_llm_json(raw):
	raw = (raw or "").strip()
	if raw.startswith("```"):
		raw = re.sub(r"^```(json)?", "", raw, flags=re.I).strip()
		raw = raw.rstrip("`").strip()
	try:
		return json.loads(raw)
	except Exception:
		# last-resort: pull out the first {...} block
		m = re.search(r"\{.*\}", raw, re.S)
		if m:
			try:
				return json.loads(m.group(0))
			except Exception:
				return None
		return None


def _match_function_llm(question, menu):
	"""Ask Claude to pick ONE function key from `menu` — never SQL, never
	free-form code, just a key from the fixed dict above. Falls through to
	the keyword matcher on any parse failure or out-of-menu answer."""
	if not llm.is_enabled():
		return None
	menu_desc = "\n".join(
		f"- {k}: {v['description']} (params: {', '.join(v['params'].keys()) or 'none'})"
		for k, v in menu.items()
	)
	system = (
		"You are a query router for an internal business copilot. Given a user's "
		"question, choose EXACTLY ONE function key from the menu below that best "
		"answers it, and extract any parameters explicitly mentioned in the question. "
		'Reply with ONLY a JSON object: {"function": "<key>", "params": {...}} — '
		"no prose, no markdown fences, no explanation. "
		'If nothing in the menu matches, reply {"function": null, "params": {}}.\n\n'
		f"Available functions:\n{menu_desc}"
	)
	raw = llm.complete(system, question, max_tokens=200)
	parsed = _parse_llm_json(raw)
	if not isinstance(parsed, dict):
		return None
	func_key = parsed.get("function")
	if not func_key or func_key not in menu:
		return None
	params = _sanitize_params(func_key, parsed.get("params") or {}, question)
	return func_key, params


# ── answer formatting ───────────────────────────────────────────────────────

def _format_fallback_answer(func_key, data):
	if data.get("error"):
		return data["error"]
	if func_key == "overdue_customers":
		if not data["rows"]:
			return "No overdue customers found" + (f" in {data['territory']}." if data.get("territory") else ".")
		lines = [f"{data['count']} overdue customer(s), ₹{data['total_outstanding']:,.0f} total outstanding:"]
		for r in data["rows"][:10]:
			lines.append(f"  • {r['customer']}: ₹{flt(r['outstanding']):,.0f} ({r.get('territory') or '—'})")
		return "\n".join(lines)
	if func_key == "top_items":
		if not data["rows"]:
			return f"No sales found for {data['period']} ({data['from_date']} to {data['to_date']})."
		lines = [f"Top items by {data['metric']} ({data['from_date']} to {data['to_date']}):"]
		for r in data["rows"][:10]:
			val = flt(r["revenue"]) if data["metric"] == "revenue" else flt(r["qty_sold"])
			unit = "₹" if data["metric"] == "revenue" else ""
			lines.append(f"  • {r['item_name']}: {unit}{val:,.0f}")
		return "\n".join(lines)
	if func_key == "low_stock_items":
		if not data["rows"]:
			return "No items are currently at or below their reorder level."
		lines = [f"{data['count']} item(s) low on stock:"]
		for r in data["rows"][:10]:
			lines.append(f"  • {r['item_name']} ({r['warehouse']}): {flt(r['actual_qty']):g} left, reorder at {flt(r['reorder_level']):g}")
		return "\n".join(lines)
	if func_key == "production_status":
		if not data["rows"]:
			return "No active production found."
		if data.get("sales_order"):
			lines = [f"Production status for {data['sales_order']} ({data['count']} work order(s)):"]
			for r in data["rows"]:
				lines.append(f"  • {r['item_code']} — {r['stage']} ({r['status']}), {flt(r['completed_qty']):g}/{flt(r['target_qty']):g}")
		else:
			lines = ["Company-wide production stage counts:"]
			for r in data["rows"]:
				lines.append(f"  • {r['stage']} — {r['status']}: {r['cnt']}")
		return "\n".join(lines)
	if func_key == "pending_leaves":
		if not data["rows"]:
			return "No leave applications are pending approval."
		lines = [f"{data['count']} leave application(s) pending:"]
		for r in data["rows"][:10]:
			lines.append(f"  • {r['employee_name']}: {r['leave_type']} ({r['from_date']} to {r['to_date']}), waiting {r['days_waiting']}d")
		return "\n".join(lines)
	if func_key == "sales_summary":
		return (
			f"Sales summary ({data['from_date']} to {data['to_date']}): "
			f"revenue ₹{flt(data['revenue']):,.0f}, {data['open_sales_orders']} open Sales Order(s), "
			f"{data['open_quotations']} open Quotation(s)."
		)
	if func_key == "ar_aging_summary":
		b = data["buckets"]
		return (
			f"AR aging{' for ' + data['territory'] if data.get('territory') else ''}: "
			f"total outstanding ₹{data['total_outstanding']:,.0f} — "
			f"0-30d ₹{b['0-30']:,.0f}, 31-60d ₹{b['31-60']:,.0f}, "
			f"61-90d ₹{b['61-90']:,.0f}, 90+d ₹{b['90+']:,.0f}."
		)
	return json.dumps(data, default=str)


def _phrase_answer(question, func_key, data):
	if llm.is_enabled():
		system = (
			"You are a helpful business assistant for an Indian B2B adhesive-tape "
			"manufacturer. Answer the user's question using ONLY the JSON data given "
			"below — never invent numbers, customers, or items not present in it. "
			"Be concise (2-4 sentences), use ₹ for currency, and name specific rows "
			"where relevant."
		)
		prompt = f"Question: {question}\n\nData (JSON):\n{json.dumps(data, default=str)[:4000]}"
		answer = llm.complete(system, prompt, max_tokens=400)
		if answer:
			return answer, "claude"
	return _format_fallback_answer(func_key, data), "fallback"


# ── whitelisted API ──────────────────────────────────────────────────────────

@frappe.whitelist()
def get_menu():
	"""Role-appropriate function menu — used by the page to render suggestion chips."""
	menu = _get_available_functions()
	return {
		k: {"domain": v["domain"], "description": v["description"]}
		for k, v in menu.items()
	}


@frappe.whitelist()
def ask(question):
	if not question or not str(question).strip():
		frappe.throw(_("Please enter a question."))
	question = str(question).strip()[:500]

	menu = _get_available_functions()
	if not menu:
		return {
			"answer": "You don't have access to any Copilot data yet — ask your admin to check your roles.",
			"function_used": None, "data": None, "source": "none",
		}

	match = _match_function_llm(question, menu) or _match_function_keyword(question, menu)
	if not match:
		return {
			"answer": (
				"I couldn't match that to something I can answer yet. Try asking about "
				"overdue customers, top-selling items, low stock, production status, "
				"sales summary, AR aging, or pending leave approvals."
			),
			"function_used": None, "data": None, "source": "none",
		}

	func_key, params = match
	entry = menu[func_key]
	try:
		data = entry["fn"](**params)
	except frappe.PermissionError:
		raise
	except Exception as e:
		frappe.log_error("IB Copilot", str(e))
		return {
			"answer": "Something went wrong answering that — please try rephrasing.",
			"function_used": func_key, "data": None, "source": "error",
		}

	answer, source = _phrase_answer(question, func_key, data)
	return {"answer": answer, "function_used": func_key, "data": data, "source": source}
