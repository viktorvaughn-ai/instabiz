"""IB Party Outstanding Summary — company-wide party-wise Debit/Credit ledger,
matching the sundry debtor/creditor balance-confirmation format (S.No, Party,
Debit, Credit, Grand Total)."""
import frappe
from frappe import _
from frappe.utils import flt


def execute(filters=None):
	filters = filters or {}
	data = _data(filters)
	columns = _columns()
	return columns, data, None, _chart(data, filters), _summary(data)


def _columns():
	return [
		{"label": _("S.No"), "fieldname": "idx", "fieldtype": "Int", "width": 60},
		{"label": _("Party"), "fieldname": "customer", "fieldtype": "Link", "options": "Customer", "width": 260},
		{"label": _("Debit"), "fieldname": "debit", "fieldtype": "Currency", "width": 140},
		{"label": _("Credit"), "fieldname": "credit", "fieldtype": "Currency", "width": 140},
	]


def _data(filters):
	territory = filters.get("territory")
	sp_user = filters.get("sales_person_user")
	min_balance = flt(filters.get("min_balance"))

	terr_cond = "AND si.territory = %(territory)s" if territory else ""
	sp_cond = "AND si.custom_sales_person_user = %(sp_user)s" if sp_user else ""

	rows = frappe.db.sql(
		f"""
		SELECT
			si.customer,
			SUM(CASE WHEN si.outstanding_amount > 0 THEN si.outstanding_amount ELSE 0 END) AS debit,
			SUM(CASE WHEN si.outstanding_amount < 0 THEN -si.outstanding_amount ELSE 0 END) AS credit
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		AND si.outstanding_amount != 0
		{terr_cond} {sp_cond}
		GROUP BY si.customer
		ORDER BY si.customer ASC
		""",
		{"territory": territory, "sp_user": sp_user},
		as_dict=True,
	)

	data = []
	idx = 1
	for r in rows:
		debit = flt(r.debit)
		credit = flt(r.credit)
		if abs(debit - credit) < min_balance:
			continue
		data.append({
			"idx": idx,
			"customer": r.customer,
			"debit": debit or None,
			"credit": credit or None,
		})
		idx += 1
	return data


def _chart(data, filters=None):
	if not data:
		return None
	chart_type = (filters or {}).get("chart_type") or "bar"
	top = sorted(data, key=lambda r: (r["debit"] or 0), reverse=True)[:10]
	return {
		"data": {
			"labels": [r["customer"] for r in top],
			"datasets": [{"name": _("Debit (INR)"), "values": [r["debit"] or 0 for r in top]}],
		},
		"type": chart_type,
		"colors": ["#cf222e"],
	}


def _summary(data):
	if not data:
		return None
	total_debit = sum(r["debit"] or 0 for r in data)
	total_credit = sum(r["credit"] or 0 for r in data)
	return [
		{"value": len(data), "label": _("Parties"), "datatype": "Int", "indicator": "blue"},
		{"value": total_debit, "label": _("Total Debit"), "datatype": "Currency", "indicator": "red"},
		{"value": total_credit, "label": _("Total Credit"), "datatype": "Currency", "indicator": "green"},
		{"value": total_debit - total_credit, "label": _("Net Outstanding"), "datatype": "Currency", "indicator": "orange"},
	]
