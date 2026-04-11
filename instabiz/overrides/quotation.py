"""instabiz.overrides.quotation"""
import frappe
from frappe import _
from frappe.model.mapper import get_mapped_doc  # pyright: ignore[reportMissingImports]
from erpnext.selling.doctype.quotation.quotation import Quotation  # pyright: ignore[reportMissingImports]

from instabiz.overrides.utils import (
    IbStatusMixin,
    recalculate_items,
    set_sales_person,
    sync_sales_team,
    reopen_sales_doc,
    item_postprocess,
    map_parent_fields,
    map_address_contact_fields,
    COMMON_PARENT_FIELD_MAP,
)
from instabiz.overrides.naming import autoname_quotation

DEFAULT_TERMS = "Quotation Terms"


# ── Hook entry point ──────────────────────────────────────────────────────────

def recalculate_quotation(doc, method=None):
    recalculate_items(doc)


# ── New-document defaults ─────────────────────────────────────────────────────

def _set_default_taxes(doc):
    """Auto-apply the default Sales Taxes and Charges template on new documents only."""
    if not doc.is_new() or doc.get("taxes"):
        return
    tax_template = frappe.db.get_value(
        "Sales Taxes and Charges Template",
        {"is_default": 1, "company": doc.company},
        "name",
    )
    if not tax_template:
        return
    doc.taxes_and_charges = tax_template
    template_doc = frappe.get_doc("Sales Taxes and Charges Template", tax_template)
    for row in template_doc.taxes:
        doc.append("taxes", {
            "charge_type":           row.charge_type,
            "account_head":          row.account_head,
            "description":           row.description,
            "rate":                  row.rate,
            "included_in_print_rate": row.included_in_print_rate,
        })


def _set_default_terms(doc):
    """Auto-populate tc_name and terms on new documents only."""
    if not doc.is_new():
        return
    if not doc.get("tc_name"):
        doc.tc_name = DEFAULT_TERMS
    if not doc.get("terms"):
        terms_text = frappe.db.get_value("Terms and Conditions", doc.tc_name, "terms")
        if terms_text:
            doc.terms = terms_text


# ── Document class ────────────────────────────────────────────────────────────

class CustomQuotation(IbStatusMixin, Quotation):
    STATUS_MAP = {
        "Open":              "Pending",
        "Replied":           "Pending",
        "Expired":           "Pending",
        "Ordered":           "Confirmed",
        "Partially Ordered": "Confirmed",
        "Lost":              "Cancelled",
    }

    def autoname(self):
        self.flags.name_set = True
        autoname_quotation(self)

    def before_insert(self):
        _set_default_taxes(self)
        _set_default_terms(self)
        set_sales_person(self)

    def validate(self):
        if not self.custom_location or self.custom_location == "Select":
            frappe.throw(_("Please select a Location before saving."))
        set_sales_person(self)
        sync_sales_team(self)
        recalculate_items(self)
        super().validate()


# ── Reopen ────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def reopen_quotation(name):
    """Reopen a cancelled Quotation, resetting it back to Draft (docstatus=0)."""
    reopen_sales_doc("Quotation", name, "Quotation Item")


# ── Mapper: Quotation → Sales Order ──────────────────────────────────────────

@frappe.whitelist()
def custom_make_sales_order(source_name, target_doc=None):
    def postprocess_parent(source_doc, target_doc, source_parent):
        if source_doc.get("quotation_to") == "Customer":
            target_doc.customer = source_doc.party_name
            target_doc.customer_name = source_doc.customer_name
            customer_doc = frappe.get_cached_doc("Customer", source_doc.party_name)
            if not target_doc.get("customer_group") and customer_doc.customer_group:
                target_doc.customer_group = customer_doc.customer_group
            if not target_doc.get("territory") and customer_doc.territory:
                target_doc.territory = customer_doc.territory
        map_parent_fields(source_doc, target_doc)
        map_address_contact_fields(source_doc, target_doc)

    return get_mapped_doc(
        "Quotation",
        source_name,
        {
            "Quotation": {
                "doctype": "Sales Order",
                "validation": {"docstatus": ["=", 1]},
                "postprocess": postprocess_parent,
                "field_map": {
                    **COMMON_PARENT_FIELD_MAP,
                    "name":             "quotation",
                    "party_name":       "customer",
                    "transaction_date": "transaction_date",
                },
            },
            "Quotation Item": {
                "doctype": "Sales Order Item",
                "postprocess": item_postprocess,
                "condition": lambda row: row.qty != 0,
                "field_map": {
                    "custom_branding":  "custom_branding",
                    "custom_marking":   "custom_marking",
                    "custom_thickness": "custom_thickness",
                    "parent":           "prevdoc_docname",
                    "name":             "quotation_item",
                },
            },
            "Sales Taxes and Charges": {
                "doctype": "Sales Taxes and Charges",
                "add_if_empty": True,
            },
        },
        target_doc,
    )
