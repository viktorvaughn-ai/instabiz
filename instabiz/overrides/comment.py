"""instabiz.overrides.comment — notify doc owner when a comment is posted on Q or SO."""
import frappe


WATCHED_DOCTYPES = {"Quotation", "Sales Order"}


def notify_owner_on_comment(doc, method=None):
	"""
	Fires on Comment.after_insert.
	Sends an in-app notification + email to the document owner (custom_sales_person_user)
	whenever a real user comment is added to a Quotation or Sales Order.
	Skips if the commenter IS the owner.
	"""
	if doc.comment_type != "Comment":
		return
	if doc.reference_doctype not in WATCHED_DOCTYPES:
		return

	owner_user = frappe.db.get_value(
		doc.reference_doctype,
		doc.reference_name,
		"custom_sales_person_user",
	)

	if not owner_user:
		return

	commenter = frappe.session.user
	if commenter == owner_user:
		return

	commenter_name = frappe.db.get_value("User", commenter, "full_name") or commenter
	subject = f"New comment on {doc.reference_doctype} {doc.reference_name}"
	message = (
		f"<b>{commenter_name}</b> commented on "
		f"<b>{doc.reference_doctype} {doc.reference_name}</b>:<br><br>"
		f"{doc.content}"
	)

	# ── In-app notification (bell icon + realtime event) ─────────────────────
	# Frappe's NotificationLog.after_insert automatically publishes a built-in
	# "notification" realtime event to the owner — no manual publish needed.
	frappe.get_doc({
		"doctype":       "Notification Log",
		"subject":       subject,
		"email_content": message,
		"document_type": doc.reference_doctype,
		"document_name": doc.reference_name,
		"for_user":      owner_user,
		"from_user":     commenter,
		"type":          "Alert",
	}).insert(ignore_permissions=True)
