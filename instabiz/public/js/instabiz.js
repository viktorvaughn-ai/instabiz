/**
 * instabiz.js — Frappe v15 / ERPNext v15
 */

// ════════════════════════════════════════════════════════════════════════════
// 1. GSTIN AUTOFILL  (bypass India Compliance paid API)
// ════════════════════════════════════════════════════════════════════════════
frappe.after_ajax(function () {
    if (typeof india_compliance === "undefined") return;

    // Force IC to think the API is active — our backend handles the real call
    india_compliance.is_api_enabled = function () { return true; };

    // Patch boot settings so the quick-entry form enables autofill
    const gs = frappe.boot.gst_settings;
    if (gs) {
        gs.sandbox_mode        = false;
        gs.autofill_party_info = true;
        gs.enable_api          = true;
    }

    // Intercept the GSTIN backend call to:
    //   • show a loading spinner while fetching
    //   • clear the "Status: …" description IC sets after the result arrives
    const GSTIN_METHOD = "india_compliance.gst_india.utils.gstin_info.get_gstin_info";
    const _orig_call   = frappe.call.bind(frappe);

    frappe.call = function (opts, ...rest) {
        if (opts && opts.method === GSTIN_METHOD) {
            const $desc = $('.modal:visible [data-fieldname="_gstin"] .help-box');

            // Show spinner
            $desc.html(
                '<span class="ib-gstin-loading">' +
                '<span class="ib-gstin-spinner"></span>' +
                __("Fetching GSTIN info…") +
                '</span>'
            );

            // After IC sets "Status: …", wipe it out
            const promise = _orig_call(opts, ...rest);
            promise.then(function () {
                setTimeout(function () {
                    $('.modal:visible [data-fieldname="_gstin"] .help-box').html("");
                }, 50);
            });
            return promise;
        }
        return _orig_call(opts, ...rest);
    };
});


// ════════════════════════════════════════════════════════════════════════════
// 2. DIMENSION RECALC  (qty from width/length/pkg, amount from qty × rate)
// ════════════════════════════════════════════════════════════════════════════
const IB_DOCTYPES  = ["Quotation", "Sales Order", "Delivery Note", "Sales Invoice"];
const IB_DEBOUNCE  = 300;

function ib_is_editable(frm) {
    return frm && frm.doc && frm.doc.docstatus === 0;
}

function ib_is_sqmt(uom) {
    return (uom || "").trim() === "SQMT";
}

function ib_calc_qty(row) {
    const w = flt(row.width_mm), l = flt(row.length_mtr);
    const p = flt(row.qty_pkg),  t = flt(row.total_pkg);
    if (ib_is_sqmt(row.uom)) {
        if (!w || !l || !p || !t) return null;
        return flt((w / 1000) * l * p * t, 3);
    }
    if (!p || !t) return null;
    return flt(p * t, 3);
}

function ib_debounce(fn, ms) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

async function ib_recalc_row(frm, cdt, cdn, from_dim) {
    if (!ib_is_editable(frm)) return;
    const row = locals[cdt][cdn];
    if (!row || !row.item_code || row.__ib_updating) return;

    row.__ib_updating = true;
    try {
        if (from_dim) {
            const new_qty = ib_calc_qty(row);
            if (new_qty !== null && flt(new_qty, 3) !== flt(row.qty, 3))
                await frappe.model.set_value(cdt, cdn, "qty", new_qty);
        }
        const r      = locals[cdt][cdn];
        const amount = flt(flt(r.qty) * flt(r.rate), 2);
        if (flt(amount, 2) !== flt(r.amount, 2))
            await frappe.model.set_value(cdt, cdn, "amount", amount);
    } finally {
        row.__ib_updating = false;
        frm.refresh_field("items");
    }
}


// ════════════════════════════════════════════════════════════════════════════
// 3. FORM HANDLERS  (all IB transaction doctypes)
// ════════════════════════════════════════════════════════════════════════════
const IB_REOPEN_DOCTYPES = ["Quotation", "Sales Order"];

IB_DOCTYPES.forEach(function (doctype) {
    frappe.ui.form.on(doctype, {
        refresh(frm) {
            // Prevent UOM from being auto-fetched from item master
            const uom_df = frappe.meta.get_docfield(`${doctype} Item`, "uom");
            if (uom_df) { uom_df.fetch_from = ""; uom_df.fetch_enabled = 0; }

            frm.set_query("item_code", "items", () => ({ page_length: 50 }));

            // Reopen button for cancelled Quotation / Sales Order
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


// ════════════════════════════════════════════════════════════════════════════
// 4. QUOTATION LIST VIEW
// ════════════════════════════════════════════════════════════════════════════
frappe.listview_settings["Quotation"] = frappe.listview_settings["Quotation"] || {};

Object.assign(frappe.listview_settings["Quotation"], {
    add_fields: ["transaction_date", "custom_sales_person"],

    onload(listview) {
        listview.page.add_field({
            fieldtype: "Link",
            fieldname: "party_name",
            options:   "Customer",
            label:     "Customer",
            change() {
                const val = this.get_value();
                if (val) {
                    listview.filter_area.add([[listview.doctype, "party_name", "=", val]]);
                } else {
                    listview.filter_area.remove(listview.doctype, "party_name");
                }
            },
        });
    },
});


// ════════════════════════════════════════════════════════════════════════════
// 5. SALES ORDER LIST VIEW
// ════════════════════════════════════════════════════════════════════════════
frappe.listview_settings["Sales Order"] = frappe.listview_settings["Sales Order"] || {};

Object.assign(frappe.listview_settings["Sales Order"], {
    add_fields: ["custom_sales_person"],
});


// ════════════════════════════════════════════════════════════════════════════
// 6. LIST VIEW FORMATTERS  (applied after route change so cur_list exists)
// ════════════════════════════════════════════════════════════════════════════
function ib_name_formatter(value, df, doc) {
    var date = (doc.creation || "").split(" ")[0];
    if (date) date = frappe.datetime.str_to_user(date);
    return '<span title="' + value + '">' +
        (date ? date + "<br>" : "") +
        "<strong>" + value + "</strong></span>";
}

function ib_sales_person_formatter(value, df, doc) {
    return doc.owner === frappe.session.user ? "You" : (value || "");
}

frappe.router.on("change", function () {
    const route = frappe.get_route();
    if (!route || route[0] !== "List") return;

    if (route[1] === "Quotation") {
        setTimeout(function () {
            var ls = frappe.listview_settings["Quotation"];
            if (!ls) return;

            ls.button = {
                show: () => true,
                get_label: () => __("Print"),
                get_description: () => __("Print Preview"),
                action: (doc) => window.open(
                    "/printview?doctype=Quotation&name=" + encodeURIComponent(doc.name) +
                    "&format=QPF_V2&no_letterhead=1&letterhead=No%20Letterhead&settings=%7B%7D",
                    "_blank"
                ),
            };

            ls.get_indicator = function (doc) {
                const map = { Pending: "orange", Confirmed: "green", Cancelled: "red", Draft: "red" };
                return [__(doc.status), map[doc.status] || "grey"];
            };

            ls.formatters = ls.formatters || {};
            ls.formatters.name                = ib_name_formatter;
            ls.formatters.custom_sales_person = ib_sales_person_formatter;

            if (cur_list) cur_list.render();
        }, 500);
    }

    if (route[1] === "Sales Order") {
        setTimeout(function () {
            var ls = frappe.listview_settings["Sales Order"];
            if (!ls) return;

            ls.button = {
                show: (doc) => !["Draft", "Cancelled"].includes(doc.status),
                get_label: () => __("Print"),
                get_description: () => __("Print Preview"),
                action: (doc) => window.open(
                    "/printview?doctype=Sales%20Order&name=" + encodeURIComponent(doc.name) +
                    "&format=OSPF_V2&no_letterhead=1&letterhead=No%20Letterhead&settings=%7B%7D",
                    "_blank"
                ),
            };

            ls.formatters = ls.formatters || {};
            ls.formatters.name                = ib_name_formatter;
            ls.formatters.custom_sales_person = ib_sales_person_formatter;

            if (cur_list) cur_list.render();
        }, 500);
    }
});
