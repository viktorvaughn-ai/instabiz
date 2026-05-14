"""instabiz.overrides.sales_invoice"""
import frappe
from erpnext.accounts.doctype.sales_invoice.sales_invoice import SalesInvoice  # pyright: ignore[reportMissingImports]

from instabiz.overrides.utils import IbStatusMixin, recalculate_items, set_sales_person, sync_sales_team
from instabiz.overrides.naming import autoname_sales_invoice


# ── Document class ────────────────────────────────────────────────────────────

class CustomSalesInvoice(IbStatusMixin, SalesInvoice):
    # All target values ("Unpaid", "Overdue", "Paid") are already valid ERPNext
    # SI status options so no _validate_selects override is needed — the mixin's
    # default swap-to-Draft guard still runs harmlessly.
    STATUS_MAP = {
        "Partly Paid":                "Unpaid",
        "Unpaid and Discounted":      "Unpaid",
        "Partly Paid and Discounted": "Unpaid",
        "Submitted":                  "Unpaid",
        "Overdue and Discounted":     "Overdue",
        "Credit Note Issued":         "Paid",
    }

    def autoname(self):
        self.flags.name_set = True
        autoname_sales_invoice(self)

    def before_insert(self):
        set_sales_person(self)

    def validate(self):
        if not self.custom_location or self.custom_location == "Select":
            frappe.throw(frappe._("Please select a Location before saving."))
        set_sales_person(self)
        sync_sales_team(self)
        recalculate_items(self)
        super().validate()
