import frappe
from frappe import _
from frappe.model.document import Document

_ALLOWED_ROLES = {
	"System Manager", "Sales Manager", "Accounts Manager",
	"Factory Management", "Purchase Manager", "HR Manager", "Stock Manager",
}


class IBKPISnapshot(Document):
	pass


@frappe.whitelist()
def get_kpi_snapshots(domain=None, metric_name=None, from_period=None, to_period=None):
	if not (_ALLOWED_ROLES & set(frappe.get_roles(frappe.session.user))):
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	filters = {}
	if domain:
		filters["domain"] = domain
	if metric_name:
		filters["metric_name"] = metric_name
	if from_period and to_period:
		filters["period"] = ["between", [from_period, to_period]]
	elif from_period:
		filters["period"] = [">=", from_period]
	elif to_period:
		filters["period"] = ["<=", to_period]

	return frappe.get_all(
		"IB KPI Snapshot",
		filters=filters,
		fields=[
			"name", "domain", "metric_name", "metric_value", "period",
			"comparison_value", "pct_change",
		],
		order_by="period desc",
		limit_page_length=1000,
	)
