/**
 * recalc.js
 * Dimension → qty → amount calculation helpers.
 * Used by form.js for all IB transaction doctypes.
 */

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
