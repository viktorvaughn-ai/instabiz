import json

import frappe
from frappe.utils import add_to_date, now_datetime

_SEEN_KEY = "ib_broadcast_seen"


def _get_seen(user):
	raw = frappe.db.get_default(_SEEN_KEY, parent=user)
	try:
		return set(json.loads(raw)) if raw else set()
	except Exception:
		return set()


def _set_seen(user, seen_set):
	arr = list(seen_set)[-200:]
	frappe.db.set_default(_SEEN_KEY, json.dumps(arr), parent=user)


@frappe.whitelist()
def mark_broadcast_seen(name):
	user = frappe.session.user
	seen = _get_seen(user)
	if name not in seen:
		seen.add(name)
		_set_seen(user, seen)


@frappe.whitelist()
def send_broadcast(title, message, image=None, target="All", target_users=None):
	frappe.only_for("System Manager")

	users = []
	if target == "Specific Users" and target_users:
		users = json.loads(target_users) if isinstance(target_users, str) else target_users

	doc = frappe.get_doc({
		"doctype": "IB Broadcast Log",
		"title": title,
		"message": message,
		"image": image or None,
		"target": target,
		"target_users": json.dumps(users) if users else None,
		"sent_by": frappe.session.user,
		"sent_at": now_datetime(),
	})
	doc.insert(ignore_permissions=True)

	payload = {
		"name": doc.name,
		"title": title,
		"message": message,
		"image": image or None,
		"sent_by": frappe.session.user,
		"sent_at": str(doc.sent_at).split(".")[0],
	}

	if target == "All":
		frappe.publish_realtime("ib_broadcast", payload)
	else:
		for user in users:
			frappe.publish_realtime("ib_broadcast", payload, user=user)

	return doc.name


@frappe.whitelist()
def get_recent_broadcasts(hours=48):
	"""Return unseen broadcasts targeting the current user from the last N hours."""
	user = frappe.session.user
	since = add_to_date(now_datetime(), hours=-int(hours))

	broadcasts = frappe.get_all(
		"IB Broadcast Log",
		filters={"creation": [">", since]},
		fields=["name", "title", "message", "image", "target", "target_users", "sent_by", "sent_at"],
		order_by="creation asc",
	)

	seen = _get_seen(user)
	result = []
	for b in broadcasts:
		if b["name"] in seen:
			continue
		if b["target"] == "Specific Users":
			try:
				users = json.loads(b["target_users"] or "[]")
			except Exception:
				users = []
			if user not in users:
				continue
		result.append(b)
	return result


@frappe.whitelist()
def get_broadcast_history(limit=30):
	frappe.only_for("System Manager")
	return frappe.get_all(
		"IB Broadcast Log",
		fields=["name", "title", "message", "image", "target", "target_users", "sent_by", "sent_at"],
		order_by="creation desc",
		limit=limit,
	)


@frappe.whitelist()
def get_system_users():
	"""Return all active System Users for the target picker."""
	frappe.only_for("System Manager")
	return frappe.get_all(
		"User",
		filters={"enabled": 1, "user_type": "System User", "name": ["!=", "Administrator"]},
		fields=["name", "full_name"],
		order_by="full_name asc",
	)
