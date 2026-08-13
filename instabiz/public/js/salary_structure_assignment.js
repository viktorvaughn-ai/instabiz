frappe.ui.form.on("Salary Structure Assignment", {
	refresh(frm) {
		// Printing a Salary Structure Assignment itself is never useful (it's
		// just the assignment record, no pay figures) — redirect the toolbar
		// Print action to this employee's own Salary Slip print instead.
		// Picks the most recent Salary Slip (submitted preferred over draft,
		// via docstatus desc in the sort — see resolved question 2026-08-13);
		// if none exists yet, says so instead of opening a blank/wrong print.
		frm.print_doc = function () {
			if (!frm.doc.employee) {
				frappe.msgprint(__("No Employee set on this Salary Structure Assignment."));
				return;
			}
			frappe.db.get_list("Salary Slip", {
				filters: { employee: frm.doc.employee, docstatus: ["!=", 2] },
				fields: ["name"],
				order_by: "docstatus desc, posting_date desc",
				limit: 1,
			}).then((rows) => {
				if (!rows.length) {
					frappe.msgprint(
						__("No Salary Slip found yet for {0}.", [frm.doc.employee_name || frm.doc.employee])
					);
					return;
				}
				frappe.set_route("print", "Salary Slip", rows[0].name);
			});
		};
	},
});
