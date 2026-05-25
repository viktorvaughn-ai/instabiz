"""IB Bank Reconciliation — submitted Payment Entries vs cleared/uncleared status."""
import frappe
from frappe import _
from frappe.utils import flt, getdate


def execute(filters=None):
	filters = filters or {}
	_validate(filters)
	columns = _columns()
	data    = _data(filters)
	chart   = _chart(data, filters)
	summary = _summary(data)
	return columns, data, None, chart, summary


def _validate(filters):
	if filters.get("from_date") and filters.get("to_date"):
		if getdate(filters["from_date"]) > getdate(filters["to_date"]):
			frappe.throw(_("From Date cannot be after To Date."))


def _columns():
	return [
		{"fieldname": "posting_date",  "label": _("Date"),           "fieldtype": "Date",     "width": 100},
		{"fieldname": "name",          "label": _("Payment Entry"),   "fieldtype": "Link",     "options": "Payment Entry", "width": 170},
		{"fieldname": "payment_type",  "label": _("Type"),            "fieldtype": "Data",     "width": 90},
		{"fieldname": "party",         "label": _("Party"),           "fieldtype": "Data",     "width": 180},
		{"fieldname": "bank_account",  "label": _("Bank Account"),    "fieldtype": "Data",     "width": 170},
		{"fieldname": "paid_amount",   "label": _("Amount (₹)"),      "fieldtype": "Currency", "width": 140},
		{"fieldname": "reference_no",  "label": _("Ref No"),          "fieldtype": "Data",     "width": 140},
		{"fieldname": "clearance_date","label": _("Clearance Date"),  "fieldtype": "Date",     "width": 120},
		{"fieldname": "status",        "label": _("Status"),          "fieldtype": "Data",     "width": 110},
		{"fieldname": "days_pending",  "label": _("Days Pending"),    "fieldtype": "Int",      "width": 100},
	]


# Payment Entries store bank account in paid_to (Receive) or paid_from (Pay).
# clearance_date is set by ERPNext bank recon tool when a Bank Transaction matches the PE.
_BA_GL = {
	"GUJARAT & MAHARASHTRA - HDFC": "50200023672503 - HDFC - MH & GJ - IB",
	"CHENNAI - HDFC":               "50200044619421 - HDFC - Chennai - IB",
}

def _gl_accounts_for_filter(bank_account):
	if bank_account:
		ba = frappe.db.get_value("Bank Account", bank_account, "account")
		return [ba] if ba else []
	return list(_BA_GL.values())


def _data(filters):
	gl_accounts = _gl_accounts_for_filter(filters.get("bank_account"))
	if not gl_accounts:
		return []

	show_cleared  = filters.get("show_cleared")
	cleared_cond  = "" if show_cleared else "AND pe.clearance_date IS NULL"

	params = {
		"from_date":   filters["from_date"],
		"to_date":     filters["to_date"],
		"gl_accounts": gl_accounts,
	}

	rows = frappe.db.sql(
		f"""
		SELECT
			pe.name,
			pe.posting_date,
			pe.payment_type,
			pe.party,
			pe.paid_amount,
			pe.reference_no,
			pe.clearance_date,
			CASE
				WHEN pe.payment_type = 'Receive' THEN pe.paid_to
				ELSE pe.paid_from
			END AS gl_account
		FROM `tabPayment Entry` pe
		WHERE pe.docstatus = 1
		  AND pe.posting_date BETWEEN %(from_date)s AND %(to_date)s
		  AND (pe.paid_to IN %(gl_accounts)s OR pe.paid_from IN %(gl_accounts)s)
		  {cleared_cond}
		ORDER BY pe.posting_date ASC, pe.name ASC
		""",
		{**params, "gl_accounts": tuple(gl_accounts)},
		as_dict=True,
	)

	# reverse-map GL → Bank Account name
	gl_to_ba = {v: k for k, v in _BA_GL.items()}
	today = getdate()

	result = []
	for r in rows:
		cleared = bool(r.clearance_date)
		if cleared:
			status = "Cleared"
			days_pending = 0
		else:
			status = "Uncleared"
			days_pending = (today - getdate(r.posting_date)).days

		result.append({
			"posting_date":   r.posting_date,
			"name":           r.name,
			"payment_type":   r.payment_type,
			"party":          r.party,
			"bank_account":   gl_to_ba.get(r.gl_account, r.gl_account),
			"paid_amount":    flt(r.paid_amount),
			"reference_no":   r.reference_no or "",
			"clearance_date": r.clearance_date,
			"status":         status,
			"days_pending":   days_pending,
		})

	return result


def _chart(data, filters=None):
	chart_type = (filters or {}).get("chart_type", "bar")

	cleared   = sum(flt(r["paid_amount"]) for r in data if r["status"] == "Cleared")
	uncleared = sum(flt(r["paid_amount"]) for r in data if r["status"] == "Uncleared")

	return {
		"type": chart_type,
		"data": {
			"labels":   [_("Cleared"), _("Uncleared")],
			"datasets": [{"name": _("Amount (₹)"), "values": [cleared, uncleared]}],
		},
		"colors": ["#00B050", "#C0392B"],
	}


def _summary(data):
	total     = len(data)
	cleared   = sum(1 for r in data if r["status"] == "Cleared")
	uncleared = sum(1 for r in data if r["status"] == "Uncleared")
	uncleared_amt = sum(flt(r["paid_amount"]) for r in data if r["status"] == "Uncleared")
	old_uncleared = sum(1 for r in data if r["status"] == "Uncleared" and r["days_pending"] > 7)

	return [
		{"label": _("Total Entries"),       "value": total,         "datatype": "Int"},
		{"label": _("Cleared"),             "value": cleared,       "datatype": "Int",      "indicator": "green"},
		{"label": _("Uncleared"),           "value": uncleared,     "datatype": "Int",      "indicator": "red"},
		{"label": _("Uncleared Amount (₹)"),"value": uncleared_amt, "datatype": "Currency", "currency": "INR"},
		{"label": _("Uncleared > 7 Days"),  "value": old_uncleared, "datatype": "Int",      "indicator": "orange"},
	]
