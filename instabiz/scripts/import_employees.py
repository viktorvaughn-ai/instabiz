"""
Employee import script for Instabiz + Astro workers.
Run via: bench --site frontend execute instabiz.scripts.import_employees.run
"""

import frappe

COMPANY = "Instabiz Solutions India Pvt Ltd"
IB_JOIN  = "2025-01-01"   # placeholder for Instabiz
AST_JOIN = "2024-09-01"   # placeholder for Astro (first payroll sheet)

# ─── Master data ─────────────────────────────────────────────────────────────

DEPARTMENTS = [
    "Factory Management",
    "Factory Production",
    "Factory Administration",
]

DESIGNATIONS = [
    "Factory Worker",
    "Factory Supervisor",
    "Staff",
    "Executive",
]

EMPLOYMENT_TYPES = [
    "Daily Wage",
]

# ─── Employee data ────────────────────────────────────────────────────────────
# Fields: name, gender, department, designation, employment_type,
#         date_of_joining, esic_no, uan, salary_mode

INSTABIZ_EMPLOYEES = [
    # Clear non-duplicates only — flagged ones listed separately at bottom
    ("Rupa H Yadav",                       "Female", "Despatch - IB",          "Staff",              "Full-time", IB_JOIN,  "3124697392", "",              "Bank"),
    ("Ruhina Wasim Basha",                 "Female", "Despatch - IB",          "Staff",              "Full-time", IB_JOIN,  "3124697349", "",              "Bank"),
    ("Bhagat Pandharinath Mukund",         "Male",   "Sales",                  "Sales Representative","Full-time", IB_JOIN,  "",           "",              "Bank"),
    ("Rakashan Shankar Shetty",            "Male",   "Sales",                  "Sales Representative","Full-time", IB_JOIN,  "",           "",              "Bank"),
    ("Sanjay Ankush Bhagat",               "Male",   "Despatch - IB",          "Despatch",           "Full-time", IB_JOIN,  "3124719831", "102177711192",  "Bank"),
    ("Shaikh Sakina Banu Mohd Iklakh Husen","Female","Sales",                  "Executive",          "Full-time", IB_JOIN,  "3518352508", "102000139976",  "Bank"),
    ("Aqsa Fatima Wahid Ali Shaikh",       "Female", "Sales",                  "Executive",          "Full-time", IB_JOIN,  "",           "",              "Bank"),
    ("Rukmani S Bajantri",                 "Female", "Despatch - IB",          "Staff",              "Full-time", IB_JOIN,  "3124763853", "",              "Bank"),
    ("Fakrunnisha Ayub Ali Sayyed",        "Female", "Despatch - IB",          "Staff",              "Full-time", IB_JOIN,  "3124763976", "",              "Bank"),
    ("Aaliya Yunus Ali Shaikh",            "Male",   "Sales",                  "Executive",          "Full-time", IB_JOIN,  "3124286182", "",              "Bank"),
    ("Samay Pradeep",                      "Male",   "Sales",                  "Executive",          "Full-time", IB_JOIN,  "",           "",              "Bank"),
    ("Doliya Pooja Ugmaram",               "Female", "Despatch - IB",          "Staff",              "Full-time", IB_JOIN,  "",           "",              "Bank"),
    ("Rutuja Deepak Jadhav",               "Female", "Sales",                  "Executive",          "Full-time", IB_JOIN,  "",           "",              "Bank"),
]

# These are confirmed duplicates — sheet name differs from system name.
# Skipped from auto-import; ESIC/UAN patched onto existing records below.
#
#   Sheet Name                      → System Employee
#   Juneyt Ajazali Sayyed           → HR-EMP-00006 Junaid Sayed       (confirmed same)
#   Nidhi Suresh Kumar Sainee       → HR-EMP-00008 Nidhi Saini        (confirmed same)
#   Khan Mantsha Maksood            → HR-EMP-00007 Mantasha Khan      (confirmed same)
#   Pooja Santosh Menon             → HR-EMP-00018 Puja Menon         (confirmed same)
#   Prajkta Dilip Chougule          → HR-EMP-00009 Prajakta Chougale  (confirmed same)
#   Farrukh Saeed                   → HR-EMP-00005 Farukh             (confirmed same)
#   Amirun Nisha                    → HR-EMP-00022 Nisha              (confirmed same)
#   Tuba Abbas Ansari               → DO NOT CREATE (left)

# ESIC/UAN data from March 2026 salary sheet for existing employees
EXISTING_EMPLOYEE_UPDATES = [
    # (employee_id, esic_no, uan_no)
    ("HR-EMP-00006", "3124715999",  "101368355647"),  # Junaid Sayed
    ("HR-EMP-00008", "3124697471",  "102177711185"),  # Nidhi Saini
    ("HR-EMP-00007", "3124726081",  ""),              # Mantasha Khan
    ("HR-EMP-00018", "3124719815",  "101666204637"),  # Puja Menon
    ("HR-EMP-00009", "3124742076",  ""),              # Prajakta Chougale
    ("HR-EMP-00005", "",            ""),              # Farukh (no ESIC/UAN in sheet)
]

ASTRO_EMPLOYEES = [
    # ── Management ────────────────────────────────────────────────
    ("Prajesh",                         "Male",   "Factory Management",    "Manager",            "Full-time",  AST_JOIN, "",           "",              "Bank"),
    ("Dinesh Dasharth Kambere",         "Male",   "Factory Management",    "Manager",            "Full-time",  AST_JOIN, "",           "",              "Bank"),
    ("Manoj",                           "Male",   "Factory Management",    "Manager",            "Full-time",  AST_JOIN, "",           "",              "Bank"),
    ("Jayprakash Maurya",               "Male",   "Factory Management",    "Manager",            "Full-time",  AST_JOIN, "",           "",              "Bank"),

    # ── Monthly Staff ─────────────────────────────────────────────
    ("Mansi Narendra Dhodi",            "Female", "Factory Administration","Executive",          "Full-time",  AST_JOIN, "3911966879", "102132576312",  "Bank"),
    ("Swapnil Kumar Harishbhai Baria",  "Male",   "Factory Administration","Executive",          "Full-time",  AST_JOIN, "3911966919", "102132576320",  "Bank"),
    ("Patel Urvashiben Sureshbhai",     "Female", "Factory Administration","Executive",          "Full-time",  AST_JOIN, "3912243339", "101428082955",  "Bank"),
    ("Anjali Ajit Varghese",            "Female", "Factory Administration","Executive",          "Full-time",  AST_JOIN, "3912243366", "102248177203",  "Bank"),
    ("Baria Dhruvkumar Pradipbhai",     "Male",   "Factory Administration","Executive",          "Full-time",  AST_JOIN, "3912243402", "101560077260",  "Bank"),

    # ── Daily Workers — Male ──────────────────────────────────────
    ("Malavkar Arjunbhai",              "Male",   "Factory Production",    "Factory Worker",     "Daily Wage", AST_JOIN, "3911966897", "101592485904",  "Bank"),
    ("Varli Hasmukhbhai",               "Male",   "Factory Production",    "Factory Worker",     "Daily Wage", AST_JOIN, "3911966988", "",              "Bank"),
    ("Halpati Jayeshbhai",              "Male",   "Factory Production",    "Factory Worker",     "Daily Wage", AST_JOIN, "3911967010", "",              "Bank"),
    ("Kadu Dhaneshbhai Rameshbhai",     "Male",   "Factory Production",    "Factory Worker",     "Daily Wage", AST_JOIN, "3911967094", "",              "Bank"),
    ("Halpati Pratikkumar",             "Male",   "Factory Production",    "Factory Worker",     "Daily Wage", AST_JOIN, "3912243211", "",              "Bank"),
    ("Varli Dipinbhai",                 "Male",   "Factory Production",    "Factory Worker",     "Daily Wage", AST_JOIN, "3912027125", "",              "Bank"),
    ("Dombhariya Kalpeshbhai",          "Male",   "Factory Production",    "Factory Worker",     "Daily Wage", AST_JOIN, "3912027154", "",              "Bank"),
    ("Halpati Anandbhai",               "Male",   "Factory Production",    "Factory Worker",     "Daily Wage", AST_JOIN, "3911968836", "",              "Bank"),
    ("Suthediya Rahulbhai",             "Male",   "Factory Production",    "Factory Worker",     "Daily Wage", AST_JOIN, "3911968818", "",              "Bank"),
    ("Varli Himmatkumar Govindbhai",    "Male",   "Factory Production",    "Factory Worker",     "Daily Wage", AST_JOIN, "3912243224", "",              "Bank"),
    ("Halpati Vishalbhai",              "Male",   "Factory Production",    "Factory Worker",     "Daily Wage", AST_JOIN, "3912243238", "",              "Bank"),
    ("Varli Nitinbhai",                 "Male",   "Factory Production",    "Factory Worker",     "Daily Wage", AST_JOIN, "3912243322", "",              "Bank"),
    ("Kadu Dipeshbhai",                 "Male",   "Factory Production",    "Factory Worker",     "Daily Wage", AST_JOIN, "3911967107", "",              "Bank"),

    # ── Daily Workers — Female (PF + ESIC) ───────────────────────
    ("Sangitaben Ramjibhai Varli",      "Female", "Factory Production",    "Factory Worker",     "Daily Wage", AST_JOIN, "3911968885", "102247074279",  "Bank"),
    ("Vanitaben Parsottambhai Varli",   "Female", "Factory Production",    "Factory Worker",     "Daily Wage", AST_JOIN, "3911968903", "100400061101",  "Bank"),
    ("Lataben Rajeshbhai Vadvi",        "Female", "Factory Production",    "Factory Worker",     "Daily Wage", AST_JOIN, "3911968981", "100045628406",  "Bank"),
    ("Varli Sarshvatiben Hasmukbhai",   "Female", "Factory Production",    "Factory Worker",     "Daily Wage", AST_JOIN, "3911969750", "102246982287",  "Bank"),
    ("Kadu Jaymatiben Dhaneshbhai",     "Female", "Factory Production",    "Factory Worker",     "Daily Wage", AST_JOIN, "3911969707", "100175010851",  "Bank"),
    ("Halpati Gudiben Sureshbhai",      "Female", "Factory Production",    "Factory Worker",     "Daily Wage", AST_JOIN, "3911969732", "101734694433",  "Bank"),
    ("Bhura Amitaben Sureshbhai",       "Female", "Factory Production",    "Factory Worker",     "Daily Wage", AST_JOIN, "3911969689", "102246363718",  "Bank"),
]


def run():
    # 1. Create departments
    print("\n── Departments ──────────────────────────────")
    for dept_name in DEPARTMENTS:
        if not frappe.db.exists("Department", {"department_name": dept_name, "company": COMPANY}):
            doc = frappe.get_doc({
                "doctype": "Department",
                "department_name": dept_name,
                "company": COMPANY,
                "is_group": 0,
            })
            doc.insert(ignore_permissions=True)
            print(f"  ✓ Created dept: {dept_name}")
        else:
            print(f"  · Exists dept: {dept_name}")

    # 2. Create designations
    print("\n── Designations ─────────────────────────────")
    for desig in DESIGNATIONS:
        if not frappe.db.exists("Designation", desig):
            frappe.get_doc({"doctype": "Designation", "designation_name": desig}).insert(ignore_permissions=True)
            print(f"  ✓ Created: {desig}")
        else:
            print(f"  · Exists: {desig}")

    # 3. Create employment types
    print("\n── Employment Types ─────────────────────────")
    for et in EMPLOYMENT_TYPES:
        if not frappe.db.exists("Employment Type", et):
            frappe.get_doc({"doctype": "Employment Type", "employee_type_name": et}).insert(ignore_permissions=True)
            print(f"  ✓ Created: {et}")
        else:
            print(f"  · Exists: {et}")

    frappe.db.commit()

    # 4. Create employees
    print("\n── Instabiz Employees ───────────────────────")
    _create_batch(INSTABIZ_EMPLOYEES)

    print("\n── Astro Employees ──────────────────────────")
    _create_batch(ASTRO_EMPLOYEES)

    frappe.db.commit()

    # 5. Patch ESIC/UAN onto existing employees (confirmed duplicates)
    print("\n── Patching existing employees (ESIC/UAN) ───")
    for emp_id, esic_no, uan in EXISTING_EMPLOYEE_UPDATES:
        try:
            doc = frappe.get_doc("Employee", emp_id)
            changed = False
            if esic_no and not doc.health_insurance_no:
                doc.health_insurance_no = esic_no
                changed = True
            if uan and not doc.provident_fund_account:
                doc.provident_fund_account = uan
                changed = True
            if changed:
                doc.save(ignore_permissions=True)
                print(f"  ✓ Updated {emp_id} ({doc.employee_name}): ESIC={esic_no or '—'}  UAN={uan or '—'}")
            else:
                print(f"  · No change needed for {emp_id} ({doc.employee_name})")
        except Exception as e:
            print(f"  ✗ ERROR {emp_id}: {e}")

    frappe.db.commit()
    print("\nDone.")


def _create_batch(employees):
    for (emp_name, gender, dept, desig, emp_type,
         doj, esic_no, uan, salary_mode) in employees:

        if frappe.db.exists("Employee", {"employee_name": emp_name}):
            print(f"  · Exists: {emp_name}")
            continue

        try:
            parts = emp_name.split()
            first = parts[0]
            middle = " ".join(parts[1:-1]) if len(parts) > 2 else None
            last = parts[-1] if len(parts) > 1 else None

            doc = frappe.get_doc({
                "doctype": "Employee",
                "employee_name": emp_name,
                "first_name": first,
                "middle_name": middle,
                "last_name": last,
                "company": COMPANY,
                "gender": gender,
                "department": dept,
                "designation": desig,
                "employment_type": emp_type,
                "date_of_joining": doj,
                "date_of_birth": "1990-01-01",  # placeholder — update manually
                "status": "Active",
                "salary_mode": salary_mode,
                "health_insurance_no": esic_no or None,
                "provident_fund_account": uan or None,
            })
            doc.insert(ignore_permissions=True)
            print(f"  ✓ Created: {emp_name}")
        except Exception as e:
            print(f"  ✗ ERROR {emp_name}: {e}")
