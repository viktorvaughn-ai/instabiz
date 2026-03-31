/**
 * instabiz.js — Frappe v15 / ERPNext v15
 *
 * Tax calculation is handled entirely by the ERPNext tax engine server-side.
 * This file only manages custom dimension → qty → amount recalc on the
 * child table rows.
 */

const IB_DOCTYPES = ["Quotation", "Sales Order", "Delivery Note", "Sales Invoice"];
const IB_DEBOUNCE = 300;

function ib_is_editable(frm) {
    return frm && frm.doc && frm.doc.docstatus === 0;
}

function ib_is_sqmt(uom) {
    return (uom || "").trim() === "SQMT";
}

function ib_calc_qty(row) {
    const width_mm   = flt(row.width_mm);
    const length_mtr = flt(row.length_mtr);
    const qty_pkg    = flt(row.qty_pkg);
    const total_pkg  = flt(row.total_pkg);

    if (ib_is_sqmt(row.uom)) {
        if (!width_mm || !length_mtr || !qty_pkg || !total_pkg) return null;
        return flt((width_mm / 1000) * length_mtr * qty_pkg * total_pkg, 3);
    } else {
        if (!qty_pkg || !total_pkg) return null;
        return flt(qty_pkg * total_pkg, 3);
    }
}

function ib_debounce(fn, ms) {
    let t;
    return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), ms);
    };
}

// ── core recalc ───────────────────────────────────────────────────────────────
// Recalculates qty (from dimensions, when from_dim=true) and amount for a
// single child row. Tax/totals are left entirely to the ERPNext tax engine.
//
// set_value is only called when the value actually changes to avoid
// re-entering this function via the qty/rate triggers.
async function ib_recalc_row(frm, cdt, cdn, from_dim) {
    if (!ib_is_editable(frm)) return;

    const row = locals[cdt][cdn];
    if (!row || !row.item_code) return;
    if (row.__ib_updating) return;

    row.__ib_updating = true;
    try {
        if (from_dim) {
            const new_qty = ib_calc_qty(row);
            if (new_qty !== null && flt(new_qty, 3) !== flt(row.qty, 3)) {
                await frappe.model.set_value(cdt, cdn, "qty", new_qty);
            }
        }

        // Re-read from locals AFTER the await — value is now committed in model
        const current_row = locals[cdt][cdn];
        const qty    = flt(current_row.qty);
        const rate   = flt(current_row.rate);
        const amount = flt(qty * rate, 2);

        if (flt(amount, 2) !== flt(current_row.amount, 2)) {
            await frappe.model.set_value(cdt, cdn, "amount", amount);
        }

    } finally {
        row.__ib_updating = false;
        frm.refresh_field("items");
    }
}

const IB_REOPEN_DOCTYPES = ["Quotation", "Sales Order"];

IB_DOCTYPES.forEach(doctype => {
    frappe.ui.form.on(doctype, {
        refresh(frm) {
            const uom_df = frappe.meta.get_docfield(`${doctype} Item`, "uom");
            if (uom_df) { uom_df.fetch_from = ""; uom_df.fetch_enabled = 0; }

            frm.set_query("item_code", "items", () => ({
                page_length: 50
            }));

            // Reopen button — only for Quotation and Sales Order when cancelled
            if (
                frm.doc.docstatus === 2 &&
                IB_REOPEN_DOCTYPES.includes(doctype) &&
                frappe.model.can_cancel(doctype)
            ) {
                // set_primary_action replaces the Amend button in the primary slot.
                // After reload_doc, Frappe calls set_primary_action("Submit") which
                // cleanly replaces our Reopen — no stale buttons, no class conflicts.
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

    frappe.ui.form.on(`${doctype} Item`, {
        item_code(frm, cdt, cdn) {
            // Clear UOM immediately so Frappe doesn't lock in a stale value
            frappe.model.set_value(cdt, cdn, "uom", "");
            

            // Wait for fetch_from fields (width_mm, length_mtr, qty_pkg, color)
            // to resolve from the server before running recalc.
            setTimeout(async () => {
                await frappe.model.set_value(cdt, cdn, "uom", "");
                await ib_recalc_row(frm, cdt, cdn, true);
                frm.refresh_field("items");
            }, 1200);
        },

        // Dimension fields — recalculate qty then amount
        uom:        ib_debounce(async (frm, cdt, cdn) => { await ib_recalc_row(frm, cdt, cdn, true);  }, IB_DEBOUNCE),
        width_mm:   ib_debounce(async (frm, cdt, cdn) => { await ib_recalc_row(frm, cdt, cdn, true);  }, IB_DEBOUNCE),
        length_mtr: ib_debounce(async (frm, cdt, cdn) => { await ib_recalc_row(frm, cdt, cdn, true);  }, IB_DEBOUNCE),
        qty_pkg:    ib_debounce(async (frm, cdt, cdn) => { await ib_recalc_row(frm, cdt, cdn, true);  }, IB_DEBOUNCE),
        total_pkg:  ib_debounce(async (frm, cdt, cdn) => { await ib_recalc_row(frm, cdt, cdn, true);  }, IB_DEBOUNCE),

        // qty and rate only recalculate amount — do not re-derive qty from dims
        qty:        ib_debounce(async (frm, cdt, cdn) => { await ib_recalc_row(frm, cdt, cdn, false); }, IB_DEBOUNCE),
        rate:       ib_debounce(async (frm, cdt, cdn) => { await ib_recalc_row(frm, cdt, cdn, false); }, IB_DEBOUNCE),

        items_remove: (frm) => frm.refresh_field("items"),
    });
});

// frappe.router.on("change", function () {
//     const route = frappe.get_route();
//     if (!route || route[0] !== "List") return;

//     if (route[1] === "Quotation") {
//         setTimeout(function () {
//             if (frappe.listview_settings["Quotation"]) {
//                 frappe.listview_settings["Quotation"].button = {
//                     show: function (doc) {
//                         return ["Open", "Ordered"].includes(doc.status);
//                     },
//                     get_label: function () { return __("Print"); },
//                     get_description: function (doc) { return __("Print Preview"); },
//                     action: function (doc) {
//                         window.open("/printview?doctype=Quotation&name=" + encodeURIComponent(doc.name) + "&format=QuotationPF&no_letterhead=1&letterhead=No%20Letterhead&settings=%7B%7D", "_blank");
//                     },
//                 };
//                 if (cur_list) cur_list.render();
//             }
//         }, 500);
//     }

//     if (route[1] === "Sales Order") {
//         setTimeout(function () {
//             if (frappe.listview_settings["Sales Order"]) {
//                 frappe.listview_settings["Sales Order"].button = {
//                     show: function (doc) {
//                         return !["Draft", "Cancelled"].includes(doc.status);
//                     },
//                     get_label: function () { return __("Print"); },
//                     get_description: function (doc) { return __("Print Preview"); },
//                     action: function (doc) {
//                         window.open("/printview?doctype=Sales%20Order&name=" + encodeURIComponent(doc.name) + "&format=OSPF_V2&no_letterhead=1&letterhead=No%20Letterhead&settings=%7B%7D", "_blank");
//                     },
//                 };
//                 if (cur_list) cur_list.render();
//             }
//         }, 500);
//     }
// });

// ── Quotation list view settings (must be defined before list renders) ────
frappe.listview_settings["Quotation"] = frappe.listview_settings["Quotation"] || {};
frappe.listview_settings["Quotation"].add_fields = ["transaction_date", "custom_sales_person"];
frappe.listview_settings["Quotation"].onload = function (listview) {
    listview.page.add_field({
        fieldtype: "Link",
        fieldname: "party_name",
        options:   "Customer",
        label:     "Customer",
        change: function () {
            const val = this.get_value();
            if (val) {
                listview.filter_area.add([[listview.doctype, "party_name", "=", val]]);
            } else {
                listview.filter_area.remove(listview.doctype, "party_name");
            }
        },
    });
};

// ── Sales Order list view settings ────────────────────────────────────────
frappe.listview_settings["Sales Order"] = frappe.listview_settings["Sales Order"] || {};
frappe.listview_settings["Sales Order"].add_fields = ["custom_sales_person"];

frappe.router.on("change", function () {
    const route = frappe.get_route();
    if (!route || route[0] !== "List") return;

    if (route[1] === "Quotation") {
        setTimeout(function () {
            var ls = frappe.listview_settings["Quotation"];
            if (!ls) return;

            // ── Print button (all users) ──────────────────────────
            ls.button = {
                show: function (doc) {
                    return ["Open", "Ordered", "Pending", "Confirmed", "Draft", "Cancelled"].includes(doc.status);
                },
                get_label: function () { return __("Print"); },
                get_description: function (doc) { return __("Print Preview"); },
                action: function (doc) {
                    window.open("/printview?doctype=Quotation&name=" + encodeURIComponent(doc.name) + "&format=QPF_V2&no_letterhead=1&letterhead=No%20Letterhead&settings=%7B%7D", "_blank");
                },
            };

            // ── Status indicators (all users) ─────────────────────
            ls.get_indicator = function (doc) {
                if (doc.status === "Pending") {
                    return [__("Pending"), "orange"];
                } else if (doc.status === "Confirmed") {
                    return [__("Confirmed"), "green"];
                } else if (doc.status === "Cancelled") {
                    return [__("Cancelled"), "red"];
                } else if (doc.status === "Draft") {
                    return [__("Draft"), "red"];
                }
                return [__(doc.status), "grey"];
            };

            // ── Date + ID two-line format (all users) ─────────────
            ls.formatters = ls.formatters || {};
            ls.formatters.name = function (value, df, doc) {
                var date = doc.creation || "";
                if (date) {
                    date = frappe.datetime.str_to_user(date.split(" ")[0]);
                }
                return '<span title="' + value + '">' + (date ? date + "<br>" : "") + "<strong>" + value + "</strong></span>";
            };

            // ── Sales Person column (all users) ─────────────────── 
            ls.formatters.custom_sales_person = function (value, df, doc) {
                if (doc.owner === frappe.session.user) {
                    return "You";
                }
                return value || "";
            };

            if (cur_list) cur_list.render();
        }, 500);
    }

    if (route[1] === "Sales Order") {
        setTimeout(function () {
            var ls = frappe.listview_settings["Sales Order"];
            if (!ls) return;

            // ── Print button ──────────────────────────────────────
            ls.button = {
                show: function (doc) {
                    return ["Draft", "Cancelled", "To Deliver and Bill", "To Bill"].includes(doc.status);
                },
                get_label: function () { return __("Print"); },
                get_description: function (doc) { return __("Print Preview"); },
                action: function (doc) {
                    window.open("/printview?doctype=Sales%20Order&name=" + encodeURIComponent(doc.name) + "&format=OSPF_V2&no_letterhead=1&letterhead=No%20Letterhead&settings=%7B%7D", "_blank");
                },
            };

            // ── Date + ID two-line format ─────────────────────────
            ls.formatters = ls.formatters || {};
            ls.formatters.name = function (value, df, doc) {
                var date = doc.creation || "";
                if (date) {
                    date = frappe.datetime.str_to_user(date.split(" ")[0]);
                }
                return '<span title="' + value + '">' + (date ? date + "<br>" : "") + "<strong>" + value + "</strong></span>";
            };

            // ── Sales Person "You" formatter ──────────────────────
            ls.formatters.custom_sales_person = function (value, df, doc) {
                if (doc.owner === frappe.session.user) {
                    return "You";
                }
                return value || "";
            };

            if (cur_list) cur_list.render();
        }, 500);
    }
});


