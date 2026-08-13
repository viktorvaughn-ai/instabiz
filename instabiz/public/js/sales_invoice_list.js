frappe.listview_settings["Sales Invoice"] = {
	add_fields: ["custom_sales_person"],

	button: {
		show: (doc) => doc.status !== "Cancelled",
		get_label: () => __("Print"),
		get_description: () => __("Print Preview"),
		action(doc) {
			window.open(
				"/printview?doctype=Sales%20Invoice&name=" + encodeURIComponent(doc.name) +
				"&format=IB%20GST%20Tax%20Invoice&no_letterhead=1&letterhead=No%20Letterhead&settings=%7B%7D",
				"_blank"
			);
		},
	},

	get_indicator(doc) {
		const map = {
			Draft:     "red",
			Unpaid:    "orange",
			Overdue:   "red",
			Paid:      "green",
			Return:    "grey",
			Cancelled: "red",
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
		ib_setup_list_print(listview, "Sales Invoice");
		ib_hide_sidebar();
		ib_setup_status_multiselect(listview, "Sales Invoice", [
			"Draft", "Unpaid", "Overdue", "Paid", "Return", "Cancelled",
		]);
		ib_setup_list_sales_user_filter(listview, "Sales Invoice");
		ib_setup_list_date_filter(listview, "Sales Invoice", "posting_date", []);
		// Filter row order = column order (2026-08-13): live columns are
		// Title, Status, Grand Total, Is Return, ID — Title/ID stay in
		// Frappe's own default first/second slot (title_field + ID search
		// are always first), Status moves up to right after them. Customer/
		// Company/Sales Person/Date aren't visible columns, so they trail
		// after in their existing order.
		ib_reorder_filter_row(listview, [
			$(".ib-sales-invoice-status-multi-filter"),
			listview.page.fields_dict.customer && listview.page.fields_dict.customer.$wrapper,
			listview.page.fields_dict.company && listview.page.fields_dict.company.$wrapper,
			$(".ib-sales-invoice-sales-user-filter"),
			$(".ib-sales-invoice-date-range-filter"),
		]);
		const _orig_render_list = listview.render_list.bind(listview);
		listview.render_list = function () {
			_orig_render_list();
			ib_disable_status_click_filter(listview);
		};
	},
};
