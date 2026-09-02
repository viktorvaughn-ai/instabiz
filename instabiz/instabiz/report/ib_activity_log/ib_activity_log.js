frappe.query_reports["IB Activity Log"] = {
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
			options: "All\nLead Activity\nCustomer Activity\nAssignment",
			default: "All",
		},
		{
			fieldname: "sales_person_user",
			label: __("Sales Person"),
			fieldtype: "Link",
			options: "User",
		},
		{
			fieldname: "territory",
			label: __("State"),
			fieldtype: "Link",
			options: "Territory",
		},
		{
			fieldname: "activity_type",
			label: __("Activity Type"),
			fieldtype: "Select",
			options: "\nCall\nMeeting\nWhatsApp\nEmail\nVisit",
		},
		{
			fieldname: "chart_type",
			label: __("Chart Type"),
			fieldtype: "Select",
			options: "bar\npie\ndonut\nline\npercentage",
			default: "bar",
		},
	],

	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (!data) return value;

		if (column.fieldname === "source") {
			const colors = {
				"Lead Activity":     "#1e40af",
				"Customer Activity": "#92400e",
				"Assignment":        "#065f46",
			};
			const bg = {
				"Lead Activity":     "#dbeafe",
				"Customer Activity": "#fef3c7",
				"Assignment":        "#d1fae5",
			};
			const s = data.source;
			if (s && colors[s]) {
				return `<span style="background:${bg[s]};color:${colors[s]};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">${s}</span>`;
			}
		}

		if (column.fieldname === "outcome") {
			const good = ["Positive", "Interested", "Order Placed"];
			const bad  = ["Negative", "Not Interested", "No Answer", "No Response"];
			const warn = ["Neutral", "Follow Up"];
			const v = data.outcome || "";
			if (good.includes(v)) return `<span style="color:#1a7f37;font-weight:600">${value}</span>`;
			if (bad.includes(v))  return `<span style="color:#cf222e;font-weight:600">${value}</span>`;
			if (warn.includes(v)) return `<span style="color:#d97757;font-weight:600">${value}</span>`;
		}

		if (column.fieldname === "activity_type") {
			const icons = {
				Call: "📞", Meeting: "🤝", WhatsApp: "💬", Email: "📧", Visit: "📍",
				Contacted: "✅", "Order Placed": "📦", Skipped: "⏭",
			};
			const v = data.activity_type || "";
			if (icons[v]) return `${icons[v]} ${value}`;
		}

		return value;
	},

	after_render(report) {
		const legend = report.chart_wrapper && report.chart_wrapper.querySelector(".chart-legend");
		if (legend) {
			legend.style.cssText = "display:flex;flex-wrap:wrap;justify-content:center;gap:6px 16px;";
		}
	},
};
