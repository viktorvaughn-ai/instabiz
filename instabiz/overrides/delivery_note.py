"""instabiz.overrides.delivery_note"""
import frappe
from frappe.model.mapper import get_mapped_doc  # pyright: ignore[reportMissingImports]
from erpnext.stock.doctype.delivery_note.delivery_note import DeliveryNote  # pyright: ignore[reportMissingImports]

from instabiz.overrides.utils import (
    recalculate_items,
    map_dimension_fields,
    map_parent_fields,
    map_address_contact_fields,
)

from instabiz.overrides.naming import (
    autoname_delivery_note
)


def recalculate_delivery_note(doc, method=None):
    recalculate_items(doc)


class CustomDeliveryNote(DeliveryNote):
    # def autoname(self):
    #     self.flags.name_set = True
    #     autoname_delivery_note(self)

    def validate(self):
        recalculate_items(self)
        super().validate()


@frappe.whitelist()
def custom_make_sales_invoice(source_name, target_doc=None):
    def postprocess(source_item, target_item, source_doc):
        map_dimension_fields(source_item, target_item)

    def postprocess_parent(source_doc, target_doc, source_parent):
        # ── 1. Customer fields ────────────────────────────────────────────────
        # DN → SI: both use `customer` field; set explicitly as safety net.
        if source_doc.get("customer"):
            target_doc.customer = source_doc.customer
            target_doc.customer_name = source_doc.customer_name

        # ── 2. Transport + address + contact fields ───────────────────────────
        map_parent_fields(source_doc, target_doc)
        map_address_contact_fields(source_doc, target_doc)

    return get_mapped_doc(
        "Delivery Note",
        source_name,
        {
            "Delivery Note": {
                "doctype": "Sales Invoice",
                "validation": {"docstatus": ["=", 1]},
                "postprocess": postprocess_parent,
                "field_map": {
                    "name":                      "delivery_note",
                    "customer":                  "customer",
                    "customer_name":             "customer_name",
                    "customer_address":          "customer_address",
                    "shipping_address_name":     "shipping_address_name",
                    "contact_person":            "contact_person",
                    "contact_display":           "contact_display",
                    "territory":                 "territory",
                    "customer_group":            "customer_group",
                    "currency":                  "currency",
                    "selling_price_list":        "selling_price_list",
                    "price_list_currency":       "price_list_currency",
                    "plc_conversion_rate":       "plc_conversion_rate",
                    "conversion_rate":           "conversion_rate",
                    # Carry sales person so the SI stays credited to the DN's
                    # sales person, not whoever clicks "Make Invoice"
                    "custom_sales_person":       "custom_sales_person",
                    "custom_sales_person_user":  "custom_sales_person_user",
                },
            },
            "Delivery Note Item": {
                "doctype": "Sales Invoice Item",
                "postprocess": postprocess,
                "condition": lambda row: row.qty != 0,
            },
            "Sales Taxes and Charges": {
                "doctype": "Sales Taxes and Charges",
                "add_if_empty": True,
            },
        },
        target_doc,
    )