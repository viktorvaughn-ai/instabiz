// ── IB Purchase Order — SQMT rate recalc ────────────────────────────────────
// When user enters Rate/SQMT on a PO item, auto-computes:
//   rate (per ROLL) = custom_sqmt_rate × uom_conversion_factor
//   amount           = qty × rate   (ERPNext handles natively)
// Debounced 500 ms — same pattern as sales recalc.js

const _ib_po_recalc = frappe.utils.debounce(function (frm, cdt, cdn) {
    const row = locals[cdt][cdn];
    if (!row.custom_sqmt_rate || !row.conversion_factor) return;
    if ((row.stock_uom || "").toUpperCase() !== "SQMT") return;

    const rate = flt(row.custom_sqmt_rate) * flt(row.conversion_factor);
    frappe.model.set_value(cdt, cdn, "rate", flt(rate, 2));
}, 500);

// Reverse: when rate changes manually, back-compute Rate/SQMT for display
const _ib_po_backfill_sqmt_rate = frappe.utils.debounce(function (frm, cdt, cdn) {
    const row = locals[cdt][cdn];
    if (!row.rate || !row.conversion_factor) return;
    if ((row.stock_uom || "").toUpperCase() !== "SQMT") return;
    if (row.custom_sqmt_rate) return; // user already filled it

    const sqmt_rate = flt(row.rate) / flt(row.conversion_factor);
    frappe.model.set_value(cdt, cdn, "custom_sqmt_rate", flt(sqmt_rate, 4));
}, 500);

frappe.ui.form.on("Purchase Order Item", {
    custom_sqmt_rate(frm, cdt, cdn) {
        _ib_po_recalc(frm, cdt, cdn);
    },

    // When item changes: if SQMT item with ROLL UOM and no sqmt_rate, compute from last rate
    item_code(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (!row.item_code) return;
        // Wait for ERPNext to populate stock_uom / conversion_factor
        setTimeout(() => {
            const r = locals[cdt][cdn];
            if ((r.stock_uom || "").toUpperCase() === "SQMT" && r.uom === "ROLL" && r.rate && !r.custom_sqmt_rate) {
                const sqmt_rate = flt(r.rate) / flt(r.conversion_factor || 1);
                frappe.model.set_value(cdt, cdn, "custom_sqmt_rate", flt(sqmt_rate, 4));
            }
        }, 800);
    },

    rate(frm, cdt, cdn) {
        _ib_po_backfill_sqmt_rate(frm, cdt, cdn);
    },
});
