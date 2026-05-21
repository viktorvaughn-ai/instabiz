// Customer name is protected server-side via CustomCustomer.validate()

frappe.ui.form.on("Customer", {
	refresh: function (frm) {
		if (!frm.is_new() && _ib_is_manager()) {
			_ib_render_claim_button(frm);
		}
		if (!frm.is_new()) {
			_ib_load_outstanding(frm);
			frm.add_custom_button(__("Send WhatsApp"), () => {
				ib_show_wa_dialog({
					customer: frm.doc.name,
					customer_name: frm.doc.customer_name,
				});
			}, IB_ICONS.svg("whatsapp", 16));
		}
	},

	custom_bill_and_ship_to_same_address: function (frm) {
		if (frm.doc.custom_bill_and_ship_to_same_address) {
			frm.set_value("custom_shipping",  frm.doc.custom_billing);
			frm.set_value("custom_st_city",   frm.doc.custom_bt_city);
			frm.set_value("custom_st_state",  frm.doc.custom_bt_state);
			frm.set_value("custom_st_pincode", frm.doc.custom_bt_pincode);
		}
	},

	custom_bt_pincode: function (frm) {
		instabiz.pincode.autofill(frm, "custom_bt_pincode", {
			city:  "custom_bt_city",
			state: "custom_bt_state",
		});
	},
	custom_st_pincode: function (frm) {
		instabiz.pincode.autofill(frm, "custom_st_pincode", {
			city:  "custom_st_city",
			state: "custom_st_state",
		});
	},
});

function _ib_load_outstanding(frm) {
	frappe.call({
		method: "instabiz.overrides.customer.get_outstanding",
		args: { customer: frm.doc.name },
		callback(r) {
			if (r.exc) return;
			frm.set_value("custom_outstanding_amount", r.message || 0);
		},
	});
}

function _ib_is_manager() {
	return frappe.user.has_role("Sales Manager") || frappe.user.has_role("System Manager");
}

function _ib_render_claim_button(frm) {
	const claimed_by = frm.doc.ib_claimed_by;
	const is_mine = claimed_by === frappe.session.user;

	frm.remove_custom_button("Claim", "Assign");
	frm.remove_custom_button("Unclaim", "Assign");

	if (!claimed_by) {
		frm.add_custom_button("Claim", () => {
			frappe.call({
				method: "instabiz.overrides.customer_assignment.claim_customer",
				args: { customer: frm.doc.name },
				callback(r) {
					if (r.message && r.message.status === "ok") {
						frappe.show_alert({ message: "Customer claimed", indicator: "blue" });
						frm.reload_doc();
					}
				},
			});
		}, "Assign");
	} else {
		const claimer = frm.doc.ib_claimed_by;
		frm.add_custom_button(`Unclaim (${claimer})`, () => {
			frappe.confirm(`Release this customer from ${claimer} back to the general pool?`, () => {
				frappe.call({
					method: "instabiz.overrides.customer_assignment.unclaim_customer",
					args: { customer: frm.doc.name },
					callback(r) {
						if (r.message && r.message.status === "ok") {
							frappe.show_alert({ message: "Customer released", indicator: "orange" });
							frm.reload_doc();
						}
					},
				});
			});
		}, "Assign");
	}
}
