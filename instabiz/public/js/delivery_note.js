frappe.ui.form.on("Delivery Note", {
    async refresh(frm) {
        if (frm.doc.docstatus !== 1) return;
        ib_watch_ewaybill_dialog(frm);
        let gstin = frm.doc.billing_address_gstin || frm.doc.shipping_address_gstin || "";
        if (!gstin && frm.doc.customer_address) {
            try {
                const r = await frappe.db.get_value("Address", frm.doc.customer_address, "gstin");
                gstin = r?.message?.gstin || "";
            } catch (_) {}
        }
        localStorage.setItem("ib_ewb_gstin", gstin);
    },
});
