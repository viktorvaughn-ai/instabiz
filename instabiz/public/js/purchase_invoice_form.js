// ── IB Purchase Invoice — SQMT rate recalc (mirrors purchase_order.js) ───────
const _ib_pi_recalc = frappe.utils.debounce(function (frm, cdt, cdn) {
    const row = locals[cdt][cdn];
    if (!row.custom_sqmt_rate || !row.conversion_factor) return;
    if ((row.stock_uom || "").toUpperCase() !== "SQMT") return;
    frappe.model.set_value(cdt, cdn, "rate", flt(row.custom_sqmt_rate * row.conversion_factor, 2));
}, 500);

const _ib_pi_backfill = frappe.utils.debounce(function (frm, cdt, cdn) {
    const row = locals[cdt][cdn];
    if (!row.rate || !row.conversion_factor || row.custom_sqmt_rate) return;
    if ((row.stock_uom || "").toUpperCase() !== "SQMT") return;
    frappe.model.set_value(cdt, cdn, "custom_sqmt_rate", flt(row.rate / row.conversion_factor, 4));
}, 500);

frappe.ui.form.on("Purchase Invoice Item", {
    custom_sqmt_rate: (frm, cdt, cdn) => _ib_pi_recalc(frm, cdt, cdn),
    rate:             (frm, cdt, cdn) => _ib_pi_backfill(frm, cdt, cdn),
});
