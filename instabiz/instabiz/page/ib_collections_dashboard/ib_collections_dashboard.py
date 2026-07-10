import frappe
from frappe.utils import nowdate, getdate, flt, cint


def get_context(context):
	context.no_cache = 1


def _is_privileged(user):
	privileged = {"System Manager", "Sales Manager", "Accounts User", "Accounts Manager"}
	return bool(privileged & set(frappe.get_roles(user)))


@frappe.whitelist()
def get_collections_data(search=None, filter_sp=None, overdue_only=False):
	user = frappe.session.user
	today = getdate(nowdate())
	privileged = _is_privileged(user)
	overdue_only = cint(overdue_only)

	conditions = ["si.docstatus=1", "si.outstanding_amount > 0", "si.is_return=0"]
	params = []

	if not privileged:
		conditions.append("si.custom_sales_person_user = %s")
		params.append(user)
	elif filter_sp:
		conditions.append("si.custom_sales_person_user = %s")
		params.append(filter_sp)

	if search:
		conditions.append("(si.customer_name LIKE %s OR si.name LIKE %s)")
		params += [f"%{search}%", f"%{search}%"]

	if overdue_only:
		conditions.append("si.due_date < %s")
		params.append(str(today))

	where = " AND ".join(conditions)

	# Customer-level summary
	customers = frappe.db.sql(f"""
		SELECT
			si.custom_sales_person_user as sp_user,
			COALESCE(u.full_name, si.custom_sales_person_user) as sp_name,
			si.customer,
			si.customer_name,
			COUNT(si.name) as invoice_count,
			COALESCE(SUM(si.outstanding_amount), 0) as outstanding,
			COALESCE(SUM(si.grand_total), 0) as billed,
			MIN(si.due_date) as earliest_due,
			DATEDIFF(%s, MIN(si.due_date)) as days_overdue
		FROM `tabSales Invoice` si
		LEFT JOIN `tabUser` u ON u.name = si.custom_sales_person_user
		WHERE {where}
		GROUP BY si.customer, si.customer_name, si.custom_sales_person_user, u.full_name
		ORDER BY outstanding DESC
		LIMIT 200
	""", [str(today)] + params, as_dict=True)

	customer_names = [c.customer for c in customers]
	invoices = []
	advance_map = {}
	collected_map = {}

	if customer_names:
		placeholders = ",".join(["%s"] * len(customer_names))

		# Outstanding invoices (for drill-down)
		inv_conds = ["si.docstatus=1", "si.outstanding_amount > 0", "si.is_return=0",
					 f"si.customer IN ({placeholders})"]
		inv_params = list(customer_names)
		if not privileged and not filter_sp:
			inv_conds.append("si.custom_sales_person_user = %s")
			inv_params.append(user)
		elif filter_sp:
			inv_conds.append("si.custom_sales_person_user = %s")
			inv_params.append(filter_sp)
		inv_where = " AND ".join(inv_conds)
		invoices = frappe.db.sql(f"""
			SELECT si.name, si.customer, si.posting_date, si.due_date,
				   si.grand_total, si.outstanding_amount,
				   DATEDIFF(%s, si.due_date) as days_overdue
			FROM `tabSales Invoice` si
			WHERE {inv_where}
			ORDER BY si.customer, si.due_date ASC
			LIMIT 1000
		""", [str(today)] + inv_params, as_dict=True)

		# Advances (unlinked PEs) — batch query, not correlated subquery
		advances = frappe.db.sql(f"""
			SELECT pe.party as customer, SUM(pe.unallocated_amount) as advance
			FROM `tabPayment Entry` pe
			WHERE pe.party_type='Customer' AND pe.payment_type='Receive'
			  AND pe.docstatus=1 AND pe.unallocated_amount > 0
			  AND pe.party IN ({placeholders})
			GROUP BY pe.party
		""", customer_names, as_dict=True)
		advance_map = {a.customer: flt(a.advance) for a in advances}

		# Collections in last 90 days — batch query
		cutoff = frappe.utils.add_days(str(today), -90)
		collected = frappe.db.sql(f"""
			SELECT pe.party as customer, SUM(pe.paid_amount) as collected_90d
			FROM `tabPayment Entry` pe
			WHERE pe.party_type='Customer' AND pe.payment_type='Receive'
			  AND pe.docstatus=1
			  AND pe.posting_date >= %s
			  AND pe.party IN ({placeholders})
			GROUP BY pe.party
		""", [str(cutoff)] + list(customer_names), as_dict=True)
		collected_map = {c.customer: flt(c.collected_90d) for c in collected}

	for c in customers:
		c.advance = advance_map.get(c.customer, 0)
		c.net_outstanding = max(0, flt(c.outstanding) - flt(c.advance))
		c.collected_90d = collected_map.get(c.customer, 0)

	# KPI totals
	total_outstanding = sum(flt(c.outstanding) for c in customers)
	total_advance = sum(flt(c.advance) for c in customers)
	overdue_count = sum(1 for c in customers if flt(c.days_overdue or 0) > 0)
	collected_90d_total = sum(flt(c.collected_90d) for c in customers)

	return {
		"customers": customers,
		"invoices": invoices,
		"kpis": {
			"total_outstanding": total_outstanding,
			"total_advance": total_advance,
			"net_outstanding": total_outstanding - total_advance,
			"customer_count": len(customers),
			"overdue_count": overdue_count,
			"collected_90d": collected_90d_total,
		},
		"privileged": privileged,
	}


@frappe.whitelist()
def get_sales_users():
	if not _is_privileged(frappe.session.user):
		frappe.throw("Not permitted")
	users = frappe.db.sql("""
		SELECT DISTINCT si.custom_sales_person_user as user,
			   COALESCE(u.full_name, si.custom_sales_person_user) as full_name
		FROM `tabSales Invoice` si
		LEFT JOIN `tabUser` u ON u.name = si.custom_sales_person_user
		WHERE si.docstatus=1 AND si.outstanding_amount > 0
		  AND si.custom_sales_person_user IS NOT NULL AND si.custom_sales_person_user != ''
		ORDER BY full_name
	""", as_dict=True)
	return users
