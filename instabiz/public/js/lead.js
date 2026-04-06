frappe.ui.form.on("Lead", {
	custom_pincode: function (frm) {
		instabiz.pincode.autofill(frm, "custom_pincode", {
			city:      "city",
			district:  "custom_district",
			territory: "territory",
			state:     null,
		});
	},
});
