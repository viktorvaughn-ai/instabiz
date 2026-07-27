"""instabiz.overrides.delivery_note"""
import frappe
from erpnext.stock.doctype.delivery_note.delivery_note import (
    DeliveryNote,  # pyright: ignore[reportMissingImports]
)
from frappe.model.mapper import get_mapped_doc  # pyright: ignore[reportMissingImports]

from instabiz.overrides.naming import autoname_delivery_note
from instabiz.overrides.quotation import _auto_correct_gst_template
from instabiz.overrides.utils import (
    COMMON_CHILD_FIELD_MAP,
    COMMON_PARENT_FIELD_MAP,
    LOCATION_COMPANY_ADDRESS,
    LOCATION_COMPANY_GSTIN,
    IbStatusMixin,
    apply_location_cost_center,
    item_postprocess,
    map_address_contact_fields,
    map_parent_fields,
    recalculate_items,
    set_sales_person,
    sync_sales_team,
    _guard_document_attachments,
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
        if not self.custom_location or self.custom_location == "Select":
            frappe.throw(frappe._("Please select a Location before saving."))
        loc = (self.custom_location or "").lower()
        addr = LOCATION_COMPANY_ADDRESS.get(loc)
        if addr:
            self.company_address = addr
            self.dispatch_address_name = None
        gstin = LOCATION_COMPANY_GSTIN.get(loc)
        if gstin:
            self.company_gstin = gstin
        _auto_correct_gst_template(self)
        set_sales_person(self)
        sync_sales_team(self)
        recalculate_items(self)
        apply_location_cost_center(self)
        _guard_document_attachments(self)
        super().validate()

    def on_update_after_submit(self):
        recalculate_items(self)
        try:
            super().on_update_after_submit()
        except AttributeError:
            pass

    def before_cancel(self):
        if not (self.custom_cancel_reason or "").strip():
            frappe.throw(frappe._("Fill in Cancellation Reason before cancelling this Delivery Note."))

    def before_submit(self):
        _auto_create_sr_if_needed(self)


# ── Auto Stock Reconciliation on insufficient stock ───────────────────────────

def _auto_create_sr_if_needed(dn):
    """Check actual stock per item/warehouse. If any row is short, create a
    draft Stock Reconciliation covering the shortfall and throw with a link."""
    from frappe.utils import today

    company = frappe.defaults.get_global_default("company") or dn.company

    # Aggregate required qty per (item_code, warehouse)
    required: dict[tuple, float] = {}
    for row in dn.items:
        if not row.item_code or not row.warehouse:
            continue
        item_has_batch = frappe.db.get_value("Item", row.item_code, "has_batch_no")
        if item_has_batch:
            continue  # batch items need bundles — skip
        key = (row.item_code, row.warehouse)
        required[key] = required.get(key, 0.0) + (row.qty or 0.0)

    if not required:
        return

    # Fetch actual stock in one query
    keys_list = list(required.keys())
    item_codes = list({k[0] for k in keys_list})
    warehouses  = list({k[1] for k in keys_list})

    bins = frappe.db.sql(
        """SELECT item_code, warehouse, actual_qty
           FROM `tabBin`
           WHERE item_code IN %(items)s AND warehouse IN %(wh)s""",
        {"items": item_codes, "wh": warehouses},
        as_dict=True,
    )
    actual: dict[tuple, float] = {(b.item_code, b.warehouse): b.actual_qty for b in bins}

    shortfall = [
        {"item_code": ic, "warehouse": wh, "needed": qty, "have": actual.get((ic, wh), 0.0)}
        for (ic, wh), qty in required.items()
        if actual.get((ic, wh), 0.0) < qty
    ]

    if not shortfall:
        return

    # Fetch expense account for stock adjustment
    expense_account = frappe.db.get_value("Company", company, "stock_adjustment_account") \
        or "Stock Adjustment - IB"

    sr = frappe.get_doc({
        "doctype": "Stock Reconciliation",
        "purpose": "Stock Reconciliation",
        "posting_date": today(),
        "company": company,
        "expense_account": expense_account,
        "items": [
            {
                "item_code": row["item_code"],
                "warehouse": row["warehouse"],
                # Set qty to exactly what this DN needs
                "qty": row["needed"],
                "valuation_rate": frappe.db.get_value("Item", row["item_code"], "valuation_rate") or 1.0,
            }
            for row in shortfall
        ],
    })
    sr.insert(ignore_permissions=True)

    lines = "".join(
        f"<li>{r['item_code']} — need {r['needed']}, have {r['have']} in {r['warehouse']}</li>"
        for r in shortfall
    )
    sr_link = f'<a href="/app/stock-reconciliation/{sr.name}">{sr.name}</a>'
    frappe.throw(
        frappe._(
            "Insufficient stock for {0} item(s). A draft Stock Reconciliation {1} has been "
            "created. Submit it to add stock, then re-submit this Delivery Note.<ul>{2}</ul>"
        ).format(len(shortfall), sr_link, lines),
        title=frappe._("Stock Reconciliation Required"),
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
                "field_map": {
                    **COMMON_CHILD_FIELD_MAP,
                    "name":   "dn_detail",
                    "parent": "delivery_note",
                },
            },
            "Sales Taxes and Charges": {
                "doctype": "Sales Taxes and Charges",
                "add_if_empty": True,
            },
        },
        target_doc,
    )
