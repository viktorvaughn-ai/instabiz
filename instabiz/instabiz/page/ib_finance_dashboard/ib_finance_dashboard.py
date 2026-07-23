import frappe
from frappe.utils import nowdate, getdate, get_first_day, get_last_day, add_months, flt


def get_context(context):
	context.no_cache = 1


def _get_fy_start(today):
	try:
		from erpnext.accounts.utils import get_fiscal_year
		return getdate(get_fiscal_year(today)[1])
	except Exception:
		# Fallback: April 1 of current or previous year
		d = getdate(today)
		return getdate(f"{d.year if d.month >= 4 else d.year - 1}-04-01")


@frappe.whitelist()
def get_finance_data():
	# Page nav restricts to these roles but the RPC had no internal check —
	# any authenticated user could pull company-wide cash/bank/AR/AP/GST data.
	frappe.only_for(["System Manager", "Accounts Manager", "Accounts User", "Sales Manager"])
	today = getdate(nowdate())
	month_start = get_first_day(today)
	last_start = get_first_day(add_months(today, -1))
	last_end = get_last_day(add_months(today, -1))
	fy_start = _get_fy_start(today)

	# ── Revenue ──────────────────────────────────────────────────────────────
	rev_mtd = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(grand_total),0) FROM `tabSales Invoice`
		WHERE docstatus=1 AND is_return=0 AND posting_date BETWEEN %s AND %s
	""", (month_start, today))[0][0])

	rev_last = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(grand_total),0) FROM `tabSales Invoice`
		WHERE docstatus=1 AND is_return=0 AND posting_date BETWEEN %s AND %s
	""", (last_start, last_end))[0][0])

	rev_ytd = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(grand_total),0) FROM `tabSales Invoice`
		WHERE docstatus=1 AND is_return=0 AND posting_date BETWEEN %s AND %s
	""", (fy_start, today))[0][0])

	# ── Expenses (Purchase Invoices) ─────────────────────────────────────────
	exp_mtd = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(grand_total),0) FROM `tabPurchase Invoice`
		WHERE docstatus=1 AND is_return=0 AND posting_date BETWEEN %s AND %s
	""", (month_start, today))[0][0])

	exp_last = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(grand_total),0) FROM `tabPurchase Invoice`
		WHERE docstatus=1 AND is_return=0 AND posting_date BETWEEN %s AND %s
	""", (last_start, last_end))[0][0])

	# ── Outstanding AR / AP ───────────────────────────────────────────────────
	ar = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(outstanding_amount),0) FROM `tabSales Invoice`
		WHERE docstatus=1 AND outstanding_amount > 0
	""")[0][0])

	ap = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(outstanding_amount),0) FROM `tabPurchase Invoice`
		WHERE docstatus=1 AND outstanding_amount > 0
	""")[0][0])

	# ── Cash & Bank balances ──────────────────────────────────────────────────
	company = frappe.db.get_default("company") or frappe.db.sql(
		"SELECT name FROM `tabCompany` LIMIT 1"
	)[0][0]

	cash_bank = frappe.db.sql("""
		SELECT a.name, a.account_type,
			COALESCE(SUM(gl.debit - gl.credit), 0) as balance
		FROM `tabAccount` a
		LEFT JOIN `tabGL Entry` gl ON gl.account = a.name AND gl.is_cancelled = 0
		WHERE a.account_type IN ('Cash','Bank') AND a.company = %s
		GROUP BY a.name, a.account_type
		ORDER BY balance DESC
	""", (company,), as_dict=True)

	total_cash_bank = sum(flt(r.balance) for r in cash_bank)

	# ── GST summary ───────────────────────────────────────────────────────────
	gst_collected = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(t.tax_amount),0)
		FROM `tabSales Taxes and Charges` t
		JOIN `tabSales Invoice` si ON si.name = t.parent
		WHERE si.docstatus=1 AND si.posting_date BETWEEN %s AND %s
		AND (t.account_head LIKE '%%GST%%' OR t.account_head LIKE '%%gst%%'
			OR t.account_head LIKE '%%CGST%%' OR t.account_head LIKE '%%IGST%%'
			OR t.account_head LIKE '%%SGST%%')
	""", (month_start, today))[0][0])

	gst_paid = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(t.tax_amount),0)
		FROM `tabPurchase Taxes and Charges` t
		JOIN `tabPurchase Invoice` pi ON pi.name = t.parent
		WHERE pi.docstatus=1 AND pi.posting_date BETWEEN %s AND %s
		AND (t.account_head LIKE '%%GST%%' OR t.account_head LIKE '%%gst%%'
			OR t.account_head LIKE '%%CGST%%' OR t.account_head LIKE '%%IGST%%'
			OR t.account_head LIKE '%%SGST%%')
	""", (month_start, today))[0][0])

	gst_net = gst_collected - gst_paid

	# ── Monthly P&L trend (6 months) ─────────────────────────────────────────
	pl_trend = frappe.db.sql("""
		SELECT DATE_FORMAT(posting_date,'%%b %%Y') as label,
			   DATE_FORMAT(posting_date,'%%Y-%%m') as ym,
			   COALESCE(SUM(grand_total),0) as revenue
		FROM `tabSales Invoice`
		WHERE docstatus=1 AND is_return=0
		AND posting_date >= DATE_SUB(%s, INTERVAL 6 MONTH)
		GROUP BY ym, label ORDER BY ym
	""", (today,), as_dict=True)

	exp_trend = frappe.db.sql("""
		SELECT DATE_FORMAT(posting_date,'%%Y-%%m') as ym,
			   COALESCE(SUM(grand_total),0) as expenses
		FROM `tabPurchase Invoice`
		WHERE docstatus=1 AND is_return=0
		AND posting_date >= DATE_SUB(%s, INTERVAL 6 MONTH)
		GROUP BY ym ORDER BY ym
	""", (today,), as_dict=True)

	exp_map = {r.ym: flt(r.expenses) for r in exp_trend}
	for r in pl_trend:
		r.expenses = exp_map.get(r.ym, 0)
		r.profit = flt(r.revenue) - r.expenses

	# ── Overdue AR ────────────────────────────────────────────────────────────
	overdue = frappe.db.sql("""
		SELECT name, customer_name, posting_date, due_date,
			   outstanding_amount, grand_total,
			   DATEDIFF(%s, due_date) as days_overdue
		FROM `tabSales Invoice`
		WHERE docstatus=1 AND outstanding_amount > 0
		AND due_date < %s
		ORDER BY outstanding_amount DESC
		LIMIT 15
	""", (today, today), as_dict=True)

	# ── Top expense vendors ───────────────────────────────────────────────────
	top_vendors = frappe.db.sql("""
		SELECT supplier_name as label, COALESCE(SUM(grand_total),0) as amount
		FROM `tabPurchase Invoice`
		WHERE docstatus=1 AND is_return=0 AND posting_date BETWEEN %s AND %s
		GROUP BY supplier_name ORDER BY amount DESC LIMIT 8
	""", (month_start, today), as_dict=True)

	# ── Pending payments ──────────────────────────────────────────────────────
	pending_pe = frappe.db.sql("""
		SELECT COUNT(*) as cnt, COALESCE(SUM(paid_amount),0) as total
		FROM `tabPayment Entry`
		WHERE docstatus=0
	""", as_dict=True)[0]

	return {
		"rev_mtd": rev_mtd,
		"rev_last": rev_last,
		"rev_delta": round((rev_mtd - rev_last) / rev_last * 100, 1) if rev_last else 0,
		"rev_ytd": rev_ytd,
		"exp_mtd": exp_mtd,
		"exp_last": exp_last,
		"exp_delta": round((exp_mtd - exp_last) / exp_last * 100, 1) if exp_last else 0,
		"ar": ar,
		"ap": ap,
		"total_cash_bank": total_cash_bank,
		"cash_bank_accounts": cash_bank,
		"gst_collected": gst_collected,
		"gst_paid": gst_paid,
		"gst_net": gst_net,
		"pl_trend": pl_trend,
		"overdue": overdue,
		"top_vendors": top_vendors,
		"pending_pe_count": int(pending_pe.cnt or 0),
		"pending_pe_total": flt(pending_pe.total),
		"gross_profit": rev_mtd - exp_mtd,
		"gross_margin": round((rev_mtd - exp_mtd) / rev_mtd * 100, 1) if rev_mtd else 0,
	}
