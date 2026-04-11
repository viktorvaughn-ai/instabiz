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
from instabiz.overrides.naming import autoname_delivery_note


_DN_STATUS_MAP = {
    "To Bill":   "Pending",
    "Completed": "Confirmed",
    "Closed":    "Confirmed",
}


def _set_sales_person(doc):
    """Populate custom_sales_person (display) and custom_sales_person_user (email)."""
    if not doc.get("custom_sales_person"):
        first_name = frappe.db.get_value("User", doc.owner, "first_name")
        if first_name:
            doc.custom_sales_person = first_name
    if not doc.get("custom_sales_person_user"):
        doc.custom_sales_person_user = doc.owner


class CustomDeliveryNote(DeliveryNote):
    def autoname(self):
        self.flags.name_set = True
        autoname_delivery_note(self)

    def before_insert(self):
        _set_sales_person(self)

    def validate(self):
        _set_sales_person(self)
        recalculate_items(self)
        super().validate()

    def set_status(self, update=False, status=None, update_modified=True):
        super().set_status(update=update, status=status, update_modified=update_modified)
        if self.status in _DN_STATUS_MAP:
            self.status = _DN_STATUS_MAP[self.status]
            if update:
                self.db_set("status", self.status, update_modified=update_modified)

    def _validate_selects(self):
        # "Pending" and "Confirmed" are not in ERPNext's standard DN status options.
        # Temporarily swap back to a valid ERPNext value so the check passes.
        remapped = self.status
        if remapped in _DN_STATUS_MAP.values():
            self.status = "Draft"
        super()._validate_selects()
        self.status = remapped


@frappe.whitelist()
def custom_make_sales_invoice(source_name, target_doc=None):
    def postprocess(source_item, target_item, source_doc):
        map_dimension_fields(source_item, target_item)

    def postprocess_parent(source_doc, target_doc, source_parent):
        if source_doc.get("customer"):
            target_doc.customer = source_doc.customer
            target_doc.customer_name = source_doc.customer_name
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
                    "name":                     "delivery_note",
                    "customer":                 "customer",
                    "customer_name":            "customer_name",
                    "customer_address":         "customer_address",
                    "shipping_address_name":    "shipping_address_name",
                    "contact_person":           "contact_person",
                    "contact_display":          "contact_display",
                    "territory":                "territory",
                    "customer_group":           "customer_group",
                    "currency":                 "currency",
                    "selling_price_list":       "selling_price_list",
                    "price_list_currency":      "price_list_currency",
                    "plc_conversion_rate":      "plc_conversion_rate",
                    "conversion_rate":          "conversion_rate",
                    "custom_location":          "custom_location",
                    "custom_sales_person":      "custom_sales_person",
                    "custom_sales_person_user": "custom_sales_person_user",
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
