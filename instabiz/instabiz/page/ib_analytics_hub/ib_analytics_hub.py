import frappe
from frappe.utils import nowdate, getdate, get_first_day, add_months, flt

from instabiz.overrides.billing_mode import (
	is_dev_billing_mode, sales_doctype, sales_outstanding_expr,
	purchase_doctype, purchase_outstanding_expr,
)


def get_context(context):
	context.no_cache = 1


@frappe.whitelist()
def get_analytics_data(tab="sales", period="monthly"):
	# "me" is self-scoped (frappe.session.user) and safe for anyone. Every other
	# tab returns company-wide sales/finance/hr/production data — the Page itself
	# restricts navigation to these roles, but the RPC was previously callable
	# directly by any authenticated user with no internal check (same class of
	# bug already fixed in ib_hrms_dashboard.get_hrms_data).
	if tab != "me":
		frappe.only_for(["System Manager", "Sales Manager", "Accounts Manager", "Factory Management"])
	today = getdate(nowdate())

	# `since`/date_fmt/group_fmt drive the trend chart's window+bucketing.
	# `period_start`/`prev_start`/`prev_end`/`period_label` drive the headline
	# KPI cards — previously those were hardcoded to calendar-month-to-date
	# regardless of which period tab was selected, so clicking Daily/Weekly
	# only ever changed the trend chart underneath while every number on the
	# page stayed exactly the same (confirmed: "Revenue MTD" was still MTD
	# after clicking Daily). Both now derive from the same period selector.
	if period == "daily":
		since = frappe.utils.add_days(today, -30)
		date_fmt = "%%d %%b"
		group_fmt = "%%Y-%%m-%%d"
		period_start = today
		prev_start = prev_end = frappe.utils.add_days(today, -1)
		period_label = "Today"
	elif period == "weekly":
		since = frappe.utils.add_days(today, -84)
		date_fmt = "Week %%U"
		group_fmt = "%%Y-%%U"
		period_start = frappe.utils.add_days(today, -today.weekday())  # Monday this week
		prev_start = frappe.utils.add_days(period_start, -7)
		prev_end = frappe.utils.add_days(period_start, -1)
		period_label = "WTD"
	else:
		since = get_first_day(add_months(today, -11))
		date_fmt = "%%b %%Y"
		group_fmt = "%%Y-%%m"
		period_start = get_first_day(today)
		prev_start = get_first_day(add_months(today, -1))
		prev_end = frappe.utils.get_last_day(add_months(today, -1))
		period_label = "MTD"

	pw = {
		"period_start": period_start, "period_end": today,
		"prev_start": prev_start, "prev_end": prev_end,
		"period_label": period_label,
	}

	if tab == "sales":
		return _sales_data(today, since, date_fmt, group_fmt, pw)
	elif tab == "inventory":
		return _inventory_data(today, since, date_fmt, group_fmt)
	elif tab == "production":
		return _production_data(today, since, date_fmt, group_fmt, pw)
	elif tab == "hr":
		return _hr_data(today, since, date_fmt, group_fmt, pw)
	elif tab == "finance":
		return _finance_data(today, since, date_fmt, group_fmt, pw)
	elif tab == "me":
		return _my_work_data(frappe.session.user, today, since, date_fmt, group_fmt, pw)
	return {}


def _sales_data(today, since, date_fmt, group_fmt, pw):
	# Basis controlled by instabiz.overrides.billing_mode — was 100%
	# hardcoded to Sales Invoice, so this whole tab read zero (billing isn't
	# live in ERP yet).
	period_start, period_end = pw["period_start"], pw["period_end"]
	prev_start, prev_end = pw["prev_start"], pw["prev_end"]
	period_label = pw["period_label"]

	dev_mode = is_dev_billing_mode()
	sales_dt = sales_doctype()
	sales_date = "transaction_date" if dev_mode else "posting_date"
	# Only 'Cancelled' excluded, not 'Closed' — CustomSalesOrder.STATUS_MAP maps
	# DB status 'Closed' to user-facing label 'Confirmed' (a real completed sale).
	sales_cond = "AND t.status != 'Cancelled'" if dev_mode else "AND t.is_return=0"
	outstanding_expr = sales_outstanding_expr("t")
	item_dt = f"{sales_dt} Item"

	rev_period = flt(frappe.db.sql(f"""
		SELECT COALESCE(SUM(grand_total),0) FROM `tab{sales_dt}` t
		WHERE docstatus=1 {sales_cond} AND {sales_date} BETWEEN %s AND %s
	""", (period_start, period_end))[0][0])

	rev_prev = flt(frappe.db.sql(f"""
		SELECT COALESCE(SUM(grand_total),0) FROM `tab{sales_dt}` t
		WHERE docstatus=1 {sales_cond} AND {sales_date} BETWEEN %s AND %s
	""", (prev_start, prev_end))[0][0])

	invoice_count = flt(frappe.db.sql(f"""
		SELECT COUNT(*) FROM `tab{sales_dt}` t
		WHERE docstatus=1 {sales_cond} AND {sales_date} BETWEEN %s AND %s
	""", (period_start, period_end))[0][0])

	avg_order = round(rev_period / invoice_count, 2) if invoice_count else 0

	ar = flt(frappe.db.sql(f"""
		SELECT COALESCE(SUM({outstanding_expr}),0)
		FROM `tab{sales_dt}` t WHERE docstatus=1 {sales_cond}
	""")[0][0])

	trend = frappe.db.sql(f"""
		SELECT DATE_FORMAT({sales_date}, '{date_fmt}') as label,
			   DATE_FORMAT({sales_date}, '{group_fmt}') as grp,
			   COALESCE(SUM(grand_total),0) as amount,
			   COUNT(*) as count
		FROM `tab{sales_dt}` t
		WHERE docstatus=1 {sales_cond} AND {sales_date} >= %s
		GROUP BY grp, label ORDER BY grp
	""", (since,), as_dict=True)

	by_customer = frappe.db.sql(f"""
		SELECT customer_name as label, COALESCE(SUM(grand_total),0) as amount
		FROM `tab{sales_dt}` t
		WHERE docstatus=1 {sales_cond} AND {sales_date} BETWEEN %s AND %s
		GROUP BY customer_name ORDER BY amount DESC LIMIT 10
	""", (period_start, period_end), as_dict=True)

	try:
		by_item = frappe.db.sql(f"""
			SELECT i.item_group as label, COALESCE(SUM(i.amount),0) as amount
			FROM `tab{item_dt}` i
			JOIN `tab{sales_dt}` t ON t.name=i.parent
			WHERE t.docstatus=1 {sales_cond} AND t.{sales_date} BETWEEN %s AND %s
			GROUP BY i.item_group ORDER BY amount DESC LIMIT 8
		""", (period_start, period_end), as_dict=True)
	except Exception:
		by_item = []

	return {
		"kpis": [
			{"label": f"Revenue {period_label}", "value": rev_period, "type": "currency",
			 "delta": round((rev_period - rev_prev) / rev_prev * 100, 1) if rev_prev else 0},
			{"label": f"Invoices {period_label}", "value": int(invoice_count), "type": "count", "delta": 0},
			{"label": "Avg Invoice", "value": avg_order, "type": "currency", "delta": 0},
			{"label": "Outstanding AR", "value": ar, "type": "currency", "delta": 0},
		],
		"trend": trend,
		"breakdown": by_customer,
		"secondary": by_item,
	}


def _inventory_data(today, since, date_fmt, group_fmt):
	try:
		total_items = flt(frappe.db.sql(
			"SELECT COUNT(DISTINCT item_code) FROM `tabBin`"
		)[0][0])
		in_stock = flt(frappe.db.sql(
			"SELECT COUNT(DISTINCT item_code) FROM `tabBin` WHERE actual_qty > 0"
		)[0][0])
		negative = flt(frappe.db.sql(
			"SELECT COUNT(DISTINCT item_code) FROM `tabBin` WHERE actual_qty < 0"
		)[0][0])
		stock_val = flt(frappe.db.sql("""
			SELECT COALESCE(SUM(stock_value), 0)
			FROM `tabBin` WHERE actual_qty > 0
		""")[0][0])
	except Exception:
		stock_val = 0
		total_items = in_stock = negative = 0

	by_warehouse = frappe.db.sql("""
		SELECT warehouse as label, COALESCE(SUM(actual_qty), 0) as amount
		FROM `tabBin`
		WHERE actual_qty > 0
		GROUP BY warehouse ORDER BY amount DESC LIMIT 10
	""", as_dict=True)

	by_item_group = []
	try:
		by_item_group = frappe.db.sql("""
			SELECT i.item_group as label, COUNT(DISTINCT b.item_code) as amount
			FROM `tabBin` b JOIN `tabItem` i ON i.name=b.item_code
			WHERE b.actual_qty > 0
			GROUP BY i.item_group ORDER BY amount DESC LIMIT 8
		""", as_dict=True)
	except Exception:
		pass

	recent_movements = frappe.db.sql("""
		SELECT item_code, warehouse, qty_after_transaction as qty,
			   voucher_type, voucher_no, posting_date
		FROM `tabStock Ledger Entry`
		WHERE is_cancelled=0
		ORDER BY posting_date DESC, creation DESC
		LIMIT 10
	""", as_dict=True)

	# Goods received (inbound SLE) trend
	try:
		inbound_trend = frappe.db.sql(f"""
			SELECT DATE_FORMAT(posting_date, '{date_fmt}') as label,
				   DATE_FORMAT(posting_date, '{group_fmt}') as grp,
				   COALESCE(SUM(actual_qty), 0) as amount
			FROM `tabStock Ledger Entry`
			WHERE is_cancelled=0 AND actual_qty > 0 AND posting_date >= %s
			GROUP BY grp, label ORDER BY grp
		""", (since,), as_dict=True)
	except Exception:
		inbound_trend = []

	return {
		"kpis": [
			{"label": "Total SKUs", "value": int(total_items), "type": "count", "delta": 0},
			{"label": "In Stock", "value": int(in_stock), "type": "count", "delta": 0},
			{"label": "Negative Stock", "value": int(negative), "type": "count", "delta": 0},
			{"label": "Stock Value", "value": stock_val, "type": "currency", "delta": 0},
		],
		"trend": inbound_trend,
		"breakdown": by_warehouse,
		"secondary": by_item_group,
		"recent": recent_movements,
	}


def _production_data(today, since, date_fmt, group_fmt, pw):
	period_start = pw["period_start"]
	period_label = pw["period_label"]

	try:
		wo_active = flt(frappe.db.sql("""
			SELECT COUNT(*) FROM `tabIB Work Order`
			WHERE status NOT IN ('Completed','Cancelled')
		""")[0][0])
		wo_completed = flt(frappe.db.sql("""
			SELECT COUNT(*) FROM `tabIB Work Order`
			WHERE status='Completed' AND COALESCE(completed_at, modified) >= %s
		""", (period_start,))[0][0])
		wo_total = flt(frappe.db.sql(
			"SELECT COUNT(*) FROM `tabIB Work Order`"
		)[0][0])
		machines_active = flt(frappe.db.sql(
			"SELECT COUNT(*) FROM `tabIB Machine` WHERE status='Active'"
		)[0][0])

		by_status = frappe.db.sql("""
			SELECT status as label, COUNT(*) as amount
			FROM `tabIB Work Order`
			GROUP BY status ORDER BY amount DESC
		""", as_dict=True)

		by_stage = frappe.db.sql("""
			SELECT stage as label, COUNT(*) as amount
			FROM `tabIB Work Order`
			WHERE status NOT IN ('Completed','Cancelled') AND stage IS NOT NULL AND stage != ''
			GROUP BY stage ORDER BY amount DESC LIMIT 10
		""", as_dict=True)
	except Exception:
		wo_active = wo_completed = wo_total = machines_active = 0
		by_status = []
		by_stage = []

	# WO completion trend from IB Work Order
	try:
		wo_trend = frappe.db.sql(f"""
			SELECT DATE_FORMAT(COALESCE(completed_at, modified), '{date_fmt}') as label,
				   DATE_FORMAT(COALESCE(completed_at, modified), '{group_fmt}') as grp,
				   COUNT(*) as amount
			FROM `tabIB Work Order`
			WHERE status='Completed' AND COALESCE(completed_at, modified) >= %s
			GROUP BY grp, label ORDER BY grp
		""", (since,), as_dict=True)
	except Exception:
		wo_trend = []

	# Avg wastage from completed WOs (wastage_qty / target_qty)
	try:
		avg_wastage = flt(frappe.db.sql("""
			SELECT COALESCE(AVG(wastage_qty / NULLIF(target_qty, 0)) * 100, 0)
			FROM `tabIB Work Order`
			WHERE status='Completed' AND COALESCE(completed_at, modified) >= %s
		""", (period_start,))[0][0])
	except Exception:
		avg_wastage = 0

	return {
		"kpis": [
			{"label": "Active WOs", "value": int(wo_active), "type": "count", "delta": 0},
			{"label": f"Completed {period_label}", "value": int(wo_completed), "type": "count", "delta": 0},
			{"label": "Machines Active", "value": int(machines_active), "type": "count", "delta": 0},
			{"label": "Avg Wastage %", "value": round(avg_wastage, 2), "type": "pct", "delta": 0},
		],
		"trend": wo_trend,
		"breakdown": by_stage if by_stage else by_status,
		"secondary": by_status,
	}


def _hr_data(today, since, date_fmt, group_fmt, pw):
	# HR's headline KPIs (Active Employees, Present Today, Pending Leaves) are
	# point-in-time snapshots and Payroll MTD is inherently monthly — none of
	# them have a meaningful daily/weekly equivalent, so `pw` is intentionally
	# unused here; the period selector still drives this tab's trend chart.
	try:
		total_emp = flt(frappe.db.sql(
			"SELECT COUNT(*) FROM `tabEmployee` WHERE status='Active'"
		)[0][0])
	except Exception:
		total_emp = 0

	try:
		# Count employees who checked in via terminal (Employee Checkin) OR have a
		# submitted Present attendance record. UNION deduplicates employees processed both ways.
		present_today = flt(frappe.db.sql("""
			SELECT COUNT(DISTINCT employee) FROM (
				SELECT employee FROM `tabEmployee Checkin`
				WHERE DATE(time) = %s AND log_type = 'IN'
				UNION
				SELECT employee FROM `tabAttendance`
				WHERE attendance_date = %s AND status = 'Present' AND docstatus = 1
			) _combined
		""", (today, today))[0][0])
		absent_today = flt(frappe.db.sql(
			"SELECT COUNT(*) FROM `tabAttendance` WHERE attendance_date=%s AND status='Absent' AND docstatus=1",
			(today,)
		)[0][0])
	except Exception:
		present_today = absent_today = 0

	try:
		pending_leaves = flt(frappe.db.sql(
			"SELECT COUNT(*) FROM `tabLeave Application` WHERE status='Open' AND docstatus=1"
		)[0][0])
	except Exception:
		pending_leaves = 0

	try:
		attendance_trend = frappe.db.sql(f"""
			SELECT DATE_FORMAT(attendance_date, '{date_fmt}') as label,
				   DATE_FORMAT(attendance_date, '{group_fmt}') as grp,
				   SUM(CASE WHEN status='Present' THEN 1 ELSE 0 END) as amount
			FROM `tabAttendance`
			WHERE attendance_date >= %s AND docstatus=1
			GROUP BY grp, label ORDER BY grp
		""", (since,), as_dict=True)
	except Exception:
		attendance_trend = []

	try:
		by_dept = frappe.db.sql("""
			SELECT department as label, COUNT(*) as amount
			FROM `tabEmployee` WHERE status='Active' AND department IS NOT NULL
			GROUP BY department ORDER BY amount DESC LIMIT 10
		""", as_dict=True)
	except Exception:
		by_dept = []

	try:
		# Payroll is inherently monthly (slips are generated once/month) — always
		# calendar-MTD regardless of the daily/weekly/monthly period selector,
		# since a daily/weekly window would just read 0 for most of the month.
		_pr = frappe.db.sql("""
			SELECT
				COALESCE(SUM(CASE WHEN docstatus=1 THEN net_pay ELSE 0 END), 0) AS sub_pay,
				COALESCE(SUM(CASE WHEN docstatus=0 THEN net_pay ELSE 0 END), 0) AS draft_pay
			FROM `tabSalary Slip`
			WHERE docstatus < 2 AND start_date >= %s
		""", (get_first_day(today),))[0]
		payroll_mtd = flt(_pr[0]) or flt(_pr[1])
	except Exception:
		payroll_mtd = 0

	return {
		"kpis": [
			{"label": "Active Employees", "value": int(total_emp), "type": "count", "delta": 0},
			{"label": "Present Today", "value": int(present_today), "type": "count", "delta": 0},
			{"label": "Pending Leaves", "value": int(pending_leaves), "type": "count", "delta": 0},
			{"label": "Payroll MTD", "value": payroll_mtd, "type": "currency", "delta": 0},
		],
		"trend": attendance_trend,
		"breakdown": by_dept,
		"secondary": [],
	}


def _detect_user_type(user):
	"""Resolve which 'My Work' view to show based on user's highest-priority role."""
	roles = set(frappe.get_roles(user))
	if "HR Manager" in roles or "HR User" in roles:
		return "hr"
	if "Factory Management" in roles:
		return "production"
	if "Accounts Manager" in roles or "Accounts User" in roles:
		return "finance"
	# Sales User, Sales Manager, Purchase Manager, System Manager → sales view
	return "sales"


def _my_work_data(user, today, since, date_fmt, group_fmt, pw):
	month_start = get_first_day(today)
	user_type = _detect_user_type(user)

	if user_type == "hr":
		return _my_work_hr(user, today, since, date_fmt, group_fmt, month_start, pw)
	if user_type == "production":
		return _my_work_production(user, today, since, date_fmt, group_fmt, month_start, pw)
	if user_type == "finance":
		return _my_work_finance(user, today, since, date_fmt, group_fmt, month_start, pw)
	return _my_work_sales(user, today, since, date_fmt, group_fmt, month_start, pw)


# ── Sales user view ────────────────────────────────────────────────────────────

def _my_work_sales(user, today, since, date_fmt, group_fmt, month_start, pw):
	period_start, period_end = pw["period_start"], pw["period_end"]
	period_label = pw["period_label"]
	# ── Core billing metrics ───────────────────────────────────────────────────
	# Basis controlled by instabiz.overrides.billing_mode — dev mode reads
	# Sales Order (billing isn't live in ERP yet, so SI-based revenue always
	# read 0/wrong); prod mode reads Sales Invoice for real revenue-realization
	# accounting. "collected" always stays Sales Invoice/Payment Entry — it's a
	# real money-received concept with no Sales Order equivalent.
	dev_mode = is_dev_billing_mode()
	sales_dt = sales_doctype()
	sales_date = "transaction_date" if dev_mode else "posting_date"
	# Only 'Cancelled' excluded, not 'Closed' — CustomSalesOrder.STATUS_MAP maps
	# DB status 'Closed' to user-facing label 'Confirmed' (a real completed sale).
	sales_cond = "AND t.status != 'Cancelled'" if dev_mode else "AND t.is_return=0"
	outstanding_expr = sales_outstanding_expr("t")

	# Period-scoped (drives the headline KPI cards — daily/weekly/monthly).
	billing_row = frappe.db.sql(f"""
		SELECT
			COALESCE(SUM(grand_total), 0)               as rev,
			COUNT(*)                                     as invoice_count
		FROM `tab{sales_dt}` t
		WHERE docstatus=1 {sales_cond}
		AND {sales_date} BETWEEN %s AND %s
		AND custom_sales_person_user = %s
	""", (period_start, period_end, user), as_dict=True)[0]

	rev_period    = flt(billing_row.rev)
	invoice_count  = int(billing_row.invoice_count or 0)
	avg_invoice    = round(rev_period / invoice_count, 2) if invoice_count else 0

	# Always-calendar-month (target attainment + incentive slabs are a strictly
	# monthly concept — see ib_sales_incentives.py — so these stay MTD
	# regardless of the daily/weekly/monthly period selector above).
	rev_mtd = flt(frappe.db.sql(f"""
		SELECT COALESCE(SUM(grand_total), 0) FROM `tab{sales_dt}` t
		WHERE docstatus=1 {sales_cond}
		AND {sales_date} BETWEEN %s AND %s
		AND custom_sales_person_user = %s
	""", (month_start, today, user))[0][0])

	collected = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(grand_total - outstanding_amount), 0)
		FROM `tabSales Invoice`
		WHERE docstatus=1 AND is_return=0
		AND posting_date BETWEEN %s AND %s
		AND custom_sales_person_user = %s
	""", (month_start, today, user))[0][0])

	# ── Orders (period-scoped) ─────────────────────────────────────────────────
	orders_mtd = int(flt(frappe.db.sql("""
		SELECT COUNT(*) FROM `tabSales Order`
		WHERE docstatus=1 AND transaction_date BETWEEN %s AND %s
		AND custom_sales_person_user = %s
	""", (period_start, period_end, user))[0][0]))

	# ── Advance collections (period-scoped; PEs linked to this user's SOs) ────
	# Sum per-reference-row allocated_amount, not the PE parent's paid_amount —
	# a PE split across multiple SOs would otherwise count its full paid_amount
	# once per joined reference row (same fan-out fix already applied in
	# payment_entry.py's _update_so_advance()).
	advance_collected = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(per.allocated_amount), 0)
		FROM `tabPayment Entry` pe
		JOIN `tabPayment Entry Reference` per ON per.parent = pe.name
		JOIN `tabSales Order` so ON so.name = per.reference_name
		WHERE pe.docstatus=1 AND pe.payment_type = 'Receive'
		AND per.reference_doctype = 'Sales Order'
		AND pe.posting_date BETWEEN %s AND %s
		AND so.custom_sales_person_user = %s
	""", (period_start, period_end, user))[0][0])

	# ── Target & commission (always monthly — see rev_mtd note above) ─────────
	target_row = frappe.db.sql("""
		SELECT target_amount FROM `tabIB Sales Target`
		WHERE sales_user = %s AND month = %s
	""", (user, str(month_start)), as_dict=True)
	target = flt(target_row[0]["target_amount"]) if target_row else 0
	# Attainment vs rev_mtd (dev-mode Sales Order basis), not collected —
	# matches the billing-mode basis used for rev_mtd above.
	tgt_pct = round(rev_mtd / target * 100, 1) if target else None

	commission, slab_label = 0.0, None
	try:
		from instabiz.instabiz.page.ib_sales_incentives.ib_sales_incentives import (
			_load_slabs, _get_slab_designation, _apply_slab,
		)
		commission, slab_label = _apply_slab(
			collected, tgt_pct, _get_slab_designation(user), _load_slabs()
		)
	except Exception:
		pass

	commission_per_invoice = round(commission / invoice_count, 2) if invoice_count else 0

	# ── Trend: my revenue by period ────────────────────────────────────────────
	trend = frappe.db.sql(f"""
		SELECT DATE_FORMAT({sales_date}, '{date_fmt}') as label,
			   DATE_FORMAT({sales_date}, '{group_fmt}') as grp,
			   COALESCE(SUM(grand_total), 0) as amount,
			   COUNT(*) as count
		FROM `tab{sales_dt}` t
		WHERE docstatus=1 {sales_cond} AND {sales_date} >= %s
		AND custom_sales_person_user = %s
		GROUP BY grp, label ORDER BY grp
	""", (since, user), as_dict=True)

	# ── Breakdown: my top customers MTD ────────────────────────────────────────
	by_customer = frappe.db.sql(f"""
		SELECT customer_name as label, COALESCE(SUM(grand_total), 0) as amount
		FROM `tab{sales_dt}` t
		WHERE docstatus=1 {sales_cond} AND {sales_date} BETWEEN %s AND %s
		AND custom_sales_person_user = %s
		GROUP BY customer_name ORDER BY amount DESC LIMIT 8
	""", (month_start, today, user), as_dict=True)

	# ── Customer outstanding list (all-time, for this user's customers) ────────
	cust_outstanding = frappe.db.sql(f"""
		SELECT
			customer_name as customer,
			COUNT(*)                                as invoice_count,
			COALESCE(SUM(grand_total), 0)            as total_invoiced,
			COALESCE(SUM(grand_total) - SUM({outstanding_expr}), 0) as total_collected,
			COALESCE(SUM({outstanding_expr}), 0)     as outstanding
		FROM `tab{sales_dt}` t
		WHERE docstatus=1 {sales_cond}
		AND custom_sales_person_user = %s
		GROUP BY customer_name
		HAVING outstanding > 0
		ORDER BY outstanding DESC
		LIMIT 20
	""", (user,), as_dict=True)

	# collection_pct per customer
	for r in cust_outstanding:
		ti = flt(r.total_invoiced)
		r.collection_pct = round(flt(r.total_collected) / ti * 100, 1) if ti else 0

	# ── Pending: open leads ────────────────────────────────────────────────────
	open_leads = frappe.db.sql("""
		SELECT name, lead_name, custom_status as status,
			   custom_next_follow_up_date as next_date, DATE(creation) as created
		FROM `tabLead`
		WHERE (lead_owner = %s OR owner = %s)
		AND (custom_status IS NULL OR custom_status NOT IN ('Lost', 'Converted'))
		ORDER BY custom_next_follow_up_date ASC, creation DESC LIMIT 15
	""", (user, user), as_dict=True)

	# ── Pending: open quotations ───────────────────────────────────────────────
	open_quotes = frappe.db.sql("""
		SELECT name, customer_name as customer, grand_total, status, valid_till, transaction_date
		FROM `tabQuotation`
		WHERE docstatus=1 AND status IN ('Open', 'Replied')
		AND custom_sales_person_user = %s
		ORDER BY valid_till ASC LIMIT 15
	""", (user,), as_dict=True)

	# ── Pending: open orders ───────────────────────────────────────────────────
	open_orders = frappe.db.sql("""
		SELECT name, customer_name as customer, grand_total, status,
			   transaction_date, custom_advance_paid as advance_paid
		FROM `tabSales Order`
		WHERE docstatus=1 AND status NOT IN ('Completed', 'Cancelled')
		AND custom_sales_person_user = %s
		ORDER BY transaction_date ASC LIMIT 15
	""", (user,), as_dict=True)

	# ── Pending: overdue invoices ──────────────────────────────────────────────
	# Dev mode has no real due_date pre-invoice — falls back to the order's
	# own date, same pattern as the Finance Dashboard/AR Aging report.
	overdue_si = frappe.db.sql(f"""
		SELECT name, customer_name as customer, {outstanding_expr} as outstanding_amount,
			   {sales_date} as due_date, DATEDIFF(%s, {sales_date}) as days_overdue
		FROM `tab{sales_dt}` t
		WHERE docstatus=1 {sales_cond} AND {sales_date} < %s
		AND custom_sales_person_user = %s
		HAVING outstanding_amount > 0
		ORDER BY due_date ASC LIMIT 15
	""", (today, today, user), as_dict=True)

	return {
		"kpis": [
			{"label": f"Revenue {period_label}", "value": rev_period,     "type": "currency",
			 "delta": round(tgt_pct - 100, 1) if tgt_pct else 0, "delta_label": "vs month target"},
			{"label": f"Invoices {period_label}", "value": invoice_count,  "type": "count",    "delta": 0},
			{"label": f"Advance {period_label}",  "value": advance_collected, "type": "currency", "delta": 0},
			{"label": "Commission (MTD)",         "value": commission,        "type": "currency", "delta": 0},
		],
		"trend": trend,
		"breakdown": by_customer,
		"pending": {
			"outstanding": cust_outstanding,
			"leads":       open_leads,
			"quotes":      open_quotes,
			"orders":      open_orders,
			"overdue":     overdue_si,
		},
		"meta": {
			"user_type": "sales",
			"target":             target,
			"collected":          collected,
			"tgt_pct":            tgt_pct,
			"slab":               slab_label,
			"invoice_count":      invoice_count,
			"orders_mtd":         orders_mtd,
			"avg_invoice":        avg_invoice,
			"commission_per_inv": commission_per_invoice,
		},
	}


# ── HR user view ───────────────────────────────────────────────────────────────

def _my_work_hr(user, today, since, date_fmt, group_fmt, month_start, pw):
	# Same as the main HR tab: Active Employees/Present Today/Pending Leaves
	# are point-in-time and Payroll MTD is inherently monthly — `pw` unused.
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
		) _c
	""", (today, today))[0][0])

	pending_leaves = flt(frappe.db.sql(
		"SELECT COUNT(*) FROM `tabLeave Application` WHERE status='Open' AND docstatus=1"
	)[0][0])

	payroll_mtd = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(net_pay), 0) FROM `tabSalary Slip`
		WHERE docstatus < 2 AND start_date BETWEEN %s AND %s
	""", (month_start, today))[0][0])

	attendance_trend = frappe.db.sql(f"""
		SELECT DATE_FORMAT(attendance_date, '{date_fmt}') as label,
			   DATE_FORMAT(attendance_date, '{group_fmt}') as grp,
			   SUM(CASE WHEN status='Present' THEN 1 ELSE 0 END) as amount
		FROM `tabAttendance`
		WHERE attendance_date >= %s AND docstatus=1
		GROUP BY grp, label ORDER BY grp
	""", (since,), as_dict=True)

	by_dept = frappe.db.sql("""
		SELECT department as label, COUNT(*) as amount
		FROM `tabEmployee` WHERE status='Active' AND department IS NOT NULL
		GROUP BY department ORDER BY amount DESC LIMIT 10
	""", as_dict=True)

	pending_leave_list = frappe.db.sql("""
		SELECT la.name, e.employee_name, la.leave_type, la.from_date, la.to_date,
			   la.total_leave_days, la.status
		FROM `tabLeave Application` la
		LEFT JOIN `tabEmployee` e ON e.name = la.employee
		WHERE la.docstatus=1 AND la.status = 'Open'
		ORDER BY la.from_date ASC LIMIT 15
	""", as_dict=True)

	new_joiners = frappe.db.sql("""
		SELECT name, employee_name, designation, department, date_of_joining
		FROM `tabEmployee`
		WHERE status='Active' AND date_of_joining >= %s
		ORDER BY date_of_joining DESC LIMIT 10
	""", (month_start,), as_dict=True)

	exiting = frappe.db.sql("""
		SELECT name, employee_name, designation, department, relieving_date
		FROM `tabEmployee`
		WHERE relieving_date >= %s AND relieving_date <= %s
		ORDER BY relieving_date ASC LIMIT 10
	""", (today, frappe.utils.add_days(today, 30)), as_dict=True)

	absent_today_list = frappe.db.sql("""
		SELECT a.employee, e.employee_name, e.department
		FROM `tabAttendance` a
		LEFT JOIN `tabEmployee` e ON e.name = a.employee
		WHERE a.attendance_date = %s AND a.status = 'Absent' AND a.docstatus = 1
		ORDER BY e.department, e.employee_name LIMIT 15
	""", (today,), as_dict=True)

	return {
		"kpis": [
			{"label": "Active Employees", "value": int(total_emp), "type": "count", "delta": 0},
			{"label": "Present Today",    "value": int(present_today), "type": "count", "delta": 0},
			{"label": "Pending Leaves",   "value": int(pending_leaves), "type": "count", "delta": 0},
			{"label": "Payroll MTD",      "value": payroll_mtd, "type": "currency", "delta": 0},
		],
		"trend": attendance_trend,
		"breakdown": by_dept,
		"pending": {
			"leaves": pending_leave_list,
			"joiners": new_joiners,
			"exiting": exiting,
			"absent": absent_today_list,
		},
		"meta": {"user_type": "hr"},
	}


# ── Production user view ───────────────────────────────────────────────────────

def _my_work_production(user, today, since, date_fmt, group_fmt, month_start, pw):
	period_start = pw["period_start"]
	period_label = pw["period_label"]
	wo_active = flt(frappe.db.sql(
		"SELECT COUNT(*) FROM `tabIB Work Order` WHERE status NOT IN ('Completed','Cancelled')"
	)[0][0])
	wo_pending = flt(frappe.db.sql(
		"SELECT COUNT(*) FROM `tabIB Work Order` WHERE status = 'Pending'"
	)[0][0])
	wo_today = flt(frappe.db.sql(
		"SELECT COUNT(*) FROM `tabIB Work Order` WHERE status='Completed' AND COALESCE(completed_at, modified) >= %s",
		(period_start,)
	)[0][0])
	machines_active = flt(frappe.db.sql(
		"SELECT COUNT(*) FROM `tabIB Machine` WHERE status='Active'"
	)[0][0])

	wo_trend = frappe.db.sql(f"""
		SELECT DATE_FORMAT(COALESCE(completed_at, modified), '{date_fmt}') as label,
			   DATE_FORMAT(COALESCE(completed_at, modified), '{group_fmt}') as grp,
			   COUNT(*) as amount
		FROM `tabIB Work Order`
		WHERE status='Completed' AND COALESCE(completed_at, modified) >= %s
		GROUP BY grp, label ORDER BY grp
	""", (since,), as_dict=True)

	by_stage = frappe.db.sql("""
		SELECT COALESCE(stage, 'No Stage') as label, COUNT(*) as amount
		FROM `tabIB Work Order`
		WHERE status NOT IN ('Completed','Cancelled')
		GROUP BY stage ORDER BY amount DESC LIMIT 10
	""", as_dict=True)

	active_wos = frappe.db.sql("""
		SELECT name, item_code, stage, priority, status, machine, operator,
			   target_qty, completed_qty, started_at
		FROM `tabIB Work Order`
		WHERE status NOT IN ('Completed','Cancelled')
		ORDER BY FIELD(priority,'High','Medium','Low'), started_at ASC LIMIT 15
	""", as_dict=True)

	on_hold = frappe.db.sql("""
		SELECT name, item_code, stage, priority, machine
		FROM `tabIB Work Order` WHERE status='On Hold' LIMIT 10
	""", as_dict=True)

	return {
		"kpis": [
			{"label": "Active WOs",       "value": int(wo_active), "type": "count", "delta": 0},
			{"label": "Pending",          "value": int(wo_pending), "type": "count", "delta": 0},
			{"label": f"Completed {period_label}",  "value": int(wo_today), "type": "count", "delta": 0},
			{"label": "Machines Active",  "value": int(machines_active), "type": "count", "delta": 0},
		],
		"trend": wo_trend,
		"breakdown": by_stage,
		"pending": {"active": active_wos, "on_hold": on_hold},
		"meta": {"user_type": "production"},
	}


# ── Finance/Accounts user view ─────────────────────────────────────────────────

def _my_work_finance(user, today, since, date_fmt, group_fmt, month_start, pw):
	# Basis controlled by instabiz.overrides.billing_mode — was 100%
	# hardcoded to Sales/Purchase Invoice, so every figure here except the
	# real Payment Entry ones (collections_mtd/payments_mtd/recent_payments)
	# read zero (billing isn't live in ERP yet).
	period_start, period_end = pw["period_start"], pw["period_end"]
	period_label = pw["period_label"]
	dev_mode = is_dev_billing_mode()
	sales_dt = sales_doctype()
	purch_dt = purchase_doctype()
	sales_date = "transaction_date" if dev_mode else "posting_date"
	purch_date = "transaction_date" if dev_mode else "posting_date"
	# Only 'Cancelled' excluded, not 'Closed' — CustomSalesOrder.STATUS_MAP maps
	# DB status 'Closed' to user-facing label 'Confirmed' (a real completed sale).
	sales_cond = "AND t.status != 'Cancelled'" if dev_mode else "AND t.is_return=0"
	purch_cond = "AND t.status NOT IN ('Closed', 'Cancelled')" if dev_mode else "AND t.is_return=0"
	ar_expr = sales_outstanding_expr("t")
	ap_expr = purchase_outstanding_expr("t")

	ar_total = flt(frappe.db.sql(
		f"SELECT COALESCE(SUM({ar_expr}),0) FROM `tab{sales_dt}` t WHERE docstatus=1 {sales_cond}"
	)[0][0])
	ap_total = flt(frappe.db.sql(
		f"SELECT COALESCE(SUM({ap_expr}),0) FROM `tab{purch_dt}` t WHERE docstatus=1 {purch_cond}"
	)[0][0])
	collections_mtd = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(paid_amount), 0) FROM `tabPayment Entry`
		WHERE docstatus=1 AND payment_type='Receive' AND posting_date BETWEEN %s AND %s
	""", (period_start, period_end))[0][0])
	payments_mtd = flt(frappe.db.sql("""
		SELECT COALESCE(SUM(paid_amount), 0) FROM `tabPayment Entry`
		WHERE docstatus=1 AND payment_type='Pay' AND posting_date BETWEEN %s AND %s
	""", (period_start, period_end))[0][0])

	rev_trend = frappe.db.sql(f"""
		SELECT DATE_FORMAT({sales_date}, '{date_fmt}') as label,
			   DATE_FORMAT({sales_date}, '{group_fmt}') as grp,
			   COALESCE(SUM(grand_total), 0) as amount
		FROM `tab{sales_dt}` t
		WHERE docstatus=1 {sales_cond} AND {sales_date} >= %s
		GROUP BY grp, label ORDER BY grp
	""", (since,), as_dict=True)

	overdue_by_cust = frappe.db.sql(f"""
		SELECT customer_name as label, COALESCE(SUM({ar_expr}), 0) as amount
		FROM `tab{sales_dt}` t
		WHERE docstatus=1 {sales_cond} AND {sales_date} < %s
		GROUP BY customer_name
		HAVING amount > 0
		ORDER BY amount DESC LIMIT 10
	""", (today,), as_dict=True)

	overdue_si = frappe.db.sql(f"""
		SELECT name, customer_name as customer, {ar_expr} as outstanding_amount,
			   {sales_date} as due_date, DATEDIFF(%s, {sales_date}) as days_overdue
		FROM `tab{sales_dt}` t
		WHERE docstatus=1 {sales_cond} AND {sales_date} < %s
		HAVING outstanding_amount > 0
		ORDER BY due_date ASC LIMIT 15
	""", (today, today), as_dict=True)

	overdue_pi = frappe.db.sql(f"""
		SELECT name, supplier_name as supplier, {ap_expr} as outstanding_amount,
			   {purch_date} as due_date, DATEDIFF(%s, {purch_date}) as days_overdue
		FROM `tab{purch_dt}` t
		WHERE docstatus=1 {purch_cond} AND {purch_date} < %s
		HAVING outstanding_amount > 0
		ORDER BY due_date ASC LIMIT 15
	""", (today, today), as_dict=True)

	recent_payments = frappe.db.sql("""
		SELECT name, payment_type, party_name as party, paid_amount,
			   reference_no, posting_date
		FROM `tabPayment Entry`
		WHERE docstatus=1 AND posting_date BETWEEN %s AND %s
		ORDER BY posting_date DESC, creation DESC LIMIT 15
	""", (period_start, period_end), as_dict=True)

	return {
		"kpis": [
			{"label": "Outstanding AR",            "value": ar_total,       "type": "currency", "delta": 0},
			{"label": "Outstanding AP",            "value": ap_total,       "type": "currency", "delta": 0},
			{"label": f"Collections {period_label}", "value": collections_mtd,"type": "currency", "delta": 0},
			{"label": f"Payments {period_label}",    "value": payments_mtd,   "type": "currency", "delta": 0},
		],
		"trend": rev_trend,
		"breakdown": overdue_by_cust,
		"pending": {
			"overdue_si": overdue_si,
			"overdue_pi": overdue_pi,
			"payments": recent_payments,
		},
		"meta": {"user_type": "finance"},
	}


def _finance_data(today, since, date_fmt, group_fmt, pw):
	# Basis controlled by instabiz.overrides.billing_mode — was 100%
	# hardcoded to Sales/Purchase Invoice, so this whole tab read zero
	# (billing isn't live in ERP yet).
	period_start, period_end = pw["period_start"], pw["period_end"]
	prev_start, prev_end = pw["prev_start"], pw["prev_end"]
	period_label = pw["period_label"]

	dev_mode = is_dev_billing_mode()
	sales_dt = sales_doctype()
	purch_dt = purchase_doctype()
	sales_date = "transaction_date" if dev_mode else "posting_date"
	# Only 'Cancelled' excluded, not 'Closed' — CustomSalesOrder.STATUS_MAP maps
	# DB status 'Closed' to user-facing label 'Confirmed' (a real completed sale).
	sales_cond = "AND t.status != 'Cancelled'" if dev_mode else "AND t.is_return=0"
	purch_cond = "AND t.status NOT IN ('Closed', 'Cancelled')" if dev_mode else ""
	ar_expr = sales_outstanding_expr("t")
	ap_expr = purchase_outstanding_expr("t")

	ar = flt(frappe.db.sql(
		f"SELECT COALESCE(SUM({ar_expr}),0) FROM `tab{sales_dt}` t WHERE docstatus=1 {sales_cond}"
	)[0][0])

	ap = flt(frappe.db.sql(
		f"SELECT COALESCE(SUM({ap_expr}),0) FROM `tab{purch_dt}` t WHERE docstatus=1 {purch_cond}"
	)[0][0])

	rev_period = flt(frappe.db.sql(f"""
		SELECT COALESCE(SUM(grand_total),0) FROM `tab{sales_dt}` t
		WHERE docstatus=1 {sales_cond} AND {sales_date} BETWEEN %s AND %s
	""", (period_start, period_end))[0][0])

	rev_prev = flt(frappe.db.sql(f"""
		SELECT COALESCE(SUM(grand_total),0) FROM `tab{sales_dt}` t
		WHERE docstatus=1 {sales_cond} AND {sales_date} BETWEEN %s AND %s
	""", (prev_start, prev_end))[0][0])

	rev_delta = round((rev_period - rev_prev) / rev_prev * 100, 1) if rev_prev else 0

	gst_period = flt(frappe.db.sql(f"""
		SELECT COALESCE(SUM(tx.tax_amount),0)
		FROM `tabSales Taxes and Charges` tx
		JOIN `tab{sales_dt}` t ON t.name=tx.parent AND tx.parenttype=%s
		WHERE t.docstatus=1 AND t.{sales_date} BETWEEN %s AND %s
		AND (tx.account_head LIKE '%%GST%%' OR tx.account_head LIKE '%%CGST%%'
			OR tx.account_head LIKE '%%IGST%%' OR tx.account_head LIKE '%%SGST%%')
	""", (sales_dt, period_start, period_end))[0][0])

	pl_trend = frappe.db.sql(f"""
		SELECT DATE_FORMAT({sales_date},'{date_fmt}') as label,
			   DATE_FORMAT({sales_date},'{group_fmt}') as grp,
			   COALESCE(SUM(grand_total),0) as amount
		FROM `tab{sales_dt}` t
		WHERE docstatus=1 {sales_cond} AND {sales_date} >= %s
		GROUP BY grp, label ORDER BY grp
	""", (since,), as_dict=True)

	overdue = frappe.db.sql(f"""
		SELECT customer_name as label, COALESCE(SUM({ar_expr}),0) as amount
		FROM `tab{sales_dt}` t
		WHERE docstatus=1 {sales_cond} AND {sales_date} < %s
		GROUP BY customer_name
		HAVING amount > 0
		ORDER BY amount DESC LIMIT 10
	""", (today,), as_dict=True)

	return {
		"kpis": [
			{"label": f"Revenue {period_label}", "value": rev_period, "type": "currency", "delta": rev_delta},
			{"label": "Outstanding AR", "value": ar, "type": "currency", "delta": 0},
			{"label": "Outstanding AP", "value": ap, "type": "currency", "delta": 0},
			{"label": f"GST Collected {period_label}", "value": gst_period, "type": "currency", "delta": 0},
		],
		"trend": pl_trend,
		"breakdown": overdue,
		"secondary": [],
	}
