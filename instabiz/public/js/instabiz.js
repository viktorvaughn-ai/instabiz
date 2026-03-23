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

// ── core qty calculation (matches utils.py exactly) ───────────────────────────
function ib_calc_qty(row) {
    const uom        = (row.uom || "").trim();
    const width_mm   = flt(row.width_mm);
    const length_mtr = flt(row.length_mtr);
    const qty_pkg    = flt(row.qty_pkg);
    const total_pkg  = flt(row.total_pkg);

    if (uom === "SQMT") {
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

// ── refresh grid to make updated values visible ───────────────────────────────
function ib_refresh_grid(frm) {
    try {
        frm.fields_dict.items.grid.refresh();
    } catch (_) {}
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
        ib_refresh_grid(frm);
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

// ── wire up all 4 doctypes ────────────────────────────────────────────────────
IB_DOCTYPES.forEach(doctype => {
    frappe.ui.form.on(doctype, {
        refresh(frm) {
            // Disable UOM auto-fetch from Item master at meta level
            const uom_df = frappe.meta.get_docfield(`${doctype} Item`, "uom");
            if (uom_df) {
                uom_df.fetch_from = "";
                uom_df.fetch_enabled = 0;
            }
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
            // Clear immediately
            frappe.model.set_value(cdt, cdn, "uom", "");
            // Clear again after fetch completes
            setTimeout(() => {
                frappe.model.set_value(cdt, cdn, "uom", "");
                const row = locals[cdt][cdn];
                ib_recalc_row(frm, cdt, cdn, true);
            }, 800);
        },

        uom: ib_debounce((frm, cdt, cdn) => {
            try {
                ib_recalc_row(frm, cdt, cdn, true);
            } catch (_) {}
        }, IB_DEBOUNCE),

        width_mm:     ib_debounce((frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, true),  IB_DEBOUNCE),
        length_mtr:   ib_debounce((frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, true),  IB_DEBOUNCE),
        qty_pkg:      ib_debounce((frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, true),  IB_DEBOUNCE),
        total_pkg:    ib_debounce((frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, true),  IB_DEBOUNCE),

        qty:          ib_debcleaounce((frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, false), IB_DEBOUNCE),
        rate:         ib_debounce((frm, cdt, cdn) => ib_recalc_row(frm, cdt, cdn, false), IB_DEBOUNCE),

        items_remove: (frm) => ib_trigger_tax_calc(frm),
    });
});