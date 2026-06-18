frappe.listview_settings["GL Entry"] = {
	onload(listview) {
		ib_setup_gl_print(listview);
	},
};
