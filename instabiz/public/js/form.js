/**
 * form.js
 * Form-level handlers for all IB transaction doctypes:
 * refresh, reopen button, item field triggers.
 * Depends on: recalc.js
 */

/**
 * ib_hide_sidebar()
 * Collapse the Frappe list-view filter sidebar so the content area fills the
 * full width. Safe to call anywhere — the route guard ensures it never hides
 * the module navigation sidebar on app/module home pages.
 */
function ib_hide_sidebar() {
    const route = frappe.get_route();
    if (!route || route[0] !== "List") return;   // never fire on /app or /app/crm etc.
    $('.layout-side-section').css({ display: 'none', transition: 'none' });
    $('.layout-main-section').css('margin-left', '0');
}

// On every list-view navigation: hide the filter sidebar AND refresh the list
// so newly created docs appear immediately (Frappe page-cache would otherwise
// show stale data from the previous visit).
frappe.router.on("change", function () {
    ib_hide_sidebar();
    const route = frappe.get_route();
    if (route && route[0] === "List" && cur_list) {
        cur_list.refresh();
    }
});

const IB_DOCTYPES        = ["Quotation", "Sales Order", "Delivery Note", "Sales Invoice"];
const IB_REOPEN_DOCTYPES = ["Quotation", "Sales Order"];
const IB_DEBOUNCE        = 300;

IB_DOCTYPES.forEach(function (doctype) {
    frappe.ui.form.on(doctype, {
        refresh(frm) {
            // Prevent UOM from being auto-fetched from item master
            const uom_df = frappe.meta.get_docfield(`${doctype} Item`, "uom");
            if (uom_df) { uom_df.fetch_from = ""; uom_df.fetch_enabled = 0; }

            frm.set_query("item_code", "items", () => ({ page_length: 50 }));

            // Draft doc — remove the Cancel option ERPNext adds to the Actions menu
            if (frm.doc.docstatus === 0) {
                frm.remove_custom_button(__("Cancel"));
                if (frm.page.btn_secondary) frm.page.btn_secondary.hide();
            }

            // Reopen button — cancelled Quotation / Sales Order only
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
                                callback: function (r) { if (!r.exc) window.location.reload(); },
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

    frappe.ui.form.on(`${doctype} Item`, {
        item_code(frm, cdt, cdn) {
            frappe.model.set_value(cdt, cdn, "uom", "");
            setTimeout(async () => {
                await frappe.model.set_value(cdt, cdn, "uom", "");
                await ib_recalc_row(frm, cdt, cdn, true);
                frm.refresh_field("items");
            }, 1200);
        },

        uom:        ib_debounce(async (frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, true),  IB_DEBOUNCE),
        width_mm:   ib_debounce(async (frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, true),  IB_DEBOUNCE),
        length_mtr: ib_debounce(async (frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, true),  IB_DEBOUNCE),
        qty_pkg:    ib_debounce(async (frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, true),  IB_DEBOUNCE),
        total_pkg:  ib_debounce(async (frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, true),  IB_DEBOUNCE),
        qty:        ib_debounce(async (frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, false), IB_DEBOUNCE),
        rate:       ib_debounce(async (frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, false), IB_DEBOUNCE),

        items_remove: (frm) => frm.refresh_field("items"),
    });
});
