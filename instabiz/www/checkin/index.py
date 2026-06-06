import frappe
from frappe import _

def get_context(context):
	# Redirect guests to login
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/login?redirect-to=/checkin"
		raise frappe.Redirect

# Resolve employee from logged-in user
	employee = frappe.db.get_value(
		"Employee",
		{"user_id": frappe.session.user, "status": "Active"},
		["name", "employee_name"],
		as_dict=True,
	)

	if not employee:
		context.error = _("No active Employee record is linked to your account. Contact HR.")
		return

	context.employee      = employee.name
	context.employee_name = employee.employee_name
	context.no_cache      = 1
