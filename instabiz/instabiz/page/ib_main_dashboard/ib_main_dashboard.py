import frappe
from frappe.utils import nowdate, getdate, get_first_day, get_last_day, add_months, flt


def get_context(context):
	context.no_cache = 1


@frappe.whitelist()
def get_dashboard_data():
	today = getdate(nowdate())
	month_start = get_first_day(today)
	last_month_start = get_first_day(add_months(today, -1))
	last_month_end = get_last_day(add_months(today, -1))

	# ── Revenue MTD ──────────────────────────────────────────────────────────
	rev_mtd = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(grand_total), 0)
		FROM `tabSales Invoice`
		WHERE docstatus=1 AND is_return=0
		AND posting_date BETWEEN %s AND %s
	""", (month_start, today))[0][0])

	rev_last = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(grand_total), 0)
		FROM `tabSales Invoice`
		WHERE docstatus=1 AND is_return=0
		AND posting_date BETWEEN %s AND %s
	""", (last_month_start, last_month_end))[0][0])

	rev_delta = round(((rev_mtd - rev_last) / rev_last * 100), 1) if rev_last else 0

	# ── Outstanding AR ───────────────────────────────────────────────────────
	ar = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(outstanding_amount), 0)
		FROM `tabSales Invoice`
		WHERE docstatus=1 AND outstanding_amount > 0
	""")[0][0])

	# ── Open Quotations ──────────────────────────────────────────────────────
	quotes = flt(frappe.db.sql("""
		SELECT COUNT(*) FROM `tabQuotation`
		WHERE docstatus=1 AND status NOT IN ('Ordered','Lost','Cancelled','Expired')
	""")[0][0])

	# ── Open Sales Orders ────────────────────────────────────────────────────
	open_so = flt(frappe.db.sql("""
		SELECT COUNT(*) FROM `tabSales Order`
		WHERE docstatus=1 AND status NOT IN ('Completed','Cancelled','Closed')
	""")[0][0])

	# ── Pending Delivery Notes ───────────────────────────────────────────────
	pending_dn = flt(frappe.db.sql("""
		SELECT COUNT(*) FROM `tabDelivery Note`
		WHERE docstatus=0
	""")[0][0])

	# ── Low stock (bins where actual_qty <= 0) ───────────────────────────────
	try:
		low_stock = flt(frappe.db.sql("""
			SELECT COUNT(DISTINCT item_code) FROM `tabBin`
			WHERE actual_qty <= 0 AND reserved_qty > 0
		""")[0][0])
	except Exception:
		low_stock = 0

	# ── 6-month revenue trend ────────────────────────────────────────────────
	trend = frappe.db.sql("""
		SELECT
			DATE_FORMAT(posting_date, '%%b %%Y') as label,
			DATE_FORMAT(posting_date, '%%Y-%%m') as ym,
			COALESCE(SUM(grand_total), 0) as amount,
			COALESCE(SUM(base_grand_total), 0) as base_amount
		FROM `tabSales Invoice`
		WHERE docstatus=1 AND is_return=0
		AND posting_date >= DATE_SUB(%s, INTERVAL 6 MONTH)
		GROUP BY ym, label
		ORDER BY ym
	""", (today,), as_dict=True)

	# ── Top 5 customers this month ───────────────────────────────────────────
	top_customers = frappe.db.sql("""
		SELECT customer_name, COALESCE(SUM(grand_total), 0) as total
		FROM `tabSales Invoice`
		WHERE docstatus=1 AND is_return=0
		AND posting_date BETWEEN %s AND %s
		GROUP BY customer_name
		ORDER BY total DESC
		LIMIT 5
	""", (month_start, today), as_dict=True)

	# ── Recent invoices — scoped to user unless privileged ───────────────────────
	roles = frappe.get_roles(frappe.session.user)
	privileged = any(r in roles for r in ("System Manager", "Sales Manager", "Accounts Manager", "Accounts User"))
	si_cond = "" if privileged else f"AND custom_sales_person_user = {frappe.db.escape(frappe.session.user)}"
	recent_si = frappe.db.sql(f"""
		SELECT name, customer_name, posting_date, due_date, grand_total, outstanding_amount, status
		FROM `tabSales Invoice`
		WHERE docstatus=1 {si_cond}
		ORDER BY posting_date DESC, creation DESC
		LIMIT 8
	""", as_dict=True)

	return {
		"rev_mtd": rev_mtd,
		"rev_last": rev_last,
		"rev_delta": rev_delta,
		"ar": ar,
		"quotes": int(quotes),
		"open_so": int(open_so),
		"pending_dn": int(pending_dn),
		"low_stock": int(low_stock),
		"trend": trend,
		"top_customers": top_customers,
		"recent_si": recent_si,
	}
