import frappe
from frappe.utils import today


def run_follow_up_reminders():
	overdue = frappe.get_all(
		"Lead",
		filters=[
			["custom_next_follow_up_date", "is", "set"],
			["custom_next_follow_up_date", "<", today()],
			["status", "not in", ["Converted", "Do Not Contact", "Lost"]],
		],
		fields=["name", "lead_name", "lead_owner", "custom_next_follow_up_date", "custom_follow_up_note"],
		order_by="custom_next_follow_up_date asc",
	)
	if not overdue:
		return

	for lead in overdue:
		owner = lead.lead_owner
		if not owner:
			continue
		_notify(owner, lead)

	frappe.db.commit()


def _notify(user: str, lead: dict) -> None:
	marker = f"[ib-followup-{lead.name}-{lead.custom_next_follow_up_date}]"
	if frappe.db.exists("Notification Log", {"for_user": user, "subject": ["like", f"%{marker}%"]}):
		return
	body = f"Follow-up overdue: {lead.lead_name or lead.name} (due {lead.custom_next_follow_up_date})"
	if lead.custom_follow_up_note:
		note_part = f" — {lead.custom_follow_up_note}"
		max_body = 140 - len(marker) - 1
		if len(body) + len(note_part) <= max_body:
			body += note_part
	max_body = 140 - len(marker) - 1
	subject = f"{marker} {body[:max_body]}"
	frappe.get_doc(
		{
			"doctype": "Notification Log",
			"for_user": user,
			"from_user": "Administrator",
			"subject": subject,
			"type": "Alert",
			"document_type": "Lead",
			"document_name": lead.name,
		}
	).insert(ignore_permissions=True)
