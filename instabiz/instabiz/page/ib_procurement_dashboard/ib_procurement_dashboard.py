import frappe
from frappe.utils import nowdate, getdate, get_first_day, get_last_day, add_months, flt

from instabiz.overrides.billing_mode import is_dev_billing_mode, purchase_doctype


def get_context(context):
	context.no_cache = 1


@frappe.whitelist()
def get_procurement_data():
	# Page nav restricts to these roles but the RPC had no internal check —
	# any authenticated user could pull company-wide PO/AP/vendor spend data.
	frappe.only_for(["System Manager", "Accounts Manager", "Purchase Manager", "Purchase User", "Factory Management"])
	today = getdate(nowdate())
	month_start = get_first_day(today)
	last_start = get_first_day(add_months(today, -1))
	last_end = get_last_day(add_months(today, -1))

	# ── Open POs ──────────────────────────────────────────────────────────────
	open_po_count = flt(frappe.db.sql("""
		SELECT COUNT(*) FROM `tabPurchase Order`
		WHERE docstatus=1 AND status NOT IN ('Completed','Cancelled','Closed')
	""")[0][0])

	open_po_value = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(grand_total),0) FROM `tabPurchase Order`
		WHERE docstatus=1 AND status NOT IN ('Completed','Cancelled','Closed')
	""")[0][0])

	# ── Pending GRNs (submitted PO not fully received) ────────────────────────
	pending_grn = flt(frappe.db.sql("""
		SELECT COUNT(*) FROM `tabPurchase Order`
		WHERE docstatus=1 AND status IN ('To Receive and Bill','To Receive')
	""")[0][0])

	# Basis controlled by instabiz.overrides.billing_mode — dev mode reads
	# Purchase Order "spend" (billing isn't live yet, PI-based spend always
	# reads empty); prod mode reads real Purchase Invoice. Purchase Order has
	# no is_return and no posting_date (falls back to transaction_date).
	# open_po_value/open_po_list above are genuinely PO-based already and are
	# left untouched.
	dev_mode = is_dev_billing_mode()
	spend_doctype = purchase_doctype()
	spend_date_field = "transaction_date" if dev_mode else "posting_date"
	spend_return_cond = "" if dev_mode else "AND is_return=0"

	# ── Spend MTD ─────────────────────────────────────────────────────────────
	spend_mtd = flt(frappe.db.sql(f"""
		SELECT COALESCE(SUM(grand_total),0) FROM `tab{spend_doctype}`
		WHERE docstatus=1 {spend_return_cond} AND {spend_date_field} BETWEEN %s AND %s
	""", (month_start, today))[0][0])

	spend_last = flt(frappe.db.sql(f"""
		SELECT COALESCE(SUM(grand_total),0) FROM `tab{spend_doctype}`
		WHERE docstatus=1 {spend_return_cond} AND {spend_date_field} BETWEEN %s AND %s
	""", (last_start, last_end))[0][0])

	# ── Overdue AP ────────────────────────────────────────────────────────────
	overdue_ap = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(outstanding_amount),0) FROM `tabPurchase Invoice`
		WHERE docstatus=1 AND outstanding_amount > 0 AND due_date < %s
	""", (today,))[0][0])

	# ── Vendor-wise spend MTD ─────────────────────────────────────────────────
	by_vendor = frappe.db.sql(f"""
		SELECT supplier_name as label, COALESCE(SUM(grand_total),0) as amount,
			   COUNT(*) as invoices
		FROM `tab{spend_doctype}`
		WHERE docstatus=1 {spend_return_cond} AND {spend_date_field} BETWEEN %s AND %s
		GROUP BY supplier_name ORDER BY amount DESC LIMIT 10
	""", (month_start, today), as_dict=True)

	# ── Open PO list ──────────────────────────────────────────────────────────
	open_po_list = frappe.db.sql("""
		SELECT name, supplier, supplier_name, transaction_date,
			   schedule_date, grand_total, status,
			   DATEDIFF(%s, schedule_date) as days_overdue
		FROM `tabPurchase Order`
		WHERE docstatus=1 AND status NOT IN ('Completed','Cancelled','Closed')
		ORDER BY schedule_date ASC
		LIMIT 20
	""", (today,), as_dict=True)

	# ── 6-month spend trend ───────────────────────────────────────────────────
	spend_trend = frappe.db.sql(f"""
		SELECT DATE_FORMAT({spend_date_field},'%%b %%Y') as label,
			   DATE_FORMAT({spend_date_field},'%%Y-%%m') as ym,
			   COALESCE(SUM(grand_total),0) as amount
		FROM `tab{spend_doctype}`
		WHERE docstatus=1 {spend_return_cond}
		AND {spend_date_field} >= DATE_SUB(%s, INTERVAL 6 MONTH)
		GROUP BY ym, label ORDER BY ym
	""", (today,), as_dict=True)

	# ── Top purchased items ───────────────────────────────────────────────────
	top_items = frappe.db.sql("""
		SELECT i.item_name as label, COALESCE(SUM(i.amount),0) as amount,
			   COALESCE(SUM(i.qty),0) as qty, i.uom
		FROM `tabPurchase Invoice Item` i
		JOIN `tabPurchase Invoice` pi ON pi.name=i.parent
		WHERE pi.docstatus=1 AND pi.is_return=0
		AND pi.posting_date BETWEEN %s AND %s
		GROUP BY i.item_code, i.item_name, i.uom
		ORDER BY amount DESC LIMIT 8
	""", (month_start, today), as_dict=True)

	# ── Pending PI (unsubmitted bills) ────────────────────────────────────────
	pending_pi = flt(frappe.db.sql(
		"SELECT COUNT(*) FROM `tabPurchase Invoice` WHERE docstatus=0"
	)[0][0])

	return {
		"open_po_count": int(open_po_count),
		"open_po_value": open_po_value,
		"pending_grn": int(pending_grn),
		"spend_mtd": spend_mtd,
		"spend_last": spend_last,
		"spend_delta": round((spend_mtd - spend_last) / spend_last * 100, 1) if spend_last else 0,
		"overdue_ap": overdue_ap,
		"pending_pi": int(pending_pi),
		"by_vendor": by_vendor,
		"open_po_list": open_po_list,
		"spend_trend": spend_trend,
		"top_items": top_items,
	}
