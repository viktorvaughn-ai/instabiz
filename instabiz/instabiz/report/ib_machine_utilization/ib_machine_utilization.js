frappe.query_reports["IB Machine Utilization"] = {
	filters: [
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			default: frappe.datetime.add_days(frappe.datetime.get_today(), -30),
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
		},
		{
			fieldname: "machine",
			label: __("Machine"),
			fieldtype: "Link",
			options: "IB Machine",
		},
		{
			fieldname: "location",
			label: __("Location"),
			fieldtype: "Select",
			options: "\nmaharashtra\ngujarat\nchennai",
		},
		{
			fieldname: "chart_type",
			label: __("Chart Type"),
			fieldtype: "Select",
			options: "bar\nline\npercentage",
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

		if (["utilization_pct", "oee_pct"].includes(column.fieldname)) {
			const v = data[column.fieldname];
			if (v === null || v === undefined) {
				return `<span style="color:#888" title="No data for this leg — see Performance/Quality columns">—</span>`;
			}
			const color = v >= 75 ? "#1a7f37" : v >= 50 ? "#2e74b5" : v >= 25 ? "#d97757" : "#cf222e";
			value = `<span style="color:${color};font-weight:600">${value}</span>`;
		}

		if (column.fieldname === "performance_pct" && (data.performance_pct === null || data.performance_pct === undefined)) {
			value = `<span style="color:#888" title="Machine capacity/capacity UOM not set — Performance can't be computed">—</span>`;
		}
		if (column.fieldname === "quality_pct" && (data.quality_pct === null || data.quality_pct === undefined)) {
			value = `<span style="color:#888" title="No Work Order that day had a recorded (nonzero) wastage % — Quality can't be distinguished from 'never measured'">—</span>`;
		}
		return value;
	},
};
