frappe.ui.form.on("Address", {
	pincode: function (frm) {
		instabiz.pincode.autofill(frm, "pincode", {
			city:      "city",
			district:  null,
			territory: null,
			state:     "state",
		});
	},
});
