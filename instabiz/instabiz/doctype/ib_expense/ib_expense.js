frappe.ui.form.on("IB Expense", {
	setup(frm) {
		frm.set_query("expense_account", () => ({
			filters: { company: frm.doc.company, root_type: "Expense", is_group: 0 },
		}));
		// root_type Liability, not account_type "Payable" — the default
		// "Expenses Payable - IB" account is deliberately untyped (no real
		// Party is ever attached, unlike Creditors, so GL Entry's own
		// mandatory-party-on-Payable-account check would otherwise block
		// every submit; see ib_expense.py's module docstring).
		frm.set_query("payable_account", () => ({
			filters: { company: frm.doc.company, root_type: "Liability", is_group: 0 },
		}));
		frm.set_query("mode_of_payment", () => ({
			filters: { enabled: 1 },
		}));
	},
});
