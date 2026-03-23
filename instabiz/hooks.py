app_name = "instabiz"
app_title = "Instabiz"
app_publisher = "Instabiz Solutions India Pvt Ltd"
app_description = "Custom ERP extensions for Instabiz"
app_version = "0.0.1"

# ── Fixtures ─────────────────────────────────────────────────────────────────
fixtures = ["Custom Field"]

# ── Class overrides ───────────────────────────────────────────────────────────
override_doctype_class = {
    "Quotation":     "instabiz.overrides.quotation.CustomQuotation",
    "Sales Order":   "instabiz.overrides.sales_order.CustomSalesOrder",
    "Delivery Note": "instabiz.overrides.delivery_note.CustomDeliveryNote",
    "Sales Invoice": "instabiz.overrides.sales_invoice.CustomSalesInvoice",
}

# ── Server-side doc events ────────────────────────────────────────────────────
doc_events = {
"Quotation": {"validate": "instabiz.overrides.quotation.recalculate_quotation"},
"Sales Order": {"validate": "instabiz.overrides.sales_order.recalculate_sales_order"},
"Delivery Note": {"validate": "instabiz.overrides.delivery_note.recalculate_delivery_note"},
"Sales Invoice": {"validate": "instabiz.overrides.sales_invoice.recalculate_sales_invoice"},
}

# ── Whitelisted method overrides ──────────────────────────────────────────────
override_whitelisted_methods = {
    "erpnext.selling.doctype.quotation.quotation.make_sales_order":
        "instabiz.overrides.quotation.custom_make_sales_order",
    "erpnext.stock.doctype.delivery_note.delivery_note.make_sales_invoice":
        "instabiz.overrides.delivery_note.custom_make_sales_invoice",
}

# ── Frontend assets ───────────────────────────────────────────────────────────
app_include_css = ["/assets/instabiz/css/instabiz.css"]
#web_include_css = ["/assets/instabiz/css/instabiz.css"]

app_include_js = ["/assets/instabiz/js/instabiz.js"]
