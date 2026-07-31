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
	onload(frm) {
		if (frm.is_new() && !frm.doc.delivery_date) {
			frm.set_value("delivery_date", frappe.datetime.add_days(frm.doc.transaction_date || frappe.datetime.get_today(), 8));
		}
	},
	// Default ETD = order date + 8 days — only while the doc is still new/unsaved,
	// so editing transaction_date on an existing order never touches a real delivery_date.
	transaction_date(frm) {
		if (frm.is_new()) {
			frm.set_value("delivery_date", frappe.datetime.add_days(frm.doc.transaction_date || frappe.datetime.get_today(), 8));
		}
	},
});

// Advance-payment approval gate: a Draft SO with an unapproved advance can't
// be confirmed (blocked server-side in advance_approval.py). Approve/Reject
// buttons only shown to the designated approver.
const IB_ADVANCE_APPROVER = "idris@instabizsolutions.com";

frappe.ui.form.on("Sales Order", {
	refresh(frm) {
		if (frm.doc.docstatus !== 0) return;
		if (frm.doc.custom_advance_approval_status !== "Pending") return;
		const can_approve =
			frappe.session.user === IB_ADVANCE_APPROVER || frappe.user.has_role("System Manager");
		if (!can_approve) return;

		frm.add_custom_button(__("Approve"), () => ib_decide_advance(frm, "Approved"), __("Advance"));
		frm.add_custom_button(__("Reject"), () => ib_decide_advance(frm, "Rejected"), __("Advance"));
	},
});

function ib_decide_advance(frm, status) {
	frappe.prompt(
		[{ fieldname: "remarks", label: __("Remarks"), fieldtype: "Small Text" }],
		(values) => {
			frappe.call({
				method: "instabiz.overrides.advance_approval.set_advance_approval",
				args: { sales_order: frm.doc.name, status, remarks: values.remarks },
				callback: () => frm.reload_doc(),
			});
		},
		__(status === "Approved" ? "Approve Advance Payment" : "Reject Advance Payment"),
		__(status)
	);
}

// Record Advance (Deposit) — the only way to reach the advance-approval feature
// at all pre-submit. The standard "Create > Payment" button never shows for a
// Draft SO, and a Payment Entry referencing a non-submitted Sales Order in its
// references table is rejected outright by core ERPNext validation. This opens
// a plain on-account Payment Entry instead: no references row, just
// custom_advance_for_so pointing back at this order (see payment_entry.js /
// instabiz.overrides.payment_entry._update_advance_for_so).
frappe.ui.form.on("Sales Order", {
	refresh(frm) {
		if (frm.doc.docstatus !== 0 || frm.is_new()) return;
		if (!frm.doc.customer) return;

		frm.add_custom_button(__("Record Advance (Deposit)"), () => {
			frappe.new_doc("Payment Entry", {
				payment_type: "Receive",
				party_type: "Customer",
				party: frm.doc.customer,
				custom_advance_for_so: frm.doc.name,
			});
		}, __("Create"));
	},
});
