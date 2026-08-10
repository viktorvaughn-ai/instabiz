"""IB Credit Note Register — submitted IB Credit Notes with items and value."""
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
		{"fieldname": "posting_date",           "label": _("Date"),              "fieldtype": "Date",     "width": 100},
		{"fieldname": "name",                   "label": _("Credit Note"),       "fieldtype": "Link",     "options": "IB Credit Note", "width": 180},
		{"fieldname": "against_sales_invoice",  "label": _("Against SI"),        "fieldtype": "Link",     "options": "Sales Invoice", "width": 180},
		{"fieldname": "customer",               "label": _("Customer"),          "fieldtype": "Link",     "options": "Customer",  "width": 200},
		{"fieldname": "reason_code",            "label": _("Reason"),            "fieldtype": "Data",     "width": 160},
		{"fieldname": "item_list",              "label": _("Items"),             "fieldtype": "Data",     "width": 220},
		{"fieldname": "total",                  "label": _("Total (₹)"),         "fieldtype": "Currency", "width": 120},
		{"fieldname": "total_taxes_and_charges","label": _("GST (₹)"),           "fieldtype": "Currency", "width": 100},
		{"fieldname": "grand_total",            "label": _("Grand Total (₹)"),   "fieldtype": "Currency", "width": 140},
		{"fieldname": "status",                 "label": _("Status"),            "fieldtype": "Data",     "width": 100},
	]


def _data(filters):
	conds  = ["cn.docstatus = 1"]
	params = {}

	if filters.get("from_date"):
		conds.append("cn.posting_date >= %(from_date)s")
		params["from_date"] = filters["from_date"]
	if filters.get("to_date"):
		conds.append("cn.posting_date <= %(to_date)s")
		params["to_date"] = filters["to_date"]
	if filters.get("customer"):
		conds.append("cn.customer = %(customer)s")
		params["customer"] = filters["customer"]
	if filters.get("reason_code"):
		conds.append("cn.reason_code = %(reason_code)s")
		params["reason_code"] = filters["reason_code"]

	where = " AND ".join(conds)

	rows = frappe.db.sql(
		f"""
		SELECT
			cn.posting_date,
			cn.name,
			cn.against_sales_invoice,
			cn.customer,
			cn.reason_code,
			cn.total,
			cn.total_taxes_and_charges,
			cn.grand_total,
			cn.status,
			(
				SELECT GROUP_CONCAT(cni.item_code ORDER BY cni.idx SEPARATOR ', ')
				FROM `tabIB Credit Note Item` cni
				WHERE cni.parent = cn.name
			)  AS item_list
		FROM `tabIB Credit Note` cn
		WHERE {where}
		ORDER BY cn.posting_date DESC, cn.name DESC
		""",
		params,
		as_dict=True,
	)
	return rows


def _chart(data, filters=None):
	chart_type = (filters or {}).get("chart_type", "bar")

	customer_totals = {}
	for r in data:
		customer_totals[r.customer] = customer_totals.get(r.customer, 0) + flt(r.grand_total)

	top = sorted(customer_totals.items(), key=lambda x: x[1], reverse=True)[:10]
	labels = [t[0] for t in top]
	values = [t[1] for t in top]

	return {
		"type": chart_type,
		"data": {
			"labels":   labels,
			"datasets": [{"name": _("Credit Value (₹)"), "values": values}],
		},
		"colors": ["#e74c3c"],
	}


def _summary(data):
	total_value      = sum(flt(r.grand_total) for r in data)
	count            = len(data)
	unique_customers = len({r.customer for r in data})
	avg_value        = round(total_value / count, 2) if count else 0

	return [
		{"label": _("Credit Notes"),      "value": count,            "datatype": "Int"},
		{"label": _("Total Value (₹)"),   "value": total_value,      "datatype": "Currency", "currency": "INR"},
		{"label": _("Unique Customers"),  "value": unique_customers, "datatype": "Int"},
		{"label": _("Avg Credit Value"),  "value": avg_value,        "datatype": "Currency", "currency": "INR"},
	]
