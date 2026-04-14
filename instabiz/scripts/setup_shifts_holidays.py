"""
Setup script:
1. Create Instabiz 2026 holiday list from company notice board
2. Assign holiday list to company and all employees
3. Fix Standard Shift working hour thresholds
4. Create Factory Shift (12 hours)
5. Assign correct shifts to all employees (office vs factory)

Run via: bench --site frontend execute instabiz.scripts.setup_shifts_holidays.run
"""

import frappe

COMPANY = "Instabiz Solutions India Pvt Ltd"
HOLIDAY_LIST = "Instabiz 2026"

# ── Holiday list from company notice board ────────────────────────────────────
HOLIDAYS = [
	("2026-01-26", "Republic Day"),
	("2026-03-04", "Holi"),
	("2026-03-21", "Ramzan Eid"),
	("2026-05-01", "Maharashtra Day"),
	("2026-05-28", "Bakri Eid"),
	("2026-08-15", "Independence Day"),
	("2026-08-26", "Milad un Nabi"),
	("2026-09-25", "Ganesh Chaturthi"),
	("2026-10-02", "Gandhi Jayanti"),
	("2026-10-20", "Dassera"),
	("2026-11-08", "Diwali"),
	("2026-11-09", "Diwali"),
	("2026-11-10", "Diwali"),
	("2026-11-11", "Diwali"),
]

# ── Shift definitions ─────────────────────────────────────────────────────────
OFFICE_SHIFT  = "Standard Shift"    # 11:00 – 18:00 (exists, needs threshold fix)
FACTORY_SHIFT = "Factory Shift"     # 08:00 – 20:00 (12 hours, to create)

# Factory departments
FACTORY_DEPTS = ["Factory Production - IB", "Factory Management - IB", "Factory Administration - IB"]


def run():
	_setup_holiday_list()
	frappe.db.commit()

	_assign_holiday_to_company()
	_assign_holiday_to_employees()
	frappe.db.commit()

	_fix_standard_shift()
	_create_factory_shift()
	frappe.db.commit()

	_assign_shifts()
	frappe.db.commit()

	print("\nDone.")


# ── Holiday List ──────────────────────────────────────────────────────────────

def _setup_holiday_list():
	print("\n── Holiday List ─────────────────────────────")
	if frappe.db.exists("Holiday List", HOLIDAY_LIST):
		frappe.delete_doc("Holiday List", HOLIDAY_LIST, ignore_permissions=True)
		print(f"  · Deleted existing: {HOLIDAY_LIST}")

	holidays = [{"holiday_date": d, "description": name} for d, name in HOLIDAYS]
	doc = frappe.get_doc({
		"doctype": "Holiday List",
		"holiday_list_name": HOLIDAY_LIST,
		"from_date": "2026-01-01",
		"to_date": "2026-12-31",
		"holidays": holidays,
	})
	doc.insert(ignore_permissions=True)
	print(f"  ✓ Created: {HOLIDAY_LIST} ({len(HOLIDAYS)} holidays)")
	for d, name in HOLIDAYS:
		print(f"      {d}  {name}")


def _assign_holiday_to_company():
	print("\n── Company Holiday List ─────────────────────")
	frappe.db.set_value("Company", COMPANY, "default_holiday_list", HOLIDAY_LIST)
	print(f"  ✓ Set {HOLIDAY_LIST} as default for {COMPANY}")


def _assign_holiday_to_employees():
	print("\n── Employee Holiday List ────────────────────")
	employees = frappe.get_all("Employee",
		filters={"company": COMPANY, "status": "Active"},
		fields=["name", "employee_name"]
	)
	for emp in employees:
		frappe.db.set_value("Employee", emp.name, "holiday_list", HOLIDAY_LIST)
	print(f"  ✓ Assigned to {len(employees)} employees")


# ── Shifts ────────────────────────────────────────────────────────────────────

def _fix_standard_shift():
	print("\n── Standard Shift (fix thresholds) ─────────")
	doc = frappe.get_doc("Shift Type", OFFICE_SHIFT)
	doc.working_hours_threshold_for_absent   = 4.0   # < 4h = absent
	doc.working_hours_threshold_for_half_day = 5.5   # < 5.5h = half day, >= 5.5h = present
	doc.holiday_list = HOLIDAY_LIST
	doc.save(ignore_permissions=True)
	print(f"  ✓ Updated: absent < 4h, half-day < 5.5h")


def _create_factory_shift():
	print("\n── Factory Shift (12 hours) ─────────────────")
	if frappe.db.exists("Shift Type", FACTORY_SHIFT):
		doc = frappe.get_doc("Shift Type", FACTORY_SHIFT)
		doc.start_time = "08:00:00"
		doc.end_time   = "20:00:00"
		doc.working_hours_threshold_for_absent   = 6.0
		doc.working_hours_threshold_for_half_day = 9.0
		doc.enable_auto_attendance = 1
		doc.holiday_list = HOLIDAY_LIST
		doc.save(ignore_permissions=True)
		print(f"  · Updated existing: {FACTORY_SHIFT}")
	else:
		doc = frappe.get_doc({
			"doctype": "Shift Type",
			"name": FACTORY_SHIFT,
			"start_time": "08:00:00",
			"end_time": "20:00:00",
			"enable_auto_attendance": 1,
			"working_hours_threshold_for_absent": 6.0,
			"working_hours_threshold_for_half_day": 9.0,
			"holiday_list": HOLIDAY_LIST,
		})
		doc.insert(ignore_permissions=True)
		print(f"  ✓ Created: {FACTORY_SHIFT} (08:00–20:00, absent < 6h, half-day < 9h)")


# ── Shift Assignments ─────────────────────────────────────────────────────────

def _assign_shifts():
	print("\n── Shift Assignments ────────────────────────")
	employees = frappe.get_all("Employee",
		filters={"company": COMPANY, "status": "Active"},
		fields=["name", "employee_name", "department", "date_of_joining"]
	)

	office_count = factory_count = 0
	for emp in employees:
		is_factory = emp.department in FACTORY_DEPTS
		shift = FACTORY_SHIFT if is_factory else OFFICE_SHIFT

		# Set default_shift on employee master
		frappe.db.set_value("Employee", emp.name, "default_shift", shift)

		# Create Shift Assignment if not already exists
		existing = frappe.db.exists("Shift Assignment", {
			"employee": emp.name,
			"shift_type": shift,
			"docstatus": 1,
		})
		if not existing:
			try:
				sa = frappe.get_doc({
					"doctype": "Shift Assignment",
					"employee": emp.name,
					"company": COMPANY,
					"shift_type": shift,
					"start_date": str(emp.date_of_joining),
				})
				sa.insert(ignore_permissions=True)
				sa.submit()
			except Exception as e:
				print(f"  ✗ Shift assignment error {emp.employee_name}: {e}")
				continue

		if is_factory:
			factory_count += 1
		else:
			office_count += 1

	print(f"  ✓ Office  → {OFFICE_SHIFT}:  {office_count} employees")
	print(f"  ✓ Factory → {FACTORY_SHIFT}: {factory_count} employees")
