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

from instabiz.overrides.naming import (
    autoname_sales_order
)

from instabiz.overrides.quotation import _sync_sales_team


def _set_sales_person(doc):
    """Auto-populate custom_sales_person from the document creator's first name."""
    if not doc.get("custom_sales_person"):
        full_name = frappe.db.get_value("User", doc.owner, "first_name")
        if full_name:
            doc.custom_sales_person = full_name


def recalculate_sales_order(doc, method=None):
    recalculate_items(doc)


class CustomSalesOrder(SalesOrder):
    def autoname(self):
        self.flags.name_set = True
        autoname_sales_order(self)

    def before_insert(self):
        _set_sales_person(self)

    def validate(self):
        if not self.custom_location or self.custom_location == "Select":
            frappe.throw("Please select a Location before saving.")
        _set_sales_person(self)
        _sync_sales_team(self)
        recalculate_items(self)
        super().validate()  # revert Quotation to Open on cancel


@frappe.whitelist()
def reopen_sales_order(name):
    """Reopen a cancelled Sales Order, resetting it back to submitted (docstatus=1)."""
    doc = frappe.get_doc("Sales Order", name)
    frappe.has_permission("Sales Order", "cancel", doc=doc, throw=True)

    if doc.docstatus != 2:
        frappe.throw(frappe._("Only a cancelled Sales Order can be reopened."))

    # Block if any submitted Delivery Note is linked
    linked_dn = frappe.db.get_all(
        "Delivery Note Item",
        filters={"against_sales_order": name, "docstatus": 1},
        fields=["parent"],
        limit=1,
    )
    if linked_dn:
        frappe.throw(
            frappe._("Cannot reopen: submitted Delivery Note {0} is linked to this order.").format(
                linked_dn[0].parent
            )
        )

    # Block if any submitted Sales Invoice is linked
    linked_si = frappe.db.get_all(
        "Sales Invoice Item",
        filters={"sales_order": name, "docstatus": 1},
        fields=["parent"],
        limit=1,
    )
    if linked_si:
        frappe.throw(
            frappe._("Cannot reopen: submitted Sales Invoice {0} is linked to this order.").format(
                linked_si[0].parent
            )
        )

    # Reset to Draft so the document is editable; on_submit will handle
    # reserved qty and Quotation status update when re-submitted
    frappe.db.set_value("Sales Order", name, "docstatus", 0)
    # Reset all child table rows — they carry docstatus=2 after cancellation
    # which makes them read-only even when the parent is back to Draft
    frappe.db.sql("UPDATE `tabSales Order Item` SET docstatus=0 WHERE parent=%s", name)
    frappe.db.sql("UPDATE `tabSales Taxes and Charges` SET docstatus=0 WHERE parent=%s AND parenttype='Sales Order'", name)
    doc.reload()

    # Revert linked Quotation status to Pending (SO is now Draft, not submitted)
    # Skip Quotations that are themselves cancelled
    for quotation_name in set(d.prevdoc_docname for d in doc.get("items") if d.prevdoc_docname):
        if frappe.db.get_value("Quotation", quotation_name, "docstatus") != 2:
            frappe.get_doc("Quotation", quotation_name).set_status(update=True)

    # Recalculate SO status (→ "Draft")
    doc.set_status(update=True)

    doc.add_comment("Edit", frappe._("Reopened by {0}").format(frappe.session.user))
    frappe.msgprint(
        frappe._("Sales Order {0} has been reopened.").format(name),
        indicator="green",
        alert=True,
    )


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
                    "custom_location":       "custom_location",                    
                },
            },
            "Sales Order Item": {
                "doctype": "Delivery Note Item",
                "postprocess": postprocess,
                "condition": lambda row: row.qty != 0,
                "field_map": {
                    "custom_branding": "custom_branding",
                    "custom_marking":  "custom_marking",
                    "custom_thickness":  "custom_thickness",
                    
                },
            },
            "Sales Taxes and Charges": {
                "doctype": "Sales Taxes and Charges",
                "add_if_empty": True,
            },
        },
        target_doc,
    )