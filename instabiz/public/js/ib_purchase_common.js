// ── IB Purchase — shared helpers for PO / GRN / PI ──────────────────────────

// Mirrors _PURCHASE_GST_TEMPLATES in purchase_order.py
const _IB_GST_TEMPLATES = {
    false_true:  "Input GST In-state - IB",
    false_false: "Input GST Out-state - IB",
    true_true:   "Input GST RCM In-state - IB",
    true_false:  "Input GST RCM Out-state - IB",
};

async function ib_auto_purchase_tax(frm) {
    if (frm.doc.docstatus !== 0) return;

    const co_code = (frm.doc.company_gstin || "").substring(0, 2);
    if (!co_code) return;

    // Supplier GSTIN: from form field or lookup supplier_address
    let sup_code = (frm.doc.supplier_gstin || "").substring(0, 2);
    if (!sup_code && frm.doc.supplier_address) {
        const r = await frappe.db.get_value("Address", frm.doc.supplier_address, "gstin");
        sup_code = ((r && r.message && r.message.gstin) || "").substring(0, 2);
    }
    if (!sup_code) return;

    const is_rcm      = !!(frm.doc.is_reverse_charge);
    const is_instate  = co_code === sup_code;
    const key         = `${is_rcm}_${is_instate}`;
    const template    = _IB_GST_TEMPLATES[key];

    if (!template || frm.doc.taxes_and_charges === template) return;

    frm.set_value("taxes_and_charges", template);
}

// ── SQMT rate recalc (shared logic for child rows) ───────────────────────────
//
// For SQMT items purchased in ROLL:
//   User enters Rate/SQMT (custom_sqmt_rate) → Rate per ROLL = sqmt_rate × cf
//   OR user enters Rate directly              → treated as SQMT rate, ROLL rate computed
//
// Rate/SQMT field = the editable SQMT price
// Rate field      = computed ROLL price (what ERPNext uses for amount)
// Amount          = Qty (ROLL) × Rate (per ROLL) = Qty × sqmt_rate × cf

function _ib_is_sqmt_roll(row) {
    return (row.stock_uom || "").toUpperCase() === "SQMT"
        && (row.uom || "").toUpperCase() === "ROLL"
        && flt(row.conversion_factor) > 0;
}

// Rate/SQMT changed → compute Rate per ROLL
function _ib_recalc_from_sqmt(frm, cdt, cdn) {
    const row = locals[cdt][cdn];
    if (!_ib_is_sqmt_roll(row) || !row.custom_sqmt_rate) return;
    const roll_rate = flt(row.custom_sqmt_rate) * flt(row.conversion_factor);
    // Suppress back-trigger by setting flag
    row._ib_sqmt_updating = true;
    frappe.model.set_value(cdt, cdn, "rate", flt(roll_rate, 2));
    row._ib_sqmt_updating = false;
}

// Rate changed → treat as SQMT rate, compute ROLL rate
function _ib_recalc_from_rate(frm, cdt, cdn) {
    const row = locals[cdt][cdn];
    if (row._ib_sqmt_updating) return;   // skip if we triggered this change
    if (!_ib_is_sqmt_roll(row) || !row.rate) return;

    const sqmt_rate = flt(row.rate);              // user typed this as SQMT rate
    const roll_rate = sqmt_rate * flt(row.conversion_factor);

    row._ib_sqmt_updating = true;
    frappe.model.set_value(cdt, cdn, "custom_sqmt_rate", flt(sqmt_rate, 4));
    frappe.model.set_value(cdt, cdn, "rate", flt(roll_rate, 2));
    row._ib_sqmt_updating = false;
}

const _ib_po_recalc_d   = frappe.utils.debounce(_ib_recalc_from_sqmt, 400);
const _ib_po_backfill_d = frappe.utils.debounce(_ib_recalc_from_rate,  400);

// ── Purchase Order ────────────────────────────────────────────────────────────
frappe.ui.form.on("Purchase Order", {
    onload:           (frm) => ib_auto_purchase_tax(frm),
    supplier:         (frm) => ib_auto_purchase_tax(frm),
    supplier_address: (frm) => ib_auto_purchase_tax(frm),
    supplier_gstin:   (frm) => ib_auto_purchase_tax(frm),
    company_gstin:    (frm) => ib_auto_purchase_tax(frm),
    is_reverse_charge:(frm) => ib_auto_purchase_tax(frm),
});

frappe.ui.form.on("Purchase Order Item", {
    custom_sqmt_rate: (frm, cdt, cdn) => _ib_po_recalc_d(frm, cdt, cdn),
    rate:             (frm, cdt, cdn) => _ib_po_backfill_d(frm, cdt, cdn),
    item_code(frm, cdt, cdn) {
        // On item select: if SQMT/ROLL item, clear rate so user enters via Rate/SQMT
        setTimeout(() => {
            const r = locals[cdt][cdn];
            if (_ib_is_sqmt_roll(r)) {
                frappe.model.set_value(cdt, cdn, "custom_sqmt_rate", 0);
                frappe.model.set_value(cdt, cdn, "rate", 0);
            }
        }, 900);
    },
});

// ── Purchase Receipt ──────────────────────────────────────────────────────────
frappe.ui.form.on("Purchase Receipt", {
    onload:           (frm) => ib_auto_purchase_tax(frm),
    supplier:         (frm) => ib_auto_purchase_tax(frm),
    supplier_address: (frm) => ib_auto_purchase_tax(frm),
    supplier_gstin:   (frm) => ib_auto_purchase_tax(frm),
    company_gstin:    (frm) => ib_auto_purchase_tax(frm),
    is_reverse_charge:(frm) => ib_auto_purchase_tax(frm),
});

frappe.ui.form.on("Purchase Receipt Item", {
    custom_sqmt_rate: (frm, cdt, cdn) => _ib_po_recalc_d(frm, cdt, cdn),
    rate:             (frm, cdt, cdn) => _ib_po_backfill_d(frm, cdt, cdn),
});

// ── Purchase Invoice ──────────────────────────────────────────────────────────
frappe.ui.form.on("Purchase Invoice", {
    onload:           (frm) => ib_auto_purchase_tax(frm),
    supplier:         (frm) => ib_auto_purchase_tax(frm),
    supplier_address: (frm) => ib_auto_purchase_tax(frm),
    supplier_gstin:   (frm) => ib_auto_purchase_tax(frm),
    company_gstin:    (frm) => ib_auto_purchase_tax(frm),
    is_reverse_charge:(frm) => ib_auto_purchase_tax(frm),
});

frappe.ui.form.on("Purchase Invoice Item", {
    custom_sqmt_rate: (frm, cdt, cdn) => _ib_po_recalc_d(frm, cdt, cdn),
    rate:             (frm, cdt, cdn) => _ib_po_backfill_d(frm, cdt, cdn),
});
