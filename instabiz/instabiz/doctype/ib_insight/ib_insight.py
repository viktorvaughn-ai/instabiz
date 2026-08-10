import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime


class IBInsight(Document):
	pass


@frappe.whitelist()
def acknowledge_insight(name):
	"""Mark an IB Insight Acknowledged. Permission-checked: only the
	insight's own owner_role holders or System Manager can acknowledge."""
	doc = frappe.get_doc("IB Insight", name)
	user_roles = set(frappe.get_roles(frappe.session.user))
	if "System Manager" not in user_roles and doc.owner_role not in user_roles:
		frappe.throw(_("Not permitted to acknowledge this insight"), frappe.PermissionError)

	frappe.db.set_value(
		"IB Insight",
		name,
		{
			"status": "Acknowledged",
			"acknowledged_by": frappe.session.user,
			"acknowledged_at": now_datetime(),
		},
	)
	return {"status": "Acknowledged", "acknowledged_by": frappe.session.user}


@frappe.whitelist()
def get_insights(domain=None, severity=None, status=None, owner_role=None):
	"""Role-scoped insight list. A non-System-Manager user only sees insights
	where owner_role is one of their own roles (unless they explicitly asked
	for a specific owner_role they hold — System Manager can ask for any)."""
	user_roles = set(frappe.get_roles(frappe.session.user))
	privileged = "System Manager" in user_roles

	filters = {}
	if domain:
		filters["domain"] = domain
	if severity:
		filters["severity"] = severity
	if status:
		filters["status"] = status

	if owner_role:
		if not privileged and owner_role not in user_roles:
			frappe.throw(_("Not permitted to view insights for this role"), frappe.PermissionError)
		filters["owner_role"] = owner_role
	elif not privileged:
		filters["owner_role"] = ["in", list(user_roles) or ["__none__"]]

	return frappe.get_all(
		"IB Insight",
		filters=filters,
		fields=[
			"name", "title", "domain", "owner_role", "severity", "status",
			"narrative", "source_doctype", "source_name", "root_cause_tag",
			"acknowledged_by", "acknowledged_at", "escalated_to_role",
			"escalated_at", "creation",
		],
		order_by="creation desc",
		limit_page_length=200,
	)
