frappe.query_reports["IB Cash Flow Statement"] = {
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
			fieldname: "chart_type",
			label: __("Chart Type"),
			fieldtype: "Select",
			options: "bar\npie\ndonut\nline",
			default: "bar",
		},
	],

	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (!data) return value;

		// Color balance column: red if negative
		if (column.fieldname === "balance") {
			const raw = data.balance;
			if (raw < 0) {
				value = `<span style="color:#c0392b;font-weight:600;">${value}</span>`;
			} else {
				value = `<span style="font-weight:600;">${value}</span>`;
			}
		}

		// Color inflow green, outflow red
		if (column.fieldname === "inflow" && data.inflow > 0) {
			value = `<span style="color:#1a6b3c;">${value}</span>`;
		}
		if (column.fieldname === "outflow" && data.outflow > 0) {
			value = `<span style="color:#c0392b;">${value}</span>`;
		}

		// Bold opening balance row
		if (data.category === "Opening Balance") {
			value = `<strong>${value}</strong>`;
		}

		return value;
	},

	after_render(report) {
		if (report.chart_wrapper) {
			$(report.chart_wrapper).find(".chart-legend").css("flex-wrap", "wrap");
		}
	},
};
