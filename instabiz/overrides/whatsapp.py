import re
import base64
import time

import frappe
import requests
from frappe.utils import add_days, now, today


# ── Config ────────────────────────────────────────────────────────────────────

def _base_url():
	return frappe.conf.get("openwa_url", "http://localhost:2785").rstrip("/")


def _headers():
	return {
		"X-API-Key": frappe.conf.get("openwa_api_key", ""),
		"Content-Type": "application/json",
	}


# Print format to use when attaching a PDF per doctype
_PRINT_FORMAT = {
	"Quotation":     "",
	"Sales Order":   "",
	"Delivery Note": "IB Packing List",
	"Sales Invoice": "IB GST Tax Invoice",
}


# ── Internal helpers ──────────────────────────────────────────────────────────

def _format_phone(mobile):
	"""Return WA chatId: {country_code}{number}@c.us.
	If number already contains country code (11+ digits), use as-is.
	Bare 10-digit numbers get India prefix 91.
	"""
	num = re.sub(r"[^0-9]", "", mobile or "")
	if num.startswith("0"):
		num = num[1:]
	if len(num) == 10:
		num = "91" + num
	return f"{num}@c.us"


def _get_session_for_user(user):
	row = frappe.db.get_value(
		"IB WA Session",
		{"user": user},
		["session_id", "status"],
		as_dict=True,
	)
	if not row:
		frappe.throw(
			"No WhatsApp session configured for your account. "
			"Ask your manager to create one in <b>IB WA Session</b>.",
			title="WA Session Missing",
		)
	if row.status != "Connected":
		frappe.throw(
			f"Your WhatsApp session is not connected (status: <b>{row.status}</b>). "
			"Open <b>IB WA Session</b> and scan the QR code to reconnect.",
			title="WA Session Disconnected",
		)
	return row.session_id


def _render_message(template_message, customer, sender_user):
	cust = frappe.get_doc("Customer", customer)
	sender = frappe.get_doc("User", sender_user)
	last_order_row = frappe.db.sql(
		"SELECT MAX(transaction_date) FROM `tabSales Order` WHERE customer=%s AND docstatus=1",
		customer,
	)
	last_order = str(last_order_row[0][0]) if last_order_row and last_order_row[0][0] else "N/A"
	return template_message.format(
		customer=cust.customer_name,
		name=sender.full_name or sender_user,
		territory=cust.territory or "",
		contact=cust.custom_contact_person_name or cust.customer_name,
		last_order=last_order,
	)


def _resolve_session_uuid(session_name):
	"""Resolve user-defined session name → OpenWA UUID."""
	try:
		resp = requests.get(
			f"{_base_url()}/api/sessions",
			params={"name": session_name},
			headers=_headers(),
			timeout=10,
		)
		sessions = resp.json()
		if sessions and isinstance(sessions, list):
			return sessions[0].get("id") or session_name
	except Exception:
		pass
	return session_name


def _send_text(session_id, chat_id, text):
	resp = requests.post(
		f"{_base_url()}/api/sessions/{session_id}/messages/send-text",
		json={"chatId": chat_id, "text": text},
		headers=_headers(),
		timeout=15,
	)
	resp.raise_for_status()
	return resp.json()


def _send_document(session_id, chat_id, doctype, docname, caption=""):
	print_format = _PRINT_FORMAT.get(doctype, "")
	pdf_bytes = frappe.get_print(doctype, docname, print_format=print_format, as_pdf=True)
	b64 = base64.b64encode(pdf_bytes).decode("utf-8")
	resp = requests.post(
		f"{_base_url()}/api/sessions/{session_id}/messages/send-document",
		json={
			"chatId": chat_id,
			"base64": b64,
			"mimetype": "application/pdf",
			"filename": f"{docname}.pdf",
			"caption": caption,
		},
		headers=_headers(),
		timeout=30,
	)
	resp.raise_for_status()
	return resp.json()


def _log(customer, phone, template_name, message, sent_by, status, error_msg="", ref_doctype="", ref_docname=""):
	log = frappe.new_doc("IB WA Log")
	log.customer = customer
	log.phone = phone
	log.template = template_name
	log.message = message
	log.sent_by = sent_by
	log.sent_at = now()
	log.status = status
	log.error_message = error_msg
	log.ref_doctype = ref_doctype or ""
	log.ref_docname = ref_docname or ""
	log.insert(ignore_permissions=True)


# ── Whitelisted: send from UI ─────────────────────────────────────────────────

@frappe.whitelist()
def send_whatsapp(customer, template_name, ref_doctype=None, ref_docname=None, message=None):
	user = frappe.session.user
	mobile = frappe.db.get_value("Customer", customer, "custom_primary_contact_person") \
		or frappe.db.get_value("Customer", customer, "mobile_no")
	if not mobile:
		frappe.throw(
			f"No mobile number on record for <b>{customer}</b>. "
			"Set Primary Contact Person phone on the Customer.",
			title="No Mobile Number",
		)

	session_name = _get_session_for_user(user)
	session_uuid = _resolve_session_uuid(session_name)
	chat_id = _format_phone(mobile)

	template = frappe.get_doc("IB WA Template", template_name)
	message = message or _render_message(template.message, customer, user)

	status = "Sent"
	error_msg = ""
	try:
		_send_text(session_uuid, chat_id, message)
		if ref_doctype and ref_docname:
			_send_document(session_uuid, chat_id, ref_doctype, ref_docname, caption=message[:200])
	except Exception as e:
		status = "Failed"
		error_msg = str(e)
		frappe.log_error(str(e), "IB WA Send Failed")

	_log(customer, mobile, template_name, message, user, status, error_msg, ref_doctype or "", ref_docname or "")
	frappe.db.commit()

	if status == "Failed":
		frappe.throw(f"WhatsApp send failed: {error_msg}", title="WA Send Failed")

	return {"status": "ok"}


# ── Whitelisted: session management ──────────────────────────────────────────

@frappe.whitelist()
def get_session_qr(session_id):
	"""Create session in OpenWA if needed, then return QR base64."""
	url = _base_url()
	hdrs = _headers()

	# Step 1: create session (ignore 409 if already exists)
	uuid = session_id
	try:
		cr = requests.post(f"{url}/api/sessions", json={"name": session_id}, headers=hdrs, timeout=10)
		if cr.status_code in (200, 201):
			uuid = cr.json().get("id") or session_id
		else:
			uuid = _resolve_session_uuid(session_id)
	except Exception:
		uuid = _resolve_session_uuid(session_id)

	# Step 2: start session (ignore 400 if already started or already connected)
	try:
		requests.post(f"{url}/api/sessions/{uuid}/start", headers=hdrs, timeout=15)
	except Exception:
		pass

	# Step 3: wait briefly for QR to generate, then fetch
	time.sleep(3)
	try:
		resp = requests.get(f"{url}/api/sessions/{uuid}/qr", headers=hdrs, timeout=10)
		resp.raise_for_status()
		data = resp.json()
		qr = data.get("qrCode") or data.get("qr") or data.get("base64") or data.get("data") or ""
		return {"qr": qr}
	except Exception as e:
		frappe.throw(str(e), title="QR Fetch Failed")


@frappe.whitelist()
def sync_session_status(session_id):
	"""Poll OpenWA for session status and return mapped value."""
	try:
		uuid = _resolve_session_uuid(session_id)
		resp = requests.get(
			f"{_base_url()}/api/sessions/{uuid}",
			headers=_headers(),
			timeout=10,
		)
		data = resp.json()
		raw = (data.get("status") or "").upper()
		status_map = {
			"READY": "Connected",
			"CONNECTED": "Connected",
			"DISCONNECTED": "Disconnected",
			"FAILED": "Disconnected",
			"QR_READY": "QR Pending",
			"QR": "QR Pending",
			"INITIALIZING": "QR Pending",
			"AUTHENTICATING": "QR Pending",
			"CREATED": "QR Pending",
			"STARTING": "QR Pending",
			"SCAN_QR_CODE": "QR Pending",
		}
		return {"status": status_map.get(raw, "Disconnected")}
	except Exception as e:
		return {"status": "Disconnected", "error": str(e)}


# ── Scheduler: 30-day dormant WA blast ───────────────────────────────────────

def run_wa_dormant_blast():
	"""Daily: send WA re-engagement to customers with no SO in 30+ days, via their assigned rep's session."""
	cutoff = add_days(today(), -30)

	customers = frappe.db.sql(
		"""
		SELECT c.name AS customer,
		       COALESCE(NULLIF(c.custom_primary_contact_person, ''), c.mobile_no) AS mobile_no
		FROM `tabCustomer` c
		LEFT JOIN `tabSales Order` so ON so.customer = c.name AND so.docstatus = 1
		WHERE c.disabled = 0
		  AND (
		        (c.custom_primary_contact_person IS NOT NULL AND c.custom_primary_contact_person != '')
		     OR (c.mobile_no IS NOT NULL AND c.mobile_no != '')
		  )
		GROUP BY c.name, mobile_no
		HAVING MAX(so.transaction_date) IS NULL OR MAX(so.transaction_date) < %(cutoff)s
		""",
		{"cutoff": cutoff},
		as_dict=True,
	)

	template_name = frappe.db.get_value(
		"IB WA Template",
		{"is_active": 1},
		"name",
		order_by="display_order asc",
	)
	if not template_name:
		frappe.logger().warning("IB WA Dormant Blast: no active template found, skipping")
		return

	template = frappe.get_doc("IB WA Template", template_name)
	sent = 0

	for row in customers:
		try:
			# Find rep with a connected session who has this customer assigned
			assignment = frappe.db.get_value(
				"IB Customer Assignment",
				{"customer": row.customer, "status": ["in", ["Pending", "Contacted"]]},
				"assigned_to",
				order_by="assigned_date desc",
			)
			if not assignment:
				continue

			session_id = frappe.db.get_value(
				"IB WA Session",
				{"user": assignment, "status": "Connected"},
				"session_id",
			)
			if not session_id:
				continue
			session_uuid = _resolve_session_uuid(session_id)

			# 30-day dedup
			already = frappe.db.count(
				"IB WA Log",
				{"customer": row.customer, "status": "Sent", "sent_at": [">=", cutoff]},
			)
			if already:
				continue

			chat_id = _format_phone(row.mobile_no)
			message = _render_message(template.message, row.customer, assignment)

			_send_text(session_uuid, chat_id, message)
			_log(row.customer, row.mobile_no, template_name, message, assignment, "Sent")
			sent += 1

		except Exception as e:
			frappe.log_error(str(e), f"IB WA Dormant Blast: {row.customer}")
			_log(row.customer, row.mobile_no, template_name, "", "Administrator", "Failed", str(e))

		frappe.db.commit()

	frappe.logger().info(f"IB WA Dormant Blast: sent {sent} messages")
