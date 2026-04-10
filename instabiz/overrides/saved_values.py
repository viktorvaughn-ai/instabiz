"""instabiz.overrides.saved_values

Persist and retrieve previously used free-text values so the UI can
offer them as autocomplete suggestions.

Categories:
  transport — `transport` field on Quotation / Sales Order parent
  branding  — `custom_branding` field on Quotation Item / Sales Order Item
"""

import frappe


@frappe.whitelist()
def get_saved_values(category):
    """Return a sorted list of distinct values for the given category."""
    if category == "transport":
        rows = frappe.db.sql("""
            SELECT DISTINCT transport FROM `tabQuotation`
             WHERE transport IS NOT NULL AND transport != ''
            UNION
            SELECT DISTINCT transport FROM `tabSales Order`
             WHERE transport IS NOT NULL AND transport != ''
            ORDER BY transport
        """)
    elif category == "branding":
        rows = frappe.db.sql("""
            SELECT DISTINCT custom_branding FROM `tabQuotation Item`
             WHERE custom_branding IS NOT NULL AND custom_branding != ''
            UNION
            SELECT DISTINCT custom_branding FROM `tabSales Order Item`
             WHERE custom_branding IS NOT NULL AND custom_branding != ''
            ORDER BY custom_branding
        """)
    else:
        return []

    return [r[0] for r in rows]
