frappe.query_reports["IB Lost Deal Analysis"] = {
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
			fieldname: "source",
			label: __("Source"),
			fieldtype: "Select",
			options: "Both\nLead\nQuotation",
			default: "Both",
		},
		{
			fieldname: "loss_reason",
			label: __("Loss Reason"),
			fieldtype: "Select",
			options: "\nPrice\nCompetition\nNo Budget\nNo Response\nProduct Mismatch\nOther",
		},
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

	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (!data) return value;
		if (column.fieldname === "source") {
			const color = data.source === "Quotation" ? "#2e74b5" : "#d97757";
			value = `<span style="color:${color};font-weight:600">${value}</span>`;
		}
		if (column.fieldname === "loss_reason" && data.loss_reason === "Not Set") {
			value = `<span style="color:#aaa">${value}</span>`;
		}
		return value;
	},
};
