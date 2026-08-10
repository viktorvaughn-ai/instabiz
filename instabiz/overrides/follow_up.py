import frappe
from frappe.utils import today


def run_follow_up_reminders():
	# NOTE: this app tracks lead workflow state on custom_status ("Cold Lead",
	# "Hot Lead", "Contacted", "Qualified", "Proposal", "Negotiation",
	# "Converted", "Customer", "Lost" -- see lead.py set_lead_status VALID set),
	# not on the native ERPNext "status" field. Native status is basically
	# unused in this app: almost every real Lead sits at status="Lead" for its
	# entire life ("Do Not Contact" and "Converted" are the only native values
	# actually reachable). The exclusion list below used to filter on "status"
	# alone with a "Lost" value that field can never hold, so leads marked
	# custom_status="Lost" kept getting "follow-up overdue" reminders forever
	# (confirmed live: 22 real Lost leads with an overdue follow-up date were
	# still matching). Filter on custom_status for the workflow-terminal
	# states and native status only for "Do Not Contact" (a real native value
	# with no custom_status equivalent).
	overdue = frappe.get_all(
		"Lead",
		filters=[
			["custom_next_follow_up_date", "is", "set"],
			["custom_next_follow_up_date", "<", today()],
			["custom_status", "not in", ["Converted", "Customer", "Lost"]],
			["status", "!=", "Do Not Contact"],
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
