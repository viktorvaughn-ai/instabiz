"""IB Expense By Head — company expense breakdown by Chart-of-Accounts head.

Sourced directly from `GL Entry` (root_type = "Expense"), not Purchase Invoice
or Journal Entry individually — GL Entry is the unified ledger, so this avoids
handling each voucher type's own schema separately while still covering every
expense-type posting regardless of which document created it (Purchase
Invoice, Journal Entry, Stock Reconciliation valuation adjustments, Delivery
Note COGS, etc).
"""
import frappe
from frappe import _
from frappe.utils import flt


def execute(filters=None):
	filters = filters or {}
	data    = _data(filters)
	columns = _columns()
	return columns, data, None, _chart(data, filters), _summary(data)


def _columns():
	return [
		{"label": _("Account (Head)"), "fieldname": "account",      "fieldtype": "Link",     "options": "Account",     "width": 220},
		{"label": _("Cost Center"),    "fieldname": "cost_center",  "fieldtype": "Link",     "options": "Cost Center", "width": 170},
		{"label": _("Vendor(s)"),      "fieldname": "vendors",      "fieldtype": "Data",     "width": 200},
		{"label": _("Transactions"),   "fieldname": "txn_count",    "fieldtype": "Int",      "width": 100},
		{"label": _("Expense Amount"), "fieldname": "total_debit",  "fieldtype": "Currency", "width": 150},
		{"label": _("% of Total"),     "fieldname": "pct_of_total", "fieldtype": "Percent",  "width": 110},
	]


def _data(filters):
	cost_center = filters.get("cost_center")
	vendor      = filters.get("vendor")
	from_date   = filters.get("from_date")
	to_date     = filters.get("to_date")

	cc_cond   = "AND gl.cost_center = %(cost_center)s" if cost_center else ""
	v_cond    = "AND gl.party_type = 'Supplier' AND gl.party = %(vendor)s" if vendor else ""
	date_cond = ""
	params = {"cost_center": cost_center, "vendor": vendor}
	if from_date:
		date_cond += " AND gl.posting_date >= %(from_date)s"
		params["from_date"] = from_date
	if to_date:
		date_cond += " AND gl.posting_date <= %(to_date)s"
		params["to_date"] = to_date

	rows = frappe.db.sql(
		f"""
		SELECT
			gl.account,
			gl.cost_center,
			SUM(gl.debit - gl.credit) AS total_debit,
			COUNT(*) AS txn_count,
			GROUP_CONCAT(DISTINCT NULLIF(gl.party, '') SEPARATOR ', ') AS vendors
		FROM `tabGL Entry` gl
		INNER JOIN `tabAccount` a ON a.name = gl.account
		WHERE a.root_type = 'Expense'
		AND gl.docstatus = 1
		AND gl.is_cancelled = 0
		{date_cond} {cc_cond} {v_cond}
		GROUP BY gl.account, gl.cost_center
		ORDER BY total_debit DESC
		""",
		params,
		as_dict=True,
	)

	total = sum(flt(r.total_debit) for r in rows)
	for r in rows:
		r["total_debit"]  = round(flt(r["total_debit"]), 2)
		r["pct_of_total"] = flt(r["total_debit"] / total * 100, 2) if total else 0
		r["vendors"]      = r.get("vendors") or ""

	return rows


def _chart(data, filters=None):
	if not data:
		return None
	chart_type = (filters or {}).get("chart_type") or "bar"
	agg = {}
	for r in data:
		agg[r["account"]] = agg.get(r["account"], 0) + flt(r["total_debit"])
	top = sorted(agg.items(), key=lambda x: x[1], reverse=True)[:10]
	return {
		"data": {
			"labels":   [t[0] for t in top],
			"datasets": [{"name": _("Expense (INR)"), "values": [round(t[1]) for t in top]}],
		},
		"type": chart_type,
		"colors": ["#c0392b"],
	}


def _summary(data):
	if not data:
		return None
	total = sum(flt(r["total_debit"]) for r in data)

	by_head = {}
	by_cc   = {}
	for r in data:
		by_head[r["account"]]     = by_head.get(r["account"], 0) + flt(r["total_debit"])
		by_cc[r["cost_center"]]   = by_cc.get(r["cost_center"], 0) + flt(r["total_debit"])

	top_head = max(by_head, key=by_head.get) if by_head else "-"
	top_cc   = max(by_cc, key=by_cc.get) if by_cc else "-"

	return [
		{"value": total,    "label": _("Total Expense"),    "datatype": "Currency", "indicator": "red"},
		{"value": top_head, "label": _("Top Expense Head"), "datatype": "Data",     "indicator": "orange"},
		{"value": top_cc,   "label": _("Top Cost Center"),  "datatype": "Data",     "indicator": "blue"},
	]
