frappe.query_reports["IB Collections Report"] = {
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
			fieldname: "territory",
			label:     __("State"),
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

	formatter(value, row, column, data) {
		if (column.fieldname === "collection_pct" && data) {
			const pct = parseFloat(value) || 0;
			const color = pct >= 75 ? "green" : pct >= 40 ? "orange" : "red";
			return `<span style="color:var(--${color})">${flt(pct, 1)}%</span>`;
		}
		return value;
	},
};
