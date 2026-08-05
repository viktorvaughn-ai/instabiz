import frappe

from instabiz.overrides.permissions import _is_privileged

EXPORT_ROW_CAP = 5000

# Whitelisted sort columns only — never interpolate client-supplied column names directly.
SORT_COLUMNS = {
	"transaction_date": "so.transaction_date",
	"sales_order": "so.name",
	"customer": "so.customer_name",
	"location": "so.custom_location",
	"sales_person": "so.custom_sales_person",
	"qty": "soi.qty",
	"uom": "soi.uom",
	"rate": "soi.rate",
	"amount": "soi.amount",
}


def _build_where(item_code, customer, from_date, to_date, sales_person_user, location, uom, search, user):
	if not item_code and not customer:
		frappe.throw(frappe._("Select an Item or a Customer"))

	conditions = ["so.docstatus = 1"]
	params = {}

	if item_code:
		conditions.append("soi.item_code = %(item_code)s")
		params["item_code"] = item_code

	if customer:
		conditions.append("so.customer = %(customer)s")
		params["customer"] = customer

	if uom:
		conditions.append("soi.uom = %(uom)s")
		params["uom"] = uom

	if from_date:
		conditions.append("so.transaction_date >= %(from_date)s")
		params["from_date"] = from_date

	if to_date:
		conditions.append("so.transaction_date <= %(to_date)s")
		params["to_date"] = to_date

	if sales_person_user:
		conditions.append("so.custom_sales_person_user = %(sales_person_user)s")
		params["sales_person_user"] = sales_person_user

	if location:
		conditions.append("so.custom_location = %(location)s")
		params["location"] = location

	if search:
		conditions.append(
			"""(
				so.name LIKE %(search)s
				OR so.customer_name LIKE %(search)s
				OR so.custom_location LIKE %(search)s
				OR so.custom_sales_person LIKE %(search)s
			)"""
		)
		params["search"] = f"%{search}%"

	if not _is_privileged(user):
		conditions.append("(so.custom_sales_person_user = %(user)s OR so.owner = %(user)s)")
		params["user"] = user

	return " AND ".join(conditions), params


def _order_by(sort_by, sort_dir):
	col = SORT_COLUMNS.get(sort_by)
	if not col:
		return "so.transaction_date DESC, so.creation DESC"
	direction = "ASC" if str(sort_dir).lower() == "asc" else "DESC"
	return f"{col} {direction}, so.creation DESC"


@frappe.whitelist()
def get_item_uoms(item_code):
	"""Distinct UOMs this item has actually sold in, most-frequent first.

	One item can sell in several UOMs at very different rate scales (e.g. per-PCS
	vs per-SQMT) — blending them into one min/max/last is comparing apples to
	oranges. Powers the UOM filter dropdown so the frontend can default to the
	dominant UOM instead of mixing them.
	"""
	if not item_code:
		return []
	user = frappe.session.user
	where, params = _build_where(item_code, None, None, None, None, None, None, None, user)
	return frappe.db.sql(
		f"""
		SELECT soi.uom, COUNT(*) AS cnt
		FROM `tabSales Order Item` soi
		INNER JOIN `tabSales Order` so ON so.name = soi.parent
		WHERE {where}
		GROUP BY soi.uom
		ORDER BY cnt DESC
		""",
		params,
		as_dict=True,
	)


@frappe.whitelist()
def get_item_price_history(
	item_code=None,
	customer=None,
	from_date=None,
	to_date=None,
	sales_person_user=None,
	location=None,
	uom=None,
	search=None,
	sort_by=None,
	sort_dir="desc",
	limit=20,
	offset=0,
):
	"""Past Sales Order lines for one item, newest first (or per sort_by/sort_dir).

	Sourced from Sales Order (not Sales Invoice) — matches the rest of the app's
	current SO-basis for "what was actually sold", since billing isn't live yet
	(see sales_target.py / dashboards). Non-privileged users only see their own
	orders, same row-level rule as the rest of the sales doctypes.
	"""
	limit = int(limit)
	offset = int(offset)
	user = frappe.session.user

	where, params = _build_where(
		item_code, customer, from_date, to_date, sales_person_user, location, uom, search, user
	)
	order_by = _order_by(sort_by, sort_dir)

	rows = frappe.db.sql(
		f"""
		SELECT
			so.name AS sales_order,
			so.transaction_date,
			so.customer,
			so.customer_name,
			so.custom_sales_person AS sales_person,
			so.custom_location AS location,
			soi.item_code,
			soi.item_name,
			soi.qty,
			soi.uom,
			soi.rate,
			soi.amount
		FROM `tabSales Order Item` soi
		INNER JOIN `tabSales Order` so ON so.name = soi.parent
		WHERE {where}
		ORDER BY {order_by}
		LIMIT %(limit)s OFFSET %(offset)s
		""",
		{**params, "limit": limit, "offset": offset},
		as_dict=True,
	)

	agg = frappe.db.sql(
		f"""
		SELECT COUNT(*) AS cnt
		FROM `tabSales Order Item` soi
		INNER JOIN `tabSales Order` so ON so.name = soi.parent
		WHERE {where}
		""",
		params,
		as_dict=True,
	)[0]

	total = agg.cnt

	# Last/lowest/highest rate always computed now (2026-08-05, user request)
	# even in customer-only mode (no item_code) — previously skipped entirely
	# there on the reasoning that rows could span unrelated items at very
	# different price scales. Kept that same "blended" flag (mirrors the
	# existing UOM-blend note below) so the frontend can still disclose when
	# these numbers span more than one item, rather than silently presenting
	# a customer-only blended range as if it were one item's price history.
	max_row = frappe.db.sql(
		f"""
		SELECT MAX(soi.rate) AS max_rate
		FROM `tabSales Order Item` soi
		INNER JOIN `tabSales Order` so ON so.name = soi.parent
		WHERE {where}
		""",
		params,
		as_dict=True,
	)[0]

	# min_rate excludes rate<=0 rows separately — a mis-entered 0-rate SO
	# line should not make the "Lowest" KPI read ₹0 (the row itself still
	# shows in the table/count above, only the lowest-price summary skips it).
	min_row = frappe.db.sql(
		f"""
		SELECT MIN(soi.rate) AS min_rate
		FROM `tabSales Order Item` soi
		INNER JOIN `tabSales Order` so ON so.name = soi.parent
		WHERE {where} AND soi.rate > 0
		""",
		params,
		as_dict=True,
	)[0]

	last = frappe.db.sql(
		f"""
		SELECT soi.rate
		FROM `tabSales Order Item` soi
		INNER JOIN `tabSales Order` so ON so.name = soi.parent
		WHERE {where}
		ORDER BY so.transaction_date DESC, so.creation DESC
		LIMIT 1
		""",
		params,
		as_dict=True,
	)
	summary = {
		"count": total,
		"last_rate": last[0].rate if last else None,
		"min_rate": min_row.min_rate,
		"max_rate": max_row.max_rate,
		"blended_across_items": not bool(item_code),
	}

	trend_rows = frappe.db.sql(
		f"""
		SELECT so.transaction_date AS date, soi.rate AS rate
		FROM `tabSales Order Item` soi
		INNER JOIN `tabSales Order` so ON so.name = soi.parent
		WHERE {where}
		ORDER BY so.transaction_date DESC, so.creation DESC
		LIMIT 60
		""",
		params,
		as_dict=True,
	)

	return {
		"data": rows,
		"total": total,
		"summary": summary,
		"trend": list(reversed(trend_rows)),
	}


@frappe.whitelist()
def export_item_price_history(
	item_code=None,
	customer=None,
	from_date=None,
	to_date=None,
	sales_person_user=None,
	location=None,
	uom=None,
	search=None,
	sort_by=None,
	sort_dir="desc",
):
	"""Full matching row set (no pagination) for CSV export, capped at EXPORT_ROW_CAP."""
	user = frappe.session.user

	where, params = _build_where(
		item_code, customer, from_date, to_date, sales_person_user, location, uom, search, user
	)
	order_by = _order_by(sort_by, sort_dir)

	rows = frappe.db.sql(
		f"""
		SELECT
			so.name AS sales_order,
			so.transaction_date,
			so.customer,
			so.customer_name,
			so.custom_sales_person AS sales_person,
			so.custom_location AS location,
			soi.item_code,
			soi.item_name,
			soi.qty,
			soi.uom,
			soi.rate,
			soi.amount
		FROM `tabSales Order Item` soi
		INNER JOIN `tabSales Order` so ON so.name = soi.parent
		WHERE {where}
		ORDER BY {order_by}
		LIMIT {EXPORT_ROW_CAP + 1}
		""",
		params,
		as_dict=True,
	)

	truncated = len(rows) > EXPORT_ROW_CAP
	return {"data": rows[:EXPORT_ROW_CAP], "truncated": truncated}
