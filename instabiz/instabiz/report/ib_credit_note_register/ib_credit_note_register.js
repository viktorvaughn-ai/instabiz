frappe.query_reports["IB Credit Note Register"] = {
	filters: [
		{
			fieldname: "from_date",
			label:     __("From Date"),
			fieldtype: "Date",
			default:   frappe.datetime.month_start(),
			reqd:      1,
		},
		{
			fieldname: "to_date",
			label:     __("To Date"),
			fieldtype: "Date",
			default:   frappe.datetime.get_today(),
			reqd:      1,
		},
		{
			fieldname: "customer",
			label:     __("Customer"),
			fieldtype: "Link",
			options:   "Customer",
		},
		{
			fieldname: "territory",
			label:     __("Territory"),
			fieldtype: "Link",
			options:   "Territory",
		},
		{
			fieldname: "sales_person_user",
			label:     __("Sales Person"),
			fieldtype: "Link",
			options:   "User",
		},
		{
			fieldname: "chart_type",
			label:     __("Chart Type"),
			fieldtype: "Select",
			options:   "bar\npie\ndonut\nline\npercentage",
			default:   "bar",
		},
	],

	after_render() {
		const legend = this.$report?.find?.(".chart-legend");
		if (legend) legend.css("flex-wrap", "wrap");
	},
};
