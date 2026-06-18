frappe.listview_settings["Purchase Receipt"] = {
	get_indicator(doc) {
		const map = {
			Draft:           "red",
			"Return Issued": "grey",
			Completed:       "green",
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
	},

	onload(listview) {
		ib_setup_list_print(listview, "Purchase Receipt");
		ib_hide_sidebar();
		ib_setup_status_multiselect(listview, "Purchase Receipt", [
			"Draft", "Return Issued", "Completed", "Cancelled",
		]);
		ib_setup_list_date_filter(listview, "Purchase Receipt", "posting_date", []);
		const _orig_render_list = listview.render_list.bind(listview);
		listview.render_list = function () {
			_orig_render_list();
			ib_disable_status_click_filter(listview);
		};
	},
};
