"""instabiz.overrides.quotation"""
import frappe
from frappe.model.mapper import get_mapped_doc  # pyright: ignore[reportMissingImports]
from erpnext.selling.doctype.quotation.quotation import Quotation  # pyright: ignore[reportMissingImports]

from instabiz.overrides.utils import (
    recalculate_items,
    map_dimension_fields,
    map_parent_fields,
    map_address_contact_fields,
)

DEFAULT_TERMS = "Quotation Terms"


def recalculate_quotation(doc, method=None):
    recalculate_items(doc)


def _set_default_terms(doc):
    """Auto-populate tc_name and terms if not already set."""
    if not doc.get("tc_name"):
        doc.tc_name = DEFAULT_TERMS
    if not doc.get("terms"):
        terms_text = frappe.db.get_value(
            "Terms and Conditions", doc.tc_name, "terms"
        )
        if terms_text:
            doc.terms = terms_text


class CustomQuotation(Quotation):
     
    def set_sales_person(self):
        pass # fdf

    def before_insert(self):
        _set_default_terms(self)
#       _set_custom_sales_person(self)

    def validate(self):
        _set_default_terms(self)
#       _set_custom_sales_person(self)
        recalculate_items(self)
        super().validate()


@frappe.whitelist()
def custom_make_sales_order(source_name, target_doc=None):
    def postprocess(source_item, target_item, source_doc):
        map_dimension_fields(source_item, target_item)

    def postprocess_parent(source_doc, target_doc, source_parent):
        # ── 1. party_name → customer ──────────────────────────────────────────
        if source_doc.get("quotation_to") == "Customer":
            target_doc.customer = source_doc.party_name
            target_doc.customer_name = source_doc.customer_name

            customer_doc = frappe.get_cached_doc("Customer", source_doc.party_name)
            if not target_doc.get("customer_group") and customer_doc.customer_group:
                target_doc.customer_group = customer_doc.customer_group
            if not target_doc.get("territory") and customer_doc.territory:
                target_doc.territory = customer_doc.territory

        # ── 2. Transport + address + contact fields ───────────────────────────
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
                    "name":                  "quotation",
                    "party_name":            "customer",
                    "customer_name":         "customer_name",
                    "customer_address":      "customer_address",
                    "shipping_address_name": "shipping_address_name",
                    "contact_person":        "contact_person",
                    "contact_display":       "contact_display",
                    "territory":             "territory",
                    "customer_group":        "customer_group",
                    "currency":              "currency",
                    "selling_price_list":    "selling_price_list",
                    "price_list_currency":   "price_list_currency",
                    "plc_conversion_rate":   "plc_conversion_rate",
                    "conversion_rate":       "conversion_rate",
                    "transaction_date":      "transaction_date",
                    # Warehouse: custom_warehouse on Quotation → set_warehouse on SO
                    #"custom_warehouse":      "set_warehouse",
                },
            },
            "Quotation Item": {
                "doctype": "Sales Order Item",
                "postprocess": postprocess,
                "condition": lambda row: row.qty != 0,
                "field_map": {
                    "custom_branding": "custom_branding",
                    "custom_marking":  "custom_marking",
                },
            },
            "Sales Taxes and Charges": {
                "doctype": "Sales Taxes and Charges",
                "add_if_empty": True,
            },
        },
        target_doc,
    )