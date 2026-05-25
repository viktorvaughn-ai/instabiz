frappe.query_reports["IB Bank Reconciliation"] = {
	filters: [
		{
			fieldname: "bank_account",
			label: __("Bank Account"),
			fieldtype: "Link",
			options: "Bank Account",
			reqd: 0,
			get_query: () => ({ filters: { is_company_account: 1 } }),
		},
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
			fieldname: "show_cleared",
			label: __("Show Cleared"),
			fieldtype: "Check",
			default: 0,
		},
		{
			fieldname: "chart_type",
			label: __("Chart Type"),
			fieldtype: "Select",
			options: "bar\npie\ndonut\nline",
			default: "bar",
		},
	],
	after_render(report) {
		if (report.chart_wrapper) {
			$(report.chart_wrapper).find(".chart-legend").css("flex-wrap", "wrap");
		}
	},
};
