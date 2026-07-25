"""IB AP Aging — outstanding Purchase Invoices bucketed by age."""
import frappe
from frappe import _
from frappe.utils import today, getdate, date_diff, flt


def execute(filters=None):
	filters = filters or {}
	data    = _data(filters)
	columns = _columns()
	return columns, data, None, _chart(data, filters), _summary(data)


def _columns():
	return [
		{"label": _("Supplier"),      "fieldname": "supplier",     "fieldtype": "Link",     "options": "Supplier", "width": 200},
		{"label": _("Order"),         "fieldname": "name",         "fieldtype": "Link",     "options": "Purchase Order", "width": 160},
		{"label": _("Order Date"),    "fieldname": "posting_date", "fieldtype": "Date",     "width": 110},
		{"label": _("Due Date"),      "fieldname": "due_date",     "fieldtype": "Date",     "width": 100},
		{"label": _("Age (days)"),    "fieldname": "age_days",     "fieldtype": "Int",      "width": 100},
		{"label": _("0-30"),          "fieldname": "b0_30",        "fieldtype": "Currency", "width": 120},
		{"label": _("31-60"),         "fieldname": "b31_60",       "fieldtype": "Currency", "width": 120},
		{"label": _("61-90"),         "fieldname": "b61_90",       "fieldtype": "Currency", "width": 120},
		{"label": _("90+"),           "fieldname": "b90plus",      "fieldtype": "Currency", "width": 120},
		{"label": _("Outstanding"),   "fieldname": "outstanding",  "fieldtype": "Currency", "width": 140},
	]


def _data(filters):
	# TEST-ONLY BASIS CHANGE: Purchase Order instead of Purchase Invoice —
	# billing isn't live in ERP yet, so PI-based AP always reads empty. Revert
	# to Purchase Invoice once invoicing goes live. "Outstanding" here = full
	# order value (no payment concept exists pre-invoice); "Due Date" = order's
	# own transaction_date, there being no invoice due_date to fall back on.
	today_date = getdate(today())
	supplier   = filters.get("supplier")

	supp_cond = "AND po.supplier = %(supplier)s" if supplier else ""

	rows = frappe.db.sql(
		f"""
		SELECT
			po.name,
			po.supplier,
			po.transaction_date AS posting_date,
			po.transaction_date AS due_date,
			po.grand_total       AS outstanding
		FROM `tabPurchase Order` po
		WHERE po.docstatus = 1
		AND po.grand_total > 0
		AND po.status NOT IN ('Closed', 'Cancelled')
		{supp_cond}
		ORDER BY po.transaction_date ASC
		""",
		{"supplier": supplier},
		as_dict=True,
	)

	data = []
	for r in rows:
		age = date_diff(today_date, getdate(r.due_date)) if r.due_date else 0
		age = max(age, 0)
		amt = flt(r.outstanding)
		data.append({
			"supplier":     r.supplier,
			"name":         r.name,
			"posting_date": r.posting_date,
			"due_date":     r.due_date,
			"age_days":     age,
			"b0_30":        amt if age <= 30 else 0,
			"b31_60":       amt if 31 <= age <= 60 else 0,
			"b61_90":       amt if 61 <= age <= 90 else 0,
			"b90plus":      amt if age > 90 else 0,
			"outstanding":  amt,
		})
	return data


def _chart(data, filters=None):
	if not data:
		return None
	chart_type = (filters or {}).get("chart_type") or "bar"
	buckets = {"0-30": 0, "31-60": 0, "61-90": 0, "90+": 0}
	for r in data:
		buckets["0-30"]  += r["b0_30"]
		buckets["31-60"] += r["b31_60"]
		buckets["61-90"] += r["b61_90"]
		buckets["90+"]   += r["b90plus"]
	return {
		"data": {
			"labels":   list(buckets.keys()),
			"datasets": [{"name": _("Outstanding (INR)"), "values": list(buckets.values())}],
		},
		"type": chart_type,
		"colors": ["#1a7f37", "#d97757", "#ed7d31", "#cf222e"],
	}


def _summary(data):
	if not data:
		return None
	total    = sum(r["outstanding"] for r in data)
	old      = sum(r["b90plus"] for r in data)
	inv_ct   = len(data)
	supp_ct  = len({r["supplier"] for r in data})
	return [
		{"value": inv_ct,  "label": _("Invoices"),         "datatype": "Int",      "indicator": "blue"},
		{"value": supp_ct, "label": _("Suppliers"),         "datatype": "Int",      "indicator": "orange"},
		{"value": total,   "label": _("Total Payable"),     "datatype": "Currency", "indicator": "red"},
		{"value": old,     "label": _("90+ Days"),          "datatype": "Currency", "indicator": "red"},
	]
