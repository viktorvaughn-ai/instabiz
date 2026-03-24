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

IB_DOCTYPES.forEach(doctype => {
    frappe.ui.form.on(doctype, {
        refresh(frm) {
            const uom_df = frappe.meta.get_docfield(`${doctype} Item`, "uom");
            if (uom_df) { uom_df.fetch_from = ""; uom_df.fetch_enabled = 0; }
            frm.set_query("item_code", "items", () => ({
                page_length: 50
            }));
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