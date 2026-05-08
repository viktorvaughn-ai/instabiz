import frappe
from frappe import _
from frappe.utils import today, add_days


def get_context(context):
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/login?redirect-to=/mydocs"
		raise frappe.Redirect

	employee = frappe.db.get_value(
		"Employee",
		{"user_id": frappe.session.user, "status": "Active"},
		["name", "employee_name", "designation", "department"],
		as_dict=True,
	)

	if not employee:
		context.error = _("No active Employee record linked to your account. Contact HR.")
		return

	docs = frappe.get_all(
		"Employee Document",
		filters={"parent": employee.name, "parenttype": "Employee"},
		fields=["document_type", "document_number", "document_file", "expiry_date"],
		order_by="document_type asc",
	)

	warn_date = add_days(today(), 30)
	for d in docs:
		if d.expiry_date:
			if str(d.expiry_date) < today():
				d["expiry_status"] = "expired"
			elif str(d.expiry_date) <= warn_date:
				d["expiry_status"] = "expiring"
			else:
				d["expiry_status"] = "ok"
		else:
			d["expiry_status"] = "none"

	context.employee      = employee.name
	context.employee_name = employee.employee_name
	context.designation   = employee.designation or ""
	context.department    = employee.department or ""
	context.docs          = docs
	context.no_cache      = 1
	context.title         = "My Documents"
