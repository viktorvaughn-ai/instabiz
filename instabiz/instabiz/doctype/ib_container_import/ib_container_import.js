frappe.ui.form.on("IB Container Import", {
	refresh(frm) {
		if (!frm.is_new()) {
			frm.fields_dict["items"].grid.add_custom_button(__("Reprint Labels"), () => {
				const selected = frm.fields_dict["items"].grid.get_selected();
				if (!selected.length) {
					frappe.msgprint(__("Select a row first"));
					return;
				}
				selected.forEach((row_name) => {
					const row = frm.doc.items.find((r) => r.name === row_name);
					if (!row || !row.item_code) return;
					window.open(
						frappe.urllib.get_full_url(
							"/api/method/instabiz.instabiz.doctype.ib_container_import.ib_container_import.reprint_item_labels" +
								"?container_import=" + encodeURIComponent(frm.doc.name) +
								"&item_code=" + encodeURIComponent(row.item_code)
						)
					);
				});
			});
		}
	},
});

frappe.ui.form.on("IB Container Import Item", {
	no_of_boxes(frm, cdt, cdn) {
		_ib_ctn_recalc(frm, cdt, cdn);
	},
	qty_per_box(frm, cdt, cdn) {
		_ib_ctn_recalc(frm, cdt, cdn);
	},
});

function _ib_ctn_recalc(frm, cdt, cdn) {
	const row = frappe.get_doc(cdt, cdn);
	row.total_qty = flt(row.no_of_boxes) * flt(row.qty_per_box);
	frm.refresh_field("items");
}
