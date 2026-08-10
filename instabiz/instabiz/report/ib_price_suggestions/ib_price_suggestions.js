frappe.query_reports["IB Price Suggestions"] = {
	filters: [
		{
			fieldname: "status",
			label: __("Status"),
			fieldtype: "Select",
			options: "\nNew\nReviewed\nApplied\nDismissed",
		},
		{
			fieldname: "needs_review_only",
			label: __("Needs Review Only"),
			fieldtype: "Check",
		},
		{
			fieldname: "item",
			label: __("Item"),
			fieldtype: "Link",
			options: "Item",
		},
		{
			fieldname: "customer",
			label: __("Customer"),
			fieldtype: "Link",
			options: "Customer",
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
		if (column.fieldname === "deviation_pct") {
			const pct = Math.abs(data.deviation_pct || 0);
			const color = pct > 5 ? "#cf222e" : "#1a7f37";
			value = `<span style="color:${color};font-weight:600">${value}</span>`;
		}
		return value;
	},
};
