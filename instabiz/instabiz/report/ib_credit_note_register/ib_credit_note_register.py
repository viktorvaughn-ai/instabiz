"""IB Credit Note Register — all Sales Invoice returns with reason, items, value."""
import frappe
from frappe import _
from frappe.utils import flt


def execute(filters=None):
	filters = filters or {}
	columns = _columns()
	data    = _data(filters)
	chart   = _chart(data, filters)
	summary = _summary(data)
	return columns, data, None, chart, summary


def _columns():
	return [
		{"fieldname": "posting_date",            "label": _("Date"),             "fieldtype": "Date",     "width": 100},
		{"fieldname": "name",                    "label": _("Credit Note"),      "fieldtype": "Link",     "options": "Sales Invoice", "width": 160},
		{"fieldname": "return_against",          "label": _("Original Invoice"), "fieldtype": "Link",     "options": "Sales Invoice", "width": 160},
		{"fieldname": "customer",                "label": _("Customer"),         "fieldtype": "Link",     "options": "Customer",      "width": 180},
		{"fieldname": "territory",               "label": _("Territory"),        "fieldtype": "Data",     "width": 120},
		{"fieldname": "custom_sales_person_user","label": _("Sales Person"),     "fieldtype": "Data",     "width": 150},
		{"fieldname": "items",                   "label": _("Items"),            "fieldtype": "Data",     "width": 220},
		{"fieldname": "return_value",            "label": _("Return Value (₹)"), "fieldtype": "Currency", "width": 140},
		{"fieldname": "custom_return_reason",    "label": _("Return Reason"),    "fieldtype": "Data",     "width": 200},
		{"fieldname": "status",                  "label": _("Status"),           "fieldtype": "Data",     "width": 100},
	]


def _data(filters):
	conds  = ["si.is_return = 1", "si.docstatus = 1"]
	params = {}

	if filters.get("from_date"):
		conds.append("si.posting_date >= %(from_date)s")
		params["from_date"] = filters["from_date"]
	if filters.get("to_date"):
		conds.append("si.posting_date <= %(to_date)s")
		params["to_date"] = filters["to_date"]
	if filters.get("customer"):
		conds.append("si.customer = %(customer)s")
		params["customer"] = filters["customer"]
	if filters.get("territory"):
		conds.append("si.territory = %(territory)s")
		params["territory"] = filters["territory"]
	if filters.get("sales_person_user"):
		conds.append("si.custom_sales_person_user = %(sales_person_user)s")
		params["sales_person_user"] = filters["sales_person_user"]

	where = " AND ".join(conds)

	rows = frappe.db.sql(
		f"""
		SELECT
			si.posting_date,
			si.name,
			si.return_against,
			si.customer,
			si.territory,
			si.custom_sales_person_user,
			ROUND(ABS(si.grand_total), 2)                                      AS return_value,
			si.custom_return_reason,
			si.status,
			(
				SELECT GROUP_CONCAT(sii.item_code ORDER BY sii.idx SEPARATOR ', ')
				FROM `tabSales Invoice Item` sii
				WHERE sii.parent = si.name
			)                                                                  AS items
		FROM `tabSales Invoice` si
		WHERE {where}
		ORDER BY si.posting_date DESC, si.name DESC
		""",
		params,
		as_dict=True,
	)
	return rows


def _chart(data, filters=None):
	chart_type = (filters or {}).get("chart_type", "bar")

	# group by customer, top 10
	customer_totals = {}
	for r in data:
		customer_totals[r.customer] = customer_totals.get(r.customer, 0) + flt(r.return_value)

	top = sorted(customer_totals.items(), key=lambda x: x[1], reverse=True)[:10]
	labels = [t[0] for t in top]
	values = [t[1] for t in top]

	return {
		"type": chart_type,
		"data": {
			"labels":   labels,
			"datasets": [{"name": _("Return Value (₹)"), "values": values}],
		},
		"colors": ["#e74c3c"],
	}


def _summary(data):
	total_value      = sum(flt(r.return_value) for r in data)
	count            = len(data)
	unique_customers = len({r.customer for r in data})
	avg_value        = round(total_value / count, 2) if count else 0

	return [
		{"label": _("Credit Notes"),      "value": count,            "datatype": "Int"},
		{"label": _("Total Value (₹)"),   "value": total_value,      "datatype": "Currency", "currency": "INR"},
		{"label": _("Unique Customers"),  "value": unique_customers, "datatype": "Int"},
		{"label": _("Avg Return Value"),  "value": avg_value,        "datatype": "Currency", "currency": "INR"},
	]
