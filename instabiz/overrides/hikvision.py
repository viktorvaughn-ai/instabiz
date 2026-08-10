"""instabiz.overrides.hikvision

Hikvision ISAPI transport layer for `IB Hikvision Terminal` devices
(fingerprint / access-control attendance terminals).

This module deliberately does NOT reinvent employee-ID resolution or
attendance record-keeping — both already exist in this app:

  * Employee <-> device-ID mapping: `Employee.custom_biometric_id`, resolved
    via `_build_employee_map()` / `_resolve_employee()` in
    `instabiz.instabiz.page.ib_biometric_import.ib_biometric_import`
    (imported here, not duplicated). The same "unmatched" reconciliation UI
    (`get_unmatched_employees()` / `save_biometric_id()`) that page already
    ships is reused as-is for the biometric IDs a Hikvision terminal reports
    -- there's nothing Hikvision-specific about that mapping, so it isn't
    re-implemented here.
  * Employee Checkin creation shape (employee/log_type/time/device_id/shift)
    follows the exact same pattern as `attendance_terminal.create_checkin()`
    and the CSV importer's `import_biometric()` -- only `device_id` differs,
    set to `f"hikvision-{terminal.name}"` (not the generic
    `"biometric-import"` string) so these rows are distinguishable in
    reporting from the CSV-import path.

ISAPI background (Hikvision's own documented protocol, used across the whole
device line -- access-control terminals, DVRs, fingerprint/face terminals):

  PUSH (device -> server): the device is configured, via its own web UI
  (typically Configuration -> Network -> Advanced Settings -> HTTP Listening,
  wording varies by firmware/model -- consult the terminal's own manual) or
  via `PUT /ISAPI/Event/notification/httpHosts`, to POST attendance events to
  a URL as they happen. Payload is typically multipart/form-data (a JSON part
  commonly named `event_log`, sometimes alongside a JPEG snapshot part) or
  raw JSON, depending on device config -- `hikvision_webhook()` below handles
  both defensively since there's no physical device here to confirm which
  shape a specific model/firmware actually sends.

  PULL (server -> device): we call the device's own ISAPI search endpoint,
  `POST /ISAPI/AccessControl/AcsEvent?format=json`, with HTTP Digest Auth
  (Hikvision terminals overwhelmingly use Digest, not Basic), paginating via
  `searchResultPosition` until `totalMatches` is exhausted.

  Standard AcsEvent fields used here: `employeeNoString` / `employeeNo` /
  `cardNo` (device-reported identifier -- terminals populate whichever field
  applies to how the person was recognized), `name`, `time` (ISO 8601),
  `attendanceStatus` (only present when the terminal's own Time & Attendance
  mode is switched on -- values like `checkIn`/`checkOut`). `major=5`/`minor=75`
  is the standard "fingerprint/card recognition succeeded" event code range in
  Hikvision's published ISAPI event table, but Hikvision's event code table
  has known model-specific variation -- CONFIRM against the specific
  terminal's own API/event guide before relying on it in production.

UNVERIFIED AGAINST REAL HARDWARE (see final report for the full list): exact
push payload shape for the specific model in use, exact major/minor codes for
that model, Digest vs Basic auth on that firmware, and whether the device's
own clock/timezone lines up with `startTime`/`endTime` windowing here.
"""
import json
import secrets
import uuid

import frappe
import requests
from dateutil import parser as date_parser
from frappe import _
from frappe.utils import add_to_date, get_datetime, now_datetime
from requests.auth import HTTPDigestAuth

from instabiz.instabiz.page.ib_biometric_import.ib_biometric_import import (
	_build_employee_map,
	_resolve_employee,
)

_ROLES = ["HR Manager", "HR User", "System Manager"]

# Standard ISAPI "fingerprint/card verification succeeded" event range.
# Confirm against the specific terminal model's own event-code table --
# Hikvision's major/minor table has model-specific variation.
_ACS_EVENT_MAJOR = 5
_ACS_EVENT_MINOR = 75

_MAX_RESULTS_PER_PAGE = 30
_DEFAULT_LOOKBACK_HOURS = 24

_ATTENDANCE_STATUS_MAP = {
	"checkin": "IN", "checkout": "OUT",
	"breakin": "IN", "breakout": "OUT",
	"overtimein": "IN", "overtimeout": "OUT",
}


# ── Auth / HTTP ─────────────────────────────────────────────────────────────

def _get_digest_session(terminal):
	"""Build an authenticated requests.Session for ISAPI calls to `terminal`
	(an IB Hikvision Terminal doc). Hikvision devices almost universally use
	HTTP Digest Auth, not Basic. Password is never handled as a raw field
	value -- always via Document.get_password(), which decrypts through
	Frappe's own encryption, never returning the plaintext stored value
	directly from the field.
	"""
	password = terminal.get_password("password", raise_exception=False)
	session = requests.Session()
	session.auth = HTTPDigestAuth(terminal.username, password or "")
	return session


def _base_url(terminal):
	return f"http://{terminal.ip_address}:{terminal.port}/ISAPI/AccessControl/AcsEvent?format=json"


# ── Event-time parsing ───────────────────────────────────────────────────────

def _parse_event_time(raw_time):
	"""Parse a Hikvision event's ISO 8601 `time` field into a naive datetime.

	CAVEAT (untested against real hardware): if the device includes a UTC
	offset (e.g. "2026-07-31T09:00:00+05:30"), this converts to the *bench
	server's OS-local* timezone, not Frappe's site "Time Zone" setting.
	Whether that matches the factory floor's actual clock depends entirely on
	how the specific terminal is configured on site -- verify once a real
	device is reachable.
	"""
	dt = date_parser.isoparse(str(raw_time))
	if dt.tzinfo is not None:
		dt = dt.astimezone().replace(tzinfo=None)
	return dt


# ── IN/OUT direction ──────────────────────────────────────────────────────────

def _resolve_log_type(raw_event, employee, dt):
	"""Determine IN vs OUT for a device event.

	Hikvision's own AcsEvent doesn't reliably carry direction for a plain
	fingerprint punch -- major=5/minor=75 just means "recognition succeeded",
	nothing about direction. If the terminal's own Time & Attendance mode is
	enabled it may report `attendanceStatus` (checkIn/checkOut/breakIn/...);
	trust that when present.

	Otherwise, fall back to the exact same alternation rule this app already
	uses elsewhere for Employee Checkin state (see
	`instabiz.overrides.checkin.self_checkin`'s "already checked in/out"
	guard, and `get_my_status`/`get_employees_with_status`'s IN+OUT -> DONE
	grouping): the first punch of the day is IN, and each subsequent punch
	for that employee/day flips the previous log_type. This is deliberately
	reused rather than inventing a separate rule.
	"""
	status = str(raw_event.get("attendanceStatus") or "").strip().lower().replace(" ", "").replace("_", "")
	if status in _ATTENDANCE_STATUS_MAP:
		return _ATTENDANCE_STATUS_MAP[status]

	last = frappe.db.sql(
		"""
		SELECT log_type FROM `tabEmployee Checkin`
		WHERE employee=%s AND DATE(time)=%s AND time < %s
		ORDER BY time DESC LIMIT 1
		""",
		(employee, dt.date(), dt.strftime("%Y-%m-%d %H:%M:%S")),
	)
	if last and last[0][0] == "IN":
		return "OUT"
	return "IN"


# ── Shared resolution + checkin creation (used by BOTH pull and push) ───────

def _process_event(terminal, raw_event, employee_map=None):
	"""Resolve one Hikvision AcsEvent dict to a real Employee and create an
	Employee Checkin. Called by both `pull_terminal_events` and
	`hikvision_webhook` so the resolution/creation logic lives in exactly one
	place.

	`employee_map` is an optional pre-built (by_bio_id, by_name) tuple so a
	pull loop with many pages doesn't rebuild the Employee map per event.

	Returns a dict: {"status": "created"|"duplicate"|"unmatched"|"error", ...}
	"""
	if not isinstance(raw_event, dict):
		return {"status": "error", "reason": "event is not a JSON object"}

	identifier = (
		raw_event.get("employeeNoString")
		or raw_event.get("employeeNo")
		or raw_event.get("cardNo")
	)
	identifier = str(identifier).strip() if identifier not in (None, "") else None

	raw_time = raw_event.get("time") or raw_event.get("dateTime")

	if not identifier or not raw_time:
		return {"status": "error", "reason": "missing employee identifier or time", "raw": raw_event}

	try:
		dt = _parse_event_time(raw_time)
	except Exception:
		return {"status": "error", "reason": f"unparseable time: {raw_time}"}

	by_bio_id, by_name = employee_map or _build_employee_map()
	name_hint = raw_event.get("name")
	employee = _resolve_employee(identifier, name_hint, by_bio_id, by_name)

	if not employee:
		# Not resolvable to a real Employee -- surfaced back to the caller so
		# the scheduled job / webhook response can report "N unmatched
		# events" for someone to reconcile via the existing
		# get_unmatched_employees()/save_biometric_id() flow (same UI the CSV
		# importer already uses; nothing new needed there).
		return {"status": "unmatched", "identifier": identifier, "name_hint": name_hint, "time": str(dt)}

	dt_str = dt.strftime("%Y-%m-%d %H:%M:%S")

	# Duplicate guard: same (employee, exact timestamp) already recorded --
	# same guard shape as import_biometric()'s CSV path.
	if frappe.db.exists("Employee Checkin", {"employee": employee, "time": dt_str}):
		return {"status": "duplicate", "employee": employee, "time": dt_str}

	log_type = _resolve_log_type(raw_event, employee, dt)
	shift = frappe.db.get_value("Employee", employee, "default_shift")

	try:
		doc = frappe.get_doc({
			"doctype": "Employee Checkin",
			"employee": employee,
			"log_type": log_type,
			"time": dt_str,
			"device_id": f"hikvision-{terminal.name}",
			"shift": shift,
		})
		doc.insert(ignore_permissions=True)
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Hikvision checkin insert failed: {terminal.name}")
		return {"status": "error", "reason": str(e), "employee": employee}

	return {"status": "created", "employee": employee, "log_type": log_type, "time": dt_str, "checkin": doc.name}


# ── PULL model (server polls device) ────────────────────────────────────────

@frappe.whitelist()
def pull_terminal_events(terminal_name, since=None):
	"""Poll one terminal's AcsEvent search endpoint for events since `since`
	(or since its own `last_sync`, or the last 24h if never synced), paginate
	via searchResultPosition, resolve+create Employee Checkins for each event,
	and update `terminal.last_sync` on success.

	Returns {"created": int, "unmatched": int, "unmatched_events": [...]}.
	"""
	frappe.only_for(_ROLES)

	terminal = frappe.get_doc("IB Hikvision Terminal", terminal_name)
	if terminal.status != "Active":
		frappe.throw(_("Terminal {0} is not Active").format(terminal_name))

	session = _get_digest_session(terminal)
	url = _base_url(terminal)

	end_time = now_datetime()
	if since:
		start_time = get_datetime(since)
	elif terminal.last_sync:
		start_time = get_datetime(terminal.last_sync)
	else:
		start_time = add_to_date(end_time, hours=-_DEFAULT_LOOKBACK_HOURS)

	# NOTE (unverified against real hardware): formatted without a UTC offset
	# -- Hikvision's search window is generally interpreted against the
	# device's own configured local time. If the device's clock/timezone
	# doesn't match the bench server's, this window will be off; confirm
	# against the actual terminal before relying on this for production sync.
	start_iso = start_time.strftime("%Y-%m-%dT%H:%M:%S")
	end_iso = end_time.strftime("%Y-%m-%dT%H:%M:%S")

	created = 0
	unmatched_events = []
	errors = []
	position = 0

	while True:
		body = {
			"AcsEventCond": {
				"searchID": str(uuid.uuid4()),
				"searchResultPosition": position,
				"maxResults": _MAX_RESULTS_PER_PAGE,
				"major": _ACS_EVENT_MAJOR,
				"minor": _ACS_EVENT_MINOR,
				"startTime": start_iso,
				"endTime": end_iso,
			}
		}

		try:
			resp = session.post(url, json=body, timeout=15)
			resp.raise_for_status()
			data = resp.json()
		except Exception as e:
			frappe.log_error(frappe.get_traceback(), f"Hikvision pull request failed: {terminal_name}")
			errors.append(str(e))
			break

		acs_event = data.get("AcsEvent", {}) or {}
		info_list = acs_event.get("InfoList") or []
		if not info_list:
			break

		employee_map = _build_employee_map()
		for raw_event in info_list:
			result = _process_event(terminal, raw_event, employee_map=employee_map)
			if result["status"] == "created":
				created += 1
			elif result["status"] == "unmatched":
				unmatched_events.append(result)

		total_matches = acs_event.get("totalMatches", 0) or 0
		position += len(info_list)
		if position >= total_matches or len(info_list) < _MAX_RESULTS_PER_PAGE:
			break

	if created:
		frappe.db.commit()

	if not errors:
		frappe.db.set_value("IB Hikvision Terminal", terminal.name, "last_sync", now_datetime(), update_modified=False)
		frappe.db.commit()

	return {
		"created": created,
		"unmatched": len(unmatched_events),
		"unmatched_events": unmatched_events,
		"errors": errors,
	}


@frappe.whitelist()
def run_hikvision_sync():
	"""Scheduler job (also whitelisted for manual triggering, e.g.
	`bench --site frontend execute instabiz.overrides.hikvision.run_hikvision_sync`).

	Loops every Active `IB Hikvision Terminal` with sync_mode Pull or Both and
	pulls its events. Each terminal is isolated (one failing device doesn't
	stop the rest) and logged via frappe.log_error, matching the pattern
	other daily jobs in this app use (e.g. auto_absent.py's per-record
	savepoint isolation).
	"""
	# Scheduler invokes this as Administrator (implicitly has every role), so
	# this gate only affects direct manual/API callers -- previously this was
	# whitelisted with no check at all, unlike pull_terminal_events which it
	# wraps per-terminal.
	frappe.only_for(_ROLES)
	terminals = frappe.get_all(
		"IB Hikvision Terminal",
		filters={"status": "Active", "sync_mode": ["in", ["Pull", "Both"]]},
		pluck="name",
	)

	summary = {}
	for terminal_name in terminals:
		try:
			summary[terminal_name] = pull_terminal_events(terminal_name)
		except Exception:
			frappe.log_error(frappe.get_traceback(), f"Hikvision scheduled sync failed: {terminal_name}")
			summary[terminal_name] = {"error": "sync failed, see Error Log"}

	return summary


# ── PUSH model (device posts to us) ─────────────────────────────────────────

def _extract_webhook_payload():
	"""Hikvision push events arrive as multipart/form-data (a JSON part
	commonly named `event_log`, sometimes alongside a JPEG snapshot part) or
	as raw application/json, depending on how the specific terminal/firmware
	is configured. Parse defensively -- there's no real device here to
	confirm which shape this deployment's model actually sends.

	Returns a parsed dict/list, or None if nothing parseable was found.
	"""
	request = frappe.request

	for key in ("event_log", "eventLog", "Event_Log", "anpr"):
		if request.files and key in request.files:
			try:
				return json.loads(request.files[key].read().decode("utf-8"))
			except Exception:
				pass
		if request.form and key in request.form:
			try:
				return json.loads(request.form[key])
			except Exception:
				pass

	# Some firmwares post the JSON as a file part under an arbitrary field name.
	if request.files:
		for f in request.files.values():
			try:
				return json.loads(f.read().decode("utf-8"))
			except Exception:
				continue

	# Or as a plain form field containing a JSON string.
	if frappe.form_dict:
		for v in frappe.form_dict.values():
			if isinstance(v, str) and v.strip().startswith("{"):
				try:
					return json.loads(v)
				except Exception:
					continue

	# Or a raw JSON body.
	if request.data:
		try:
			return json.loads(request.data.decode("utf-8"))
		except Exception:
			pass

	return None


@frappe.whitelist(allow_guest=True)
def hikvision_webhook(terminal_name=None, secret=None):
	"""Push-model endpoint. Reachable at (default Frappe whitelist URL
	pattern, no additional routing needed):

	    /api/method/instabiz.overrides.hikvision.hikvision_webhook

	Must be allow_guest=True since the device has no Frappe login. Hikvision
	push payloads carry no HMAC/signature of their own, so authenticity here
	rests on two checks: `terminal_name` must match a real, Active
	`IB Hikvision Terminal`, AND `secret` must match that terminal's own
	auto-generated `webhook_secret` -- configure the device's push target URL
	as `.../hikvision_webhook?terminal_name=<name>&secret=<webhook_secret>`
	(or as body fields, whichever the terminal's push config UI allows).
	Before this secret existed, `terminal_name` alone (a guessable, visible
	Frappe docname) was the only gate -- anyone who knew or guessed a
	terminal's name could POST fabricated attendance events for any employee.
	Set a terminal's status to Inactive to immediately cut off a device you
	don't trust, independent of the secret.
	"""
	terminal_name = (
		terminal_name
		or frappe.form_dict.get("terminal_name")
		or frappe.form_dict.get("terminalName")
	)
	secret = secret or frappe.form_dict.get("secret")
	if not terminal_name:
		frappe.local.response.http_status_code = 400
		return {"error": "terminal_name is required"}

	terminal_row = frappe.db.get_value(
		"IB Hikvision Terminal", terminal_name, ["name", "status", "webhook_secret"], as_dict=True
	)
	if not terminal_row:
		frappe.local.response.http_status_code = 404
		return {"error": "unknown terminal"}
	if terminal_row.status != "Active":
		frappe.local.response.http_status_code = 403
		return {"error": "terminal is not Active"}
	if not secret or not secrets.compare_digest(secret, terminal_row.webhook_secret or ""):
		frappe.local.response.http_status_code = 403
		return {"error": "invalid or missing secret"}

	payload = _extract_webhook_payload()
	if payload is None:
		frappe.local.response.http_status_code = 400
		return {"error": "no parseable event payload"}

	events = payload if isinstance(payload, list) else [payload]

	# Hikvision sometimes nests the real event fields under
	# AccessControllerEvent/accessControllerEvent rather than at the top level.
	normalized = []
	for e in events:
		if not isinstance(e, dict):
			continue
		inner = e.get("AccessControllerEvent") or e.get("accessControllerEvent")
		normalized.append(inner if isinstance(inner, dict) else e)

	terminal = frappe.get_doc("IB Hikvision Terminal", terminal_name)
	employee_map = _build_employee_map()

	created = 0
	unmatched_events = []
	for raw_event in normalized:
		result = _process_event(terminal, raw_event, employee_map=employee_map)
		if result["status"] == "created":
			created += 1
		elif result["status"] == "unmatched":
			unmatched_events.append(result)

	if created:
		frappe.db.commit()

	frappe.db.set_value("IB Hikvision Terminal", terminal_name, "last_sync", now_datetime(), update_modified=False)
	frappe.db.commit()

	return {"created": created, "unmatched": len(unmatched_events), "unmatched_events": unmatched_events}
