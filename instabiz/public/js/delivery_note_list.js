frappe.listview_settings["Delivery Note"] = {
	add_fields: ["custom_sales_person"],

	get_indicator(doc) {
		const map = {
			Draft:           "red",
			Pending:         "orange",
			Confirmed:       "green",
			"Return Issued": "grey",
			Cancelled:       "red",
		};
		return [__(doc.status), map[doc.status] || "grey"];
	},

	formatters: {
		name(value, df, doc) {
			const date = frappe.datetime.str_to_user(
				(doc.creation || "").split(" ")[0]
			);
			return `<span title="${value}">${date ? date + "<br>" : ""}<strong>${value}</strong></span>`;
		},
		custom_sales_person(value, df, doc) {
			return doc.owner === frappe.session.user ? __("You") : (value || "");
		},
	},

	onload(listview) {
		ib_hide_sidebar();
	},
};
