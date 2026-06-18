"""instabiz.overrides.list_print — backend helpers for list-view and party-ledger printing."""
import frappe
from frappe import _


@frappe.whitelist()
def get_print_company_info():
    """Returns company name, logo, GSTIN, and address for print headers."""
    company = frappe.defaults.get_global_default("company")
    if not company:
        rows = frappe.db.get_all("Company", fields=["name"], limit=1)
        company = rows[0].name if rows else ""
    if not company:
        return {}

    doc = frappe.get_cached_doc("Company", company)
    # Address is linked via Dynamic Link, not a field on Company
    addr_rows = frappe.db.sql(
        """
        SELECT a.address_line1, a.address_line2, a.city, a.state, a.pincode
        FROM `tabAddress` a
        INNER JOIN `tabDynamic Link` dl ON dl.parent = a.name
        WHERE dl.link_doctype = 'Company' AND dl.link_name = %s
        ORDER BY a.is_primary_address DESC, a.creation ASC
        LIMIT 1
        """,
        company,
        as_dict=True,
    )
    addr = addr_rows[0] if addr_rows else None

    # GSTIN: try india_compliance field first, then tax_id
    gstin = (
        getattr(doc, "gstin", None)
        or getattr(doc, "tax_id", None)
        or ""
    )

    return {
        "name":    company,
        "logo":    doc.company_logo or "",
        "gstin":   gstin,
        "phone":   doc.phone_no or "",
        "email":   doc.email or "",
        "address": addr,
    }


@frappe.whitelist()
def get_party_gl(party_type, party, from_date=None, to_date=None):
    """
    Returns GL entries for a party with running balance.
    party_type: 'Customer' or 'Supplier'
    """
    filters = {
        "party_type": party_type,
        "party": party,
        "is_cancelled": 0,
    }
    if from_date:
        filters["posting_date"] = [">=", from_date]
    if to_date:
        if isinstance(filters.get("posting_date"), list):
            # combine into between
            filters["posting_date"] = ["between", [from_date, to_date]]
        else:
            filters["posting_date"] = ["<=", to_date]

    entries = frappe.db.get_all(
        "GL Entry",
        filters=filters,
        fields=[
            "posting_date", "voucher_type", "voucher_no",
            "remarks", "debit", "credit",
        ],
        order_by="posting_date asc, creation asc",
        limit=2000,
    )

    balance = 0.0
    for e in entries:
        balance += (e.debit or 0) - (e.credit or 0)
        e["balance"] = balance

    return entries


@frappe.whitelist()
def get_gl_entries(filters=None, from_date=None, to_date=None,
                   account=None, party_type=None, party=None, limit=500):
    """Full GL entry list for the GL print view."""
    db_filters = {"is_cancelled": 0}
    if from_date:
        db_filters["posting_date"] = [">=", from_date]
    if to_date:
        if "posting_date" in db_filters:
            db_filters["posting_date"] = ["between", [from_date, to_date]]
        else:
            db_filters["posting_date"] = ["<=", to_date]
    if account:
        db_filters["account"] = account
    if party_type:
        db_filters["party_type"] = party_type
    if party:
        db_filters["party"] = party

    entries = frappe.db.get_all(
        "GL Entry",
        filters=db_filters,
        fields=[
            "posting_date", "account", "party_type", "party",
            "voucher_type", "voucher_no", "debit", "credit", "remarks",
        ],
        order_by="posting_date asc, creation asc",
        limit=int(limit),
    )
    return entries
