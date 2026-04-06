app_name = "instabiz"
app_title = "Instabiz"
app_publisher = "Instabiz Solutions India Pvt Ltd"
app_description = "Custom ERP extensions for Instabiz"
app_version = "0.0.1"

# ── Fixtures ──────────────────────────────────────────────────────────────────
fixtures = [
    "Custom Field",
    {
        "dt": "Property Setter",
        "filters": [["doc_type", "in", ["Quotation", "Lead"]]]
    },
]
# ── Class overrides ───────────────────────────────────────────────────────────
# recalculate_items runs inside each class's validate(), so no need to also
# register it as a doc_event — that would execute it twice per save.
override_doctype_class = {
    "Quotation":     "instabiz.overrides.quotation.CustomQuotation",
    "Sales Order":   "instabiz.overrides.sales_order.CustomSalesOrder",
    "Delivery Note": "instabiz.overrides.delivery_note.CustomDeliveryNote",
    "Sales Invoice": "instabiz.overrides.sales_invoice.CustomSalesInvoice",
}

# ── Server-side doc events ────────────────────────────────────────────────────
# REMOVED: recalculate_* hooks — already handled inside the override classes
# above. Keeping them here caused double execution on every validate.
doc_events = {
    "User": {
        "after_insert": [
            "instabiz.overrides.user.create_sales_person_for_user",
            "instabiz.overrides.user.copy_admin_defaults",
            "instabiz.overrides.user.copy_admin_ui_settings",
        ],
    },
    "Lead": {
        "after_insert": "instabiz.overrides.lead.assign_lead_owner",
        "on_update":    "instabiz.overrides.lead.assign_lead_owner",
    },
}

# ── Whitelisted method overrides ──────────────────────────────────────────────
override_whitelisted_methods = {
    # Quotation → Sales Order
    "erpnext.selling.doctype.quotation.quotation.make_sales_order":
        "instabiz.overrides.quotation.custom_make_sales_order",

    # Sales Order → Delivery Note  ← THIS WAS MISSING
    "erpnext.selling.doctype.sales_order.sales_order.make_delivery_note":
        "instabiz.overrides.sales_order.custom_make_delivery_note",

    # Delivery Note → Sales Invoice
    "erpnext.stock.doctype.delivery_note.delivery_note.make_sales_invoice":
        "instabiz.overrides.delivery_note.custom_make_sales_invoice",

    # GSTIN lookup — replace India Compliance's paid API with free gstincheck.co.in
    "india_compliance.gst_india.utils.gstin_info.get_gstin_info":
        "instabiz.overrides.gstin.get_gstin_info",
}

# ── Frontend assets ───────────────────────────────────────────────────────────
app_include_css = ["/assets/instabiz/css/instabiz.css"]
app_include_js  = [
    "https://cdn.jsdelivr.net/npm/iconify-icon@2.1.0/dist/iconify-icon.min.js",  # Iconify icons (CDN)
    "/assets/instabiz/js/pincode.js",               # shared pincode autofill utility
    "/assets/instabiz/js/gstin.js",                 # GSTIN autofill (IC bypass)
    "/assets/instabiz/js/recalc.js",                # dimension → qty → amount helpers
    "/assets/instabiz/js/form.js",                  # form handlers (depends on recalc.js)
    "/assets/instabiz/js/quotation_list.js",        # Quotation list view
    "/assets/instabiz/js/sales_order_list.js",      # Sales Order list view
]

# ── DocType-specific list JS (appended AFTER the app's own list JS) ───────────
doctype_list_js = {
    "Employee Checkin": "public/js/employee_checkin_list.js",
    "Lead":             "public/js/lead_list.js",
}

doctype_js = {
    "Lead":    "public/js/lead.js",
    "Address": "public/js/address.js",
}