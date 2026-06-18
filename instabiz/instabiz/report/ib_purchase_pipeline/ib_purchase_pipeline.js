frappe.query_reports["IB Purchase Pipeline"] = {
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
			fieldname: "supplier",
			label: __("Supplier"),
			fieldtype: "Link",
			options: "Supplier",
		},
		{
			fieldname: "custom_location",
			label: __("Location"),
			fieldtype: "Select",
			options: "\nmaharashtra\nchennai\ngujarat",
		},
		{
			fieldname: "status",
			label: __("PO Status"),
			fieldtype: "Select",
			options:
				"\nDraft\nTo Receive and Bill\nTo Bill\nTo Receive\nCompleted\nCancelled\nClosed",
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
		const $legend = $(report.wrapper).find(".chart-legend");
		if ($legend.length) $legend.css("flex-wrap", "wrap");
	},

	formatter(value, row, column, data) {
		if (column.fieldname === "grn_status" && data) {
			if (value === "Fully Received")
				return `<span style="color:#16a34a;font-weight:600">${value}</span>`;
			if (value === "Not Received")
				return `<span style="color:#dc2626;font-weight:600">${value}</span>`;
			return `<span style="color:#d97706;font-weight:600">${value}</span>`;
		}
		if (column.fieldname === "pi_status" && data) {
			if (value === "Fully Billed")
				return `<span style="color:#16a34a;font-weight:600">${value}</span>`;
			if (value === "Not Billed")
				return `<span style="color:#dc2626;font-weight:600">${value}</span>`;
			return `<span style="color:#d97706;font-weight:600">${value}</span>`;
		}
		if (column.fieldname === "outstanding" && data) {
			const val = parseFloat(value) || 0;
			if (val > 0)
				return `<span style="color:#dc2626;font-weight:600">${frappe.format(value, column)}</span>`;
		}
		return value;
	},
};
