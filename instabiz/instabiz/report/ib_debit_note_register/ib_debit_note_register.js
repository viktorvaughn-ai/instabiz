frappe.query_reports["IB Debit Note Register"] = {
	filters: [
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			default: frappe.datetime.month_start(),
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
		},
		{
			fieldname: "supplier",
			label: __("Supplier"),
			fieldtype: "Link",
			options: "Supplier",
		},
		{
			fieldname: "reason_code",
			label: __("Reason Code"),
			fieldtype: "Select",
			options: "\nPurchase Return\nRate Difference\nPost Purchase Discount",
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
		if (report.chart_options && report.chart_options.data) {
			const legend = report.$chart && report.$chart.find(".chart-legend");
			if (legend) legend.css("flex-wrap", "wrap");
		}
	},
};
