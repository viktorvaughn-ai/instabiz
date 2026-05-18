frappe.query_reports["IB Payroll Summary"] = {
	filters: [
		{
			fieldname: "department",
			label: __("Department"),
			fieldtype: "Link",
			options: "Department",
		},
		{
			fieldname: "salary_structure",
			label: __("Salary Structure"),
			fieldtype: "Link",
			options: "Salary Structure",
		},
	],
};
