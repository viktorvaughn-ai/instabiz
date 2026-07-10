# ── Scheduler events ──────────────────────────────────────────────────────────
scheduler_events = {
    "daily": [
        # Runs on relieving_date — creates handover doc, notifies HR Managers
        "instabiz.overrides.employee_exit.run_exit_handover_daily",
        # Runs on relieving_date + 1 — disables the ERP user account (only for employees marked "Left")
        "instabiz.overrides.employee_exit.run_user_disable_daily",
        # Rolls over pending assignments and generates tomorrow's customer board
        "instabiz.overrides.customer_assignment.run_daily_assignment",
        # Sends bell notifications for leads with overdue follow-up dates
        "instabiz.overrides.follow_up.run_follow_up_reminders",
        # Quotation expiry alerts (15/7/1 day email) and auto-expire
        "instabiz.overrides.quotation_expiry.run_quotation_expiry",
        # Compute daily customer health scores (payment/orders/complaints/CSAT)
        "instabiz.overrides.customer_score.run_customer_score",
        # Flag customers with no SO in 60 days → ToDo + bell notification
        "instabiz.overrides.dormant.run_dormant_check",
        # Monthly sales target milestone notifications (50%/75% elapsed + end-of-month)
        "instabiz.overrides.sales_target.run_target_notifications",
        # Alert rep when SO has no DN after 48h
        "instabiz.overrides.fulfillment_sla.run_fulfillment_sla",
        # Stale quotation + cold lead win-back nudges
        "instabiz.overrides.winback.run_winback",
        # Alert purchase team when bin qty <= reorder level
        "instabiz.overrides.reorder_alert.run_reorder_alert",
        # Alert warehouse/purchase managers for batches expiring within 30 days
        "instabiz.overrides.expiry_alert.run_expiry_alert",
        # Alert purchase team for submitted POs with no linked GRN after 7 days
        "instabiz.overrides.po_followup.run_po_followup",
        # Auto-mark absent for employees with no attendance on previous working day
        "instabiz.overrides.auto_absent.run_auto_absent",
        # Alert HR when employee documents (Passport, PAN, etc.) expire within 30/7 days
        "instabiz.overrides.employee_docs.run_employee_doc_expiry",
        # Alert Purchase roles when PO payment due within 7 days
        "instabiz.overrides.vendor_payment_alert.run_vendor_payment_alert",
        # Overdue Sales Invoice reminders: 7d bell to rep, 15d to managers, 30d block + bell
        "instabiz.overrides.overdue_alert.run_overdue_alert",
        # Alert Accounts/Sales when PDC cheque date is 3 days away
        "instabiz.overrides.pdc_alert.run_pdc_alert",
        # Send WA re-engagement to customers with no SO in 30+ days
        "instabiz.overrides.whatsapp.run_wa_dormant_blast",
        # Daily production snapshot — reserved for future DPR caching
        "instabiz.overrides.production.run_daily_production_snapshot",
        # AI agents — auto_quote, demand_forecast, smart_reorder, collections, istix_enforcer, buying_dna
        "instabiz.overrides.ai_agents.run_daily_agents",
        # Monthly payroll draft creation — fires daily but only acts on the 7th
        "instabiz.overrides.payroll.run_monthly_payroll_draft",
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
        "filters": [["doc_type", "in", ["Quotation", "Sales Order", "Lead", "Delivery Note", "Customer"]]]
    },
    {
        "dt": "Purchase Taxes and Charges Template",
        "filters": [["company", "=", "Instabiz Solutions India Pvt Ltd"]]
    },
    {
        "dt": "Sales Taxes and Charges Template",
        "filters": [["company", "=", "Instabiz Solutions India Pvt Ltd"]]
    },
]
# ── Class overrides ───────────────────────────────────────────────────────────
# recalculate_items runs inside each class's validate(), so no need to also
# register it as a doc_event — that would execute it twice per save.
override_doctype_class = {
    "Quotation":         "instabiz.overrides.quotation.CustomQuotation",
    "Sales Order":       "instabiz.overrides.sales_order.CustomSalesOrder",
    "Delivery Note":     "instabiz.overrides.delivery_note.CustomDeliveryNote",
    "Sales Invoice":     "instabiz.overrides.sales_invoice.CustomSalesInvoice",
    "Purchase Order":    "instabiz.overrides.purchase_order.CustomPurchaseOrder",
    "Purchase Receipt":  "instabiz.overrides.purchase_receipt.CustomPurchaseReceipt",
    "Purchase Invoice":  "instabiz.overrides.purchase_invoice.CustomPurchaseInvoice",
    "Customer":          "instabiz.overrides.customer.CustomCustomer",
    "Salary Slip":       "instabiz.overrides.salary_slip.CustomSalarySlip",
}

# ── Server-side doc events ────────────────────────────────────────────────────
# REMOVED: recalculate_* hooks — already handled inside the override classes
# above. Keeping them here caused double execution on every validate.
doc_events = {
    "Quotation": {
        "on_submit": "instabiz.overrides.whatsapp.on_quotation_submit",
    },
    "User": {
        "after_insert": [
            "instabiz.overrides.user.create_sales_person_for_user",
            "instabiz.overrides.user.copy_admin_defaults",
            "instabiz.overrides.user.copy_admin_ui_settings",
        ],
    },
    "Lead Sales Team": {
        "after_save": "instabiz.overrides.customer_assignment.sync_team_leader_role",
    },
    "Lead": {
        "before_insert": [
            "instabiz.overrides.lead.check_duplicate_lead",
            "instabiz.overrides.lead.set_territory_from_pincode",
            "instabiz.overrides.lead.compute_lead_score",
        ],
        "after_insert": "instabiz.overrides.lead.assign_lead_owner",
        "on_update":    [
            "instabiz.overrides.lead.assign_lead_owner",
            "instabiz.overrides.lead.compute_lead_score",
        ],
    },
    "Item": {
        "before_save": "instabiz.overrides.item.set_batch_no_for_fg",
    },
    "Comment": {
        "after_insert": "instabiz.overrides.comment.notify_owner_on_comment",
    },
    "Employee": {
        "after_save": "instabiz.overrides.employee_drive.sync_employee_docs_to_drive",
    },
    "Sales Order": {
        "on_submit": [
            "instabiz.overrides.stock_events.publish_stock_update",
            "instabiz.overrides.customer_assignment.mark_assignment_done_on_so",
        ],
        "on_cancel": "instabiz.overrides.stock_events.publish_stock_update",
    },
    "Delivery Note": {
        "on_submit": [
            "instabiz.overrides.stock_events.publish_stock_update",
            "instabiz.overrides.dispatch_notification.run_dispatch_notification",
            "instabiz.overrides.ewaybill.run_ewaybill_on_submit",
        ],
        "on_cancel": "instabiz.overrides.stock_events.publish_stock_update",
    },
    "Sales Invoice": {
        "on_update": "instabiz.overrides.si_drive_sync.sync_si_documents_to_drive",
        "on_submit": [
            "instabiz.overrides.customer.update_customer_outstanding_on_si",
            "instabiz.overrides.si_drive_sync.sync_si_documents_to_drive",
            "instabiz.overrides.einvoice.run_einvoice_on_submit",
        ],
        "on_cancel": "instabiz.overrides.customer.update_customer_outstanding_on_si",
        "on_trash":  "instabiz.overrides.customer.update_customer_outstanding_on_si",
    },
    "Payment Entry": {
        "before_submit": "instabiz.overrides.payment_entry.before_submit",
        "on_submit":     "instabiz.overrides.payment_entry.on_submit",
        "on_cancel":     "instabiz.overrides.payment_entry.on_cancel",
    },
    "Stock Entry": {
        "on_submit": "instabiz.overrides.stock_events.publish_stock_update",
        "on_cancel": "instabiz.overrides.stock_events.publish_stock_update",
    },
    "Stock Reconciliation": {
        "on_submit": "instabiz.overrides.stock_events.publish_stock_update",
        "on_cancel": "instabiz.overrides.stock_events.publish_stock_update",
    },
    "IB Work Order": {
        "on_update": [
            "instabiz.overrides.n8n_hooks.on_work_order_update",
            "instabiz.overrides.production.on_work_order_update_notify",
        ],
    },
    "IB Order Sheet": {
        "after_insert": "instabiz.overrides.n8n_hooks.on_order_sheet_created",
        "on_update":    "instabiz.overrides.n8n_hooks.on_order_sheet_updated",
    },
}

# ── Row-level permission restrictions ────────────────────────────────────────
# Users only see documents they own or are assigned to (custom_sales_person_user
# for sales docs, lead_owner for Leads).
# Roles in _PRIVILEGED_ROLES (System Manager, Sales Manager) bypass the filter.
permission_query_conditions = {
    "Lead":              "instabiz.overrides.lead.get_permission_query_conditions",
    "Customer":          "instabiz.overrides.permissions.customer_query_conditions",
    "Quotation":         "instabiz.overrides.permissions.quotation_query_conditions",
    "Sales Order":       "instabiz.overrides.permissions.sales_order_query_conditions",
    "Delivery Note":     "instabiz.overrides.permissions.delivery_note_query_conditions",
    "Sales Invoice":     "instabiz.overrides.permissions.sales_invoice_query_conditions",
    "Employee Checkin":  "instabiz.overrides.checkin.employee_checkin_query_conditions",
}

has_permission = {
    "Lead":              "instabiz.overrides.lead.has_permission",
    "Customer":          "instabiz.overrides.permissions.customer_has_permission",
    "Quotation":         "instabiz.overrides.permissions.quotation_has_permission",
    "Sales Order":       "instabiz.overrides.permissions.sales_order_has_permission",
    "Delivery Note":     "instabiz.overrides.permissions.delivery_note_has_permission",
    "Sales Invoice":     "instabiz.overrides.permissions.sales_invoice_has_permission",
    "Employee Checkin":  "instabiz.overrides.checkin.employee_checkin_has_permission",
}

# ── Whitelisted method overrides ──────────────────────────────────────────────
override_whitelisted_methods = {
    # Quotation → Sales Order
    "erpnext.selling.doctype.quotation.quotation.make_sales_order":
        "instabiz.overrides.quotation.custom_make_sales_order",

    # Sales Order → Delivery Note
    "erpnext.selling.doctype.sales_order.sales_order.make_delivery_note":
        "instabiz.overrides.sales_order.custom_make_delivery_note",

    # Delivery Note → Sales Invoice
    "erpnext.stock.doctype.delivery_note.delivery_note.make_sales_invoice":
        "instabiz.overrides.delivery_note.custom_make_sales_invoice",

    # e-Waybill generation — accept transaction_type override from UI
    "india_compliance.gst_india.utils.e_waybill.generate_e_waybill":
        "instabiz.overrides.ewaybill.custom_generate_e_waybill",

    # Lead → Customer (carry territory, pincode, sales person)
    "erpnext.crm.doctype.lead.lead.make_customer":
        "instabiz.overrides.lead.custom_make_customer",

    # Workspace shortcut role filtering
    "frappe.desk.desktop.get_desktop_page":
        "instabiz.overrides.workspace_filter.get_desktop_page",
}

# ── Frontend assets ───────────────────────────────────────────────────────────
app_include_css = ["/assets/instabiz/css/instabiz.css"]
app_include_js  = [
    "https://cdn.jsdelivr.net/npm/iconify-icon@2.1.0/dist/iconify-icon.min.js",  # Iconify icons (CDN)
    "/assets/instabiz/js/ib_color_map.js",            # item color name → hex mapping
    "/assets/instabiz/js/ib_icons.js",                # shared SVG icon registry (IB_ICONS.svg)
    "/assets/instabiz/js/ib_stock_common.js",         # shared stock page utilities (IBStock.*)
    "/assets/instabiz/js/pincode.js",               # shared pincode autofill utility
    "/assets/instabiz/js/recalc.js",                # dimension → qty → amount helpers
    "/assets/instabiz/js/form.js",                  # form handlers (depends on recalc.js)
    "/assets/instabiz/js/list_utils.js",            # shared list view helpers (status multiselect, extract filter values)
    "/assets/instabiz/js/comment_popover.js",       # inline comment popover on list rows
    "/assets/instabiz/js/whatsapp_dialog.js",       # global WA send dialog (ib_show_wa_dialog)
    "/assets/instabiz/js/ib_list_print.js",         # shared list view print utility
    "/assets/instabiz/js/ib_dash_utils.js",         # dashboard shared: countUp loader, skeleton helpers, fmt
    "/assets/instabiz/js/so_production_panel.js",  # SO form: production stage + dispatch status panel
    # "/assets/instabiz/js/broadcast.js",            # global broadcast modal subscriber — DISABLED
    # ib_stock_dashboard.js is loaded by Frappe's page engine (not global)
    # "/assets/instabiz/js/quotation_list.js",        # Quotation list view
    # "/assets/instabiz/js/sales_order_list.js",      # Sales Order list view
    "/assets/instabiz/js/app_redirect.js"
]

# ── DocType-specific list JS (appended AFTER the app's own list JS) ───────────
doctype_list_js = {
    "Employee Checkin":  "public/js/employee_checkin_list.js",
    "Lead":              "public/js/lead_list.js",
    "Quotation":         "public/js/quotation_list.js",
    "Sales Order":       "public/js/sales_order_list.js",
    "Delivery Note":     "public/js/delivery_note_list.js",
    "Sales Invoice":     "public/js/sales_invoice_list.js",
    "Purchase Order":    "public/js/purchase_order_list.js",
    "Purchase Receipt":  "public/js/purchase_receipt_list.js",
    "Purchase Invoice":  "public/js/purchase_invoice_list.js",
    "IB Item Price List": "public/js/ib_item_price_list_list.js",
    "Customer":          "public/js/customer_list.js",
    "GL Entry":          "public/js/gl_entry_list.js",
}

doctype_js = {
    "Lead":                    "public/js/lead.js",
    "Address":                 "public/js/address.js",
    "Customer":                "public/js/customer.js",
    "Quotation":               "public/js/ib_sales_common.js",
    "Sales Order":             "public/js/ib_sales_common.js",
    "Employee Exit Handover":  "public/js/employee_exit_handover.js",
    "IB Sample Request":       "public/js/sample_request.js",
    "Employee":                "public/js/employee.js",
    "Job Applicant":           "public/js/job_applicant.js",
    "Sales Invoice":           "public/js/sales_invoice.js",
    "Delivery Note":           "public/js/delivery_note.js",
    "Purchase Order":          "public/js/ib_purchase_common.js",
    "Purchase Receipt":        "public/js/ib_purchase_common.js",
    "Purchase Invoice":        "public/js/ib_purchase_common.js",
    "IB WA Session":           "public/js/ib_wa_session.js",
    "IB Credit Note":          "public/js/ib_credit_note.js",
    "IB Debit Note":           "public/js/ib_debit_note.js",
}
