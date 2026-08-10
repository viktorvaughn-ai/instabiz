"""IB Cash Flow Statement — bank/cash GL movements with running balance and category breakdown."""
import frappe
from frappe import _
from frappe.utils import flt, get_first_day, getdate, today

# GL accounts to treat as cash/bank. Kept in sync with `tabBank Account`
# (is_company_account=1) — added Kotak (opened 2026-06-30, was missing here)
# after it was found excluded from the "all accounts" default view (blank
# bank_account filter); explicitly selecting it in the filter already worked
# since that path resolves any Bank Account dynamically.
_BANK_ACCOUNTS = [
    "50200023672503 - HDFC - MH & GJ - IB",
    "50200044619421 - HDFC - Chennai - IB",
    "0912306832 - Kotak Mahindra Bank (India) - IB",
    "Cash - IB",
]

_CATEGORY_COLORS = {
    "Customer Collections": "#1a6b3c",
    "Vendor Payments":      "#c0392b",
    "Salary & Wages":       "#8e44ad",
    "Operating Expenses":   "#e67e22",
    "Financing":            "#2980b9",
    "Tax Payments":         "#7f8c8d",
    "Inter-account":        "#95a5a6",
    "Other Inflow":         "#27ae60",
    "Other Outflow":        "#e74c3c",
}


def execute(filters=None):
    filters = filters or {}
    _validate(filters)
    columns = _columns()
    data    = _data(filters)
    chart   = _chart(data, filters)
    summary = _summary(data, filters)
    return columns, data, None, chart, summary


def _validate(filters):
    if filters.get("from_date") and filters.get("to_date"):
        if getdate(filters["from_date"]) > getdate(filters["to_date"]):
            frappe.throw(_("From Date cannot be after To Date."))


def _columns():
    return [
        {"fieldname": "posting_date", "label": _("Date"),        "fieldtype": "Date",     "width": 100},
        {"fieldname": "category",     "label": _("Category"),    "fieldtype": "Data",     "width": 160},
        {"fieldname": "voucher_type", "label": _("Type"),        "fieldtype": "Data",     "width": 120},
        {"fieldname": "voucher_no",   "label": _("Voucher"),     "fieldtype": "Dynamic Link", "options": "voucher_type", "width": 160},
        {"fieldname": "party",        "label": _("Party"),       "fieldtype": "Data",     "width": 180},
        {"fieldname": "description",  "label": _("Description"), "fieldtype": "Data",     "width": 260},
        {"fieldname": "inflow",       "label": _("Inflow (₹)"),  "fieldtype": "Currency", "width": 130},
        {"fieldname": "outflow",      "label": _("Outflow (₹)"), "fieldtype": "Currency", "width": 130},
        {"fieldname": "balance",      "label": _("Balance (₹)"), "fieldtype": "Currency", "width": 140},
    ]


def _get_accounts(filters):
    if filters.get("bank_account"):
        acct = frappe.db.get_value("Bank Account", filters["bank_account"], "account")
        return [acct] if acct else []
    return _BANK_ACCOUNTS


def _opening_balance(accounts, before_date):
    if not accounts:
        return 0.0
    result = frappe.db.sql(
        """
        SELECT COALESCE(SUM(debit - credit), 0)
        FROM `tabGL Entry`
        WHERE account IN %(accounts)s
          AND posting_date < %(dt)s
          AND docstatus = 1
          AND is_cancelled = 0
        """,
        {"accounts": tuple(accounts), "dt": before_date},
    )
    return flt(result[0][0]) if result else 0.0


def _categorize(row):
    """Assign a human-readable category from GL + PE metadata."""
    if row.voucher_type == "Payment Entry":
        pt  = (row.party_type or "").strip()
        pmt = (row.payment_type or "").strip()
        if pt == "Customer":
            return "Customer Collections"
        if pt == "Supplier":
            return "Vendor Payments"
        if pt == "Employee":
            return "Salary & Wages"
        return "Other Inflow" if pmt == "Receive" else "Other Outflow"

    # Journal Entry — keyword scan on remarks
    rem = (row.remarks or "").lower()
    if any(k in rem for k in ["salary", "payroll", "wages", "salery"]):
        return "Salary & Wages"
    if any(k in rem for k in ["rent", "travel", "marketing", "stationery", "telephone",
                               "utility", "maintenance", "entertainment", "postal"]):
        return "Operating Expenses"
    if any(k in rem for k in ["loan", "od ", "overdraft", "drawdown", "secured",
                               "unsecured", "finance", "interest"]):
        return "Financing"
    if any(k in rem for k in ["tax", "gst", "tds", "advance tax", "pt "]):
        return "Tax Payments"
    if any(k in rem for k in ["cash deposit", "contra", "inter", "transfer"]):
        return "Inter-account"
    if any(k in rem for k in ["vendor", "supplier", "purchase", "material", "creditor"]):
        return "Vendor Payments"
    if any(k in rem for k in ["customer", "collection", "payment received", "debtor"]):
        return "Customer Collections"

    # Fallback: inflow vs outflow
    return "Other Inflow" if flt(row.debit) > 0 else "Other Outflow"


def _data(filters):
    accounts = _get_accounts(filters)
    if not accounts:
        return []

    from_date = filters.get("from_date") or get_first_day(today())
    to_date   = filters.get("to_date")   or today()

    opening = _opening_balance(accounts, from_date)

    rows = frappe.db.sql(
        """
        SELECT
            gl.posting_date,
            gl.voucher_type,
            gl.voucher_no,
            gl.debit,
            gl.credit,
            gl.remarks,
            COALESCE(pe.party_type, '') AS party_type,
            COALESCE(pe.party,      '') AS party,
            COALESCE(pe.payment_type,'') AS payment_type
        FROM `tabGL Entry` gl
        LEFT JOIN `tabPayment Entry` pe
            ON pe.name = gl.voucher_no AND gl.voucher_type = 'Payment Entry'
        WHERE gl.account IN %(accounts)s
          AND gl.posting_date BETWEEN %(from_date)s AND %(to_date)s
          AND gl.docstatus = 1
          AND gl.is_cancelled = 0
        ORDER BY gl.posting_date ASC, gl.creation ASC
        """,
        {"accounts": tuple(accounts), "from_date": from_date, "to_date": to_date},
        as_dict=True,
    )

    running = opening
    result  = []

    # Opening balance row
    result.append({
        "posting_date": from_date,
        "category":     "Opening Balance",
        "voucher_type": "",
        "voucher_no":   "",
        "party":        "",
        "description":  "Opening balance brought forward",
        "inflow":       opening if opening >= 0 else 0,
        "outflow":      abs(opening) if opening < 0 else 0,
        "balance":      opening,
    })

    for r in rows:
        inflow  = flt(r.debit)
        outflow = flt(r.credit)
        running += inflow - outflow
        category = _categorize(r)

        # Clean up remarks: strip "Note: " prefix Frappe adds
        desc = (r.remarks or "").replace("Note: ", "").split("\n")[0].strip()

        result.append({
            "posting_date": r.posting_date,
            "category":     category,
            "voucher_type": r.voucher_type,
            "voucher_no":   r.voucher_no,
            "party":        r.party,
            "description":  desc,
            "inflow":       inflow  if inflow  > 0 else 0,
            "outflow":      outflow if outflow > 0 else 0,
            "balance":      running,
        })

    return result


def _chart(data, filters=None):
    chart_type = (filters or {}).get("chart_type", "bar")

    # Aggregate by category (exclude opening balance row)
    cat_in  = {}
    cat_out = {}
    for r in data[1:]:
        cat = r["category"]
        cat_in[cat]  = cat_in.get(cat, 0)  + flt(r["inflow"])
        cat_out[cat] = cat_out.get(cat, 0) + flt(r["outflow"])

    # Only categories with activity
    all_cats = sorted({c for c in list(cat_in) + list(cat_out)
                       if cat_in.get(c, 0) + cat_out.get(c, 0) > 0})

    inflow_vals  = [cat_in.get(c, 0)  for c in all_cats]
    outflow_vals = [cat_out.get(c, 0) for c in all_cats]

    return {
        "type": chart_type,
        "data": {
            "labels":   all_cats,
            "datasets": [
                {"name": _("Inflow (₹)"),  "values": inflow_vals},
                {"name": _("Outflow (₹)"), "values": outflow_vals},
            ],
        },
        "colors": ["#1a6b3c", "#c0392b"],
    }


def _summary(data, filters=None):
    if not data:
        return []

    opening  = flt(data[0]["balance"]) if data else 0
    total_in = sum(flt(r["inflow"])  for r in data[1:])
    total_out= sum(flt(r["outflow"]) for r in data[1:])
    net      = total_in - total_out
    closing  = opening + net

    return [
        {"label": _("Opening Balance"),  "value": opening,   "datatype": "Currency", "currency": "INR"},
        {"label": _("Total Inflows"),    "value": total_in,  "datatype": "Currency", "currency": "INR",
         "indicator": "green"},
        {"label": _("Total Outflows"),   "value": total_out, "datatype": "Currency", "currency": "INR",
         "indicator": "red"},
        {"label": _("Net Cash Flow"),    "value": net,       "datatype": "Currency", "currency": "INR",
         "indicator": "green" if net >= 0 else "red"},
        {"label": _("Closing Balance"),  "value": closing,   "datatype": "Currency", "currency": "INR"},
    ]
