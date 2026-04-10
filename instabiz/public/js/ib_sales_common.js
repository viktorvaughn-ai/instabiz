/**
 * ib_sales_common.js
 * Shared item query override for all selling transactions.
 * Registered for Quotation and Sales Order via doctype_js in hooks.py.
 */

function ib_set_item_query(frm, customer_field) {
	frm.set_query("item_code", "items", function () {
		return {
			query: "instabiz.overrides.item.item_query",
			filters: { customer: frm.doc[customer_field] || "" },
			page_length: 30,
		};
	});
}

frappe.ui.form.on("Quotation", {
	refresh: (frm) => ib_set_item_query(frm, "party_name"),
});

frappe.ui.form.on("Sales Order", {
	refresh: (frm) => ib_set_item_query(frm, "customer"),
});
