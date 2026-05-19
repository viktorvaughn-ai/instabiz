frappe.listview_settings["Delivery Note"] = {
	add_fields: ["custom_sales_person"],

	button: {
		show: (doc) => doc.status !== "Cancelled",
		get_label: () => __("Print"),
		get_description: () => __("Print Preview"),
		action(doc) {
			window.open(
				"/printview?doctype=Delivery%20Note&name=" + encodeURIComponent(doc.name) +
				"&no_letterhead=1&letterhead=No%20Letterhead&settings=%7B%7D",
				"_blank"
			);
		},
	},

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
		const warehouseField = listview.page.fields_dict.set_warehouse;
		if (warehouseField?.$wrapper) warehouseField.$wrapper.hide();
		ib_setup_status_multiselect(listview, "Delivery Note", [
			"Draft", "Pending", "Confirmed", "Return Issued", "Cancelled",
		]);
		const _orig_render_list = listview.render_list.bind(listview);
		listview.render_list = function () {
			_orig_render_list();
			ib_disable_status_click_filter(listview);
		};
	},
};
