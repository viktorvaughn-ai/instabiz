frappe.query_reports["IB ABC Analysis"] = {
	filters: [
		{
			fieldname: "computed_on",
			label: __("Computed On"),
			fieldtype: "Date",
			description: __("Leave blank to use the most recent weekly run"),
		},
		{
			fieldname: "classification",
			label: __("Classification"),
			fieldtype: "Select",
			options: "\nA\nB\nC",
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
		if (column.fieldname === "classification") {
			const color = { A: "#1a7f37", B: "#d97757", C: "#cf222e" }[data.classification] || "#666";
			value = `<span style="color:${color};font-weight:700">${value}</span>`;
		}
		if (column.fieldname === "cumulative_pct") {
			const pct = data.cumulative_pct || 0;
			const color = pct <= 80 ? "#1a7f37" : pct <= 95 ? "#d97757" : "#cf222e";
			value = `<span style="color:${color}">${value}</span>`;
		}
		return value;
	},
};
