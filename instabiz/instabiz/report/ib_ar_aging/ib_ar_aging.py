"""IB AR Aging — outstanding Sales Invoices bucketed by age."""
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
		{"label": _("Customer"),      "fieldname": "customer",     "fieldtype": "Link",     "options": "Customer", "width": 200},
		{"label": _("Invoice"),       "fieldname": "name",         "fieldtype": "Link",     "options": "Sales Invoice", "width": 160},
		{"label": _("Invoice Date"),  "fieldname": "posting_date", "fieldtype": "Date",     "width": 110},
		{"label": _("Due Date"),      "fieldname": "due_date",     "fieldtype": "Date",     "width": 100},
		{"label": _("Age (days)"),    "fieldname": "age_days",     "fieldtype": "Int",      "width": 100},
		{"label": _("0-30"),          "fieldname": "b0_30",        "fieldtype": "Currency", "width": 120},
		{"label": _("31-60"),         "fieldname": "b31_60",       "fieldtype": "Currency", "width": 120},
		{"label": _("61-90"),         "fieldname": "b61_90",       "fieldtype": "Currency", "width": 120},
		{"label": _("90+"),           "fieldname": "b90plus",      "fieldtype": "Currency", "width": 120},
		{"label": _("Outstanding"),   "fieldname": "outstanding",  "fieldtype": "Currency", "width": 140},
		{"label": _("Sales Person"),  "fieldname": "sales_person", "fieldtype": "Data",     "width": 150},
	]


def _data(filters):
	today_date = getdate(today())
	customer   = filters.get("customer")
	territory  = filters.get("territory")
	sp_user    = filters.get("sales_person_user")

	cust_cond = "AND si.customer = %(customer)s" if customer else ""
	terr_cond = "AND si.territory = %(territory)s" if territory else ""
	sp_cond   = "AND si.custom_sales_person_user = %(sp_user)s" if sp_user else ""

	rows = frappe.db.sql(
		f"""
		SELECT
			si.name,
			si.customer,
			si.posting_date,
			si.due_date,
			si.outstanding_amount  AS outstanding,
			si.custom_sales_person AS sales_person,
			si.custom_sales_person_user
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		AND si.outstanding_amount > 0
		{cust_cond} {terr_cond} {sp_cond}
		ORDER BY si.due_date ASC
		""",
		{"customer": customer, "territory": territory, "sp_user": sp_user},
		as_dict=True,
	)

	data = []
	for r in rows:
		age = date_diff(today_date, getdate(r.due_date)) if r.due_date else 0
		age = max(age, 0)
		amt = flt(r.outstanding)
		data.append({
			"customer":     r.customer,
			"name":         r.name,
			"posting_date": r.posting_date,
			"due_date":     r.due_date,
			"age_days":     age,
			"b0_30":        amt if age <= 30 else 0,
			"b31_60":       amt if 31 <= age <= 60 else 0,
			"b61_90":       amt if 61 <= age <= 90 else 0,
			"b90plus":      amt if age > 90 else 0,
			"outstanding":  amt,
			"sales_person": r.sales_person or r.custom_sales_person_user or "",
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
	total  = sum(r["outstanding"] for r in data)
	old    = sum(r["b90plus"] for r in data)
	inv_ct = len(data)
	cust_ct = len({r["customer"] for r in data})
	return [
		{"value": inv_ct,  "label": _("Invoices"),          "datatype": "Int",      "indicator": "blue"},
		{"value": cust_ct, "label": _("Customers"),          "datatype": "Int",      "indicator": "orange"},
		{"value": total,   "label": _("Total Outstanding"),  "datatype": "Currency", "indicator": "red"},
		{"value": old,     "label": _("90+ Days"),           "datatype": "Currency", "indicator": "red"},
	]
