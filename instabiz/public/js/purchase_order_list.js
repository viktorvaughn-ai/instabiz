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
		ib_setup_status_multiselect(listview, "Purchase Order", [
			"Draft", "To Receive and Bill", "To Bill", "To Receive", "Completed", "Cancelled", "Closed",
		]);
		ib_setup_list_date_filter(listview, "Purchase Order", "transaction_date", []);
		// Filter row order = column order (2026-08-13): live columns are
		// Supplier Name, Status, Date, Grand Total, % Billed, ID — Supplier
		// Name/ID stay in Frappe's own default first/second slot (title_field
		// is supplier_name here), Status/Date move up right after them.
		// Supplier/Company/Location aren't visible columns, trail after.
		ib_reorder_filter_row(listview, [
			$(".ib-purchase-order-status-multi-filter"),
			$(".ib-purchase-order-date-range-filter"),
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
