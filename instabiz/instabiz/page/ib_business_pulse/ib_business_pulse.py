import frappe
from frappe.utils import nowdate, getdate, get_first_day, get_last_day, add_months, flt


def get_context(context):
	context.no_cache = 1


@frappe.whitelist()
def get_pulse_data():
	today = getdate(nowdate())
	month_start = get_first_day(today)
	last_month_start = get_first_day(add_months(today, -1))
	last_month_end = get_last_day(add_months(today, -1))

	# ── Revenue ──────────────────────────────────────────────────────────────
	# TEST-ONLY BASIS CHANGE: Sales Order instead of Sales Invoice — billing
	# isn't live in ERP yet, so SI-based revenue always read 0/wrong. Revert to
	# Sales Invoice once invoicing goes live for real revenue-realization accounting.
	rev_mtd = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(grand_total), 0)
		FROM `tabSales Order`
		WHERE docstatus=1
		AND transaction_date BETWEEN %s AND %s
	""", (month_start, today))[0][0])

	rev_last = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(grand_total), 0)
		FROM `tabSales Order`
		WHERE docstatus=1
		AND transaction_date BETWEEN %s AND %s
	""", (last_month_start, last_month_end))[0][0])

	ar = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(outstanding_amount), 0)
		FROM `tabSales Invoice`
		WHERE docstatus=1 AND outstanding_amount > 0
	""")[0][0])

	# Collection rate = collected / billed for the same 3-month window
	three_months_start = get_first_day(add_months(today, -3))
	total_billed = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(grand_total), 0)
		FROM `tabSales Invoice`
		WHERE docstatus=1 AND is_return=0
		AND posting_date BETWEEN %s AND %s
	""", (three_months_start, today))[0][0])
	ar_3m = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(outstanding_amount), 0)
		FROM `tabSales Invoice`
		WHERE docstatus=1 AND outstanding_amount > 0
		AND posting_date BETWEEN %s AND %s
	""", (three_months_start, today))[0][0])
	collected_3m = max(0.0, total_billed - ar_3m)
	collection_rate = max(0.0, min(100.0, round(collected_3m / total_billed * 100, 1))) if total_billed else 100.0
	rev_score = min(100, round((rev_mtd / rev_last * 80) if rev_last else 50, 0))

	# ── Sales Pipeline ───────────────────────────────────────────────────────
	open_leads = flt(frappe.db.sql("""
		SELECT COUNT(*) FROM `tabLead`
		WHERE status NOT IN ('Converted','Do Not Contact')
	""")[0][0])

	open_quotes = flt(frappe.db.sql("""
		SELECT COUNT(*) FROM `tabQuotation`
		WHERE docstatus=1 AND status NOT IN ('Ordered','Lost','Cancelled','Expired')
	""")[0][0])

	pipeline_score = min(100, int(open_leads * 5 + open_quotes * 10))

	# ── Inventory ────────────────────────────────────────────────────────────
	try:
		total_items = flt(frappe.db.sql(
			"SELECT COUNT(DISTINCT item_code) FROM `tabBin` WHERE actual_qty > 0"
		)[0][0])
		# Same definition as reorder_alert.py / ib_main_dashboard.py — actual_qty at
		# or below the item's reorder level, not just zero-stock-with-reservation.
		low_stock = flt(frappe.db.sql("""
			SELECT COUNT(DISTINCT b.item_code) FROM `tabBin` b
			INNER JOIN `tabItem Reorder` r
				ON r.parent = b.item_code AND r.warehouse = b.warehouse
			WHERE r.warehouse_reorder_level > 0
			  AND b.actual_qty <= r.warehouse_reorder_level
		""")[0][0])
		inv_score = max(0, round((1 - low_stock / total_items) * 100, 0)) if total_items else 80
	except Exception:
		total_items, low_stock, inv_score = 0, 0, 80

	# ── Procurement / Payables ───────────────────────────────────────────────
	try:
		open_po = flt(frappe.db.sql("""
			SELECT COUNT(*) FROM `tabPurchase Order`
			WHERE docstatus=1 AND status NOT IN ('Completed','Cancelled','Closed')
		""")[0][0])
		procurement_score = min(100, max(40, 100 - int(open_po * 3)))
	except Exception:
		open_po, procurement_score = 0, 80

	# ── HR ────────────────────────────────────────────────────────────────────
	try:
		total_emp = flt(frappe.db.sql(
			"SELECT COUNT(*) FROM `tabEmployee` WHERE status='Active'"
		)[0][0])
		present_today = flt(frappe.db.sql("""
			SELECT COUNT(DISTINCT employee) FROM (
				SELECT employee FROM `tabEmployee Checkin`
				WHERE DATE(time) = %s AND log_type = 'IN'
				UNION
				SELECT employee FROM `tabAttendance`
				WHERE attendance_date = %s AND status = 'Present' AND docstatus = 1
			) _combined
		""", (today, today))[0][0])
		hr_score = round((present_today / total_emp * 100), 0) if total_emp else 80
	except Exception:
		total_emp, present_today, hr_score = 0, 0, 80

	# ── Production ───────────────────────────────────────────────────────────
	try:
		wo_active = flt(frappe.db.sql("""
			SELECT COUNT(*) FROM `tabIB Work Order`
			WHERE status NOT IN ('Completed','Cancelled')
		""")[0][0])
		wo_completed = flt(frappe.db.sql("""
			SELECT COUNT(*) FROM `tabIB Work Order`
			WHERE status='Completed'
			AND COALESCE(completed_at, modified) >= %s
		""", (month_start,))[0][0])
		prod_total = wo_active + wo_completed
		prod_score = round((wo_completed / prod_total * 100), 0) if prod_total else 50
	except Exception:
		wo_active, wo_completed, prod_score = 0, 0, 80

	# ── 14-day revenue trend ──────────────────────────────────────────────────
	trend_14 = frappe.db.sql("""
		SELECT
			DATE_FORMAT(posting_date, '%%d %%b') as label,
			posting_date as dt,
			COALESCE(SUM(grand_total), 0) as amount
		FROM `tabSales Invoice`
		WHERE docstatus=1 AND is_return=0
		AND posting_date >= DATE_SUB(%s, INTERVAL 13 DAY)
		GROUP BY dt, label
		ORDER BY dt
	""", (today,), as_dict=True)

	# ── Overall health score (weighted avg) ───────────────────────────────────
	scores = {
		"Revenue":     float(rev_score),
		"Sales":       float(pipeline_score),
		"Inventory":   float(inv_score),
		"Procurement": float(procurement_score),
		"HR":          float(hr_score),
		"Production":  float(prod_score),
	}
	overall = round(sum(scores.values()) / len(scores), 0)

	return {
		"overall": overall,
		"scores": scores,
		"rev_mtd": rev_mtd,
		"rev_last": rev_last,
		"collection_rate": collection_rate,
		"ar": ar,
		"open_leads": int(open_leads),
		"open_quotes": int(open_quotes),
		"total_items": int(total_items),
		"low_stock": int(low_stock),
		"open_po": int(open_po),
		"total_emp": int(total_emp),
		"present_today": int(present_today),
		"wo_active": int(wo_active),
		"wo_completed": int(wo_completed),
		"trend_14": trend_14,
	}
