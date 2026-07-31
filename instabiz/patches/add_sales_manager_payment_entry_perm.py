import frappe

FULL_PERM = {
	"permlevel": 0,
	"read": 1,
	"write": 1,
	"create": 1,
	"submit": 1,
	"cancel": 1,
	"amend": 1,
	"delete": 1,
	"print": 1,
	"email": 1,
	"report": 1,
	"export": 1,
}


def execute():
	"""Grant Sales Manager the same Payment Entry rights as Accounts User.

	Sales Manager previously had zero access to Payment Entry (no docperm at
	all), blocking them from recording customer payments against their own
	Sales Orders. Mirrors Accounts User's perm level exactly rather than
	inventing a narrower one.

	Frappe replaces ALL standard (doctype-json) perms with Custom DocPerm rows
	the moment a single Custom DocPerm exists for a doctype — so Accounts
	User/Accounts Manager must be explicitly re-created here too, or adding
	only the Sales Manager row silently locks Accounts out of Payment Entry.
	"""
	for role in ("Sales Manager", "Accounts User", "Accounts Manager"):
		if frappe.db.exists("Custom DocPerm", {"parent": "Payment Entry", "role": role}):
			continue
		doc = frappe.get_doc({
			"doctype": "Custom DocPerm",
			"parent": "Payment Entry",
			"parenttype": "DocType",
			"parentfield": "permissions",
			"role": role,
			**FULL_PERM,
		})
		doc.insert(ignore_permissions=True)
	frappe.clear_cache(doctype="Payment Entry")
