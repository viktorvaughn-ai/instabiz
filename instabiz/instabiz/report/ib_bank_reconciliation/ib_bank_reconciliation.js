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
	// This report is one stage of a 3-stage pipeline (Bank Statement Import
	// -> native Bank Reconciliation Tool -> this report, a read-only cleared/
	// uncleared audit view of the same Payment Entries the Tool matches) —
	// previously reachable from neither of the other two. Cross-nav buttons
	// added both ways instead of merging this into a page: it's a genuine
	// Script Report (native filter bar/datatable/chart/export), forcing it
	// into custom-page HTML would throw all of that away for no real gain.
	onload(report) {
		report.page.add_inner_button(__("Match Transactions →"), () => {
			frappe.set_route("bank-reconciliation-tool");
		});
		report.page.add_inner_button(__("Import More →"), () => {
			frappe.set_route("ib-bank-statement-import");
		});
	},
};
