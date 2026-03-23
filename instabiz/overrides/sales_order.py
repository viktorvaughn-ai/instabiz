"""instabiz.overrides.sales_order"""
import frappe
from frappe.model.mapper import get_mapped_doc  # pyright: ignore[reportMissingImports]
from erpnext.selling.doctype.sales_order.sales_order import SalesOrder  # pyright: ignore[reportMissingImports]

from instabiz.overrides.utils import (
    recalculate_items,
    map_dimension_fields,
    map_parent_fields,
    map_address_contact_fields,
)


def recalculate_sales_order(doc, method=None):
    recalculate_items(doc)


class CustomSalesOrder(SalesOrder):    
    def validate(self):
        recalculate_items(self)
        super().validate()


@frappe.whitelist()
def custom_make_delivery_note(source_name, target_doc=None):
    def postprocess(source_item, target_item, source_doc):
        map_dimension_fields(source_item, target_item)

    def postprocess_parent(source_doc, target_doc, source_parent):
        # ── 1. Customer fields ────────────────────────────────────────────────
        if source_doc.get("customer"):
            target_doc.customer = source_doc.customer
            target_doc.customer_name = source_doc.customer_name

            customer_doc = frappe.get_cached_doc("Customer", source_doc.customer)
            if not target_doc.get("customer_group") and customer_doc.customer_group:
                target_doc.customer_group = customer_doc.customer_group
            if not target_doc.get("territory") and customer_doc.territory:
                target_doc.territory = customer_doc.territory

        # ── 2. Transport + address + contact fields ───────────────────────────
        map_parent_fields(source_doc, target_doc)
        map_address_contact_fields(source_doc, target_doc)

    return get_mapped_doc(
        "Sales Order",
        source_name,
        {
            "Sales Order": {
                "doctype": "Delivery Note",
                "validation": {"docstatus": ["=", 1]},
                "postprocess": postprocess_parent,
                "field_map": {
                    "name":                  "against_sales_order",
                    "customer":              "customer",
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
                    # Carry warehouse through to Delivery Note
                    #"set_warehouse":         "set_warehouse",
                },
            },
            "Sales Order Item": {
                "doctype": "Delivery Note Item",
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