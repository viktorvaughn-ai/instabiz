"""IB Territory Report — sales performance grouped by territory."""
import frappe
from frappe import _
from frappe.utils import flt, getdate


def execute(filters=None):
	filters = filters or {}
	data    = _data(filters)
	columns = _columns()
	return columns, data, None, _chart(data, filters), _summary(data)


def _columns():
	return [
		{"label": _("State"),     "fieldname": "territory",    "fieldtype": "Link",     "options": "Territory", "width": 180},
		{"label": _("Leads"),         "fieldname": "leads",        "fieldtype": "Int",      "width": 90},
		{"label": _("Quotations"),    "fieldname": "quotations",   "fieldtype": "Int",      "width": 110},
		{"label": _("Orders"),        "fieldname": "orders",       "fieldtype": "Int",      "width": 90},
		{"label": _("Revenue"),       "fieldname": "revenue",      "fieldtype": "Currency", "width": 160},
		{"label": _("Avg Deal"),      "fieldname": "avg_deal",     "fieldtype": "Currency", "width": 140},
		{"label": _("Lead→SO %"),     "fieldname": "conv_pct",     "fieldtype": "Percent",  "width": 110},
		{"label": _("Lost Leads"),    "fieldname": "lost_leads",   "fieldtype": "Int",      "width": 100},
	]


def _data(filters):
	from_date = filters.get("from_date")
	to_date   = filters.get("to_date")

	leads = frappe.db.sql(
		"""
		SELECT territory,
		       COUNT(*) AS leads,
		       SUM(custom_status = 'Lost') AS lost_leads
		FROM `tabLead`
		WHERE territory IS NOT NULL AND territory != ''
		AND DATE(creation) BETWEEN %(from_date)s AND %(to_date)s
		GROUP BY territory
		""",
		{"from_date": from_date, "to_date": to_date}, as_dict=True,
	)

	quotes = frappe.db.sql(
		"""
		SELECT territory, COUNT(*) AS quotations
		FROM `tabQuotation`
		WHERE docstatus = 1 AND territory IS NOT NULL
		AND transaction_date BETWEEN %(from_date)s AND %(to_date)s
		GROUP BY territory
		""",
		{"from_date": from_date, "to_date": to_date}, as_dict=True,
	)

	orders = frappe.db.sql(
		"""
		SELECT territory, COUNT(*) AS orders, SUM(rounded_total) AS revenue
		FROM `tabSales Order`
		WHERE docstatus = 1 AND territory IS NOT NULL
		AND transaction_date BETWEEN %(from_date)s AND %(to_date)s
		GROUP BY territory
		""",
		{"from_date": from_date, "to_date": to_date}, as_dict=True,
	)

	lead_map  = {r.territory: r for r in leads}
	quote_map = {r.territory: r.quotations for r in quotes}
	order_map = {r.territory: r for r in orders}

	all_terr = set(lead_map) | set(quote_map) | set(order_map)
	rows = []
	for t in all_terr:
		lrow  = lead_map.get(t, {})
		l_cnt = lrow.get("leads", 0) or 0
		q_cnt = quote_map.get(t, 0) or 0
		orow  = order_map.get(t, {})
		o_cnt = orow.get("orders", 0) or 0
		rev   = flt(orow.get("revenue", 0))
		rows.append({
			"territory":  t,
			"leads":      l_cnt,
			"quotations": q_cnt,
			"orders":     o_cnt,
			"revenue":    rev,
			"avg_deal":   flt(rev / o_cnt, 2) if o_cnt else 0,
			"conv_pct":   flt(o_cnt / l_cnt * 100, 1) if l_cnt else 0,
			"lost_leads": lrow.get("lost_leads", 0) or 0,
		})

	rows.sort(key=lambda r: r["revenue"], reverse=True)
	return rows


def _chart(data, filters=None):
	if not data:
		return None
	chart_type = (filters or {}).get("chart_type") or "bar"
	top = data[:10]
	return {
		"data": {
			"labels":   [r["territory"] for r in top],
			"datasets": [
				{"name": _("Revenue"),  "values": [r["revenue"] for r in top]},
				{"name": _("Orders"),   "values": [r["orders"]  for r in top]},
			],
		},
		"type": chart_type,
		"colors": ["#d97757", "#2e74b5"],
	}


def _summary(data):
	if not data:
		return None
	return [
		{"value": len(data),                        "label": _("States"),           "datatype": "Int",      "indicator": "blue"},
		{"value": sum(r["leads"]   for r in data),  "label": _("Total Leads"),      "datatype": "Int",      "indicator": "orange"},
		{"value": sum(r["orders"]  for r in data),  "label": _("Total Orders"),     "datatype": "Int",      "indicator": "green"},
		{"value": sum(r["revenue"] for r in data),  "label": _("Total Revenue"),    "datatype": "Currency", "indicator": "green"},
	]
