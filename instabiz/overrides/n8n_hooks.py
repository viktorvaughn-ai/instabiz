"""
instabiz/overrides/n8n_hooks.py — Production event webhooks to n8n.

Events fired:
  work_order_started         — WO transitions to In Progress
  work_order_stage_completed — WO completed (non-RTD stage)
  work_order_rtd             — WO completed at Ready to Deliver stage
  work_order_updated         — all other WO saves
  order_sheet_created        — new IB Order Sheet
  order_sheet_completed      — Order Sheet status → Completed
"""
import frappe
from instabiz.overrides.ai_agents import notify_n8n


def on_work_order_update(doc, method=None):
	if doc.status == "In Progress":
		event = "work_order_started"
	elif doc.status == "Completed" and doc.stage == "Ready to Deliver":
		event = "work_order_rtd"
	elif doc.status == "Completed":
		event = "work_order_stage_completed"
	else:
		event = "work_order_updated"

	customer_name = ""
	delivery_date = None
	if doc.order_sheet:
		os_data = frappe.db.get_value(
			"IB Order Sheet", doc.order_sheet,
			["customer_name", "delivery_date"], as_dict=True,
		) or {}
		customer_name = os_data.get("customer_name") or ""
		delivery_date = str(os_data.get("delivery_date")) if os_data.get("delivery_date") else None

	notify_n8n(event, {
		"name": doc.name,
		"order_sheet": doc.order_sheet,
		"sales_order": doc.sales_order,
		"item_code": doc.item_code,
		"item_name": getattr(doc, "item_name", ""),
		"stage": doc.stage,
		"status": doc.status,
		"machine": doc.machine,
		"operator": doc.operator,
		"target_qty": doc.target_qty,
		"completed_qty": doc.completed_qty,
		"wastage_qty": doc.wastage_qty,
		"wastage_pct": getattr(doc, "wastage_pct", 0),
		"priority": doc.priority,
		"batch_group": getattr(doc, "batch_group", "") or "",
		"customer_name": customer_name,
		"delivery_date": delivery_date,
		"started_at": str(doc.started_at) if doc.started_at else None,
		"completed_at": str(doc.completed_at) if doc.completed_at else None,
	})


def on_order_sheet_created(doc, method=None):
	notify_n8n("order_sheet_created", {
		"name": doc.name,
		"sales_order": doc.sales_order,
		"customer": getattr(doc, "customer", ""),
		"customer_name": getattr(doc, "customer_name", ""),
		"status": doc.status,
		"priority": doc.priority,
		"delivery_date": str(doc.delivery_date) if getattr(doc, "delivery_date", None) else None,
		"item_count": len(doc.items) if getattr(doc, "items", None) else 0,
	})


def on_order_sheet_updated(doc, method=None):
	"""Fire when Order Sheet reaches Completed status."""
	if doc.status == "Completed":
		notify_n8n("order_sheet_completed", {
			"name": doc.name,
			"sales_order": doc.sales_order,
			"customer_name": getattr(doc, "customer_name", ""),
			"priority": doc.priority,
			"delivery_date": str(doc.delivery_date) if getattr(doc, "delivery_date", None) else None,
		})
