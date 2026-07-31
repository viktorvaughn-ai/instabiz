/**
 * payment_entry.js
 * custom_advance_for_so: only relevant for Receive PEs (depends_on in custom_field.json).
 * Filters the picker to Draft Sales Orders belonging to the PE's party, so a user
 * can only pick a real, still-open order for that customer.
 */

frappe.ui.form.on("Payment Entry", {
	refresh(frm) {
		ib_set_advance_for_so_query(frm);
	},
	payment_type(frm) {
		ib_set_advance_for_so_query(frm);
	},
	party(frm) {
		ib_set_advance_for_so_query(frm);
		if (frm.doc.custom_advance_for_so) {
			frm.set_value("custom_advance_for_so", "");
		}
	},
});

function ib_set_advance_for_so_query(frm) {
	frm.set_query("custom_advance_for_so", function () {
		return {
			filters: {
				docstatus: 0,
				customer: frm.doc.party || "",
			},
		};
	});
}
