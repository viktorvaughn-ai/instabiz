"""IB Debit Note Register — submitted IB Debit Notes with items and value."""
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
		{"fieldname": "name",                   "label": _("Debit Note"),        "fieldtype": "Link",     "options": "IB Debit Note", "width": 180},
		{"fieldname": "against_purchase_invoice","label": _("Against PI"),       "fieldtype": "Link",     "options": "Purchase Invoice", "width": 180},
		{"fieldname": "supplier",               "label": _("Supplier"),          "fieldtype": "Link",     "options": "Supplier",  "width": 200},
		{"fieldname": "reason_code",            "label": _("Reason"),            "fieldtype": "Data",     "width": 160},
		{"fieldname": "item_list",              "label": _("Items"),             "fieldtype": "Data",     "width": 220},
		{"fieldname": "total",                  "label": _("Total (₹)"),         "fieldtype": "Currency", "width": 120},
		{"fieldname": "total_taxes_and_charges","label": _("GST (₹)"),           "fieldtype": "Currency", "width": 100},
		{"fieldname": "grand_total",            "label": _("Grand Total (₹)"),   "fieldtype": "Currency", "width": 140},
		{"fieldname": "status",                 "label": _("Status"),            "fieldtype": "Data",     "width": 100},
	]


def _data(filters):
	conds  = ["dn.docstatus = 1"]
	params = {}

	if filters.get("from_date"):
		conds.append("dn.posting_date >= %(from_date)s")
		params["from_date"] = filters["from_date"]
	if filters.get("to_date"):
		conds.append("dn.posting_date <= %(to_date)s")
		params["to_date"] = filters["to_date"]
	if filters.get("supplier"):
		conds.append("dn.supplier = %(supplier)s")
		params["supplier"] = filters["supplier"]
	if filters.get("reason_code"):
		conds.append("dn.reason_code = %(reason_code)s")
		params["reason_code"] = filters["reason_code"]

	where = " AND ".join(conds)

	rows = frappe.db.sql(
		f"""
		SELECT
			dn.posting_date,
			dn.name,
			dn.against_purchase_invoice,
			dn.supplier,
			dn.reason_code,
			dn.total,
			dn.total_taxes_and_charges,
			dn.grand_total,
			dn.status,
			(
				SELECT GROUP_CONCAT(dni.item_code ORDER BY dni.idx SEPARATOR ', ')
				FROM `tabIB Debit Note Item` dni
				WHERE dni.parent = dn.name
			)  AS item_list
		FROM `tabIB Debit Note` dn
		WHERE {where}
		ORDER BY dn.posting_date DESC, dn.name DESC
		""",
		params,
		as_dict=True,
	)
	return rows


def _chart(data, filters=None):
	chart_type = (filters or {}).get("chart_type", "bar")

	supplier_totals = {}
	for r in data:
		supplier_totals[r.supplier] = supplier_totals.get(r.supplier, 0) + flt(r.grand_total)

	top = sorted(supplier_totals.items(), key=lambda x: x[1], reverse=True)[:10]
	labels = [t[0] for t in top]
	values = [t[1] for t in top]

	return {
		"type": chart_type,
		"data": {
			"labels":   labels,
			"datasets": [{"name": _("Debit Value (₹)"), "values": values}],
		},
		"colors": ["#e67e22"],
	}


def _summary(data):
	total_value     = sum(flt(r.grand_total) for r in data)
	count           = len(data)
	unique_suppliers = len({r.supplier for r in data})
	avg_value       = round(total_value / count, 2) if count else 0

	return [
		{"label": _("Debit Notes"),      "value": count,             "datatype": "Int"},
		{"label": _("Total Value (₹)"),  "value": total_value,       "datatype": "Currency", "currency": "INR"},
		{"label": _("Unique Suppliers"), "value": unique_suppliers,  "datatype": "Int"},
		{"label": _("Avg Debit Value"),  "value": avg_value,         "datatype": "Currency", "currency": "INR"},
	]
