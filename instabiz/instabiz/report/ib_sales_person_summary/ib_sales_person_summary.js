frappe.query_reports["IB Sales Person Summary"] = {
	filters: [
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			default: frappe.datetime.month_start(),
			reqd: 1,
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
			reqd: 1,
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
			fieldname: "status",
			label: __("Status"),
			fieldtype: "Select",
			options: ["", "Draft", "Pending", "Dispatched", "Confirmed", "Cancelled"].join("\n"),
		},
		{
			fieldname: "territory",
			label: __("Territory"),
			fieldtype: "Link",
			options: "Territory",
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

	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (column.fieldname === "sales_person" && data) {
			value = `<strong>${value}</strong>`;
		}
		return value;
	},
};
