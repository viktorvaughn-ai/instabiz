"""
instabiz/overrides/ai_agents.py — AI agent orchestration engine.

Static agents (23, hardcoded, full Python logic):
  Sales:      auto_quote, demand_forecast, smart_reorder, collections, istix_enforcer, buying_dna
  Production: prod_advance, prod_machine_assign, prod_notify_ready, prod_auto_os,
              prod_job_bundle, prod_wastage_flag, prod_priority_escalate
  HR:         hr_leave_pending, hr_attendance_gap, hr_payroll_nudge, hr_late_checkin
  Finance:    finance_payable_due, finance_expense_pending, finance_bank_recon
  Operations: ops_po_overdue, ops_delivery_risk, ops_stock_aging

Dynamic agents: unlimited, created via IB Agent Definition doctype (SQL + config).

Each agent:
  - reads live Frappe data
  - builds a DETERMINISTIC draft
  - optionally asks Claude to phrase the human-facing text
  - writes one `IB AI Action` row (status=pending)
  - Never takes any action until a human approves it in the AI Inbox

Whitelisted entry points:
  run_all_agents()         — run all static + all active dynamic agents
  run_agent(agent_code)    — run a single agent (static or dynamic)
  get_ai_actions(...)      — list actions from queue (module-aware)
  approve_action(name)     — approve + execute one action
  reject_action(name)      — reject one action
  get_ai_status()          — LLM enabled + agent counts
  get_agent_registry()     — all agents metadata for UI
  toggle_agent_active()    — enable/disable a dynamic agent
"""
import json
import frappe
from frappe.utils import nowdate, getdate, flt, cint, now_datetime, add_days
from instabiz.overrides import llm

# ── static agent metadata ────────────────────────────────────────────────────

AGENT_META = {
	"auto_quote":              {"label": "Auto Quote",         "icon": "lucide:file-text",      "color": "#4e7fff"},
	"buying_dna":              {"label": "Buying DNA",          "icon": "lucide:repeat",         "color": "#10b981"},
	"collections":             {"label": "Collections",         "icon": "lucide:wallet",         "color": "#ef4444"},
	"finance_payable_due":     {"label": "Payable Due",         "icon": "lucide:calendar-clock", "color": "#dc2626"},
	"finance_expense_pending": {"label": "Expense Pending",     "icon": "lucide:receipt",        "color": "#f59e0b"},
	"finance_bank_recon":      {"label": "Bank Reconciliation", "icon": "lucide:landmark",       "color": "#0891b2"},
	"demand_forecast":         {"label": "Demand Forecast",     "icon": "lucide:bar-chart-2",    "color": "#7c4dff"},
	"smart_reorder":           {"label": "Smart Reorder",       "icon": "lucide:shopping-cart",  "color": "#f59e0b"},
	"ops_po_overdue":          {"label": "PO Overdue",          "icon": "lucide:truck",          "color": "#ef4444"},
	"ops_delivery_risk":       {"label": "Delivery Risk",       "icon": "lucide:package-x",      "color": "#dc2626"},
	"ops_stock_aging":         {"label": "Stock Aging",         "icon": "lucide:archive",        "color": "#9333ea"},
	"istix_enforcer":          {"label": "Istix Enforcer",      "icon": "lucide:alert-triangle", "color": "#ff6b35"},
	"prod_advance":            {"label": "Advance Stage",       "icon": "lucide:fast-forward",   "color": "#2563eb"},
	"prod_machine_assign":     {"label": "Assign Machine",      "icon": "lucide:settings-2",     "color": "#0891b2"},
	"prod_notify_ready":       {"label": "Notify Sales (RTD)",  "icon": "lucide:bell",           "color": "#ea580c"},
	"prod_auto_os":            {"label": "Auto Order Sheet",    "icon": "lucide:file-plus",      "color": "#7c3aed"},
	"prod_job_bundle":         {"label": "Job Bundle",          "icon": "lucide:layers",         "color": "#059669"},
	"prod_wastage_flag":       {"label": "Wastage Flag",        "icon": "lucide:flask-conical",  "color": "#b45309"},
	"prod_priority_escalate":  {"label": "Priority Escalate",   "icon": "lucide:siren",          "color": "#dc2626"},
	"hr_leave_pending":        {"label": "Leave Pending",       "icon": "lucide:calendar-off",   "color": "#2563eb"},
	"hr_attendance_gap":       {"label": "Attendance Gap",      "icon": "lucide:user-x",         "color": "#ef4444"},
	"hr_payroll_nudge":        {"label": "Payroll Nudge",       "icon": "lucide:banknote",       "color": "#059669"},
	"hr_late_checkin":         {"label": "Late Check-in",       "icon": "lucide:clock-4",        "color": "#f59e0b"},
}

AGENT_MODULES = {
	"auto_quote": "Sales", "buying_dna": "Sales", "demand_forecast": "Operations",
	"smart_reorder": "Operations", "collections": "Finance",
	"istix_enforcer": "Production", "prod_advance": "Production",
	"prod_machine_assign": "Production", "prod_notify_ready": "Production",
	"prod_auto_os": "Production", "prod_job_bundle": "Production",
	"prod_wastage_flag": "Production", "prod_priority_escalate": "Production",
	"hr_leave_pending": "HR", "hr_attendance_gap": "HR",
	"hr_payroll_nudge": "HR", "hr_late_checkin": "HR",
	"finance_payable_due": "Finance", "finance_expense_pending": "Finance",
	"finance_bank_recon": "Finance",
	"ops_po_overdue": "Operations", "ops_delivery_risk": "Operations",
	"ops_stock_aging": "Operations",
	"raven_sales_bot": "Sales",
}

_ALL_MANAGER_ROLES = [
	"System Manager", "Sales Manager", "Accounts Manager",
	"HR Manager", "Purchase Manager", "Factory Management",
]


# ── helpers ─────────────────────────────────────────────────────────────────

def _dedup_exists(agent: str, reference_name: str) -> bool:
	"""Pending action for this agent+reference already exists today?"""
	if not reference_name:
		return False
	today = nowdate()
	exists = frappe.db.sql("""
		SELECT name FROM `tabIB AI Action`
		WHERE agent=%s AND reference_name=%s AND status='pending'
		AND DATE(creation)=%s
		LIMIT 1
	""", (agent, reference_name, today))
	return bool(exists)


def _queue(agent, action_type, title, summary, draft, reference_doctype=None,
		   reference_name=None, ai_generated=False, module=""):
	if _dedup_exists(agent, reference_name):
		return None
	doc = frappe.get_doc({
		"doctype": "IB AI Action",
		"agent": agent,
		"module": module or AGENT_MODULES.get(agent, ""),
		"action_type": action_type,
		"status": "pending",
		"title": title[:140],
		"summary": summary or "",
		"draft_json": json.dumps(draft or {}, default=str, ensure_ascii=False),
		"reference_doctype": reference_doctype,
		"reference_name": reference_name,
		"ai_generated": int(ai_generated),
	})
	# ignore_links: some agents (demand_forecast, prod_job_bundle, hr_payroll_nudge)
	# queue with reference_doctype=None + a synthetic reference_name used only for
	# same-day dedup (no single real document backs the action). Frappe's Dynamic
	# Link validation throws "Reference DocType must be set first" whenever
	# reference_name is set but reference_doctype is empty — that silently failed
	# every run for those 3 agents since inception (confirmed via IB Agent Run Log:
	# status=failed, 0 IB AI Action rows ever created for any of them). Skipping
	# link validation here is safe: reference_doctype/reference_name are otherwise
	# always valid real values for every other agent, this only restores the
	# doctype-less dedup-key case to working.
	doc.insert(ignore_permissions=True, ignore_links=True)
	frappe.db.commit()
	return doc.name


def _run_log(agent_code, trigger_type="schedule"):
	doc = frappe.get_doc({
		"doctype": "IB Agent Run Log",
		"agent_code": agent_code,
		"trigger_type": trigger_type,
		"status": "running",
		"run_at": now_datetime(),
	})
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return doc


def _finish_log(log_doc, status, records, actions, summary=None, error=None):
	log_doc.status = status
	log_doc.records_processed = records
	log_doc.actions_taken = actions
	log_doc.summary_json = json.dumps(summary or {}, default=str)
	if error:
		log_doc.error_details = str(error)
	log_doc.save(ignore_permissions=True)
	frappe.db.commit()


# ── agent 1: auto_quote ──────────────────────────────────────────────────────

def run_auto_quote(trigger="schedule"):
	log = _run_log("auto_quote", trigger)
	made = 0
	records = 0
	try:
		leads = frappe.get_all("Lead", filters={
			"status": ["in", ["Open", "Interested", "Replied"]],
			"custom_lead_score": [">", 30],
		}, fields=["name", "lead_name", "company_name", "custom_lead_score",
				   "custom_product_of_interest", "email_id", "mobile_no",
				   "territory"])
		records = len(leads)
		for lead in leads:
			interest = lead.get("custom_product_of_interest") or ""
			if not interest:
				continue
			company = lead.get("company_name") or lead.get("lead_name") or "Lead"

			item = frappe.db.sql("""
				SELECT item_code, item_name,
				       COALESCE(NULLIF(valuation_rate,0), 0) AS rate
				FROM `tabItem`
				WHERE disabled=0 AND (
					LOWER(item_name) LIKE %s OR LOWER(item_group) LIKE %s
				) LIMIT 1
			""", (f"%{interest.lower()}%", f"%{interest.lower()}%"), as_dict=True)
			item = item[0] if item else {}
			rate = flt(item.get("rate"))
			item_name = item.get("item_name") or interest

			base_summary = f"Draft quotation for {company}: {item_name} @ ₹{rate:,.0f}."
			note = llm.complete(
				"You are a B2B sales assistant for an adhesive tape manufacturer. "
				"Write one short internal note suggesting a quotation. India context.",
				f"Suggest a quote for {company} interested in {interest}. "
				f"Lead score: {lead.get('custom_lead_score')}.",
			)
			draft = {
				"lead": lead["name"],
				"customer": company,
				"item": item_name,
				"item_code": item.get("item_code"),
				"rate": rate,
				"territory": lead.get("territory"),
				"email": lead.get("email_id"),
			}
			if _queue("auto_quote", "create_quotation",
					  f"Quote: {company}", note or base_summary, draft,
					  "Lead", lead["name"], bool(note)):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: auto_quote", str(e))
	return made


# ── agent 2: demand_forecast ─────────────────────────────────────────────────

def run_demand_forecast(trigger="schedule"):
	log = _run_log("demand_forecast", trigger)
	try:
		rows = frappe.db.sql("""
			SELECT soi.item_code, i.item_name,
			       SUM(soi.qty) AS qty_sold
			FROM `tabSales Invoice Item` soi
			JOIN `tabSales Invoice` si ON si.name = soi.parent
			JOIN `tabItem` i ON i.item_code = soi.item_code
			WHERE si.docstatus = 1
			  AND si.posting_date >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK)
			GROUP BY soi.item_code, i.item_name
			ORDER BY qty_sold DESC, soi.item_code ASC
			LIMIT 30
		""", as_dict=True)
		forecast_rows = []
		for r in rows:
			weekly_avg = flt(r.qty_sold) / 12
			forecast_4w = round(weekly_avg * 4, 1)
			forecast_rows.append({
				"item_code": r.item_code,
				"item_name": r.item_name,
				"weekly_avg": round(weekly_avg, 1),
				"forecast_4w": forecast_4w,
			})
		top = forecast_rows[:10]
		top_mover = (
			f"{top[0]['item_name']} ({top[0]['forecast_4w']} units)" if top and top[0]["forecast_4w"] else "no recent sales"
		)
		summary = f"4-week demand forecast for {len(rows)} SKUs. Top mover: {top_mover}."
		note = llm.complete(
			"You are a supply-chain analyst for an adhesive tape manufacturer. One concise paragraph.",
			f"Summarize this demand forecast: top mover {top_mover}. "
			f"Top 3 items: {', '.join(r['item_name'] for r in top[:3])}. "
			"Any reorder risks or seasonal notes for an India manufacturer?",
		)
		draft = {"rows": top, "period_weeks": 12, "forecast_weeks": 4}
		result = _queue(
			"demand_forecast", "forecast_report",
			"Weekly Demand Forecast", note or summary, draft,
			None, f"forecast-{nowdate()}",
		)
		_finish_log(log, "success", len(rows), 1 if result else 0, {"top": top[:3]})
		return 1 if result else 0
	except Exception as e:
		_finish_log(log, "failed", 0, 0, error=e)
		frappe.log_error("IB AI Agents: demand_forecast", str(e))
		return 0


# ── agent 3: smart_reorder ──────────────────────────────────────────────────

def run_smart_reorder(trigger="schedule"):
	log = _run_log("smart_reorder", trigger)
	made = 0
	records = 0
	try:
		items = frappe.db.sql("""
			SELECT i.item_code, i.item_name, i.item_group,
			       COALESCE(SUM(b.actual_qty), 0) AS stock_qty,
			       MAX(ir.warehouse_reorder_level) AS reorder_level
			FROM `tabItem` i
			JOIN `tabItem Reorder` ir ON ir.parent = i.item_code
			LEFT JOIN `tabBin` b ON b.item_code = i.item_code
			WHERE i.disabled = 0
			  AND i.is_stock_item = 1
			  AND ir.warehouse_reorder_level > 0
			GROUP BY i.item_code, i.item_name, i.item_group
			HAVING stock_qty <= reorder_level
			ORDER BY (reorder_level - stock_qty) DESC, i.item_code ASC
			LIMIT 30
		""", as_dict=True)
		records = len(items)
		for it in items:
			stock = flt(it.stock_qty)
			reorder = flt(it.reorder_level)
			suggest_qty = round(max(reorder * 2, reorder - stock + reorder), 0)

			last_supplier = frappe.db.sql("""
				SELECT poi.schedule_date, s.supplier_name
				FROM `tabPurchase Order Item` poi
				JOIN `tabPurchase Order` po ON po.name = poi.parent
				JOIN `tabSupplier` s ON s.name = po.supplier
				WHERE poi.item_code = %s AND po.docstatus = 1
				ORDER BY poi.schedule_date DESC LIMIT 1
			""", (it.item_code,), as_dict=True)
			supplier = last_supplier[0].supplier_name if last_supplier else "—"

			summary = (
				f"{it.item_name} low: stock {stock:g} ≤ reorder {reorder:g}. "
				f"Suggest order {suggest_qty:g} units"
				+ (f" from {supplier}" if supplier != "—" else "")
			)
			draft = {
				"item_code": it.item_code,
				"item_name": it.item_name,
				"suggest_qty": suggest_qty,
				"supplier": supplier,
				"current_stock": stock,
				"reorder_level": reorder,
			}
			if _queue("smart_reorder", "create_material_request",
					  f"Reorder: {it.item_name}", summary, draft,
					  "Item", it.item_code):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: smart_reorder", str(e))
	return made


# ── agent 4: collections ────────────────────────────────────────────────────

def run_collections(trigger="schedule"):
	log = _run_log("collections", trigger)
	made = 0
	records = 0
	try:
		overdue = frappe.db.sql("""
			SELECT si.name, si.customer, si.posting_date,
			       si.due_date, si.outstanding_amount,
			       si.grand_total, c.mobile_no
			FROM `tabSales Invoice` si
			LEFT JOIN `tabCustomer` c ON c.name = si.customer
			WHERE si.docstatus = 1
			  AND si.outstanding_amount > 0
			  AND si.due_date < CURDATE()
			  AND si.is_return = 0
			ORDER BY si.due_date ASC, si.name ASC
			LIMIT 30
		""", as_dict=True)
		records = len(overdue)
		for inv in overdue:
			outstanding = flt(inv.outstanding_amount)
			if outstanding <= 0:
				continue
			today = getdate(nowdate())
			due = getdate(inv.due_date) if inv.due_date else today
			days = (today - due).days
			if days <= 0:
				continue
			tone = "gentle" if days < 15 else ("firm" if days <= 30 else "escalation")
			cust = inv.customer
			base_msg = (
				f"Dear {cust}, invoice {inv.name} of ₹{outstanding:,.0f} "
				f"is {days} days overdue. Kindly arrange payment at the earliest."
			)
			msg = llm.complete(
				f"You are a polite accounts-receivable officer at an Indian B2B company. "
				f"Tone: {tone}. Write exactly 2 sentences. No placeholder text.",
				f"Write a payment reminder to {cust} for ₹{outstanding:,.0f}, "
				f"{days} days overdue on invoice {inv.name}.",
			)
			draft = {
				"customer": cust,
				"invoice": inv.name,
				"amount": outstanding,
				"days_overdue": days,
				"tone": tone,
				"message": msg or base_msg,
				"phone": inv.mobile_no,
			}
			if _queue("collections", "collection_message",
					  f"Collect ₹{outstanding:,.0f}: {cust}",
					  f"{days}d overdue ({tone})", draft,
					  "Sales Invoice", inv.name, bool(msg)):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: collections", str(e))
	return made


# ── agent 5: istix_enforcer ─────────────────────────────────────────────────

def run_istix_enforcer(trigger="schedule"):
	"""Stalled IB Work Orders (in-progress > 8h without update) → escalation."""
	log = _run_log("istix_enforcer", trigger)
	made = 0
	records = 0
	try:
		stalled = frappe.db.sql("""
			SELECT wo.name, wo.order_sheet, wo.item_code,
			       wo.stage, wo.operator, wo.machine,
			       wo.started_at, wo.priority,
			       TIMESTAMPDIFF(HOUR, wo.started_at, NOW()) AS hours_running,
			       os.sales_order, os.customer_name
			FROM `tabIB Work Order` wo
			JOIN `tabIB Order Sheet` os ON os.name = wo.order_sheet
			WHERE wo.status = 'In Progress'
			  AND wo.started_at IS NOT NULL
			  AND TIMESTAMPDIFF(HOUR, wo.started_at, NOW()) >= 8
			ORDER BY hours_running DESC, wo.name ASC
			LIMIT 20
		""", as_dict=True)
		records = len(stalled)
		for wo in stalled:
			hours = flt(wo.hours_running)
			so_bit = f" Sales Order: {wo.sales_order}" + (f" ({wo.customer_name})" if wo.customer_name else "") + "." if wo.sales_order else ""
			summary = (
				f"Work Order {wo.name} (Stage: {wo.stage}) has been running for "
				f"{hours:.0f}h without completion. Item: {wo.item_code}. "
				f"Machine: {wo.machine or 'unassigned'}.{so_bit}"
			)
			msg = llm.complete(
				"You are a production supervisor. Be concise. One sentence.",
				f"Write an escalation note: Work order {wo.name} stage {wo.stage} "
				f"stalled {hours:.0f} hours. Item: {wo.item_code}."
				+ (f" Sales Order {wo.sales_order} for {wo.customer_name}." if wo.sales_order else ""),
			)
			draft = {
				"work_order": wo.name,
				"order_sheet": wo.order_sheet,
				"sales_order": wo.sales_order,
				"customer_name": wo.customer_name,
				"item_code": wo.item_code,
				"stage": wo.stage,
				"hours_running": hours,
				"machine": wo.machine,
				"operator": wo.operator,
				"priority": wo.priority,
				"message": msg or summary,
			}
			# Title carries the SO/customer, same as the sibling prod_* agents
			# above — a manager scanning the AI Inbox card list previously saw
			# only "Stalled WO: IB-WO-2026-25291 (10h)" with no way to tell
			# whose order it was without clicking through.
			title = f"Stalled WO: {wo.name} ({hours:.0f}h)"
			if wo.sales_order:
				title += f" — {wo.sales_order}" + (f" ({wo.customer_name})" if wo.customer_name else "")
			if _queue("istix_enforcer", "escalate_work_order",
					  title, msg or summary, draft,
					  "IB Work Order", wo.name, bool(msg)):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: istix_enforcer", str(e))
	return made


# ── agent 6: buying_dna ─────────────────────────────────────────────────────

def run_buying_dna(trigger="schedule"):
	"""Customers who bought regularly but haven't ordered in > avg cycle → follow-up."""
	log = _run_log("buying_dna", trigger)
	made = 0
	records = 0
	try:
		profiles = frappe.db.sql("""
			SELECT so.customer,
			       COUNT(so.name) AS order_count,
			       MIN(so.transaction_date) AS first_order,
			       MAX(so.transaction_date) AS last_order,
			       DATEDIFF(CURDATE(), MAX(so.transaction_date)) AS days_since,
			       DATEDIFF(MAX(so.transaction_date), MIN(so.transaction_date)) /
			           GREATEST(COUNT(so.name) - 1, 1) AS avg_cycle_days
			FROM `tabSales Order` so
			WHERE so.docstatus = 1
			GROUP BY so.customer
			HAVING order_count >= 3
			   AND avg_cycle_days > 0
			   AND days_since >= avg_cycle_days * 1.2
			ORDER BY days_since DESC, so.customer ASC
			LIMIT 50
		""", as_dict=True)
		records = len(profiles)
		for p in profiles:
			urgency = flt(p.days_since) / max(flt(p.avg_cycle_days), 1)
			summary = (
				f"{p.customer} last ordered {p.days_since:.0f} days ago "
				f"(avg cycle {p.avg_cycle_days:.0f}d, urgency {urgency:.1f}x). "
				f"{p.order_count} orders since {p.first_order}."
			)
			msg = llm.complete(
				"You are a CRM assistant for a B2B adhesive tape company in India. One sentence.",
				f"Suggest a follow-up message for {p.customer} who hasn't ordered in "
				f"{p.days_since:.0f} days (usual cycle: {p.avg_cycle_days:.0f} days).",
			)
			draft = {
				"customer": p.customer,
				"days_since": p.days_since,
				"avg_cycle_days": p.avg_cycle_days,
				"urgency_score": round(urgency, 2),
				"order_count": p.order_count,
				"last_order": str(p.last_order),
				"suggestion": msg or summary,
			}
			if _queue("buying_dna", "customer_followup",
					  f"Follow-up: {p.customer} ({p.days_since:.0f}d silent)",
					  msg or summary, draft,
					  "Customer", p.customer, bool(msg)):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: buying_dna", str(e))
	return made


# ── production agent 1: prod_advance ──────────────────────────────────────────

def run_prod_advance(trigger="schedule"):
	"""WOs in-progress ≥85% complete → queue advance to next stage."""
	log = _run_log("prod_advance", trigger)
	made = 0
	records = 0
	try:
		wos = frappe.db.sql("""
			SELECT wo.name, wo.order_sheet, wo.item_code, wo.stage,
			       wo.target_qty, wo.completed_qty, wo.machine, wo.priority,
			       TIMESTAMPDIFF(HOUR, wo.started_at, NOW()) AS hours_running,
			       os.sales_order, os.customer_name
			FROM `tabIB Work Order` wo
			JOIN `tabIB Order Sheet` os ON os.name = wo.order_sheet
			WHERE wo.status = 'In Progress'
			  AND wo.started_at IS NOT NULL
			  AND wo.target_qty > 0
			  AND wo.completed_qty / wo.target_qty >= 0.85
			  AND TIMESTAMPDIFF(HOUR, wo.started_at, NOW()) >= 2
			ORDER BY hours_running DESC, wo.name ASC
			LIMIT 30
		""", as_dict=True)
		records = len(wos)
		for wo in wos:
			pct = flt(wo.completed_qty) / flt(wo.target_qty) * 100
			summary = (
				f"WO {wo.name} at {pct:.0f}% ({wo.completed_qty}/{wo.target_qty}) "
				f"on {wo.stage}. Ready to advance to next stage?"
			)
			draft = {
				"work_order": wo.name,
				"order_sheet": wo.order_sheet,
				"sales_order": wo.sales_order,
				"item_code": wo.item_code,
				"stage": wo.stage,
				"completed_qty": flt(wo.completed_qty),
				"target_qty": flt(wo.target_qty),
				"completion_pct": round(pct, 1),
				"machine": wo.machine or "",
				"priority": wo.priority,
			}
			if _queue("prod_advance", "advance_work_order",
					  f"Advance WO: {wo.name} ({pct:.0f}%)", summary, draft,
					  "IB Work Order", wo.name):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: prod_advance", str(e))
	return made


# ── production agent 2: prod_machine_assign ────────────────────────────────────

def run_prod_machine_assign(trigger="schedule"):
	"""Pending WOs with no machine assigned for ≥1 day → queue assignment."""
	log = _run_log("prod_machine_assign", trigger)
	made = 0
	records = 0
	try:
		wos = frappe.db.sql("""
			SELECT wo.name, wo.order_sheet, wo.item_code, wo.stage,
			       wo.target_qty, wo.priority,
			       DATEDIFF(CURDATE(), DATE(wo.creation)) AS days_waiting,
			       os.sales_order, os.customer_name, os.delivery_date
			FROM `tabIB Work Order` wo
			JOIN `tabIB Order Sheet` os ON os.name = wo.order_sheet
			WHERE wo.status = 'Pending'
			  AND (wo.machine IS NULL OR wo.machine = '')
			  AND DATEDIFF(CURDATE(), DATE(wo.creation)) >= 1
			ORDER BY FIELD(wo.priority, 'Urgent', 'High', 'Normal', 'Low'),
			         os.delivery_date ASC, wo.name ASC
			LIMIT 20
		""", as_dict=True)
		records = len(wos)
		for wo in wos:
			from instabiz.overrides.production import _assign_machine_load_balanced
			suggested = _assign_machine_load_balanced(wo.stage) or ""
			summary = (
				f"WO {wo.name} ({wo.stage}) Pending {wo.days_waiting}d, no machine. "
				f"Priority: {wo.priority}. Suggested: {suggested or 'none available'}."
			)
			draft = {
				"work_order": wo.name,
				"order_sheet": wo.order_sheet,
				"sales_order": wo.sales_order,
				"item_code": wo.item_code,
				"stage": wo.stage,
				"priority": wo.priority,
				"days_waiting": wo.days_waiting,
				"suggested_machine": suggested,
				"delivery_date": str(wo.delivery_date) if wo.delivery_date else None,
			}
			if _queue("prod_machine_assign", "assign_machine",
					  f"Assign Machine: {wo.name} ({wo.stage})", summary, draft,
					  "IB Work Order", wo.name):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: prod_machine_assign", str(e))
	return made


# ── production agent 3: prod_notify_ready ─────────────────────────────────────

def run_prod_notify_ready(trigger="schedule"):
	"""Order Sheets that are fully ready to deliver → notify sales user.

	RTD/Delivered were collapsed out of the stage model entirely (2026-08-13,
	see production.py's STAGES) — Packing is the real last Work Order stage
	now, and IB Order Sheet.status flips to "Completed" once every item's
	real last stage is done (_update_order_sheet_progress). This used to
	independently re-derive "all items RTD" from a per-WO stage query as a
	staleness check against os.status possibly not having caught up yet —
	but there's no RTD WO stage left to check for, so that query now
	permanently matches zero rows. os.status == "Completed" is the same
	signal get_order_dn_readiness()/get_so_list_badges() already treat as
	authoritative; reusing it here too instead of re-deriving it.
	"""
	log = _run_log("prod_notify_ready", trigger)
	made = 0
	records = 0
	try:
		os_rows = frappe.db.sql("""
			SELECT os.name, os.sales_order, os.customer_name,
			       os.priority, os.delivery_date,
			       so.custom_sales_person_user
			FROM `tabIB Order Sheet` os
			LEFT JOIN `tabSales Order` so ON so.name = os.sales_order
			WHERE os.status = 'Completed'
			ORDER BY os.delivery_date ASC, os.name ASC
			LIMIT 30
		""", as_dict=True)
		records = len(os_rows)
		for os_row in os_rows:
			sales_user = os_row.custom_sales_person_user or ""
			summary = (
				f"Sales Order {os_row.sales_order} for {os_row.customer_name} "
				f"is fully Ready to Deliver. Notify: {sales_user or 'unassigned'}."
			)
			draft = {
				"order_sheet": os_row.name,
				"sales_order": os_row.sales_order,
				"customer_name": os_row.customer_name,
				"sales_person_user": sales_user,
				"priority": os_row.priority,
				"delivery_date": str(os_row.delivery_date) if os_row.delivery_date else None,
			}
			if _queue("prod_notify_ready", "notify_sales_rtd",
					  f"RTD: {os_row.sales_order} — {os_row.customer_name}", summary, draft,
					  "IB Order Sheet", os_row.name):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: prod_notify_ready", str(e))
	return made


# ── production agent 4: prod_auto_os ──────────────────────────────────────────

def run_prod_auto_os(trigger="schedule"):
	"""Submitted SOs with no Order Sheet → queue Order Sheet auto-creation."""
	log = _run_log("prod_auto_os", trigger)
	made = 0
	records = 0
	try:
		sos = frappe.db.sql("""
			SELECT so.name, so.customer, so.customer_name,
			       so.transaction_date, so.delivery_date
			FROM `tabSales Order` so
			WHERE so.docstatus = 1
			  AND so.status NOT IN ('Completed', 'Cancelled', 'Closed')
			  AND NOT EXISTS (
			      SELECT 1 FROM `tabIB Order Sheet` os
			      WHERE os.sales_order = so.name AND os.status != 'Cancelled'
			  )
			ORDER BY so.delivery_date ASC, so.name ASC
			LIMIT 10
		""", as_dict=True)
		records = len(sos)
		for so in sos:
			summary = (
				f"SO {so.name} for {so.customer_name} has not started production. "
				f"Delivery: {so.delivery_date or 'not set'}. Auto-create?"
			)
			draft = {
				"sales_order": so.name,
				"customer": so.customer,
				"customer_name": so.customer_name,
				"delivery_date": str(so.delivery_date) if so.delivery_date else None,
				"transaction_date": str(so.transaction_date),
			}
			if _queue("prod_auto_os", "create_order_sheet",
					  f"Create OS: {so.name}", summary, draft,
					  "Sales Order", so.name):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: prod_auto_os", str(e))
	return made


# ── production agent 5: prod_job_bundle ───────────────────────────────────────

def run_prod_job_bundle(trigger="schedule"):
	"""Multiple Pending WOs for same item+stage → queue batch machine assignment."""
	log = _run_log("prod_job_bundle", trigger)
	made = 0
	records = 0
	try:
		groups = frappe.db.sql("""
			SELECT wo.item_code, wo.stage,
			       COUNT(*) AS wo_count,
			       SUM(wo.target_qty) AS total_qty,
			       GROUP_CONCAT(wo.name ORDER BY wo.priority SEPARATOR ',') AS wo_names
			FROM `tabIB Work Order` wo
			WHERE wo.status = 'Pending'
			  AND (wo.batch_group IS NULL OR wo.batch_group = '')
			GROUP BY wo.item_code, wo.stage
			HAVING wo_count >= 2
			ORDER BY wo_count DESC, wo.item_code ASC, wo.stage ASC
			LIMIT 10
		""", as_dict=True)
		records = len(groups)
		for grp in groups:
			wo_list = (grp.wo_names or "").split(",")
			from instabiz.overrides.production import _assign_machine_load_balanced
			suggested = _assign_machine_load_balanced(grp.stage) or ""
			summary = (
				f"{grp.wo_count} Pending WOs for {grp.item_code}/{grp.stage} "
				f"({grp.total_qty:g} units total). Suggested machine: {suggested or 'none'}. "
				"Bundle for efficient run?"
			)
			bundle_key = f"{grp.item_code}-{grp.stage}"
			draft = {
				"item_code": grp.item_code,
				"stage": grp.stage,
				"wo_names": wo_list,
				"wo_count": grp.wo_count,
				"total_qty": flt(grp.total_qty),
				"suggested_machine": suggested,
			}
			if _queue("prod_job_bundle", "batch_assign_machine",
					  f"Bundle {grp.wo_count} WOs: {grp.item_code}/{grp.stage}",
					  summary, draft, None, f"bundle-{bundle_key}-{nowdate()}"):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: prod_job_bundle", str(e))
	return made


# ── HR agent 1: hr_leave_pending ─────────────────────────────────────────────

def run_hr_leave_pending(trigger="schedule"):
	"""Leave Applications pending approval > 2 days → nudge approver."""
	log = _run_log("hr_leave_pending", trigger)
	made = 0
	records = 0
	try:
		rows = frappe.db.sql("""
			SELECT la.name, la.employee, la.employee_name,
			       la.leave_approver, la.from_date, la.to_date,
			       la.total_leave_days, la.leave_type,
			       DATEDIFF(CURDATE(), DATE(la.creation)) AS days_waiting
			FROM `tabLeave Application` la
			WHERE la.docstatus = 0
			  AND la.status = 'Open'
			  AND DATEDIFF(CURDATE(), DATE(la.creation)) >= 2
			ORDER BY days_waiting DESC, la.name ASC
			LIMIT 20
		""", as_dict=True)
		records = len(rows)
		for la in rows:
			summary = (
				f"{la.employee_name} applied for {int(la.total_leave_days or 0)}d {la.leave_type} "
				f"({la.from_date} → {la.to_date}), waiting {la.days_waiting} days."
			)
			msg = llm.complete(
				"You are an HR assistant. One sentence, professional.",
				f"Write a nudge to approve {la.employee_name}'s {la.leave_type} leave "
				f"({int(la.total_leave_days or 0)} days), pending {la.days_waiting} days.",
			)
			draft = {
				"leave_application": la.name,
				"employee": la.employee,
				"employee_name": la.employee_name,
				"approver": la.leave_approver or "",
				"leave_type": la.leave_type,
				"from_date": str(la.from_date),
				"to_date": str(la.to_date),
				"days_waiting": la.days_waiting,
				"message": msg or summary,
			}
			if _queue("hr_leave_pending", "approve_leave_reminder",
					  f"Leave Pending: {la.employee_name} ({la.days_waiting}d)",
					  msg or summary, draft,
					  "Leave Application", la.name, bool(msg)):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: hr_leave_pending", str(e))
	return made


# ── HR agent 2: hr_attendance_gap ────────────────────────────────────────────

def run_hr_attendance_gap(trigger="schedule"):
	"""Employees with 3+ absent days in last 7 days → alert HR Manager."""
	log = _run_log("hr_attendance_gap", trigger)
	made = 0
	records = 0
	try:
		rows = frappe.db.sql("""
			SELECT a.employee, e.employee_name, e.reports_to,
			       COUNT(*) AS absent_days
			FROM `tabAttendance` a
			JOIN `tabEmployee` e ON e.name = a.employee
			WHERE a.docstatus = 1
			  AND a.status = 'Absent'
			  AND a.attendance_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
			GROUP BY a.employee, e.employee_name, e.reports_to
			HAVING absent_days >= 3
			ORDER BY absent_days DESC, a.employee ASC
			LIMIT 15
		""", as_dict=True)
		records = len(rows)
		for r in rows:
			summary = f"{r.employee_name} absent {r.absent_days} of last 7 days."
			draft = {
				"employee": r.employee,
				"employee_name": r.employee_name,
				"absent_days": r.absent_days,
				"reports_to": r.reports_to or "",
				"message": summary,
			}
			if _queue("hr_attendance_gap", "attendance_gap_alert",
					  f"Absent {r.absent_days}d: {r.employee_name}", summary, draft,
					  "Employee", r.employee):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: hr_attendance_gap", str(e))
	return made


# ── HR agent 3: hr_payroll_nudge ─────────────────────────────────────────────

def run_hr_payroll_nudge(trigger="schedule"):
	"""Month-end approaching (≤3 days) + missing salary slips → nudge HR Manager."""
	log = _run_log("hr_payroll_nudge", trigger)
	made = 0
	records = 0
	try:
		import calendar
		today = getdate(nowdate())
		last_day = getdate(f"{today.year}-{today.month:02d}-{calendar.monthrange(today.year, today.month)[1]:02d}")
		days_to_end = (last_day - today).days
		if days_to_end > 3:
			_finish_log(log, "success", 0, 0)
			return 0
		# Count active employees vs salary slips for current month
		period = f"{today.year}-{today.month:02d}"
		active_emp = frappe.db.count("Employee", {"status": "Active"})
		slips_done = frappe.db.sql("""
			SELECT COUNT(*) AS cnt FROM `tabSalary Slip`
			WHERE docstatus = 1
			  AND YEAR(start_date) = %s AND MONTH(start_date) = %s
		""", (today.year, today.month), as_dict=True)[0].cnt
		pending = max(0, active_emp - slips_done)
		if pending == 0:
			_finish_log(log, "success", active_emp, 0)
			return 0
		ref = f"payroll-nudge-{period}"
		summary = (
			f"Month ends in {days_to_end} day(s). {pending} of {active_emp} "
			f"salary slips not yet processed for {period}."
		)
		msg = llm.complete(
			"You are an HR admin. One sentence, urgent tone.",
			f"Write a payroll reminder: {pending} salary slips pending for {period}, "
			f"month ends in {days_to_end} days.",
		)
		draft = {
			"period": period,
			"active_employees": active_emp,
			"slips_done": slips_done,
			"pending": pending,
			"days_to_end": days_to_end,
			"message": msg or summary,
		}
		records = active_emp
		if _queue("hr_payroll_nudge", "payroll_nudge",
				  f"Payroll: {pending} slips pending ({period})",
				  msg or summary, draft, None, ref, bool(msg)):
			made = 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: hr_payroll_nudge", str(e))
	return made


# ── HR agent 4: hr_late_checkin ──────────────────────────────────────────────

def run_hr_late_checkin(trigger="schedule"):
	"""Employees with 5+ late check-ins this month → flag to HR Manager."""
	log = _run_log("hr_late_checkin", trigger)
	made = 0
	records = 0
	try:
		today = getdate(nowdate())
		rows = frappe.db.sql("""
			SELECT a.employee, e.employee_name,
			       COUNT(*) AS late_count
			FROM `tabAttendance` a
			JOIN `tabEmployee` e ON e.name = a.employee
			WHERE a.docstatus = 1
			  AND a.late_entry = 1
			  AND YEAR(a.attendance_date) = %s
			  AND MONTH(a.attendance_date) = %s
			GROUP BY a.employee, e.employee_name
			HAVING late_count >= 5
			ORDER BY late_count DESC, a.employee ASC
			LIMIT 15
		""", (today.year, today.month), as_dict=True)
		records = len(rows)
		for r in rows:
			summary = f"{r.employee_name} has {r.late_count} late arrivals this month."
			draft = {
				"employee": r.employee,
				"employee_name": r.employee_name,
				"late_count": r.late_count,
				"month": f"{today.year}-{today.month:02d}",
				"message": summary,
			}
			if _queue("hr_late_checkin", "late_checkin_flag",
					  f"Late x{r.late_count}: {r.employee_name}", summary, draft,
					  "Employee", r.employee):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: hr_late_checkin", str(e))
	return made


# ── Finance agent 1: finance_payable_due ─────────────────────────────────────

def run_finance_payable_due(trigger="schedule"):
	"""Purchase Invoices due in ≤ 5 days with outstanding > 0 → alert Accounts Manager."""
	log = _run_log("finance_payable_due", trigger)
	made = 0
	records = 0
	try:
		rows = frappe.db.sql("""
			SELECT pi.name, pi.supplier, pi.due_date,
			       pi.outstanding_amount, pi.currency,
			       DATEDIFF(pi.due_date, CURDATE()) AS days_until_due
			FROM `tabPurchase Invoice` pi
			WHERE pi.docstatus = 1
			  AND pi.outstanding_amount > 0
			  AND pi.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 5 DAY)
			ORDER BY pi.due_date ASC, pi.name ASC
			LIMIT 20
		""", as_dict=True)
		records = len(rows)
		for pi in rows:
			amt = flt(pi.outstanding_amount)
			days = int(pi.days_until_due or 0)
			summary = (
				f"PI {pi.name} from {pi.supplier}: ₹{amt:,.0f} due in {days} day(s) "
				f"on {pi.due_date}."
			)
			msg = llm.complete(
				"You are an accounts payable officer. One sentence, professional.",
				f"Write an alert: invoice {pi.name} from {pi.supplier} "
				f"of ₹{amt:,.0f} is due in {days} days.",
			)
			draft = {
				"invoice": pi.name,
				"supplier": pi.supplier,
				"amount": amt,
				"due_date": str(pi.due_date),
				"days_until_due": days,
				"message": msg or summary,
			}
			if _queue("finance_payable_due", "payable_due_alert",
					  f"Pay ₹{amt:,.0f} to {pi.supplier} in {days}d",
					  msg or summary, draft,
					  "Purchase Invoice", pi.name, bool(msg)):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: finance_payable_due", str(e))
	return made


# ── Finance agent 2: finance_expense_pending ──────────────────────────────────

def run_finance_expense_pending(trigger="schedule"):
	"""Expense Claims submitted but not approved > 3 days → nudge approver."""
	log = _run_log("finance_expense_pending", trigger)
	made = 0
	records = 0
	try:
		rows = frappe.db.sql("""
			SELECT ec.name, ec.employee, ec.employee_name,
			       ec.total_claimed_amount, ec.approval_status,
			       DATEDIFF(CURDATE(), DATE(ec.creation)) AS days_pending
			FROM `tabExpense Claim` ec
			WHERE ec.docstatus = 1
			  AND ec.approval_status = 'Submitted'
			  AND DATEDIFF(CURDATE(), DATE(ec.creation)) >= 3
			ORDER BY days_pending DESC, ec.total_claimed_amount DESC, ec.name ASC
			LIMIT 15
		""", as_dict=True)
		records = len(rows)
		for ec in rows:
			amt = flt(ec.total_claimed_amount)
			summary = (
				f"Expense claim {ec.name} by {ec.employee_name}: "
				f"₹{amt:,.0f} pending approval for {ec.days_pending} days."
			)
			draft = {
				"expense_claim": ec.name,
				"employee": ec.employee,
				"employee_name": ec.employee_name,
				"amount": amt,
				"days_pending": ec.days_pending,
				"message": summary,
			}
			if _queue("finance_expense_pending", "expense_approve_nudge",
					  f"Expense ₹{amt:,.0f}: {ec.employee_name} ({ec.days_pending}d)",
					  summary, draft,
					  "Expense Claim", ec.name):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: finance_expense_pending", str(e))
	return made


# ── Finance agent 3: finance_bank_recon ──────────────────────────────────────

def run_finance_bank_recon(trigger="schedule"):
	"""Bank transactions uncleared for > 7 days → nudge Accounts Manager."""
	log = _run_log("finance_bank_recon", trigger)
	made = 0
	records = 0
	try:
		rows = frappe.db.sql("""
			SELECT bt.name, bt.bank_account, bt.date,
			       bt.deposit AS amount, bt.description,
			       DATEDIFF(CURDATE(), bt.date) AS days_old
			FROM `tabBank Transaction` bt
			WHERE bt.docstatus = 1
			  AND bt.status = 'Unreconciled'
			  AND DATEDIFF(CURDATE(), bt.date) >= 7
			ORDER BY days_old DESC, bt.name ASC
			LIMIT 10
		""", as_dict=True)
		records = len(rows)
		for bt in rows:
			amt = flt(bt.amount)
			summary = (
				f"Bank transaction {bt.name} ({bt.bank_account}): "
				f"₹{amt:,.0f} unreconciled for {bt.days_old} days."
			)
			draft = {
				"bank_transaction": bt.name,
				"bank_account": bt.bank_account,
				"amount": amt,
				"date": str(bt.date),
				"days_old": bt.days_old,
				"description": bt.description or "",
				"message": summary,
			}
			if _queue("finance_bank_recon", "bank_recon_nudge",
					  f"Unreconciled ₹{amt:,.0f} ({bt.days_old}d)",
					  summary, draft,
					  "Bank Transaction", bt.name):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: finance_bank_recon", str(e))
	return made


# ── Operations agent 1: ops_po_overdue ───────────────────────────────────────

def run_ops_po_overdue(trigger="schedule"):
	"""PO items with schedule_date passed but not fully received → follow-up."""
	log = _run_log("ops_po_overdue", trigger)
	made = 0
	records = 0
	try:
		rows = frappe.db.sql("""
			SELECT poi.parent AS po_name, po.supplier, po.supplier_name,
			       poi.item_code, poi.item_name,
			       poi.qty, poi.received_qty,
			       poi.schedule_date,
			       DATEDIFF(CURDATE(), poi.schedule_date) AS days_overdue
			FROM `tabPurchase Order Item` poi
			JOIN `tabPurchase Order` po ON po.name = poi.parent
			WHERE po.docstatus = 1
			  AND po.status NOT IN ('Completed', 'Cancelled', 'Closed')
			  AND poi.schedule_date < CURDATE()
			  AND poi.received_qty < poi.qty
			ORDER BY days_overdue DESC, poi.name ASC
			LIMIT 20
		""", as_dict=True)
		records = len(rows)
		for r in rows:
			pending_qty = flt(r.qty) - flt(r.received_qty)
			summary = (
				f"PO {r.po_name} from {r.supplier_name}: {r.item_name} — "
				f"{pending_qty:g} units still pending, {r.days_overdue}d overdue."
			)
			msg = llm.complete(
				"You are a procurement officer. One sentence.",
				f"Write a follow-up note: PO {r.po_name} from {r.supplier_name}, "
				f"{pending_qty:g} units of {r.item_name} not received, {r.days_overdue} days late.",
			)
			draft = {
				"po_name": r.po_name,
				"supplier": r.supplier,
				"supplier_name": r.supplier_name,
				"item_code": r.item_code,
				"item_name": r.item_name,
				"pending_qty": pending_qty,
				"schedule_date": str(r.schedule_date),
				"days_overdue": r.days_overdue,
				"message": msg or summary,
			}
			if _queue("ops_po_overdue", "po_overdue_alert",
					  f"PO Overdue {r.days_overdue}d: {r.po_name}",
					  msg or summary, draft,
					  "Purchase Order", r.po_name, bool(msg)):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: ops_po_overdue", str(e))
	return made


# ── Operations agent 2: ops_delivery_risk ────────────────────────────────────

def run_ops_delivery_risk(trigger="schedule"):
	"""SOs with delivery_date passed and status not Completed/Closed → alert."""
	log = _run_log("ops_delivery_risk", trigger)
	made = 0
	records = 0
	try:
		rows = frappe.db.sql("""
			SELECT so.name, so.customer_name, so.delivery_date,
			       so.status, so.grand_total,
			       DATEDIFF(CURDATE(), so.delivery_date) AS days_overdue,
			       so.custom_sales_person_user AS sales_user
			FROM `tabSales Order` so
			WHERE so.docstatus = 1
			  AND so.delivery_date < CURDATE()
			  AND so.status NOT IN ('Completed', 'Closed', 'Cancelled')
			ORDER BY days_overdue DESC, so.name ASC
			LIMIT 20
		""", as_dict=True)
		records = len(rows)
		for so in rows:
			summary = (
				f"SO {so.name} for {so.customer_name}: delivery was {so.delivery_date} "
				f"({so.days_overdue}d ago), status still '{so.status}'."
			)
			msg = llm.complete(
				"You are a sales operations manager. One sentence, urgent.",
				f"Write an alert: Sales Order {so.name} for {so.customer_name} "
				f"is {so.days_overdue} days past delivery date. Status: {so.status}.",
			)
			draft = {
				"sales_order": so.name,
				"customer_name": so.customer_name,
				"delivery_date": str(so.delivery_date),
				"status": so.status,
				"days_overdue": so.days_overdue,
				"sales_user": so.sales_user or "",
				"message": msg or summary,
			}
			if _queue("ops_delivery_risk", "delivery_risk_alert",
					  f"Delivery {so.days_overdue}d late: {so.name}",
					  msg or summary, draft,
					  "Sales Order", so.name, bool(msg)):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: ops_delivery_risk", str(e))
	return made


# ── Operations agent 3: ops_stock_aging ──────────────────────────────────────

def run_ops_stock_aging(trigger="schedule"):
	"""Items with stock but no bin movement in > 60 days → review flag."""
	log = _run_log("ops_stock_aging", trigger)
	made = 0
	records = 0
	try:
		rows = frappe.db.sql("""
			SELECT b.item_code, i.item_name, i.item_group,
			       SUM(b.actual_qty) AS total_qty,
			       MAX(DATEDIFF(CURDATE(), DATE(b.modified))) AS days_stale
			FROM `tabBin` b
			JOIN `tabItem` i ON i.item_code = b.item_code
			WHERE b.actual_qty > 0
			  AND DATEDIFF(CURDATE(), DATE(b.modified)) >= 60
			GROUP BY b.item_code, i.item_name, i.item_group
			ORDER BY days_stale DESC, b.item_code ASC
			LIMIT 15
		""", as_dict=True)
		records = len(rows)
		for r in rows:
			summary = (
				f"{r.item_name} ({r.item_group}): {r.total_qty:g} units in stock, "
				f"no movement in {r.days_stale} days."
			)
			draft = {
				"item_code": r.item_code,
				"item_name": r.item_name,
				"item_group": r.item_group,
				"total_qty": flt(r.total_qty),
				"days_stale": r.days_stale,
				"message": summary,
			}
			if _queue("ops_stock_aging", "stock_aging_flag",
					  f"Aging Stock {r.days_stale}d: {r.item_name}",
					  summary, draft,
					  "Item", r.item_code):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: ops_stock_aging", str(e))
	return made


# ── Production agent 6: prod_wastage_flag ────────────────────────────────────

def run_prod_wastage_flag(trigger="schedule"):
	"""Completed WOs with wastage above norm → quality review."""
	log = _run_log("prod_wastage_flag", trigger)
	made = 0
	records = 0
	try:
		wos = frappe.db.sql("""
			SELECT wo.name, wo.order_sheet, wo.item_code, wo.stage,
			       wo.wastage_pct, wo.target_qty, wo.completed_qty,
			       m.wastage_norm_pct,
			       os.customer_name, os.sales_order
			FROM `tabIB Work Order` wo
			JOIN `tabIB Order Sheet` os ON os.name = wo.order_sheet
			LEFT JOIN `tabIB Machine` m ON m.name = wo.machine
			WHERE wo.status = 'Completed'
			  AND TIMESTAMPDIFF(HOUR, COALESCE(wo.completed_at, wo.modified), NOW()) BETWEEN 0 AND 24
			  AND wo.wastage_pct > COALESCE(m.wastage_norm_pct, 3)
			ORDER BY wo.wastage_pct DESC, wo.name ASC
			LIMIT 15
		""", as_dict=True)
		records = len(wos)
		for wo in wos:
			norm = flt(wo.wastage_norm_pct) or 3.0
			summary = (
				f"WO {wo.name} ({wo.stage}): wastage {wo.wastage_pct:.1f}% "
				f"vs norm {norm:.1f}%. Item: {wo.item_code}."
			)
			msg = llm.complete(
				"You are a production quality manager. One sentence.",
				f"Write a quality alert: WO {wo.name} had {wo.wastage_pct:.1f}% wastage "
				f"on {wo.stage} (norm {norm:.1f}%) for {wo.item_code}.",
			)
			draft = {
				"work_order": wo.name,
				"order_sheet": wo.order_sheet,
				"sales_order": wo.sales_order,
				"item_code": wo.item_code,
				"stage": wo.stage,
				"wastage_pct": flt(wo.wastage_pct),
				"norm_pct": norm,
				"customer_name": wo.customer_name,
				"message": msg or summary,
			}
			if _queue("prod_wastage_flag", "wastage_quality_flag",
					  f"High Wastage {wo.wastage_pct:.1f}%: {wo.name}",
					  msg or summary, draft,
					  "IB Work Order", wo.name, bool(msg)):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: prod_wastage_flag", str(e))
	return made


# ── Production agent 7: prod_priority_escalate ───────────────────────────────

def run_prod_priority_escalate(trigger="schedule"):
	"""Urgent/High priority WOs Pending > 6h without start → immediate flag."""
	log = _run_log("prod_priority_escalate", trigger)
	made = 0
	records = 0
	try:
		wos = frappe.db.sql("""
			SELECT wo.name, wo.order_sheet, wo.item_code, wo.stage,
			       wo.priority, wo.machine,
			       TIMESTAMPDIFF(HOUR, wo.creation, NOW()) AS hours_pending,
			       os.customer_name, os.delivery_date, os.sales_order
			FROM `tabIB Work Order` wo
			JOIN `tabIB Order Sheet` os ON os.name = wo.order_sheet
			WHERE wo.status = 'Pending'
			  AND wo.priority IN ('Urgent', 'High')
			  AND TIMESTAMPDIFF(HOUR, wo.creation, NOW()) >= 6
			ORDER BY FIELD(wo.priority, 'Urgent', 'High'), hours_pending DESC, wo.name ASC
			LIMIT 15
		""", as_dict=True)
		records = len(wos)
		for wo in wos:
			hrs = flt(wo.hours_pending)
			summary = (
				f"{wo.priority} WO {wo.name} ({wo.stage}) for {wo.customer_name} "
				f"pending {hrs:.0f}h without start. Machine: {wo.machine or 'unassigned'}."
			)
			msg = llm.complete(
				"You are a production floor manager. One sentence, urgent.",
				f"Escalation: {wo.priority} work order {wo.name} ({wo.stage}) "
				f"for {wo.customer_name} waiting {hrs:.0f} hours, not started.",
			)
			draft = {
				"work_order": wo.name,
				"order_sheet": wo.order_sheet,
				"sales_order": wo.sales_order,
				"item_code": wo.item_code,
				"stage": wo.stage,
				"priority": wo.priority,
				"hours_pending": hrs,
				"machine": wo.machine or "",
				"customer_name": wo.customer_name,
				"message": msg or summary,
			}
			if _queue("prod_priority_escalate", "priority_wo_escalate",
					  f"{wo.priority} WO Pending {hrs:.0f}h: {wo.name}",
					  msg or summary, draft,
					  "IB Work Order", wo.name, bool(msg)):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error("IB AI Agents: prod_priority_escalate", str(e))
	return made


# ── dynamic agent runner ─────────────────────────────────────────────────────

def run_dynamic_agent(agent_def_name, trigger="schedule"):
	"""Run a single IB Agent Definition — SQL query → queue IB AI Actions."""
	ad = frappe.get_doc("IB Agent Definition", agent_def_name)
	if not ad.is_active:
		return 0
	log = _run_log(ad.agent_code, trigger)
	made = 0
	records = 0
	try:
		if not (ad.data_query or "").strip():
			_finish_log(log, "success", 0, 0)
			return 0
		rows = frappe.db.sql(ad.data_query, {"today": nowdate()}, as_dict=True)
		records = len(rows)
		max_r = cint(ad.max_per_run) or 20
		for row in rows[:max_r]:
			row_dict = {k: (str(v) if v is not None else "") for k, v in dict(row).items()}
			try:
				title = frappe.render_template(ad.title_template or ad.agent_name, row_dict)
			except Exception:
				title = ad.agent_name
			summary = title
			if ad.summary_template:
				try:
					summary = frappe.render_template(ad.summary_template, row_dict)
				except Exception:
					pass
			ai_gen = False
			if ad.llm_enabled and ad.llm_user_template:
				try:
					user_msg = frappe.render_template(ad.llm_user_template, row_dict)
					note = llm.complete(
						ad.llm_system_prompt or "You are a helpful business assistant. One sentence.",
						user_msg,
					)
					if note:
						summary = note
						ai_gen = True
				except Exception:
					pass
			key_field = (ad.dedup_key_field or "").strip()
			ref_name_field = (ad.reference_name_field or "").strip()
			ref_name = row_dict.get(key_field) or None
			if ref_name_field and ref_name_field in row_dict:
				ref_name = row_dict[ref_name_field] or ref_name
			if _queue(
				ad.agent_code, ad.action_type or "acknowledge",
				title[:140], summary, dict(row),
				ad.reference_doctype or None, ref_name,
				ai_gen, ad.module or "Custom",
			):
				made += 1
		_finish_log(log, "success", records, made)
	except Exception as e:
		_finish_log(log, "failed", records, made, error=e)
		frappe.log_error(f"IB Dynamic Agent: {ad.agent_code}", str(e))
	return made


# ── agent registry ────────────────────────────────────────────────────────────

AGENT_FUNCS = {
	"auto_quote": run_auto_quote,
	"demand_forecast": run_demand_forecast,
	"smart_reorder": run_smart_reorder,
	"collections": run_collections,
	"istix_enforcer": run_istix_enforcer,
	"buying_dna": run_buying_dna,
	"prod_advance": run_prod_advance,
	"prod_machine_assign": run_prod_machine_assign,
	"prod_notify_ready": run_prod_notify_ready,
	"prod_auto_os": run_prod_auto_os,
	"prod_job_bundle": run_prod_job_bundle,
	# HR
	"hr_leave_pending": run_hr_leave_pending,
	"hr_attendance_gap": run_hr_attendance_gap,
	"hr_payroll_nudge": run_hr_payroll_nudge,
	"hr_late_checkin": run_hr_late_checkin,
	# Finance
	"finance_payable_due": run_finance_payable_due,
	"finance_expense_pending": run_finance_expense_pending,
	"finance_bank_recon": run_finance_bank_recon,
	# Operations
	"ops_po_overdue": run_ops_po_overdue,
	"ops_delivery_risk": run_ops_delivery_risk,
	"ops_stock_aging": run_ops_stock_aging,
	# Production (extra)
	"prod_wastage_flag": run_prod_wastage_flag,
	"prod_priority_escalate": run_prod_priority_escalate,
}


# ── apply helpers ────────────────────────────────────────────────────────────

def _get_role_user(role):
	"""Return first non-Administrator user with the given role, or Administrator."""
	rows = frappe.db.sql("""
		SELECT DISTINCT ur.parent FROM `tabHas Role` ur
		WHERE ur.role = %s AND ur.parenttype = 'User'
		  AND ur.parent NOT IN ('Administrator', 'Guest')
		LIMIT 1
	""", (role,), as_dict=True)
	return rows[0].parent if rows else "Administrator"


# ── dynamic action executor ──────────────────────────────────────────────────

def _apply_dynamic(action_doc, draft):
	"""Execute action for dynamic agents (IB Agent Definition-backed)."""
	t = action_doc.action_type
	config = {}
	if frappe.db.exists("IB Agent Definition", action_doc.agent):
		raw = frappe.db.get_value("IB Agent Definition", action_doc.agent, "action_config") or "{}"
		try:
			config = json.loads(raw)
		except Exception:
			config = {}

	if t == "acknowledge":
		return "Acknowledged"

	if t == "send_notification":
		role = config.get("for_role", "System Manager")
		target_user = _get_role_user(role)
		subject_tmpl = config.get("subject_template") or action_doc.title or "Agent Alert"
		try:
			subject = frappe.render_template(subject_tmpl, draft)
		except Exception:
			subject = subject_tmpl
		msg_field = config.get("message_field", "message")
		msg = draft.get(msg_field, "") or action_doc.summary or ""
		frappe.get_doc({
			"doctype": "Notification Log",
			"subject": subject[:140],
			"email_content": msg,
			"for_user": target_user,
			"type": "Alert",
			"document_type": action_doc.reference_doctype or "",
			"document_name": action_doc.reference_name or "",
			"from_user": "Administrator",
		}).insert(ignore_permissions=True)
		frappe.db.commit()
		return f"Notification sent to {target_user}"

	if t == "create_doc":
		doctype = config.get("doctype")
		if not doctype:
			return "No doctype in action_config"
		field_map = config.get("field_map", {})
		doc_data = {"doctype": doctype}
		for target_field, source in field_map.items():
			if isinstance(source, str) and source.startswith("__const__"):
				doc_data[target_field] = source[9:]
			elif source in draft:
				doc_data[target_field] = draft[source]
		new_doc = frappe.get_doc(doc_data)
		new_doc.insert(ignore_permissions=True)
		frappe.db.commit()
		return f"{doctype} {new_doc.name} created"

	if t == "update_doc":
		ref_dt = action_doc.reference_doctype
		ref_name = action_doc.reference_name
		field = config.get("field")
		value = config.get("value")
		if value is None and config.get("value_field"):
			value = draft.get(config["value_field"])
		if ref_dt and ref_name and field:
			frappe.db.set_value(ref_dt, ref_name, field, value)
			frappe.db.commit()
			return f"Updated {ref_dt} {ref_name}.{field} = {value}"
		return "Missing reference_doctype, reference_name, or field in config"

	if t == "submit_doc":
		ref_dt = action_doc.reference_doctype
		ref_name = action_doc.reference_name
		if ref_dt and ref_name and frappe.db.exists(ref_dt, ref_name):
			doc = frappe.get_doc(ref_dt, ref_name)
			doc.submit()
			frappe.db.commit()
			return f"{ref_dt} {ref_name} submitted"
		return "Document not found"

	if t == "run_function":
		fn_path = config.get("function")
		if not fn_path:
			return "No function in action_config"
		extra_args = config.get("args", {})
		fn_args = {k: v for k, v in draft.items() if not k.startswith("_")}
		fn_args.update(extra_args)
		result = frappe.get_attr(fn_path)(**fn_args)
		return str(result) if result is not None else "Function executed"

	return f"Action type '{t}' has no handler — add one to _apply() or _apply_dynamic()"


# ── apply handlers (on approve) ───────────────────────────────────────────────

def _apply(action_doc):
	t = action_doc.action_type
	draft = json.loads(action_doc.draft_json or "{}")

	if t == "create_quotation":
		lead = draft.get("lead")
		if lead and frappe.db.exists("Lead", lead):
			q = frappe.get_doc({
				"doctype": "Quotation",
				"party_name": lead,
				"quotation_to": "Lead",
				"transaction_date": nowdate(),
				"custom_sales_person_user": frappe.session.user,
			})
			if draft.get("item_code"):
				item_uom = frappe.db.get_value("Item", draft["item_code"], "stock_uom") or "Nos"
				q.append("items", {
					"item_code": draft["item_code"],
					"item_name": draft.get("item"),
					"qty": 1,
					"uom": item_uom,
					"rate": draft.get("rate", 0),
				})
			q.insert(ignore_permissions=True)
			return f"Quotation {q.name} created (draft)"
		return "Lead not found — no action taken"

	if t == "create_material_request":
		company = frappe.db.get_single_value("Global Defaults", "default_company")
		default_wh = frappe.db.get_single_value("Stock Settings", "default_warehouse") or ""
		item_code = draft.get("item_code")
		stock_uom = "Nos"
		if item_code:
			stock_uom = frappe.db.get_value("Item", item_code, "stock_uom") or "Nos"
		mr = frappe.get_doc({
			"doctype": "Material Request",
			"material_request_type": "Purchase",
			"transaction_date": nowdate(),
			"company": company,
		})
		if item_code:
			mr.append("items", {
				"item_code": item_code,
				"item_name": draft.get("item_name"),
				"qty": draft.get("suggest_qty", 1),
				"schedule_date": add_days(nowdate(), 7),
				"warehouse": default_wh,
				"uom": stock_uom,
				"stock_uom": stock_uom,
				"conversion_factor": 1,
			})
		mr.insert(ignore_permissions=True)
		return f"Material Request {mr.name} created (draft)"

	if t == "collection_message":
		return "Message approved (logged)"

	if t == "escalate_work_order":
		wo = draft.get("work_order")
		msg = draft.get("message", "")
		frappe.get_doc({
			"doctype": "Notification Log",
			"subject": f"⚠️ Stalled Work Order: {wo}",
			"email_content": msg,
			"for_user": frappe.session.user,
			"type": "Alert",
			"document_type": "IB Work Order",
			"document_name": wo,
			"from_user": "Administrator",
		}).insert(ignore_permissions=True)
		return f"Escalation sent for {wo}"

	if t == "customer_followup":
		return "Follow-up suggestion acknowledged"

	if t == "forecast_report":
		return "Demand forecast acknowledged"

	if t == "advance_work_order":
		wo_name = draft.get("work_order")
		if wo_name and frappe.db.exists("IB Work Order", wo_name):
			from instabiz.overrides.production import advance_to_next_stage
			result = advance_to_next_stage(wo_name)
			return f"Advanced WO {wo_name}: {result.get('message', 'done')}"
		return "Work Order not found"

	if t == "assign_machine":
		wo_name = draft.get("work_order")
		machine = draft.get("suggested_machine")
		if wo_name and machine and frappe.db.exists("IB Work Order", wo_name):
			wo = frappe.get_doc("IB Work Order", wo_name)
			if wo.status == "Pending":
				wo.machine = machine
				wo.save(ignore_permissions=True)
				frappe.db.commit()
				return f"Machine {machine} assigned to {wo_name}"
		return "Assignment skipped"

	if t == "notify_sales_rtd":
		sales_user = draft.get("sales_person_user")
		so_name = draft.get("sales_order")
		if sales_user and so_name:
			frappe.get_doc({
				"doctype": "Notification Log",
				"subject": f"Order Ready to Deliver: {so_name} [ib-agent-rtd-{so_name}]",
				"email_content": (
					f"<p>Sales Order <strong>{so_name}</strong> for "
					f"<strong>{draft.get('customer_name', '')}</strong> "
					"has completed all production stages. Please arrange dispatch.</p>"
				),
				"for_user": sales_user,
				"type": "Alert",
				"document_type": "Sales Order",
				"document_name": so_name,
				"from_user": "Administrator",
			}).insert(ignore_permissions=True)
			frappe.db.commit()
			return f"Notified {sales_user} for {so_name}"
		return "No sales person assigned"

	if t == "create_order_sheet":
		so_name = draft.get("sales_order")
		if so_name and frappe.db.exists("Sales Order", so_name):
			from instabiz.overrides.production import create_order_sheet
			result = create_order_sheet(so_name)
			return f"Order Sheet created: {result.get('name', 'unknown')}"
		return "Sales Order not found"

	if t == "batch_assign_machine":
		wo_names = draft.get("wo_names", [])
		machine = draft.get("suggested_machine")
		if wo_names and machine:
			from instabiz.overrides.production import batch_assign_machine as _batch
			result = _batch(wo_names, machine)
			updated = result.get("updated", [])
			return f"Batch assigned {len(updated)} WOs to {machine}"
		return "No WOs or machine in draft"

	# ── HR apply handlers ─────────────────────────────────────────────────────

	if t == "approve_leave_reminder":
		approver = draft.get("approver") or "Administrator"
		la_name = draft.get("leave_application", "")
		frappe.get_doc({
			"doctype": "Notification Log",
			"subject": f"Leave Approval Needed: {draft.get('employee_name')} — {draft.get('leave_type')}",
			"email_content": draft.get("message", ""),
			"for_user": approver,
			"type": "Alert",
			"document_type": "Leave Application",
			"document_name": la_name,
			"from_user": "Administrator",
		}).insert(ignore_permissions=True)
		return f"Nudge sent to {approver} for {la_name}"

	if t == "attendance_gap_alert":
		hr_user = _get_role_user("HR Manager")
		emp = draft.get("employee_name", "")
		frappe.get_doc({
			"doctype": "Notification Log",
			"subject": f"Attendance Gap: {emp} absent {draft.get('absent_days')} days",
			"email_content": draft.get("message", ""),
			"for_user": hr_user,
			"type": "Alert",
			"document_type": "Employee",
			"document_name": draft.get("employee", ""),
			"from_user": "Administrator",
		}).insert(ignore_permissions=True)
		return f"Attendance gap alert sent for {emp}"

	if t == "payroll_nudge":
		hr_user = _get_role_user("HR Manager")
		frappe.get_doc({
			"doctype": "Notification Log",
			"subject": f"Payroll Reminder: {draft.get('pending')} slips pending — {draft.get('period')}",
			"email_content": draft.get("message", ""),
			"for_user": hr_user,
			"type": "Alert",
			"document_type": None,
			"from_user": "Administrator",
		}).insert(ignore_permissions=True)
		return f"Payroll nudge sent to {hr_user}"

	if t == "late_checkin_flag":
		hr_user = _get_role_user("HR Manager")
		frappe.get_doc({
			"doctype": "Notification Log",
			"subject": f"Late Arrivals: {draft.get('employee_name')} — {draft.get('late_count')}x this month",
			"email_content": draft.get("message", ""),
			"for_user": hr_user,
			"type": "Alert",
			"document_type": "Employee",
			"document_name": draft.get("employee", ""),
			"from_user": "Administrator",
		}).insert(ignore_permissions=True)
		return f"Late check-in flag sent for {draft.get('employee_name')}"

	# ── Finance apply handlers ────────────────────────────────────────────────

	if t == "payable_due_alert":
		acct_user = _get_role_user("Accounts Manager")
		frappe.get_doc({
			"doctype": "Notification Log",
			"subject": f"Payment Due: {draft.get('supplier')} — ₹{flt(draft.get('amount', 0)):,.0f} in {draft.get('days_until_due')}d",
			"email_content": draft.get("message", ""),
			"for_user": acct_user,
			"type": "Alert",
			"document_type": "Purchase Invoice",
			"document_name": draft.get("invoice", ""),
			"from_user": "Administrator",
		}).insert(ignore_permissions=True)
		return f"Payable alert sent for {draft.get('invoice')}"

	if t == "expense_approve_nudge":
		acct_user = _get_role_user("Accounts Manager")
		frappe.get_doc({
			"doctype": "Notification Log",
			"subject": f"Expense Claim Pending: {draft.get('employee_name')} — ₹{flt(draft.get('amount', 0)):,.0f}",
			"email_content": draft.get("message", ""),
			"for_user": acct_user,
			"type": "Alert",
			"document_type": "Expense Claim",
			"document_name": draft.get("expense_claim", ""),
			"from_user": "Administrator",
		}).insert(ignore_permissions=True)
		return f"Expense nudge sent for {draft.get('expense_claim')}"

	if t == "bank_recon_nudge":
		acct_user = _get_role_user("Accounts Manager")
		frappe.get_doc({
			"doctype": "Notification Log",
			"subject": f"Unreconciled Bank Txn: {draft.get('bank_account')} — ₹{flt(draft.get('amount', 0)):,.0f} ({draft.get('days_old')}d old)",
			"email_content": draft.get("message", ""),
			"for_user": acct_user,
			"type": "Alert",
			"document_type": "Bank Transaction",
			"document_name": draft.get("bank_transaction", ""),
			"from_user": "Administrator",
		}).insert(ignore_permissions=True)
		return f"Bank recon nudge sent for {draft.get('bank_transaction')}"

	# ── Operations apply handlers ─────────────────────────────────────────────

	if t == "po_overdue_alert":
		pur_user = _get_role_user("Purchase Manager")
		frappe.get_doc({
			"doctype": "Notification Log",
			"subject": f"PO Receipt Overdue {draft.get('days_overdue')}d: {draft.get('po_name')} — {draft.get('supplier_name')}",
			"email_content": draft.get("message", ""),
			"for_user": pur_user,
			"type": "Alert",
			"document_type": "Purchase Order",
			"document_name": draft.get("po_name", ""),
			"from_user": "Administrator",
		}).insert(ignore_permissions=True)
		return f"PO overdue alert sent for {draft.get('po_name')}"

	if t == "delivery_risk_alert":
		sales_user = draft.get("sales_user") or _get_role_user("Sales Manager")
		frappe.get_doc({
			"doctype": "Notification Log",
			"subject": f"Delivery Overdue {draft.get('days_overdue')}d: {draft.get('sales_order')} — {draft.get('customer_name')}",
			"email_content": draft.get("message", ""),
			"for_user": sales_user,
			"type": "Alert",
			"document_type": "Sales Order",
			"document_name": draft.get("sales_order", ""),
			"from_user": "Administrator",
		}).insert(ignore_permissions=True)
		return f"Delivery risk alert sent for {draft.get('sales_order')}"

	if t == "stock_aging_flag":
		_stock_user = _get_role_user("Stock Manager")
		acct_user = _stock_user if _stock_user != "Administrator" else _get_role_user("Accounts Manager")
		frappe.get_doc({
			"doctype": "Notification Log",
			"subject": f"Aging Stock {draft.get('days_stale')}d: {draft.get('item_name')} ({draft.get('total_qty'):g} units)",
			"email_content": draft.get("message", ""),
			"for_user": acct_user,
			"type": "Alert",
			"document_type": "Item",
			"document_name": draft.get("item_code", ""),
			"from_user": "Administrator",
		}).insert(ignore_permissions=True)
		return f"Stock aging flag sent for {draft.get('item_code')}"

	# ── Production extra apply handlers ───────────────────────────────────────

	if t == "wastage_quality_flag":
		wo_name = draft.get("work_order")
		prod_user = _get_role_user("Manufacturing Manager") or "Administrator"
		frappe.get_doc({
			"doctype": "Notification Log",
			"subject": f"High Wastage {draft.get('wastage_pct'):.1f}%: {wo_name} ({draft.get('stage')})",
			"email_content": draft.get("message", ""),
			"for_user": prod_user,
			"type": "Alert",
			"document_type": "IB Work Order",
			"document_name": wo_name,
			"from_user": "Administrator",
		}).insert(ignore_permissions=True)
		return f"Wastage flag sent for {wo_name}"

	if t == "priority_wo_escalate":
		wo_name = draft.get("work_order")
		prod_user = _get_role_user("Manufacturing Manager") or "Administrator"
		frappe.get_doc({
			"doctype": "Notification Log",
			"subject": f"{draft.get('priority')} WO Pending {draft.get('hours_pending'):.0f}h: {wo_name}",
			"email_content": draft.get("message", ""),
			"for_user": prod_user,
			"type": "Alert",
			"document_type": "IB Work Order",
			"document_name": wo_name,
			"from_user": "Administrator",
		}).insert(ignore_permissions=True)
		return f"Priority escalation sent for {wo_name}"

	# Fallback: dynamic agent handler
	return _apply_dynamic(action_doc, draft)


# ── daily scheduler entry point ───────────────────────────────────────────────

def run_daily_agents():
	"""Called by scheduler — runs all static agents + all active daily dynamic agents."""
	results = {}
	for name, fn in AGENT_FUNCS.items():
		try:
			results[name] = fn("schedule")
		except Exception as e:
			frappe.log_error(f"IB AI Agents: {name}", str(e))
			results[name] = f"error: {e}"
	# Dynamic agents
	try:
		dynamic = frappe.get_all(
			"IB Agent Definition",
			filters={"is_active": 1, "schedule_type": ["in", ["daily", "hourly"]]},
			pluck="name",
		)
		for name in dynamic:
			try:
				results[name] = run_dynamic_agent(name, "schedule")
			except Exception as e:
				frappe.log_error(f"IB Dynamic Agent: {name}", str(e))
				results[name] = f"error: {e}"
	except Exception:
		pass  # IB Agent Definition table may not exist yet during migration
	return results


# ── whitelisted API ───────────────────────────────────────────────────────────

@frappe.whitelist()
def run_all_agents():
	frappe.only_for(_ALL_MANAGER_ROLES)
	results = {}
	for name, fn in AGENT_FUNCS.items():
		try:
			results[name] = fn("manual")
		except Exception as e:
			results[name] = f"error: {e}"
	# Dynamic agents
	try:
		dynamic = frappe.get_all("IB Agent Definition", filters={"is_active": 1}, pluck="name")
		for name in dynamic:
			try:
				results[name] = run_dynamic_agent(name, "manual")
			except Exception as e:
				results[name] = f"error: {e}"
	except Exception:
		pass
	return {"success": True, "results": results}


@frappe.whitelist()
def run_agent(agent_code):
	frappe.only_for(_ALL_MANAGER_ROLES)
	if agent_code in AGENT_FUNCS:
		result = AGENT_FUNCS[agent_code]("manual")
		return {"success": True, "agent": agent_code, "queued": result}
	# Try dynamic agent
	try:
		if frappe.db.exists("IB Agent Definition", agent_code):
			result = run_dynamic_agent(agent_code, "manual")
			return {"success": True, "agent": agent_code, "queued": result}
	except Exception:
		pass
	frappe.throw(f"Unknown agent: {agent_code}")


def _get_agent_module_map():
	"""Returns {agent_code: module} for all static + active dynamic agents."""
	result = dict(AGENT_MODULES)
	try:
		dynamic = frappe.db.sql(
			"SELECT agent_code, module FROM `tabIB Agent Definition` WHERE is_active=1",
			as_dict=True,
		)
		for d in dynamic:
			result[d.agent_code] = d.module
	except Exception:
		pass
	return result


@frappe.whitelist()
def get_ai_actions(status="pending", agent=None, module=None, start=0, page_length=20):
	frappe.only_for(_ALL_MANAGER_ROLES)
	filters = {}
	if status and status != "all":
		filters["status"] = status
	if agent and agent != "all":
		filters["agent"] = agent
	elif module and module not in ("", "All"):
		agent_mod_map = _get_agent_module_map()
		module_agents = [k for k, v in agent_mod_map.items() if v == module]
		if module_agents:
			filters["agent"] = ["in", module_agents]
		else:
			_page = cint(page_length) or 20
			return {"actions": [], "total": 0, "start": 0, "page_length": _page}
	_start = cint(start)
	_page = cint(page_length) or 20
	actions = frappe.get_all(
		"IB AI Action",
		filters=filters,
		fields=["name", "agent", "module", "action_type", "status", "title", "summary",
				"draft_json", "reference_doctype", "reference_name",
				"ai_generated", "decided_by", "decided_at", "creation"],
		order_by="creation desc",
		start=_start,
		page_length=_page,
	)
	total = frappe.db.count("IB AI Action", filters)
	return {"actions": actions, "total": total, "start": _start, "page_length": _page}


@frappe.whitelist()
def raven_draft_quotation(lead, item_code=None, rate=None, note=None):
	"""Called by the Raven sales-bot's Custom Function (not Create Document) —
	drafts a pending IB AI Action instead of creating a real Quotation directly,
	reusing the exact same human-in-the-loop approval path as the auto_quote
	scheduled agent (action_type='create_quotation', applied by _apply() only
	when a manager clicks Approve in AI Inbox)."""
	if not frappe.db.exists("Lead", lead):
		return {"ok": False, "message": f"Lead {lead} not found — no action taken."}
	if not frappe.has_permission("Lead", ptype="read", doc=lead):
		frappe.throw(frappe._("Not permitted to read this Lead"), frappe.PermissionError)

	lead_doc = frappe.db.get_value(
		"Lead", lead,
		["company_name", "custom_product_of_interest", "territory", "email_id", "custom_lead_score"],
		as_dict=True,
	) or {}

	item_name = None
	resolved_rate = rate
	if item_code:
		item_row = frappe.db.get_value("Item", item_code, ["item_name", "standard_rate"], as_dict=True)
		if item_row:
			item_name = item_row.item_name
			if resolved_rate is None:
				resolved_rate = item_row.standard_rate

	draft = {
		"lead": lead,
		"customer": lead_doc.get("company_name"),
		"item": item_name,
		"item_code": item_code,
		"rate": resolved_rate,
		"territory": lead_doc.get("territory"),
		"email": lead_doc.get("email_id"),
	}
	company = lead_doc.get("company_name") or lead
	action_name = _queue(
		"raven_sales_bot", "create_quotation",
		f"Quote: {company}",
		note or "Drafted via Raven sales-bot chat request.",
		draft, "Lead", lead, ai_generated=True,
	)
	if not action_name:
		return {"ok": False, "message": "A quotation draft for this lead was already queued today — check AI Inbox."}
	return {
		"ok": True,
		"message": f"Draft quotation for {company} queued as {action_name} — a manager needs to approve it in AI Inbox before it becomes a real Quotation.",
		"action_name": action_name,
	}


@frappe.whitelist()
def approve_action(name):
	frappe.only_for(_ALL_MANAGER_ROLES)
	doc = frappe.get_doc("IB AI Action", name)
	if doc.status != "pending":
		frappe.throw(f"Already {doc.status}")
	result = _apply(doc)
	doc.status = "approved"
	doc.decided_by = frappe.session.user
	doc.decided_at = now_datetime()
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"success": True, "result": result}


@frappe.whitelist()
def reject_action(name):
	frappe.only_for(_ALL_MANAGER_ROLES)
	doc = frappe.get_doc("IB AI Action", name)
	if doc.status != "pending":
		frappe.throw(f"Already {doc.status}")
	doc.status = "rejected"
	doc.decided_by = frappe.session.user
	doc.decided_at = now_datetime()
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"success": True}


@frappe.whitelist()
def get_agent_run_stats():
	"""Return per-agent last run info and total actions queued."""
	frappe.only_for(_ALL_MANAGER_ROLES)
	rows = frappe.db.sql("""
		SELECT agent_code,
		       MAX(run_at) AS last_run,
		       SUBSTRING_INDEX(GROUP_CONCAT(status ORDER BY run_at DESC), ',', 1) AS last_status,
		       SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(actions_taken,0) ORDER BY run_at DESC), ',', 1) AS last_queued
		FROM `tabIB Agent Run Log`
		GROUP BY agent_code
	""", as_dict=True)
	stats = {r.agent_code: {
		"last_run": str(r.last_run) if r.last_run else None,
		"last_status": r.last_status,
		"last_queued": cint(r.last_queued),
	} for r in rows}
	# Total actions ever queued per agent
	totals = frappe.db.sql("""
		SELECT agent, COUNT(*) AS cnt FROM `tabIB AI Action` GROUP BY agent
	""", as_dict=True)
	for t in totals:
		if t.agent in stats:
			stats[t.agent]["total_queued"] = t.cnt
		else:
			stats[t.agent] = {"total_queued": t.cnt}
	return stats


@frappe.whitelist()
def get_ai_status():
	frappe.only_for(_ALL_MANAGER_ROLES)
	enabled = llm.is_enabled()
	pending_count = frappe.db.count("IB AI Action", {"status": "pending"})
	static_count = len(AGENT_FUNCS)
	try:
		dynamic_count = frappe.db.count("IB Agent Definition", {"is_active": 1})
	except Exception:
		dynamic_count = 0
	return {
		"claude_enabled": enabled,
		"pending_actions": pending_count,
		"agents": list(AGENT_FUNCS.keys()),
		"static_count": static_count,
		"dynamic_count": dynamic_count,
		"total_agents": static_count + dynamic_count,
	}


@frappe.whitelist()
def get_agent_registry():
	"""Return all agents (static + dynamic) with display metadata for the AI Inbox UI."""
	frappe.only_for(_ALL_MANAGER_ROLES)
	registry = {}
	for code, meta in AGENT_META.items():
		registry[code] = {
			"label": meta["label"],
			"icon": meta["icon"],
			"color": meta["color"],
			"module": AGENT_MODULES.get(code, ""),
			"is_dynamic": False,
			"is_active": True,
		}
	try:
		dynamic = frappe.get_all(
			"IB Agent Definition",
			fields=["agent_code", "agent_name", "module", "icon", "color", "is_active", "description"],
		)
		for d in dynamic:
			registry[d.agent_code] = {
				"label": d.agent_name,
				"icon": d.icon or "lucide:bot",
				"color": d.color or "#888888",
				"module": d.module or "Custom",
				"is_dynamic": True,
				"is_active": bool(d.is_active),
				"description": d.description or "",
			}
	except Exception:
		pass
	return registry


@frappe.whitelist()
def toggle_agent_active(agent_code, is_active):
	"""Enable or disable a dynamic agent (IB Agent Definition)."""
	frappe.only_for(["System Manager"])
	if not frappe.db.exists("IB Agent Definition", agent_code):
		frappe.throw(f"No dynamic agent found: {agent_code}")
	frappe.db.set_value("IB Agent Definition", agent_code, "is_active", cint(is_active))
	frappe.db.commit()
	return {"success": True, "agent_code": agent_code, "is_active": cint(is_active)}

