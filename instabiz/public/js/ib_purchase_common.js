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

function _ib_is_sqmt(row) {
    return (row.uom || "").toUpperCase() === "SQMT";
}

// Dimension fields to show/hide based on UOM
const _IB_DIM_FIELDS = ["width_mm", "length_mtr", "qty_pkg", "total_pkg"];

// Show/hide dimension fields based on UOM for the current row being edited.
// Uses grid.toggle_display which applies globally per-column — acceptable because
// the user edits one row at a time and visibility reflects the active row's UOM.
function _ib_purchase_update_visibility(frm, cdt, cdn) {
    const row = locals[cdt][cdn];
    if (!row) return;
    const grid = frm.fields_dict.items && frm.fields_dict.items.grid;
    if (!grid || !grid.toggle_display) return;
    const is_sqmt = (row.uom || "").toUpperCase() === "SQMT";
    _IB_DIM_FIELDS.forEach(f => grid.toggle_display(f, is_sqmt));
    grid.toggle_display("qty", !is_sqmt);
}

// Calculate qty from dimensions for SQMT purchase items
function _ib_purchase_calc_sqmt_qty(frm, cdt, cdn) {
    const row = locals[cdt][cdn];
    if (!row || !_ib_is_sqmt(row)) return;
    const w = flt(row.width_mm);
    const l = flt(row.length_mtr);
    const p = flt(row.qty_pkg);
    const t = flt(row.total_pkg);
    if (!w || !l || !p || !t) return;
    const qty = flt((w / 1000) * l * p * t);
    if (Math.abs(qty - flt(row.qty)) > 0.000001) {
        frappe.model.set_value(cdt, cdn, "qty", qty);
    }
}

// Rate/SQMT changed → compute Rate per ROLL
function _ib_recalc_from_sqmt(frm, cdt, cdn) {
    const row = locals[cdt][cdn];
    if (!_ib_is_sqmt_roll(row) || !row.custom_sqmt_rate) return;
    const roll_rate = flt(row.custom_sqmt_rate) * flt(row.conversion_factor);
    // Hold flag through next debounce cycle to block back-trigger from rate change
    row._ib_sqmt_updating = true;
    frappe.model.set_value(cdt, cdn, "rate", flt(roll_rate, 2));
    setTimeout(() => { row._ib_sqmt_updating = false; }, 900);
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
    setTimeout(() => { row._ib_sqmt_updating = false; }, 900);
}

const _ib_po_recalc_d   = frappe.utils.debounce(_ib_recalc_from_sqmt, 400);
const _ib_po_backfill_d = frappe.utils.debounce(_ib_recalc_from_rate,  400);
const _ib_po_dim_d      = frappe.utils.debounce(_ib_purchase_calc_sqmt_qty, 300);

// Common item handlers for all three purchase child tables
function _ib_purchase_item_handlers(child_dt) {
    frappe.ui.form.on(child_dt, {
        custom_sqmt_rate: (frm, cdt, cdn) => _ib_po_recalc_d(frm, cdt, cdn),
        rate:             (frm, cdt, cdn) => _ib_po_backfill_d(frm, cdt, cdn),
        width_mm:         (frm, cdt, cdn) => _ib_po_dim_d(frm, cdt, cdn),
        length_mtr:       (frm, cdt, cdn) => _ib_po_dim_d(frm, cdt, cdn),
        qty_pkg:          (frm, cdt, cdn) => _ib_po_dim_d(frm, cdt, cdn),
        total_pkg:        (frm, cdt, cdn) => _ib_po_dim_d(frm, cdt, cdn),
        uom(frm, cdt, cdn) {
            _ib_purchase_update_visibility(frm, cdt, cdn);
            const row = locals[cdt][cdn];
            if (row && _ib_is_sqmt(row)) {
                _ib_po_dim_d(frm, cdt, cdn);
            }
        },
        form_render(frm, cdt, cdn) {
            _ib_purchase_update_visibility(frm, cdt, cdn);
        },
    });
}

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
    width_mm:         (frm, cdt, cdn) => _ib_po_dim_d(frm, cdt, cdn),
    length_mtr:       (frm, cdt, cdn) => _ib_po_dim_d(frm, cdt, cdn),
    qty_pkg:          (frm, cdt, cdn) => _ib_po_dim_d(frm, cdt, cdn),
    total_pkg:        (frm, cdt, cdn) => _ib_po_dim_d(frm, cdt, cdn),
    uom(frm, cdt, cdn) {
        _ib_purchase_update_visibility(frm, cdt, cdn);
        const row = locals[cdt][cdn];
        if (row && _ib_is_sqmt(row)) {
            _ib_po_dim_d(frm, cdt, cdn);
        }
    },
    form_render(frm, cdt, cdn) {
        _ib_purchase_update_visibility(frm, cdt, cdn);
    },
    item_code(frm, cdt, cdn) {
        // On item select: if SQMT/ROLL item, clear rate so user enters via Rate/SQMT
        setTimeout(() => {
            const r = locals[cdt][cdn];
            if (_ib_is_sqmt_roll(r)) {
                frappe.model.set_value(cdt, cdn, "custom_sqmt_rate", 0);
                frappe.model.set_value(cdt, cdn, "rate", 0);
            }
            _ib_purchase_update_visibility(frm, cdt, cdn);
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
    width_mm:         (frm, cdt, cdn) => _ib_po_dim_d(frm, cdt, cdn),
    length_mtr:       (frm, cdt, cdn) => _ib_po_dim_d(frm, cdt, cdn),
    qty_pkg:          (frm, cdt, cdn) => _ib_po_dim_d(frm, cdt, cdn),
    total_pkg:        (frm, cdt, cdn) => _ib_po_dim_d(frm, cdt, cdn),
    uom(frm, cdt, cdn) {
        _ib_purchase_update_visibility(frm, cdt, cdn);
        const row = locals[cdt][cdn];
        if (row && _ib_is_sqmt(row)) {
            _ib_po_dim_d(frm, cdt, cdn);
        }
    },
    form_render(frm, cdt, cdn) {
        _ib_purchase_update_visibility(frm, cdt, cdn);
    },
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
    width_mm:         (frm, cdt, cdn) => _ib_po_dim_d(frm, cdt, cdn),
    length_mtr:       (frm, cdt, cdn) => _ib_po_dim_d(frm, cdt, cdn),
    qty_pkg:          (frm, cdt, cdn) => _ib_po_dim_d(frm, cdt, cdn),
    total_pkg:        (frm, cdt, cdn) => _ib_po_dim_d(frm, cdt, cdn),
    uom(frm, cdt, cdn) {
        _ib_purchase_update_visibility(frm, cdt, cdn);
        const row = locals[cdt][cdn];
        if (row && _ib_is_sqmt(row)) {
            _ib_po_dim_d(frm, cdt, cdn);
        }
    },
    form_render(frm, cdt, cdn) {
        _ib_purchase_update_visibility(frm, cdt, cdn);
    },
});
