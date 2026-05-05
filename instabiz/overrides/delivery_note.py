"""instabiz.overrides.delivery_note"""
import frappe
from erpnext.stock.doctype.delivery_note.delivery_note import (
    DeliveryNote,  # pyright: ignore[reportMissingImports]
)
from frappe.model.mapper import get_mapped_doc  # pyright: ignore[reportMissingImports]

from instabiz.overrides.naming import autoname_delivery_note
from instabiz.overrides.utils import (
    COMMON_PARENT_FIELD_MAP,
    IbStatusMixin,
    item_postprocess,
    map_address_contact_fields,
    map_parent_fields,
    recalculate_items,
    set_sales_person,
    sync_sales_team,
)

# ── Document class ────────────────────────────────────────────────────────────

class CustomDeliveryNote(IbStatusMixin, DeliveryNote):
    STATUS_MAP = {
        "To Bill":   "Pending",
        "Completed": "Confirmed",
        "Closed":    "Confirmed",
    }

    def autoname(self):
        self.flags.name_set = True
        autoname_delivery_note(self)

    def before_insert(self):
        set_sales_person(self)

    def validate(self):
        set_sales_person(self)
        sync_sales_team(self)
        recalculate_items(self)
        super().validate()

    def before_submit(self):
        missing = []
        if not (self.get("lr_no") or self.get("custom_lr_number")):
            missing.append("LR Number")
        if not (self.get("custom_transport") or self.get("transporter")):
            missing.append("Transporter / Transport Company")
        if missing:
            from frappe import _
            frappe.throw(
                _("Cannot submit — fill in before dispatch:") + "<br>"
                + "<br>".join(f"• {m}" for m in missing),
                title=_("Missing Dispatch Info"),
            )


# ── Mapper: Delivery Note → Sales Invoice ─────────────────────────────────────

@frappe.whitelist()
def custom_make_sales_invoice(source_name, target_doc=None):
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
                    **COMMON_PARENT_FIELD_MAP,
                    "name": "delivery_note",
                },
            },
            "Delivery Note Item": {
                "doctype": "Sales Invoice Item",
                "postprocess": item_postprocess,
                "condition": lambda row: row.qty != 0,
            },
            "Sales Taxes and Charges": {
                "doctype": "Sales Taxes and Charges",
                "add_if_empty": True,
            },
        },
        target_doc,
    )
