/**
 * instabiz.js
 * ===========
 * Client-side recalculation for Quotation, Sales Order, Delivery Note, Sales Invoice.
 *
 * Recalc rules — mirrors utils.py exactly:
 *
 * Square Meter items:
 *   qty    = (width_mm / 1000) * length_mtr * qty_pkg * total_pkg
 *   amount = qty * rate
 *
 * PCS / other UOM items:
 *   qty    = qty_pkg * total_pkg
 *   amount = qty * rate
 *
 * When qty is edited manually:
 *   amount = qty * rate  (dimensions NOT re-derived)
 *
 * When rate is edited:
 *   amount = qty * rate  (qty unchanged)
 */

const IB_DOCTYPES = ["Quotation", "Sales Order", "Delivery Note", "Sales Invoice"];
const IB_DEBOUNCE = 400;

// ── guard: skip recalc on submitted / cancelled docs ─────────────────────────
function ib_is_editable(frm) {
    return frm.doc.docstatus === 0;
}

// ── toggle width/length fields based on UOM ───────────────────────────────────
function ib_sync_dimension_field_state(frm, row) {
    if (!frm || !frm.get_field) return;
    const uom = (row && row.uom) || "";
    const is_sqm = uom === "Square Meter";

    const grid = frm.fields_dict.items && frm.fields_dict.items.grid;
    if (!grid || !row || !row.name) return;

    const grid_row = grid.grid_rows_by_docname[row.name];
    if (!grid_row) return;

    // toggle_editable is the correct method in Frappe v15
    // falls back gracefully if method doesn't exist
    const toggle = grid_row.toggle_editable
        ? grid_row.toggle_editable.bind(grid_row)
        : (grid_row.toggle_enable
            ? grid_row.toggle_enable.bind(grid_row)
            : () => {});

    toggle("width_mm", is_sqm);
    toggle("length_mtr", is_sqm);
}

// ── core qty calculation (matches utils.py exactly) ───────────────────────────
function ib_calc_qty(row) {
    const uom        = (row.uom || "").trim();
    const width_mm   = flt(row.width_mm);
    const length_mtr = flt(row.length_mtr);
    const qty_pkg    = flt(row.qty_pkg);
    const total_pkg  = flt(row.total_pkg);

    if (uom === "Square Meter") {
        if (!width_mm || !length_mtr || !qty_pkg || !total_pkg) return null;
        return flt((width_mm / 1000) * length_mtr * qty_pkg * total_pkg, 3);
    } else {
        if (!qty_pkg || !total_pkg) return null;
        return flt(qty_pkg * total_pkg, 3);
    }
}

// ── trigger ERPNext tax engine ────────────────────────────────────────────────
function ib_trigger_tax_calc(frm) {
    try {
        frm.script_manager.trigger("calculate_taxes_and_totals", frm.doctype, frm.docname);
    } catch (e) {
        try { frm.trigger("calculate_taxes_and_totals"); } catch (_) {}
    }
}

// ── row-level recalc ──────────────────────────────────────────────────────────
function ib_recalc_row(frm, cdt, cdn, from_dimensions) {
    if (!ib_is_editable(frm)) return;

    const row = locals[cdt][cdn];
    if (!row || row.__ib_updating) return;
    if (!row.item_code) return;

    row.__ib_updating = true;

    if (from_dimensions) {
        const new_qty = ib_calc_qty(row);
        if (new_qty !== null) {
            row.qty = new_qty;
            frappe.model.set_value(cdt, cdn, "qty", new_qty);
        }
    }

    const qty    = flt(row.qty);
    const rate   = flt(row.rate);
    const amount = flt(qty * rate, 2);

    row.amount = amount;
    frappe.model.set_value(cdt, cdn, "amount", amount);

    requestAnimationFrame(() => {
        row.__ib_updating = false;
        ib_trigger_tax_calc(frm);
    });
}

// ── debounce ──────────────────────────────────────────────────────────────────
function ib_debounce(fn, ms) {
    let t;
    return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), ms);
    };
}


// ── Sales Order-specific hooks ────────────────────────────────────────────────
// Handles two cases:
//   A) SO created directly (not from Quotation) — field is blank, fill it.
//   B) SO created from Quotation — field already populated via Python mapper,
//      blank-guard inside ib_set_custom_sales_person skips overwriting it.
frappe.ui.form.on("Sales Order", {
    refresh(frm) {
        ib_set_custom_sales_person(frm);
    },
    sales_team_add(frm)    { ib_set_custom_sales_person(frm); },
    sales_team_remove(frm) { ib_set_custom_sales_person(frm); },
});

// ── wire up all 4 doctypes ────────────────────────────────────────────────────
IB_DOCTYPES.forEach(doctype => {
    frappe.ui.form.on(doctype, {
        refresh(frm) {
            // Sync field states for all existing rows on load
            // wrapped in try/catch so a single bad row never breaks the form
            (frm.doc.items || []).forEach(row => {
                try { ib_sync_dimension_field_state(frm, row); } catch (_) {}
            });
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
            // Give Frappe time to complete fetch_from, then recalc
            setTimeout(() => {
                try {
                    const row = locals[cdt][cdn];
                    ib_sync_dimension_field_state(frm, row);
                    ib_recalc_row(frm, cdt, cdn, true);
                } catch (_) {}
            }, 300);
        },

        uom: ib_debounce((frm, cdt, cdn) => {
            try {
                const row = locals[cdt][cdn];
                ib_sync_dimension_field_state(frm, row);
                ib_recalc_row(frm, cdt, cdn, true);
            } catch (_) {}
        }, IB_DEBOUNCE),

        width_mm:     ib_debounce((frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, true),  IB_DEBOUNCE),
        length_mtr:   ib_debounce((frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, true),  IB_DEBOUNCE),
        qty_pkg:      ib_debounce((frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, true),  IB_DEBOUNCE),
        total_pkg:    ib_debounce((frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, true),  IB_DEBOUNCE),

        qty:          ib_debounce((frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, false), IB_DEBOUNCE),
        rate:         ib_debounce((frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, false), IB_DEBOUNCE),

        items_remove: (frm) => ib_trigger_tax_calc(frm),
    });
});