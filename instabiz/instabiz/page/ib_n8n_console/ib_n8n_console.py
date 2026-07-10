"""
ib_n8n_console.py — n8n workflow monitor and control console.

Proxies n8n REST API (http://localhost:5678 by default).
Configure:
  site_config: n8n_base_url  (default: http://localhost:5678)
  site_config: n8n_api_key   (generate in n8n Settings → API Keys)
"""

import frappe


def _base():
	return (frappe.conf.get("n8n_base_url") or "http://localhost:5678").rstrip("/")


def _headers():
	key = frappe.conf.get("n8n_api_key", "")
	return {"X-N8N-API-KEY": key, "Content-Type": "application/json", "Accept": "application/json"}


def _get(path, timeout=5):
	import requests
	return requests.get(f"{_base()}{path}", headers=_headers(), timeout=timeout)


def _post(path, json=None, timeout=8):
	import requests
	return requests.post(f"{_base()}{path}", headers=_headers(), json=json or {}, timeout=timeout)


@frappe.whitelist()
def get_n8n_status():
	"""Return n8n health, workflow list, and recent executions."""
	result = {
		"n8n_url":     _base(),
		"api_key_set": bool(frappe.conf.get("n8n_api_key")),
		"status":      "offline",
		"workflows":   [],
		"executions":  [],
		"error":       None,
	}

	# Health check
	try:
		import requests
		r = requests.get(f"{_base()}/healthz", timeout=3)
		result["status"] = "online" if r.status_code == 200 else "degraded"
	except Exception as e:
		result["error"] = str(e)
		return result

	# Workflows
	try:
		r = _get("/api/v1/workflows?limit=50")
		if r.status_code == 200:
			data = r.json()
			wfs = data.get("data", data) if isinstance(data, dict) else data
			result["workflows"] = [
				{
					"id":          w.get("id"),
					"name":        w.get("name", ""),
					"active":      w.get("active", False),
					"updatedAt":   w.get("updatedAt", ""),
					"createdAt":   w.get("createdAt", ""),
					"tags":        [t.get("name", "") for t in (w.get("tags") or [])],
					"node_count":  len(w.get("nodes") or []),
					"trigger_type": _detect_trigger(w),
				}
				for w in (wfs if isinstance(wfs, list) else [])
			]
		elif r.status_code == 401:
			result["error"] = "API key invalid or not set. Add n8n_api_key to site_config.json."
		else:
			result["error"] = f"Workflows API: HTTP {r.status_code}"
	except Exception as e:
		result["error"] = str(e)

	# Recent executions
	try:
		r = _get("/api/v1/executions?includeData=false&limit=30")
		if r.status_code == 200:
			data = r.json()
			execs = data.get("data", data) if isinstance(data, dict) else data
			result["executions"] = [
				{
					"id":           e.get("id"),
					"workflowId":   e.get("workflowId"),
					"workflowName": e.get("workflowData", {}).get("name", "") if isinstance(e.get("workflowData"), dict) else "",
					"status":       e.get("status", "unknown"),
					"mode":         e.get("mode", ""),
					"startedAt":    e.get("startedAt", ""),
					"stoppedAt":    e.get("stoppedAt", ""),
					"finished":     e.get("finished", False),
				}
				for e in (execs if isinstance(execs, list) else [])
			]
	except Exception:
		pass

	# Webhook event log from Frappe error log (failed n8n calls)
	try:
		result["webhook_errors"] = frappe.db.get_all(
			"Error Log",
			filters={"method": ["like", "%n8n%"]},
			fields=["name", "method", "creation", "error"],
			order_by="creation desc",
			limit=10,
		)
	except Exception:
		result["webhook_errors"] = []

	return result


def _detect_trigger(workflow):
	"""Detect the trigger node type from a workflow definition."""
	nodes = workflow.get("nodes") or []
	trigger_types = {
		"n8n-nodes-base.webhook":      "Webhook",
		"n8n-nodes-base.scheduleTrigger": "Schedule",
		"n8n-nodes-base.manualTrigger": "Manual",
		"n8n-nodes-base.emailReadImap": "Email",
	}
	for node in nodes:
		ntype = node.get("type", "")
		for key, label in trigger_types.items():
			if key in ntype.lower():
				return label
	return "Unknown"


@frappe.whitelist()
def toggle_workflow(workflow_id, active):
	"""Activate or deactivate an n8n workflow."""
	frappe.only_for("System Manager")
	is_active = frappe.parse_json(active) if isinstance(active, str) else bool(active)
	action = "activate" if is_active else "deactivate"
	try:
		r = _post(f"/api/v1/workflows/{workflow_id}/{action}")
		return {"ok": r.status_code in (200, 201), "status_code": r.status_code}
	except Exception as e:
		return {"ok": False, "error": str(e)}


@frappe.whitelist()
def get_execution_detail(execution_id):
	"""Get full execution details including error message if failed."""
	frappe.only_for("System Manager")
	try:
		r = _get(f"/api/v1/executions/{execution_id}?includeData=true")
		if r.status_code == 200:
			return {"ok": True, "data": r.json()}
		return {"ok": False, "status_code": r.status_code}
	except Exception as e:
		return {"ok": False, "error": str(e)}
