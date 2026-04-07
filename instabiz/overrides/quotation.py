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

from instabiz.overrides.naming import (
    autoname_quotation
)

DEFAULT_TERMS = "Quotation Terms"


def recalculate_quotation(doc, method=None):
    recalculate_items(doc)


def _set_default_taxes(doc):
    """Auto-apply the default Sales Taxes and Charges template on new documents only."""
    # Only apply on new documents — never overwrite user's manual tax changes
    if not doc.is_new():
        return
    if doc.get("taxes"):
        return  # already has tax rows — nothing to do

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
            "charge_type":  row.charge_type,
            "account_head": row.account_head,
            "description":  row.description,
            "rate":         row.rate,
            "included_in_print_rate": row.included_in_print_rate,
        })


def _set_default_terms(doc):
    """Auto-populate tc_name and terms on new documents only."""
    # Only apply on new documents — never overwrite user's manual edits
    if not doc.is_new():
        return
    if not doc.get("tc_name"):
        doc.tc_name = DEFAULT_TERMS
    if not doc.get("terms"):
        terms_text = frappe.db.get_value(
            "Terms and Conditions", doc.tc_name, "terms"
        )
        if terms_text:
            doc.terms = terms_text

def _set_sales_person(doc):
    """Auto-populate custom_sales_person from the document creator's first name."""
    if not doc.get("custom_sales_person"):
        full_name = frappe.db.get_value("User", doc.owner, "first_name")
        if full_name:
            doc.custom_sales_person = full_name


def _sync_sales_team(doc):
    """
    Mirror custom_sales_person into the standard sales_team child table so that
    ERPNext analytics and Sales Person reports work correctly.

    If the Quotation doctype does not expose a sales_team table field
    (e.g. removed via customisation), the function returns silently.
    Duplicate rows are never added.
    """
    # Safety: verify the field actually exists on this doctype before appending
    # Use doc.doctype so this works for both Quotation and Sales Order
    if not frappe.get_meta(doc.doctype).get_field("sales_team"):
        return

    sp_value = (doc.get("custom_sales_person") or "").strip()
    if not sp_value:
        return

    # Match by sales_person_name (the display name field on Sales Person)
    sp_name = frappe.db.get_value("Sales Person", {"sales_person_name": sp_value}, "name")

    if not sp_name:
        return  # No matching Sales Person master – skip silently

    # Guard against duplicate rows
    for row in doc.get("sales_team") or []:
        if row.sales_person == sp_name:
            return

    doc.append("sales_team", {
        "sales_person": sp_name,
        "allocated_percentage": 100,
    })

class CustomQuotation(Quotation):
    def autoname(self):
        self.flags.name_set = True
        autoname_quotation(self)


    def before_insert(self):
        _set_default_taxes(self)
        _set_default_terms(self)
        _set_sales_person(self)

    def validate(self):
        if not self.custom_location or self.custom_location == "Select":
            frappe.throw(frappe._("Please select a Location before saving."))
        _set_sales_person(self)
        _sync_sales_team(self)
        recalculate_items(self)
        super().validate()

    def set_status(self, update=False, status=None, update_modified=True):
        super().set_status(update=update, status=status, update_modified=update_modified)

        status_map = {
            "Open": "Pending",
            "Replied": "Pending",
            "Ordered": "Confirmed",
            "Partially Ordered": "Confirmed",
            "Lost": "Cancelled",
            "Expired": "Pending",
        }

        if self.status in status_map:
            self.status = status_map[self.status]
            if update:
                self.db_set("status", self.status, update_modified=update_modified)


@frappe.whitelist()
def reopen_quotation(name):
    """Reopen a cancelled Quotation, resetting it back to submitted (docstatus=1)."""
    doc = frappe.get_doc("Quotation", name)
    frappe.has_permission("Quotation", "cancel", doc=doc, throw=True)

    if doc.docstatus != 2:
        frappe.throw(frappe._("Only a cancelled Quotation can be reopened."))

    try:
        frappe.db.set_value("Quotation", name, "docstatus", 0)
        # Reset all child table rows — they carry docstatus=2 after cancellation
        # which makes them read-only even when the parent is back to Draft
        frappe.db.sql("UPDATE `tabQuotation Item` SET docstatus=0 WHERE parent=%s", name)
        frappe.db.sql("UPDATE `tabSales Taxes and Charges` SET docstatus=0 WHERE parent=%s AND parenttype='Quotation'", name)
        doc.reload()
        doc.set_status(update=True)
    except Exception:
        frappe.db.rollback()
        raise

    doc.add_comment("Edit", frappe._("Reopened by {0}").format(frappe.session.user))
    frappe.msgprint(
        frappe._("Quotation {0} has been reopened.").format(name),
        indicator="green",
        alert=True,
    )


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
                    "custom_location":       "custom_location",
                    "custom_reference_po":   "custom_reference_po",
                },
            },
            "Quotation Item": {
                "doctype": "Sales Order Item",
                "postprocess": postprocess,
                "condition": lambda row: row.qty != 0,
                "field_map": {
                    "custom_branding": "custom_branding",
                    "custom_marking":  "custom_marking",
                    "custom_thickness":  "custom_thickness",
                    "parent":          "prevdoc_docname",   # ← ADD THIS
                    "name":            "quotation_item",
                },
            },
            "Sales Taxes and Charges": {
                "doctype": "Sales Taxes and Charges",
                "add_if_empty": True,
            },
        },
        target_doc,
    )