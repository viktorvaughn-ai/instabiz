"""instabiz.overrides.sales_invoice"""
import frappe
from erpnext.accounts.doctype.sales_invoice.sales_invoice import SalesInvoice  # pyright: ignore[reportMissingImports]
from instabiz.overrides.utils import recalculate_items
from instabiz.overrides.naming import autoname_sales_invoice


# Consolidate ERPNext's verbose SI statuses into user-friendly labels.
# All target values ("Unpaid", "Overdue", "Paid") are valid ERPNext options,
# so no _validate_selects override is needed.
_SI_STATUS_MAP = {
    "Partly Paid":                "Unpaid",
    "Unpaid and Discounted":      "Unpaid",
    "Partly Paid and Discounted": "Unpaid",
    "Submitted":                  "Unpaid",
    "Overdue and Discounted":     "Overdue",
    "Credit Note Issued":         "Paid",
}


def _set_sales_person(doc):
    """Populate custom_sales_person (display) and custom_sales_person_user (email)."""
    if not doc.get("custom_sales_person"):
        first_name = frappe.db.get_value("User", doc.owner, "first_name")
        if first_name:
            doc.custom_sales_person = first_name
    if not doc.get("custom_sales_person_user"):
        doc.custom_sales_person_user = doc.owner


class CustomSalesInvoice(SalesInvoice):
    def autoname(self):
        self.flags.name_set = True
        autoname_sales_invoice(self)

    def before_insert(self):
        _set_sales_person(self)

    def validate(self):
        _set_sales_person(self)
        recalculate_items(self)
        super().validate()

    def set_status(self, update=False, status=None, update_modified=True):
        super().set_status(update=update, status=status, update_modified=update_modified)
        if self.status in _SI_STATUS_MAP:
            self.status = _SI_STATUS_MAP[self.status]
            if update:
                self.db_set("status", self.status, update_modified=update_modified)
