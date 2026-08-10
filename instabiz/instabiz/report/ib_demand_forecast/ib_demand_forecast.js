frappe.query_reports["IB Demand Forecast"] = {
	filters: [
		{
			fieldname: "item",
			label: __("Item"),
			fieldtype: "Link",
			options: "Item",
		},
		{
			fieldname: "item_group",
			label: __("Item Group"),
			fieldtype: "Link",
			options: "Item Group",
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
		if (column.fieldname === "risk_flag" && data.risk_flag) {
			const color = data.risk_flag === "Low Cover" ? "#cf222e" : "#ed7d31";
			value = `<span style="color:${color};font-weight:600">${data.risk_flag}</span>`;
		}
		if (column.fieldname === "weeks_of_cover_display" && data.risk_flag === "Low Cover") {
			value = `<span style="color:#cf222e;font-weight:600">${value}</span>`;
		}
		return value;
	},
};
