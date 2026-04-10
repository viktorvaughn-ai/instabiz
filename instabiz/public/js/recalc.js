/**
 * recalc.js
 * Version: 1.2
 * Fixed: Prevents UI rounding/snapping when switching rows or clicking outside.
 * Logic: Maintain high precision for Qty, only round for Amount (Currency).
 */

function ib_is_editable(frm) {
    return frm && frm.doc && frm.doc.docstatus === 0;
}

function ib_is_sqmt(uom) {
    return (uom || "").trim() === "SQMT";
}

/**
 * Calculates raw quantity based on dimensions.
 * Returns null if calculation cannot be performed.
 */
function ib_calc_qty(row) {
    const w = flt(row.width_mm);
    const l = flt(row.length_mtr);
    const p = flt(row.qty_pkg);
    const t = flt(row.total_pkg);

    if (ib_is_sqmt(row.uom)) {
        // Only require width and length to attempt a calculation
        if (!w || !l) return null; 
        // Do NOT pass a second argument to flt() here to preserve .6, .666 etc.
        return flt((w / 1000) * l * p * t); 
    }
    
    // For other UOMs (PCS, ROLL, etc.)
    if (!p || !t) return null;
    return flt(p * t);
}

/**
 * Debounce helper to prevent rapid-fire calculations while typing.
 */
function ib_debounce(fn, ms) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

/**
 * Core recalculation logic for a single row.
 */
async function ib_recalc_row(frm, cdt, cdn, from_dim) {
    if (!ib_is_editable(frm)) return;
    const row = locals[cdt][cdn];
    if (!row || !row.item_code || row.__ib_updating) return;

    row.__ib_updating = true;
    try {
        if (from_dim) {
            const new_qty = ib_calc_qty(row);
            
            // Comparison using a small epsilon (0.000001) to detect actual changes
            // and avoid rounding jitter caused by float representation.
            if (new_qty !== null && Math.abs(flt(new_qty) - flt(row.qty)) > 0.000001) {
                // Set the raw value. Metadata/Precision settings in DocType 
                // will handle the visual display.
                await frappe.model.set_value(cdt, cdn, "qty", flt(new_qty));
            }
        }
        
        // Refresh local reference after potential qty update
        const r = locals[cdt][cdn];
        
        // Amount is currency, so we round this to 2 decimals.
        const amount = flt(flt(r.qty) * flt(r.rate), 2);
        
        if (Math.abs(flt(amount) - flt(r.amount)) > 0.001) {
            await frappe.model.set_value(cdt, cdn, "amount", amount);
        }
    } finally {
        row.__ib_updating = false;
        
        // refresh_field triggers the UI to re-read the values from 'locals'
        // If it rounds here, check "Customize Form" -> Qty -> Precision (Set to 2 or 3).
        frm.refresh_field("items");
    }
}