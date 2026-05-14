frappe.query_reports["IB Gross Margin"] = {
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
			fieldname: "territory",
			label: __("Territory"),
			fieldtype: "Link",
			options: "Territory",
		},
		{
			fieldname: "item_group",
			label: __("Item Group"),
			fieldtype: "Link",
			options: "Item Group",
		},
		{
			fieldname: "sales_person_user",
			label: __("Sales Person"),
			fieldtype: "Link",
			options: "User",
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
		if (!data) return value;
		if (column.fieldname === "margin_pct") {
			const pct = data.margin_pct || 0;
			const color = pct >= 30 ? "#1a7f37" : pct >= 15 ? "#d97757" : "#cf222e";
			value = `<span style="color:${color};font-weight:600">${value}</span>`;
		}
		return value;
	},
};
