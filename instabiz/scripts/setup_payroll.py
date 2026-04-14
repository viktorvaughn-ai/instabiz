"""
Payroll setup script: salary components, structure, and assignments.
Run via: bench --site frontend execute instabiz.scripts.setup_payroll.run
"""

import frappe

COMPANY = "Instabiz Solutions India Pvt Ltd"
CURRENCY = "INR"
STRUCTURE_NAME = "IB Payroll"

# ─── Salary amounts from March 2026 salary sheets ────────────────────────────
# (employee_name_in_db, gross_salary, from_date)
# from_date = date_of_joining placeholder used at import time

IB_JOIN = "2025-01-01"
AST_JOIN = "2024-09-01"

SALARY_ASSIGNMENTS = [
	# ── Instabiz employees ───────────────────────────────────────────────────
	("Mustafa Saleh Bookwala",               35800, IB_JOIN),
	("Nazim Ansari",                         34800, IB_JOIN),
	("Percy Umapathy",                       18000, IB_JOIN),
	("Ruhina Wasim Basha",                   17500, IB_JOIN),
	("Junaid Sayed",                         21850, IB_JOIN),
	("Nisha",                                17500, IB_JOIN),
	("Rupa H Yadav",                         18800, IB_JOIN),
	("Maya Nirban",                          22500, IB_JOIN),
	("Vidhi Bavkar",                         28000, IB_JOIN),
	("Abdul Hamid Ansari",                   27000, IB_JOIN),
	("Anas Khan",                            18000, IB_JOIN),
	("Nidhi Saini",                          16000, IB_JOIN),
	("Mantasha Khan",                        18500, IB_JOIN),
	("Puja Menon",                           17500, IB_JOIN),
	("Bhagat Pandharinath Mukund",           26000, IB_JOIN),
	("Rakashan Shankar Shetty",              23550, IB_JOIN),
	("Sanjay Ankush Bhagat",                15000, IB_JOIN),
	("Prajakta Chougale",                    21850, IB_JOIN),
	("Shaikh Sakina Banu Mohd Iklakh Husen", 18000, IB_JOIN),
	("Md Jassim",                            22000, IB_JOIN),
	("Aqsa Fatima Wahid Ali Shaikh",         26800, IB_JOIN),
	("Rukmani S Bajantri",                   17000, IB_JOIN),
	("Fakrunnisha Ayub Ali Sayyed",          15960, IB_JOIN),
	("Farukh",                               50000, IB_JOIN),
	("Dimple Pol",                           21500, IB_JOIN),
	("Zaid Khan",                            18000, IB_JOIN),
	("Sarvjeet Kori",                        19000, IB_JOIN),
	("Aaliya Yunus Ali Shaikh",              19000, IB_JOIN),
	("Samay Pradeep",                        22000, IB_JOIN),
	("Doliya Pooja Ugmaram",                 18000, IB_JOIN),
	("Rutuja Deepak Jadhav",                 22000, IB_JOIN),
	# ── Astro monthly staff ──────────────────────────────────────────────────
	("Prajesh",                              70000, AST_JOIN),
	("Dinesh Dasharth Kambere",              42000, AST_JOIN),
	("Manoj",                                36000, AST_JOIN),
	("Jayprakash Maurya",                    30000, AST_JOIN),
	("Mansi Narendra Dhodi",                 15000, AST_JOIN),
	("Swapnil Kumar Harishbhai Baria",       16000, AST_JOIN),
	("Patel Urvashiben Sureshbhai",          10000, AST_JOIN),
	("Anjali Ajit Varghese",                 14000, AST_JOIN),
	("Baria Dhruvkumar Pradipbhai",          14000, AST_JOIN),
	# ── Astro daily wage workers ─────────────────────────────────────────────
	("Malavkar Arjunbhai",                   18200, AST_JOIN),
	("Varli Hasmukhbhai",                    19500, AST_JOIN),
	("Halpati Jayeshbhai",                   19500, AST_JOIN),
	("Kadu Dhaneshbhai Rameshbhai",          19500, AST_JOIN),
	("Halpati Pratikkumar",                  18200, AST_JOIN),
	("Varli Dipinbhai",                      18200, AST_JOIN),
	("Dombhariya Kalpeshbhai",               18200, AST_JOIN),
	("Halpati Anandbhai",                    18200, AST_JOIN),
	("Suthediya Rahulbhai",                  18200, AST_JOIN),
	("Varli Himmatkumar Govindbhai",         18200, AST_JOIN),
	("Halpati Vishalbhai",                   18200, AST_JOIN),
	("Varli Nitinbhai",                      18200, AST_JOIN),
	("Kadu Dipeshbhai",                      18200, AST_JOIN),
	("Sangitaben Ramjibhai Varli",           10400, AST_JOIN),
	("Vanitaben Parsottambhai Varli",        10400, AST_JOIN),
	("Lataben Rajeshbhai Vadvi",             10400, AST_JOIN),
	("Varli Sarshvatiben Hasmukbhai",        10400, AST_JOIN),
	("Kadu Jaymatiben Dhaneshbhai",          10400, AST_JOIN),
	("Halpati Gudiben Sureshbhai",            9750, AST_JOIN),
	("Bhura Amitaben Sureshbhai",             9750, AST_JOIN),
	# ── Instabiz employees not in sheets (existing pre-import employees) ─────
	("Idris Officewala",                         0, IB_JOIN),  # no salary data — update manually
	("Amira Shaikh",                             0, IB_JOIN),
	("Ruhi Shaikh",                              0, IB_JOIN),
	("Aishwarya More",                           0, IB_JOIN),
]


def run():
	# 1. Configure salary components
	print("\n── Salary Components ────────────────────────")
	_setup_components()

	frappe.db.commit()

	# 2. Create salary structure
	print("\n── Salary Structure ─────────────────────────")
	_setup_structure()

	frappe.db.commit()

	# 3. Assign structure to all employees
	print("\n── Salary Structure Assignments ─────────────")
	_assign_salaries()

	frappe.db.commit()
	print("\nDone.")


def _setup_components():
	components = [
		# (name, abbr, type, formula, condition, is_tax_applicable, round_to_the_nearest_integer)
		("Basic",                      "B",    "Earning",   "base",                                          "",                                         0, 1),
		("House Rent Allowance",       "HRA",  "Earning",   "0",                                             "",                                         0, 1),
		("Conveyance Allowance",       "CA",   "Earning",   "0",                                             "",                                         0, 1),
		("Provident Fund",             "PF",   "Deduction", "round(min(base, 15000) * 0.12)",                "provident_fund_account",                   0, 1),
		("ESIC Employee Contribution", "ESIC", "Deduction", "round(base * 0.0075)",                          "health_insurance_no and base <= 21000",    0, 1),
		("Professional Tax",           "PT",   "Deduction", "200",                                           "base >= 7500",                             0, 0),
	]

	for (name, abbr, comp_type, formula, cond, is_tax, round_int) in components:
		if frappe.db.exists("Salary Component", name):
			doc = frappe.get_doc("Salary Component", name)
			doc.salary_component_abbr = abbr
			doc.type = comp_type
			doc.formula = formula
			doc.condition = cond
			doc.round_to_the_nearest_integer = round_int
			doc.save(ignore_permissions=True)
			print(f"  · Updated: {name}")
		else:
			doc = frappe.get_doc({
				"doctype": "Salary Component",
				"salary_component": name,
				"salary_component_abbr": abbr,
				"type": comp_type,
				"formula": formula,
				"condition": cond,
				"round_to_the_nearest_integer": round_int,
			})
			doc.insert(ignore_permissions=True)
			print(f"  ✓ Created: {name}")


def _setup_structure():
	if frappe.db.exists("Salary Structure", STRUCTURE_NAME):
		print(f"  · Exists: {STRUCTURE_NAME} — skipping recreation")
		return

	earnings = [
		{"salary_component": "Basic",                "abbr": "B",    "formula": "base", "amount_based_on_formula": 1},
	]
	deductions = [
		{"salary_component": "Provident Fund",             "abbr": "PF",   "formula": "round(min(base, 15000) * 0.12)", "amount_based_on_formula": 1, "condition": "provident_fund_account"},
		{"salary_component": "ESIC Employee Contribution", "abbr": "ESIC", "formula": "round(base * 0.0075)",            "amount_based_on_formula": 1, "condition": "health_insurance_no and base <= 21000"},
		{"salary_component": "Professional Tax",           "abbr": "PT",   "formula": "200",                            "amount_based_on_formula": 1, "condition": "base >= 7500"},
	]

	doc = frappe.get_doc({
		"doctype": "Salary Structure",
		"name": STRUCTURE_NAME,
		"company": COMPANY,
		"currency": CURRENCY,
		"is_active": "Yes",
		"payroll_frequency": "Monthly",
		"earnings": earnings,
		"deductions": deductions,
	})
	doc.insert(ignore_permissions=True)
	print(f"  ✓ Created: {STRUCTURE_NAME}")


def _assign_salaries():
	for (emp_name, gross, _hint_date) in SALARY_ASSIGNMENTS:
		if not gross:
			print(f"  · Skipped (no salary data): {emp_name}")
			continue

		row = frappe.db.get_value("Employee", {"employee_name": emp_name}, ["name", "date_of_joining"], as_dict=True)
		if not row:
			print(f"  ✗ Employee not found: {emp_name}")
			continue

		emp = row.name
		# Use the employee's own joining date so we never go before it
		from_date = str(row.date_of_joining)

		# Skip if already assigned
		existing = frappe.db.exists("Salary Structure Assignment", {
			"employee": emp,
			"salary_structure": STRUCTURE_NAME,
		})
		if existing:
			print(f"  · Exists: {emp_name}")
			continue

		try:
			doc = frappe.get_doc({
				"doctype": "Salary Structure Assignment",
				"employee": emp,
				"salary_structure": STRUCTURE_NAME,
				"company": COMPANY,
				"from_date": from_date,
				"base": gross,
				"currency": CURRENCY,
			})
			doc.insert(ignore_permissions=True)
			doc.submit()
			print(f"  ✓ Assigned: {emp_name} — ₹{gross:,}")
		except Exception as e:
			print(f"  ✗ ERROR {emp_name}: {e}")
