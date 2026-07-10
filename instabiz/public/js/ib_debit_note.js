frappe.ui.form.on("IB Debit Note", {
	onload(frm) {
		if (frm.is_new()) {
			frm.set_value("company", frappe.defaults.get_user_default("company") || "");
			frm.set_value("posting_date", frappe.datetime.get_today());
		}
	},

	refresh(frm) {
		frm.set_query("against_purchase_invoice", () => ({
			filters: {
				supplier: frm.doc.supplier || undefined,
				docstatus: 1,
				company: frm.doc.company || undefined,
			},
		}));
		frm.set_query("taxes_and_charges", () => ({
			filters: { company: frm.doc.company || undefined },
		}));
		frm.set_query("warehouse", "items", () => ({
			filters: { is_group: 0 },
		}));
		frm.set_query("expense_account", "items", () => ({
			filters: {
				company: frm.doc.company || undefined,
				root_type: "Expense",
				is_group: 0,
			},
		}));
	},

	against_purchase_invoice(frm) {
		if (!frm.doc.against_purchase_invoice) return;
		frappe.call({
			method: "frappe.client.get",
			args: { doctype: "Purchase Invoice", name: frm.doc.against_purchase_invoice },
			callback({ message: pi }) {
				if (!pi) return;
				frm.set_value("supplier", pi.supplier);
				if (pi.taxes_and_charges) {
					frm.set_value("taxes_and_charges", pi.taxes_and_charges);
				}
				const rows = (pi.items || []).map((item) => ({
					item_code: item.item_code,
					item_name: item.item_name,
					uom: item.uom || item.stock_uom,
					color: item.color,
					width_mm: item.width_mm,
					length_mtr: item.length_mtr,
					qty_pkg: item.qty_pkg,
					total_pkg: item.total_pkg,
					qty: item.qty,
					rate: item.rate,
					amount: item.amount,
					warehouse: item.warehouse,
					expense_account: item.expense_account,
					against_pi_item: item.name,
				}));
				frm.set_value("items", rows);
				frm.refresh_field("items");
				_refresh_totals(frm);
			},
		});
	},

	taxes_and_charges(frm) {
		_refresh_totals(frm);
	},

	reason_code(frm) {
		frm.toggle_reqd("against_purchase_invoice", frm.doc.reason_code === "Purchase Return");
	},
});

frappe.ui.form.on("IB Debit Note Item", {
	item_code(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row.item_code) return;
		frappe.db.get_value(
			"Item Default",
			{ parent: row.item_code, company: frm.doc.company },
			"expense_account",
			(r) => {
				if (r && r.expense_account) {
					frappe.model.set_value(cdt, cdn, "expense_account", r.expense_account);
				}
			}
		);
	},

	uom(frm, cdt, cdn)       { ib_recalc_row(frm, cdt, cdn, true).then(() => _refresh_totals(frm)); },
	width_mm(frm, cdt, cdn)  { ib_recalc_row(frm, cdt, cdn, true).then(() => _refresh_totals(frm)); },
	length_mtr(frm, cdt, cdn){ ib_recalc_row(frm, cdt, cdn, true).then(() => _refresh_totals(frm)); },
	qty_pkg(frm, cdt, cdn)   { ib_recalc_row(frm, cdt, cdn, true).then(() => _refresh_totals(frm)); },
	total_pkg(frm, cdt, cdn) { ib_recalc_row(frm, cdt, cdn, true).then(() => _refresh_totals(frm)); },
	qty(frm, cdt, cdn)       { ib_recalc_row(frm, cdt, cdn, false).then(() => _refresh_totals(frm)); },
	rate(frm, cdt, cdn)      { ib_recalc_row(frm, cdt, cdn, false).then(() => _refresh_totals(frm)); },
});

function _refresh_totals(frm) {
	let total = 0;
	(frm.doc.items || []).forEach((r) => { total += flt(r.amount); });
	total = flt(total, 2);
	frm.set_value("total", total);

	const tmpl = frm.doc.taxes_and_charges;
	if (!tmpl) {
		frm.set_value("total_taxes_and_charges", 0);
		frm.set_value("grand_total", total);
		return;
	}
	frappe.db.get_doc("Purchase Taxes and Charges Template", tmpl).then((doc) => {
		let tax_total = 0;
		(doc.taxes || []).forEach((t) => {
			if (t.charge_type === "On Net Total") {
				tax_total += flt(total * flt(t.rate) / 100, 2);
			} else if (t.charge_type === "Actual") {
				tax_total += flt(t.tax_amount, 2);
			}
		});
		tax_total = flt(tax_total, 2);
		frm.set_value("total_taxes_and_charges", tax_total);
		frm.set_value("grand_total", flt(total + tax_total, 2));
	});
}
