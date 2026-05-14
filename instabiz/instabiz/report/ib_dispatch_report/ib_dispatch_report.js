frappe.query_reports["IB Dispatch Report"] = {
	filters: [
		{
			fieldname: "date",
			label: __("Date"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
			reqd: 1,
		},
		{
			fieldname: "warehouse",
			label: __("Warehouse"),
			fieldtype: "Link",
			options: "Warehouse",
		},
		{
			fieldname: "sales_person_user",
			label: __("Sales Person"),
			fieldtype: "Link",
			options: "User",
			get_query() {
				return { filters: { enabled: 1 } };
			},
		},
		{
			fieldname: "chart_type",
			label: __("Chart Type"),
			fieldtype: "Select",
			options: "bar\npie\ndonut\nline\npercentage",
			default: "bar",
		},
	],

	after_render(report) {
		const legend = report.chart_wrapper && report.chart_wrapper.querySelector(".chart-legend");
		if (legend) {
			legend.style.cssText = "display:flex;flex-wrap:wrap;justify-content:center;gap:6px 16px;";
		}
	},
};
