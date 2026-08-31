frappe.listview_settings["Delivery Note"] = {
	add_fields: ["custom_sales_person"],

	button: {
		show: (doc) => doc.status !== "Cancelled",
		get_label: () => __("Print"),
		get_description: () => __("Print Preview"),
		action(doc) {
			window.open(
				"/printview?doctype=Delivery%20Note&name=" + encodeURIComponent(doc.name) +
				"&format=IB%20Packing%20List&no_letterhead=1&letterhead=No%20Letterhead&settings=%7B%7D",
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
		ib_setup_list_print(listview, "Delivery Note");
		ib_hide_sidebar();
		// Fieldname was "set_warehouse" — doesn't exist on Delivery Note
		// (real field is "set_target_warehouse"), so this never actually
		// hid anything; fixed while touching this file's filter setup.
		const warehouseField = listview.page.fields_dict.set_target_warehouse;
		if (warehouseField?.$wrapper) warehouseField.$wrapper.hide();
		ib_setup_list_autocomplete_filter(listview, "Delivery Note", "title", "Title");
		ib_setup_status_multiselect(listview, "Delivery Note", [
			"Draft", "Pending", "Confirmed", "Return Issued", "Cancelled",
		]);
		ib_setup_list_sales_user_filter(listview, "Delivery Note");
		ib_setup_list_date_filter(listview, "Delivery Note", "creation", []);
		// Filter row order = column order. Live columns: Title, Status,
		// % Installed, ID (% Installed has no filter). Title's native filter was
		// a plain text box — now an autocomplete suggesting distinct title
		// values (the customer name). ID moves out of Frappe's default first
		// slot to sit last in the column-matched group. Customer/Company/Sales
		// Person/Date aren't visible columns, so they trail after (Set Target
		// Warehouse is hidden, not shown at all).
		ib_reorder_filter_row(listview, [
			$(".ib-delivery-note-title-filter"),
			$(".ib-delivery-note-status-multi-filter"),
			listview.page.fields_dict.name && listview.page.fields_dict.name.$wrapper,
			listview.page.fields_dict.customer && listview.page.fields_dict.customer.$wrapper,
			listview.page.fields_dict.company && listview.page.fields_dict.company.$wrapper,
			$(".ib-delivery-note-sales-user-filter"),
			$(".ib-delivery-note-date-range-filter"),
		]);
		const _orig_render_list = listview.render_list.bind(listview);
		listview.render_list = function () {
			_orig_render_list();
			ib_disable_status_click_filter(listview);
		};
	},
};
