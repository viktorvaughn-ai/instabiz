import frappe


@frappe.whitelist()
def get_kb_data():
	"""Return PDF URL and current user's roles for content-aware filtering."""
	user_roles = frappe.get_roles(frappe.session.user)
	return {
		"pdf_url": "/files/instabiz_knowledge_base.pdf",
		"version": "August 2026",
		"roles": user_roles,
		"is_manager": bool(
			{"System Manager", "Sales Manager", "Accounts Manager", "HR Manager", "Purchase Manager"} & set(user_roles)
		),
		"is_system_manager": "System Manager" in user_roles,
	}
