frappe.listview_settings["Purchase Order"] = {
	button: {
		show: (doc) => doc.status !== "Cancelled",
		get_label: () => __("Print"),
		get_description: () => __("Print Preview"),
		action(doc) {
			window.open(
				"/printview?doctype=Purchase%20Order&name=" + encodeURIComponent(doc.name) +
				"&format=IB%20Purchase%20Order&no_letterhead=1&letterhead=No%20Letterhead&settings=%7B%7D",
				"_blank"
			);
		},
	},

	get_indicator(doc) {
		const map = {
			Draft:                "red",
			"To Receive and Bill": "orange",
			"To Bill":            "yellow",
			"To Receive":         "blue",
			Completed:            "green",
			Cancelled:            "red",
			Closed:               "grey",
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
	},

	onload(listview) {
		ib_setup_list_print(listview, "Purchase Order");
		ib_hide_sidebar();
		ib_setup_list_autocomplete_filter(listview, "Purchase Order", "supplier_name", "Supplier Name");
		ib_setup_status_multiselect(listview, "Purchase Order", [
			"Draft", "To Receive and Bill", "To Bill", "To Receive", "Completed", "Cancelled", "Closed",
		]);
		ib_setup_list_date_filter(listview, "Purchase Order", "transaction_date", []);
		// Filter row order = column order. Live columns: Supplier Name, Status,
		// Date, Grand Total, % Billed, ID (Grand Total / % Billed have no
		// filter). Supplier Name's native filter was a plain text box — now an
		// autocomplete suggesting distinct supplier names. ID moves out of
		// Frappe's default first slot to sit last in the column-matched group.
		// Supplier/Company/Location aren't visible columns, so they trail after.
		ib_reorder_filter_row(listview, [
			$(".ib-purchase-order-supplier-name-filter"),
			$(".ib-purchase-order-status-multi-filter"),
			$(".ib-purchase-order-date-range-filter"),
			listview.page.fields_dict.name && listview.page.fields_dict.name.$wrapper,
			listview.page.fields_dict.supplier && listview.page.fields_dict.supplier.$wrapper,
			listview.page.fields_dict.company && listview.page.fields_dict.company.$wrapper,
			listview.page.fields_dict.custom_location && listview.page.fields_dict.custom_location.$wrapper,
		]);
		const _orig_render_list = listview.render_list.bind(listview);
		listview.render_list = function () {
			_orig_render_list();
			ib_disable_status_click_filter(listview);
		};
	},
};
