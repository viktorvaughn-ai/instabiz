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
			fieldname: "last_1_year",
			label: __("Last 1 Year"),
			fieldtype: "Button",
			click: function () {
				const to_date = frappe.datetime.get_today();
				frappe.query_report.set_filter_value({
					from_date: frappe.datetime.add_months(to_date, -12),
					to_date: to_date,
				});
			},
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
