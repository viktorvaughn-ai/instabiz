"""instabiz.instabiz.page.ib_org_chart.ib_org_chart"""
import frappe


@frappe.whitelist()
def get_org_data(status_filter="Active"):
	if not set(frappe.get_roles()).intersection({"HR Manager", "System Manager"}):
		frappe.throw(frappe._("Access denied"), frappe.PermissionError)

	filters = {"status": status_filter} if status_filter and status_filter != "All" else {}
	rows = frappe.db.get_all(
		"Employee",
		filters=filters,
		fields=[
			"name", "employee_name", "designation", "department",
			"reports_to", "custom_location_state", "status", "gender",
			"date_of_joining", "company",
		],
		order_by="employee_name asc",
	)

	# Attach direct-report count
	counts = frappe.db.sql(
		"SELECT reports_to, COUNT(*) AS cnt FROM `tabEmployee` WHERE reports_to IS NOT NULL AND reports_to != '' GROUP BY reports_to",
		as_dict=True,
	)
	count_map = {r.reports_to: r.cnt for r in counts}
	for r in rows:
		r["direct_reports"] = count_map.get(r.name, 0)

	return rows
