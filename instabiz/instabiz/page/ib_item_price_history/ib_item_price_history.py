import frappe

from instabiz.overrides.permissions import _is_privileged


@frappe.whitelist()
def get_item_price_history(item_code, customer=None, from_date=None, to_date=None, limit=20, offset=0):
	"""Past Sales Order lines for one item, newest first.

	Sourced from Sales Order (not Sales Invoice) — matches the rest of the app's
	current SO-basis for "what was actually sold", since billing isn't live yet
	(see sales_target.py / dashboards). Non-privileged users only see their own
	orders, same row-level rule as the rest of the sales doctypes.
	"""
	if not item_code:
		frappe.throw(frappe._("Item is required"))

	limit = int(limit)
	offset = int(offset)
	user = frappe.session.user

	conditions = ["so.docstatus = 1", "soi.item_code = %(item_code)s"]
	params = {"item_code": item_code}

	if customer:
		conditions.append("so.customer = %(customer)s")
		params["customer"] = customer

	if from_date:
		conditions.append("so.transaction_date >= %(from_date)s")
		params["from_date"] = from_date

	if to_date:
		conditions.append("so.transaction_date <= %(to_date)s")
		params["to_date"] = to_date

	if not _is_privileged(user):
		conditions.append("(so.custom_sales_person_user = %(user)s OR so.owner = %(user)s)")
		params["user"] = user

	where = " AND ".join(conditions)

	rows = frappe.db.sql(
		f"""
		SELECT
			so.name AS sales_order,
			so.transaction_date,
			so.customer,
			so.customer_name,
			so.custom_sales_person AS sales_person,
			so.custom_location AS location,
			soi.qty,
			soi.uom,
			soi.rate,
			soi.amount
		FROM `tabSales Order Item` soi
		INNER JOIN `tabSales Order` so ON so.name = soi.parent
		WHERE {where}
		ORDER BY so.transaction_date DESC, so.creation DESC
		LIMIT %(limit)s OFFSET %(offset)s
		""",
		{**params, "limit": limit, "offset": offset},
		as_dict=True,
	)

	total = frappe.db.sql(
		f"""
		SELECT COUNT(*) AS cnt
		FROM `tabSales Order Item` soi
		INNER JOIN `tabSales Order` so ON so.name = soi.parent
		WHERE {where}
		""",
		params,
		as_dict=True,
	)[0].cnt

	rates = [r.rate for r in rows]
	summary = {
		"count": total,
		"last_rate": rows[0].rate if rows else None,
		"min_rate": min(rates) if rates else None,
		"max_rate": max(rates) if rates else None,
	}

	return {"data": rows, "total": total, "summary": summary}
