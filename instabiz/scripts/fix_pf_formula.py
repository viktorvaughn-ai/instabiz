import frappe

def run():
	# Frappe safe_eval does not expose `min` — use ternary instead
	# Old: round(min(base, 15000) * 0.12)
	# New: round((base if base <= 15000 else 15000) * 0.12)

	# Fix on Salary Component
	comp = frappe.get_doc("Salary Component", "Provident Fund")
	comp.formula = "round((base if base <= 15000 else 15000) * 0.12)"
	comp.save(ignore_permissions=True)
	print(f"  ✓ Updated Salary Component: Provident Fund")

	# Fix on Salary Structure detail row
	frappe.db.set_value(
		"Salary Detail",
		{"parent": "IB Payroll", "salary_component": "Provident Fund"},
		"formula",
		"round((base if base <= 15000 else 15000) * 0.12)"
	)
	print(f"  ✓ Updated Salary Detail in IB Payroll")

	frappe.db.commit()
	print("Done.")
