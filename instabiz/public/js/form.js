/**
 * form.js
 * Form-level handlers for all IB transaction doctypes.
 * Optimized for Frappe v15 to prevent UI rounding jitters on blur.
 * Depends on: recalc.js
 */

/**
 * ib_hide_sidebar()
 * Collapse the Frappe list-view filter sidebar.
 */
function ib_hide_sidebar() {
    const route = frappe.get_route();
    if (!route || route[0] !== "List") return;
    $('.layout-side-section').css({ display: 'none', transition: 'none' });
    $('.layout-main-section').css('margin-left', '0');
}

// Global router listener
frappe.router.on("change", function () {
    ib_hide_sidebar();
});

const IB_DOCTYPES        = ["Quotation", "Sales Order", "Delivery Note", "Sales Invoice"];
const IB_REOPEN_DOCTYPES = ["Quotation", "Sales Order"];
const IB_DEBOUNCE        = 500; // Increased to 500ms for stable decimal input

IB_DOCTYPES.forEach(function (doctype) {
    frappe.ui.form.on(doctype, {
        refresh(frm) {
            // Disable auto-fetch for UOM to maintain manual selection control
            const uom_df = frappe.meta.get_docfield(`${doctype} Item`, "uom");
            if (uom_df) {
                uom_df.fetch_from = "";
                uom_df.fetch_enabled = 0;
            }

            frm.set_query("item_code", "items", () => ({ page_length: 50 }));

            // Clicking the row index number opens the row dialog (same as pencil icon)
            const $grid = frm.fields_dict.items.grid.wrapper;
            $grid.off("click.ib_row_open").on("click.ib_row_open", ".grid-row .row-index", function () {
                const docname = $(this).closest(".grid-row").attr("data-name");
                const grid_row = frm.fields_dict.items.grid.grid_rows_by_docname[docname];
                if (grid_row) grid_row.toggle_view(true);
            });

            // UI cleanup for Draft documents
            if (frm.doc.docstatus === 0) {
                frm.remove_custom_button(__("Cancel"));
                if (frm.page.btn_secondary) frm.page.btn_secondary.hide();
            }

            // Custom Reopen logic for Cancelled documents
            if (
                frm.doc.docstatus === 2 &&
                IB_REOPEN_DOCTYPES.includes(doctype) &&
                frappe.model.can_cancel(doctype)
            ) {
                frm.page.set_primary_action(__("Reopen"), function () {
                    frappe.confirm(
                        __("Reopen this {0}?").replace("{0}", __(doctype)),
                        function () {
                            frappe.call({
                                method: doctype === "Quotation"
                                    ? "instabiz.overrides.quotation.reopen_quotation"
                                    : "instabiz.overrides.sales_order.reopen_sales_order",
                                args: { name: frm.doc.name },
                                freeze: true,
                                freeze_message: __("Reopening…"),
                                callback: function (r) { 
                                    if (!r.exc) window.location.reload(); 
                                },
                            });
                        }
                    );
                });
            }
        },


        after_save:   (frm) => frm.refresh(),
        on_submit:    (frm) => frm.refresh(),
        after_cancel: (frm) => frm.refresh(),
    });

    // Child Table Triggers
    frappe.ui.form.on(`${doctype} Item`, {
        item_code(frm, cdt, cdn) {
            // Reset UOM once on item change without double-triggering refreshes
            frappe.model.set_value(cdt, cdn, "uom", "");
            
            // Allow Frappe to finish fetching item defaults before we recalc
            setTimeout(async () => {
                await ib_recalc_row(frm, cdt, cdn, true);
            }, 600);
        },

        // Dimension triggers - Recalculate Qty then Amount
        uom:        ib_debounce(async (frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, true),  IB_DEBOUNCE),
        width_mm:   ib_debounce(async (frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, true),  IB_DEBOUNCE),
        length_mtr: ib_debounce(async (frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, true),  IB_DEBOUNCE),
        qty_pkg:    ib_debounce(async (frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, true),  IB_DEBOUNCE),
        total_pkg:  ib_debounce(async (frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, true),  IB_DEBOUNCE),
        
        // Direct value triggers - Recalculate Amount only
        qty:        ib_debounce(async (frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, false), IB_DEBOUNCE),
        rate:       ib_debounce(async (frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, false), IB_DEBOUNCE),

        items_remove: (frm) => frm.refresh_field("items"),
    });
});

// ── Quotation: Sale Type → clear taxes when Export ───────────────────────────

frappe.ui.form.on("Quotation", {
    custom_sale_type(frm) {
        if (frm.doc.custom_sale_type === "Export") {
            setTimeout(() => {
                frm.doc.taxes_and_charges = "";
                frm.refresh_field("taxes_and_charges");
                frm.clear_table("taxes");
                frm.refresh_field("taxes");
            }, 100);
        } else {
            frappe.db.get_value(
                "Sales Taxes and Charges Template",
                { is_default: 1, company: frm.doc.company },
                "name"
            ).then(r => {
                const tpl_name = r && r.message && r.message.name;
                if (!tpl_name) return;
                frappe.db.get_doc("Sales Taxes and Charges Template", tpl_name)
                    .then(template => {
                        frm.doc.taxes_and_charges = tpl_name;
                        frm.refresh_field("taxes_and_charges");
                        frm.clear_table("taxes");
                        (template.taxes || []).forEach(row => {
                            const child = frm.add_child("taxes");
                            child.charge_type            = row.charge_type;
                            child.account_head           = row.account_head;
                            child.description            = row.description;
                            child.rate                   = row.rate;
                            child.included_in_print_rate = row.included_in_print_rate;
                        });
                        frm.refresh_field("taxes");
                    });
            });
        }
    },
});

// ── List-view: Guard to prevent accidental bulk-cancellation of drafts ────────
(function () {
    frappe.router.on("change", function () {
        var route = frappe.get_route();
        if (!route || route[0] !== "List" || !IB_DOCTYPES.includes(route[1])) return;

        setTimeout(function () {
            if (!cur_list) return;
            $(cur_list.wrapper)
                .off("change.ib_cancel_guard")
                .on(
                    "change.ib_cancel_guard",
                    ".list-row-checkbox, .list-header-subject input[type='checkbox']",
                    function () {
                        setTimeout(function () {
                            if (!cur_list) return;
                            var checked = cur_list.get_checked_items();
                            if (!checked.length) return;
                            
                            // Only allow bulk cancel if all selected rows are Submitted (1)
                            var all_submitted = checked.every(function (r) {
                                return r.docstatus == 1;
                            });
                            
                            cur_list.page.actions_btn_group
                                .find("a[data-label='Cancel']")
                                .closest("li")
                                .toggle(all_submitted);
                        }, 60);
                    }
                );
        }, 400);
    });
}());