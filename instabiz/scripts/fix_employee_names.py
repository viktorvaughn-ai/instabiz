"""
Title-case all employee names for consistency.
Run via: bench --site frontend execute instabiz.scripts.fix_employee_names.run
"""

import frappe

COMPANY = "Instabiz Solutions India Pvt Ltd"


def run():
	employees = frappe.get_all(
		"Employee",
		filters={"company": COMPANY},
		fields=["name", "employee_name", "first_name", "middle_name", "last_name"],
	)

	updated = 0
	for emp in employees:
		changes = {}
		for field in ["employee_name", "first_name", "middle_name", "last_name"]:
			val = emp.get(field)
			if val:
				titled = val.title()
				if titled != val:
					changes[field] = titled
		if changes:
			frappe.db.set_value("Employee", emp.name, changes)
			new_name = changes.get("employee_name", emp.employee_name)
			print(f"  ✓ {emp.name}: {emp.employee_name!r} → {new_name!r}")
			updated += 1

	frappe.db.commit()
	print(f"\nDone. {updated} records updated.")
