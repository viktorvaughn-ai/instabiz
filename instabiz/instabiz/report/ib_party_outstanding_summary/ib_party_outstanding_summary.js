frappe.query_reports["IB Party Outstanding Summary"] = {
	filters: [
		{
			fieldname: "territory",
			label: __("Territory"),
			fieldtype: "Link",
			options: "Territory",
		},
		{
			fieldname: "sales_person_user",
			label: __("Sales Person"),
			fieldtype: "Link",
			options: "User",
			get_query() { return { filters: { enabled: 1 } }; },
		},
		{
			fieldname: "min_balance",
			label: __("Min Balance"),
			fieldtype: "Currency",
			default: 0,
			description: __("Hide parties with |Debit - Credit| below this amount"),
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
		if (column.fieldname === "debit" && data.debit > 0) {
			value = `<span style="color:#cf222e;font-weight:600">${value}</span>`;
		}
		if (column.fieldname === "credit" && data.credit > 0) {
			value = `<span style="color:#1a7f37;font-weight:600">${value}</span>`;
		}
		return value;
	},
};
