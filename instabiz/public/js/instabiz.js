/**
 * instabiz.js — Frappe v15 / ERPNext v15
 *
 * Changes from previous version:
 *  - ib_recalc_row is now async; frappe.model.set_value calls are awaited so
 *    the model is committed before tax recalc fires. This fixes the bug where
 *    totals only updated on save.
 *  - frm.refresh_field("items") is called after every recalc so the grid UI
 *    repaints immediately without requiring a save.
 *  - set_value is only called when the computed value actually differs from the
 *    current one, preventing the qty/rate triggers from re-entering ib_recalc_row
 *    and hitting the __ib_updating guard.
 *  - item_code timeout raised to 1200 ms to accommodate slower fetch_from
 *    resolutions, with an additional refresh after the timeout.
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

function ib_trigger_tax_calc(frm) {
    try {
        frm.script_manager.trigger("calculate_taxes_and_totals", frm.doctype, frm.docname);
    } catch (e) {
        try { frm.trigger("calculate_taxes_and_totals"); } catch (_) {}
    }
    // Force grid repaint so calculated amounts are visible immediately
    frm.refresh_field("items");
}

function ib_debounce(fn, ms) {
    let t;
    return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), ms);
    };
}

// ── core recalc ───────────────────────────────────────────────────────────────
// async so we can await frappe.model.set_value — without await, tax calc fires
// before the model commits the new qty/amount, producing stale UI values.
//
// set_value is only called when the value actually changes; this prevents the
// qty and rate triggers from re-entering ib_recalc_row and being silently
// dropped by the __ib_updating guard.
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
                // Await ensures the model value is committed before we read it back
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
        // Always fire tax calc + repaint after model is fully settled,
        // even if an error occurred mid-update
        ib_trigger_tax_calc(frm);
    }
}

IB_DOCTYPES.forEach(doctype => {
    frappe.ui.form.on(doctype, {
        refresh(frm) {
            const uom_df = frappe.meta.get_docfield(`${doctype} Item`, "uom");
            if (uom_df) { uom_df.fetch_from = ""; uom_df.fetch_enabled = 0; }
        },

        taxes_and_charges: (frm) => ib_trigger_tax_calc(frm),
        taxes_add:         (frm) => ib_trigger_tax_calc(frm),
        taxes_remove:      (frm) => ib_trigger_tax_calc(frm),
        transport_charges: ib_debounce((frm) => ib_trigger_tax_calc(frm), IB_DEBOUNCE),
        other_charges:     ib_debounce((frm) => ib_trigger_tax_calc(frm), IB_DEBOUNCE),

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
            // 1200 ms gives slower connections enough time; adjust if needed.
            setTimeout(async () => {
                // Clear UOM again in case it was re-set by a fetch_from rule
                await frappe.model.set_value(cdt, cdn, "uom", "");
                await ib_recalc_row(frm, cdt, cdn, true);
                // Repaint after fetch_from values have settled
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

        items_remove: (frm) => ib_trigger_tax_calc(frm),
    });
});