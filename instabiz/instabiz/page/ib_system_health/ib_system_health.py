"""
ib_system_health.py — live infra/service health checks for System Health page.

Every check is best-effort: wrapped so one failing probe never breaks the rest.
No live authenticated calls to third-party GSPs/NIC or the Claude API — those
report configuration/session state only (avoids burning quota / hitting rate
limits on every page refresh).
"""

import shutil
import socket
import subprocess

import frappe
from frappe.utils import now_datetime


def _ok(status, label, detail="", extra=None):
	d = {"status": status, "label": label, "detail": detail}
	if extra:
		d.update(extra)
	return d


def _check_database():
	try:
		frappe.db.sql("select 1")
		return _ok("online", "Database")
	except Exception as e:
		return _ok("offline", "Database", str(e))


def _check_redis_cache():
	try:
		frappe.cache.ping()
		return _ok("online", "Redis Cache")
	except Exception as e:
		return _ok("offline", "Redis Cache", str(e))


def _check_redis_queue():
	try:
		from frappe.utils.background_jobs import get_redis_conn
		get_redis_conn().ping()
		return _ok("online", "Redis Queue")
	except Exception as e:
		return _ok("offline", "Redis Queue", str(e))


def _check_background_workers():
	try:
		from frappe.utils.background_jobs import get_workers
		workers = get_workers()
		count = len(workers)
		if count == 0:
			return _ok("offline", "Background Workers", "0 workers running")
		return _ok("online", "Background Workers", f"{count} worker(s) running")
	except Exception as e:
		return _ok("unknown", "Background Workers", str(e))


def _check_scheduler():
	try:
		from frappe.utils.scheduler import is_scheduler_inactive
		if is_scheduler_inactive(verbose=False):
			return _ok("offline", "Scheduler", "Disabled, paused, or maintenance mode is on")
		return _ok("online", "Scheduler")
	except Exception as e:
		return _ok("unknown", "Scheduler", str(e))


def _check_socketio():
	port = int(frappe.conf.get("socketio_port") or 9000)
	try:
		with socket.create_connection(("127.0.0.1", port), timeout=2):
			return _ok("online", "Socket.IO / Realtime", f"port {port}")
	except Exception as e:
		return _ok("offline", "Socket.IO / Realtime", f"port {port}: {e}")


# Only these two components can be restarted from the page, and only to these
# exact PM2 process names — never built from user input, so no injection surface
# even though we call subprocess with an explicit arg list (no shell=True).
_RESTARTABLE = {
	"n8n": "n8n",
}


def _pm2_status(process_name):
	"""Best-effort PM2 process lookup. Returns 'online'/'stopped'/None (pm2 not found)."""
	pm2_bin = shutil.which("pm2")
	if not pm2_bin:
		return None
	try:
		r = subprocess.run([pm2_bin, "jlist"], capture_output=True, text=True, timeout=5)
		if r.returncode != 0:
			return None
		import json
		procs = json.loads(r.stdout or "[]")
		for p in procs:
			if p.get("name") == process_name:
				return p.get("pm2_env", {}).get("status")
		return "not_found"
	except Exception:
		return None


def _check_n8n():
	try:
		from instabiz.instabiz.page.ib_n8n_console.ib_n8n_console import get_n8n_status
		res = get_n8n_status()
		pm2 = _pm2_status("n8n")
		status = "online" if res.get("status") == "online" else "offline"
		detail_bits = [res.get("n8n_url", "")]
		if pm2:
			detail_bits.append(f"pm2: {pm2}")
		if res.get("error") and status != "online":
			detail_bits.append(res["error"])
		return _ok(status, "n8n", " | ".join(b for b in detail_bits if b), {"pm2_status": pm2, "key": "n8n"})
	except Exception as e:
		return _ok("unknown", "n8n", str(e))


def _check_claude():
	try:
		from instabiz.overrides.llm import is_enabled
		enabled = is_enabled()
		return _ok(
			"online" if enabled else "offline",
			"Claude API",
			"anthropic_api_key configured" if enabled else "anthropic_api_key not set in site_config.json",
		)
	except Exception as e:
		return _ok("unknown", "Claude API", str(e))


def _check_gst():
	"""Config + cached-session state only — no live call to NIC/GSP portal."""
	if not frappe.db.exists("DocType", "GST Settings"):
		return _ok("unknown", "GST / e-Invoice APIs", "india_compliance not installed")
	try:
		settings = frappe.get_cached_doc("GST Settings")
		if not settings.enable_api:
			return _ok("offline", "GST / e-Invoice APIs", "enable_api is off in GST Settings")

		creds = frappe.get_all(
			"GST Credential",
			fields=["gstin", "service", "session_expiry"],
		)
		if not creds:
			return _ok("offline", "GST / e-Invoice APIs", "No GST Credential configured")

		# Config (enable_api + credentials present) is the real health signal here —
		# session_expiry is only populated lazily on an actual NIC auth call and
		# expires ~6h later, so "0 fresh" just means idle, not broken. We deliberately
		# don't make a live auth call to check further (avoids hitting NIC/GSP on
		# every page refresh), so this can't distinguish idle from actually-broken.
		now = now_datetime()
		fresh = sum(1 for c in creds if c.session_expiry and c.session_expiry > now)
		detail = f"Configured for {len(creds)} GSTIN(s), enable_api on"
		detail += (
			f" | {fresh}/{len(creds)} have a live cached NIC session right now"
			if fresh
			else " | no live NIC session cached (idle — refreshes automatically on next e-invoice/e-way bill action)"
		)
		return _ok("online", "GST / e-Invoice APIs", detail)
	except Exception as e:
		return _ok("unknown", "GST / e-Invoice APIs", str(e))


CHECKS = [
	_check_database,
	_check_redis_cache,
	_check_redis_queue,
	_check_background_workers,
	_check_scheduler,
	_check_socketio,
	_check_n8n,
	_check_claude,
	_check_gst,
]


@frappe.whitelist()
def get_health_status():
	frappe.only_for("System Manager")
	results = []
	for check in CHECKS:
		try:
			results.append(check())
		except Exception as e:
			results.append(_ok("unknown", check.__name__.removeprefix("_check_"), str(e)))
	return {
		"checked_at": now_datetime(),
		"checks": results,
	}


@frappe.whitelist()
def restart_component(component):
	frappe.only_for("System Manager")

	process_name = _RESTARTABLE.get(component)
	if not process_name:
		frappe.throw(f"Unknown or non-restartable component: {component}")

	pm2_bin = shutil.which("pm2")
	if not pm2_bin:
		return {"ok": False, "error": "pm2 not found on PATH"}

	try:
		r = subprocess.run(
			[pm2_bin, "restart", process_name],
			capture_output=True, text=True, timeout=20,
		)
	except Exception as e:
		frappe.log_error("IB System Health Restart", f"{component}: {e}")
		return {"ok": False, "error": str(e)}

	ok = r.returncode == 0
	frappe.logger("ib_system_health").info(
		f"{frappe.session.user} restarted {component} (pm2 process {process_name}): "
		f"{'ok' if ok else 'FAILED — ' + r.stderr[:300]}"
	)
	if not ok:
		frappe.log_error("IB System Health Restart", f"{component}: {r.stderr[:500]}")

	return {"ok": ok, "output": (r.stdout or r.stderr)[:500]}
