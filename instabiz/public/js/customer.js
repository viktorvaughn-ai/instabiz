// Customer name is protected server-side via CustomCustomer.validate()

frappe.ui.form.on("Customer", {
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
