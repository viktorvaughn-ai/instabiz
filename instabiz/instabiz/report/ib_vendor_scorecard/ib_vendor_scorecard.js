frappe.query_reports["IB Vendor Scorecard"] = {
	filters: [
		{
			fieldname: "vendor",
			label: __("Vendor"),
			fieldtype: "Link",
			options: "Supplier",
		},
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			default: frappe.datetime.add_months(frappe.datetime.get_today(), -6),
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
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
		if (column.fieldname === "rating") {
			const color = { Excellent: "#1a7f37", Good: "#2e74b5", Fair: "#d97757", Poor: "#cf222e" }[data.rating] || "#666";
			value = `<span style="color:${color};font-weight:600">${value}</span>`;
		}
		if (column.fieldname === "overall_score") {
			const pct = data.overall_score || 0;
			const color = pct >= 90 ? "#1a7f37" : pct >= 75 ? "#2e74b5" : pct >= 60 ? "#d97757" : "#cf222e";
			value = `<span style="color:${color};font-weight:600">${value}</span>`;
		}
		return value;
	},
};
