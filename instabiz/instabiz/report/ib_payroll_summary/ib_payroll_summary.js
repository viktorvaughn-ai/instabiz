frappe.query_reports["IB Payroll Summary"] = {
	filters: [
		{
			fieldname: "payroll_month",
			label: __("Payroll Month"),
			fieldtype: "Date",
			default: frappe.datetime.month_start(),
		},
		{
			fieldname: "emp_category",
			label: __("Employee Type"),
			fieldtype: "Select",
			options: "\nAll\nOffice\nFactory",
			default: "All",
		},
{
			fieldname: "salary_structure",
			label: __("Salary Structure"),
			fieldtype: "Link",
			options: "Salary Structure",
		},
	],
};
