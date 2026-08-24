"""instabiz/overrides/command_chain.py — IB Command Chain.

Hourly scheduler: `run_command_chain_snapshot()` computes a small set of real
KPIs per role-domain (Sales/Finance/Production/Procurement/Stock/HR), stores
each as an `IB KPI Snapshot`, and — for any metric that moved adversely by
more than a threshold vs the same metric one week (168h) ago — creates an
`IB Insight` with an AI-narrated (or deterministic-fallback) one-sentence
explanation.

`run_command_chain_escalation()` (also hourly) walks Open, unacknowledged
`IB Insight` rows and escalates any that have sat longer than their
severity's `IB Escalation Rule.ack_timeout_hours`.

Metric sourcing: every domain's numbers are pulled from this app's own
existing dashboard/report whitelisted functions — nothing here reinvents a
KPI calculation. See `_get_domain_metrics()` for the exact source per domain.
"""
import frappe
from frappe.utils import flt, now_datetime, nowdate, get_datetime, add_to_date, add_months, get_first_day, getdate

from instabiz.overrides import llm

_DOMAINS = ["Sales", "Finance", "Production", "Procurement", "Stock", "HR"]

# Domain → the role that should own/act on insights raised for that domain.
_DOMAIN_ROLE = {
	"Sales": "Sales Manager",
	"Finance": "Accounts Manager",
	"Production": "Factory Management",
	"Procurement": "Purchase Manager",
	"HR": "HR Manager",
	"Stock": "Stock Manager",
}

# Adverse-move severity bands, measured against the comparison period (same
# metric+domain, 168 hours / 7 days prior). <10% swing is treated as normal
# noise and never flagged. 10-25% adverse → Warning, >25% adverse → Critical
# (mirrors this app's existing "double-digit swing = notable" convention,
# e.g. Customer Health's 15-point-drop manager-email trigger).
_WARNING_PCT = 10.0
_CRITICAL_PCT = 25.0


# ---------------------------------------------------------------------------
# Per-domain metric sourcing — reuses existing dashboard/report query logic.
# Each tuple is (metric_name, value, higher_is_better) — higher_is_better
# decides which direction of % change counts as "adverse" for that metric.
# ---------------------------------------------------------------------------

def _get_domain_metrics(domain):
	if domain == "Sales":
		from instabiz.instabiz.page.ib_main_dashboard.ib_main_dashboard import get_dashboard_data
		d = get_dashboard_data()
		return [
			("Revenue MTD", flt(d.get("rev_mtd")), True),
			("Open Sales Orders", flt(d.get("open_so")), False),
			("Open Quotations", flt(d.get("quotes")), False),
		]

	if domain == "Finance":
		from instabiz.instabiz.page.ib_finance_dashboard.ib_finance_dashboard import get_finance_data
		d = get_finance_data()
		return [
			("Outstanding AR", flt(d.get("ar")), False),
			("Outstanding AP", flt(d.get("ap")), False),
			("Cash & Bank Balance", flt(d.get("total_cash_bank")), True),
		]

	if domain == "Production":
		from instabiz.overrides.production import get_production_dashboard
		d = get_production_dashboard()
		s = d.get("summary", {}) or {}
		return [
			("Machines Active", flt(s.get("machines_active")), True),
			("Pending Work Orders", flt(s.get("pending")), False),
			("Completed Today", flt(s.get("completed_today")), True),
		]

	if domain == "Procurement":
		from instabiz.instabiz.page.ib_procurement_dashboard.ib_procurement_dashboard import get_procurement_data
		d = get_procurement_data()
		return [
			("Open PO Value", flt(d.get("open_po_value")), False),
			("Overdue AP", flt(d.get("overdue_ap")), False),
			("Pending GRNs", flt(d.get("pending_grn")), False),
		]

	if domain == "Stock":
		# Reuses ib_analytics_hub's Inventory-tab data function (per-tab
		# functions are the cleanest existing source for this domain — no
		# dedicated stock KPI dashboard exists). Read-only import; that
		# file/page is not edited by this feature.
		from instabiz.instabiz.page.ib_analytics_hub.ib_analytics_hub import _inventory_data
		today = getdate(nowdate())
		since = get_first_day(add_months(today, -11))
		d = _inventory_data(today, since, "%%b %%Y", "%%Y-%%m")
		kpis = {k["label"]: k["value"] for k in (d.get("kpis") or [])}
		return [
			("Stock Value", flt(kpis.get("Stock Value")), True),
			("Negative Stock Items", flt(kpis.get("Negative Stock")), False),
			("In Stock SKUs", flt(kpis.get("In Stock")), True),
		]

	if domain == "HR":
		from instabiz.instabiz.page.ib_hrms_dashboard.ib_hrms_dashboard import get_hrms_data
		d = get_hrms_data()
		return [
			("Active Employees", flt(d.get("total_emp")), True),
			("Present Today", flt(d.get("present_today")), True),
			("Pending Leaves", flt(d.get("pending_leaves")), False),
		]

	return []


def _truncate_to_hour(dt):
	dt = get_datetime(dt)
	return dt.replace(minute=0, second=0, microsecond=0)


def _get_comparison_value(domain, metric_name, period):
	"""Same metric+domain snapshot from exactly 168 hours (7 days) prior, if
	one exists."""
	target = add_to_date(period, hours=-168)
	return frappe.db.get_value(
		"IB KPI Snapshot",
		{"domain": domain, "metric_name": metric_name, "period": target},
		"metric_value",
	)


def _insight_dedup_exists(domain, title):
	"""One open Insight per domain+metric per day (status, DATE(creation))."""
	today = nowdate()
	return bool(frappe.db.sql(
		"""
		SELECT name FROM `tabIB Insight`
		WHERE domain=%s AND title=%s AND status='Open'
		AND DATE(creation)=%s
		LIMIT 1
		""",
		(domain, title, today),
	))


def _narrate(domain, metric_name, value, comparison_value, pct_change):
	"""Ask Claude for a one-sentence business narrative, phrased as a
	hypothesis (not a confirmed cause — the LLM only has the numbers, not the
	real underlying reason). Falls back to a deterministic, equally-cautious
	sentence if llm.py returns None (no key/credits)."""
	system = (
		"You are a terse business analyst for a manufacturing/trading company. "
		"Given a KPI's current value, its value from the same hour one week "
		"ago, and the percent change, write exactly ONE sentence in the style "
		"'Sales for Gujarat is down 12% WoW due to X.' You only have these "
		"numbers, not the real cause — phrase the 'due to X' part as a "
		"plausible HYPOTHESIS using hedging language (likely/possibly/may be "
		"due to), never as a confirmed fact. Under 30 words. No preamble, no "
		"quotes, just the sentence."
	)
	prompt = (
		f"Domain: {domain}\n"
		f"Metric: {metric_name}\n"
		f"Current value: {value}\n"
		f"Value same hour 7 days ago: {comparison_value}\n"
		f"% change: {pct_change}\n\n"
		"Write the one-sentence narrative."
	)
	text = llm.complete(system, prompt, max_tokens=120)
	if text:
		return text

	direction = "down" if pct_change < 0 else "up"
	return (
		f"{metric_name} in {domain} is {direction} {abs(pct_change)}% vs the same hour "
		f"last week — investigate; cause not yet determined."
	)


def _severity_for(adverse_pct):
	return "Critical" if adverse_pct > _CRITICAL_PCT else "Warning"


def _flag_insight(domain, owner_role, metric_name, value, comparison_value, pct_change, adverse_pct, snapshot_name):
	title = f"{metric_name} ({domain})"
	if _insight_dedup_exists(domain, title):
		return

	narrative = _narrate(domain, metric_name, value, comparison_value, pct_change)
	frappe.get_doc({
		"doctype": "IB Insight",
		"title": title,
		"domain": domain,
		"owner_role": owner_role,
		"severity": _severity_for(adverse_pct),
		"status": "Open",
		"narrative": narrative,
		"source_doctype": "IB KPI Snapshot",
		"source_name": snapshot_name,
	}).insert(ignore_permissions=True)


def _snapshot_domain(domain, period):
	owner_role = _DOMAIN_ROLE.get(domain)
	for metric_name, value, higher_is_better in _get_domain_metrics(domain):
		comparison_value = _get_comparison_value(domain, metric_name, period)
		pct_change = None
		if comparison_value not in (None, 0):
			pct_change = round((value - flt(comparison_value)) / abs(flt(comparison_value)) * 100, 2)

		snap = frappe.get_doc({
			"doctype": "IB KPI Snapshot",
			"domain": domain,
			"metric_name": metric_name,
			"metric_value": value,
			"period": period,
			"comparison_value": comparison_value,
			"pct_change": pct_change,
		})
		snap.insert(ignore_permissions=True)

		if pct_change is not None:
			# Adverse move = a decrease for "higher is better" metrics, an
			# increase for "lower is better" metrics (e.g. Outstanding AP).
			adverse_pct = (-pct_change) if higher_is_better else pct_change
			if adverse_pct > _WARNING_PCT:
				_flag_insight(domain, owner_role, metric_name, value, comparison_value, pct_change, adverse_pct, snap.name)


def run_command_chain_snapshot():
	"""Hourly scheduler entry — Feature 2. One domain's query breaking must
	not stop KPI snapshotting for every other domain."""
	period = _truncate_to_hour(now_datetime())
	for domain in _DOMAINS:
		try:
			_snapshot_domain(domain, period)
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			frappe.log_error(f"IB Command Chain snapshot: {domain}", frappe.get_traceback())


# ---------------------------------------------------------------------------
# Feature 3 — Escalation
# ---------------------------------------------------------------------------

def _notify_escalation(insight_name, insight_title, role):
	users = frappe.db.sql_list(
		"""
		SELECT DISTINCT u.name FROM `tabUser` u
		INNER JOIN `tabHas Role` hr ON hr.parent = u.name
		WHERE hr.role = %s AND u.enabled = 1 AND u.name != 'Administrator'
		""",
		(role,),
	)
	if not users:
		return
	subject = f"[ib-insight-escalated] {frappe.utils.escape_html(insight_title or '')} — escalated to {role}"
	for user in users:
		frappe.get_doc({
			"doctype": "Notification Log",
			"subject": subject,
			"for_user": user,
			"from_user": "Administrator",
			"type": "Alert",
			"document_type": "IB Insight",
			"document_name": insight_name,
		}).insert(ignore_permissions=True)


def _escalate(insight, rule):
	# frappe.db.set_value doesn't fire Document events — fine here, no
	# doc_events are wired to IB Insight.
	frappe.db.set_value(
		"IB Insight",
		insight.name,
		{
			"status": "Escalated",
			"escalated_to_role": rule.escalate_to_role,
			"escalated_at": now_datetime(),
		},
	)
	_notify_escalation(insight.name, insight.title, rule.escalate_to_role)


def run_command_chain_escalation():
	"""Hourly scheduler entry — Feature 3. Skips escalation entirely for a
	severity with no matching IB Escalation Rule (never invents a default)."""
	try:
		open_insights = frappe.get_all(
			"IB Insight",
			filters={"status": "Open", "acknowledged_at": ["is", "not set"]},
			fields=["name", "title", "severity", "creation"],
		)
	except Exception:
		frappe.log_error("IB Command Chain escalation: fetch", frappe.get_traceback())
		return

	if not open_insights:
		return

	rules = {
		r.severity: r
		for r in frappe.get_all(
			"IB Escalation Rule",
			fields=["severity", "ack_timeout_hours", "escalate_to_role"],
		)
	}
	if not rules:
		return

	now = now_datetime()
	for insight in open_insights:
		rule = rules.get(insight.severity)
		if not rule:
			continue
		overdue_hours = (now - get_datetime(insight.creation)).total_seconds() / 3600.0
		if overdue_hours <= rule.ack_timeout_hours:
			continue
		try:
			_escalate(insight, rule)
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			frappe.log_error(f"IB Command Chain escalation: {insight.name}", frappe.get_traceback())
