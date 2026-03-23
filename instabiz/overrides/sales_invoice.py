"""instabiz.overrides.sales_invoice"""
from erpnext.accounts.doctype.sales_invoice.sales_invoice import SalesInvoice
from instabiz.overrides.utils import recalculate_items


def recalculate_sales_invoice(doc, method=None):
    recalculate_items(doc)


class CustomSalesInvoice(SalesInvoice):
    def validate(self):
        recalculate_items(self)
        super().validate()