# ── Scheduler events ──────────────────────────────────────────────────────────
scheduler_events = {
    "daily": [
        # Runs on relieving_date — creates handover doc, notifies HR Managers
        "instabiz.overrides.employee_exit.run_exit_handover_daily",
        # Runs on relieving_date + 1 — disables the ERP user account (only for employees marked "Left")
        "instabiz.overrides.employee_exit.run_user_disable_daily",
    ],
}

# ── Employee Exit Handover: pending document sources ───────────────────────────
# Each entry declares one DocType whose "pending" documents should surface in the
# Employee Exit Handover when the owning employee leaves.
#
# owner_field      : field on the DocType that holds the owner identifier.
# owner_value_from : if set, the owner_field stores a User attribute (e.g.
#                   "first_name") rather than the email. The engine looks up
#                   this attribute from the exiting user's User record to build
#                   the filter and to set the new value on reassignment.
# title_field      : field shown as the document description in the handover.
# module           : display label for the Module column.
# pending_filter   : frappe.get_all-compatible filter dict for "open" docs only.
#
# To add a new module: append one dict here. Zero engine changes required.
exit_handover_sources = [
    {
        "doctype":            "Quotation",
        "owner_field":        "custom_sales_person_user",  # stores user email — unique & stable
        "display_name_field": "custom_sales_person",       # display name updated on reassignment
        "title_field":        "name",
        "module":             "Sales",
        "pending_filter":     {
            # instabiz maps ERPNext "Open"/"Replied"/"Expired" → "Pending"
            "status":    "Pending",
            "docstatus": 1,
        },
    },
    {
        "doctype":            "Sales Order",
        "owner_field":        "custom_sales_person_user",  # stores user email — unique & stable
        "display_name_field": "custom_sales_person",       # display name updated on reassignment
        "title_field":        "name",
        "module":             "Sales",
        "pending_filter":     {
            "status":    ["in", ["Pending", "Dispatched"]],
            "docstatus": 1,
        },
    },
    {
        "doctype":            "Delivery Note",
        "owner_field":        "custom_sales_person_user",
        "display_name_field": "custom_sales_person",
        "title_field":        "name",
        "module":             "Stock",
        "pending_filter":     {
            "docstatus":  0,
            "is_return":  0,   # exclude credit/return DNs
        },
    },
    {
        "doctype":            "Sales Invoice",
        "owner_field":        "custom_sales_person_user",
        "display_name_field": "custom_sales_person",
        "title_field":        "name",
        "module":             "Accounts",
        "pending_filter":     {
            "status":    ["in", ["Draft", "Unpaid", "Overdue"]],
            "docstatus": ["in", [0, 1]],   # exclude cancelled invoices
            "is_return": 0,                # exclude credit notes
        },
    },
]

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
        "filters": [["doc_type", "in", ["Quotation", "Sales Order", "Lead", "Delivery Note"]]]
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
    "Customer":      "instabiz.overrides.customer.CustomCustomer",
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

# ── Row-level permission restrictions ────────────────────────────────────────
# Users only see documents they own or are assigned to (custom_sales_person_user
# for sales docs, lead_owner for Leads).
# Roles in _PRIVILEGED_ROLES (System Manager, Sales Manager) bypass the filter.
permission_query_conditions = {
    "Lead":          "instabiz.overrides.lead.get_permission_query_conditions",
    "Quotation":     "instabiz.overrides.permissions.quotation_query_conditions",
    "Sales Order":   "instabiz.overrides.permissions.sales_order_query_conditions",
    "Delivery Note": "instabiz.overrides.permissions.delivery_note_query_conditions",
    "Sales Invoice": "instabiz.overrides.permissions.sales_invoice_query_conditions",
}

has_permission = {
    "Lead":          "instabiz.overrides.lead.has_permission",
    "Quotation":     "instabiz.overrides.permissions.quotation_has_permission",
    "Sales Order":   "instabiz.overrides.permissions.sales_order_has_permission",
    "Delivery Note": "instabiz.overrides.permissions.delivery_note_has_permission",
    "Sales Invoice": "instabiz.overrides.permissions.sales_invoice_has_permission",
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


}

# ── Frontend assets ───────────────────────────────────────────────────────────
app_include_css = ["/assets/instabiz/css/instabiz.css"]
app_include_js  = [
    "https://cdn.jsdelivr.net/npm/iconify-icon@2.1.0/dist/iconify-icon.min.js",  # Iconify icons (CDN)
    "/assets/instabiz/js/pincode.js",               # shared pincode autofill utility
    "/assets/instabiz/js/recalc.js",                # dimension → qty → amount helpers
    "/assets/instabiz/js/form.js",                  # form handlers (depends on recalc.js)
    # ib_stock_dashboard.js is loaded by Frappe's page engine (not global)
    # "/assets/instabiz/js/quotation_list.js",        # Quotation list view
    # "/assets/instabiz/js/sales_order_list.js",      # Sales Order list view
]

# ── DocType-specific list JS (appended AFTER the app's own list JS) ───────────
doctype_list_js = {
    "Employee Checkin": "public/js/employee_checkin_list.js",
    "Lead":             "public/js/lead_list.js",
    "Quotation":        "public/js/quotation_list.js",
    "Sales Order":      "public/js/sales_order_list.js",
    "Delivery Note":    "public/js/delivery_note_list.js",
    "Sales Invoice":    "public/js/sales_invoice_list.js",
}

doctype_js = {
    "Lead":                    "public/js/lead.js",
    "Address":                 "public/js/address.js",
    "Customer":                "public/js/customer.js",
    "Quotation":               "public/js/ib_sales_common.js",
    "Sales Order":             "public/js/ib_sales_common.js",
    "Employee Exit Handover":  "public/js/employee_exit_handover.js",
}