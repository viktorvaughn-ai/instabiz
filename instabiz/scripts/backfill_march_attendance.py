"""
Backfill March 2026 attendance from salary sheets and create payroll entry.
Run via: bench --site frontend execute instabiz.scripts.backfill_march_attendance.run
"""

import frappe
from datetime import date, timedelta

COMPANY  = "Instabiz Solutions India Pvt Ltd"
MONTH_START = date(2026, 3, 1)
MONTH_END   = date(2026, 3, 31)
TOTAL_DAYS  = 31

# Sheet name → DB employee_name (aliases/case fixes)
NAME_MAP = {
    "Juneyt Ajazali Sayyed":            "Junaid Sayed",
    "Amirun Nisha":                     "Nisha",
    "Nidhi Suresh Kumar Sainee":        "Nidhi Saini",
    "Khan Mantsha Maksood":             "Mantasha Khan",
    "Pooja Santosh Menon":              "Puja Menon",
    "RAKASHAN SHANKAR SHETTY":          "Rakashan Shankar Shetty",
    "Prajkta Dilip Chougule":           "Prajakta Chougale",
    "MD JASSIM":                        "Md Jassim",
    "Farrukh Saeed":                    "Farukh",
    "Mohammed Nazim Ansari":            "Nazim Ansari",
    "Adbul Hamid Ansari":               "Abdul Hamid Ansari",
    "Mohammed Zaid Yaqoob Khan":        "Zaid Khan",
    "Dimple Suraj Pol":                 "Dimple Pol",
    "Sarvjeet":                         "Sarvjeet Kori",
    "Maya Subhash Nirban":              "Maya Nirban",
    "Vidhi Suryakant Bavkar":           "Vidhi Bavkar",
    "Tuba Abbas Ansari   chq":          None,  # left — skip
    "PATEL URVASHIBEN SURESHBHAI":      "Patel Urvashiben Sureshbhai",
}

# (db_employee_name, present_days)  — 0.5 = one half-day included
ATTENDANCE_DATA = [
    # ── Instabiz ─────────────────────────────────────────────────────────────
    ("Mustafa Saleh Bookwala",               31.0),
    ("Nazim Ansari",                         31.0),
    ("Percy Umapathy",                       31.0),
    ("Ruhina Wasim Basha",                   22.0),
    ("Junaid Sayed",                         30.5),
    ("Nisha",                                25.0),
    ("Rupa H Yadav",                          0.0),
    ("Maya Nirban",                          31.0),
    ("Vidhi Bavkar",                         30.0),
    ("Abdul Hamid Ansari",                   31.0),
    ("Anas Khan",                            18.0),
    ("Nidhi Saini",                          27.0),
    ("Mantasha Khan",                        26.0),
    ("Puja Menon",                           29.0),
    ("Bhagat Pandharinath Mukund",           31.0),
    ("Rakashan Shankar Shetty",              31.0),
    ("Sanjay Ankush Bhagat",                 31.0),
    ("Prajakta Chougale",                    28.0),
    ("Shaikh Sakina Banu Mohd Iklakh Husen",  0.0),
    ("Md Jassim",                            31.0),
    ("Aqsa Fatima Wahid Ali Shaikh",          0.0),
    ("Rukmani S Bajantri",                   31.0),
    ("Fakrunnisha Ayub Ali Sayyed",          26.0),
    ("Farukh",                               21.0),
    ("Dimple Pol",                           26.0),
    ("Zaid Khan",                            26.0),
    ("Sarvjeet Kori",                        30.5),
    ("Aaliya Yunus Ali Shaikh",               0.0),
    ("Samay Pradeep",                        28.0),
    ("Doliya Pooja Ugmaram",                  8.0),
    ("Rutuja Deepak Jadhav",                 11.0),
    # ── Astro ─────────────────────────────────────────────────────────────────
    ("Prajesh",                              31.0),
    ("Dinesh Dasharth Kambere",               0.0),
    ("Manoj",                                27.0),
    ("Jayprakash Maurya",                    30.0),
    ("Mansi Narendra Dhodi",                 31.0),
    ("Swapnil Kumar Harishbhai Baria",       31.0),
    ("Malavkar Arjunbhai",                   28.5),
    ("Varli Hasmukhbhai",                    28.5),
    ("Halpati Jayeshbhai",                   29.5),
    ("Kadu Dhaneshbhai Rameshbhai",          31.0),
    ("Halpati Pratikkumar",                  27.5),
    ("Varli Dipinbhai",                      25.0),
    ("Dombhariya Kalpeshbhai",               28.5),
    ("Halpati Anandbhai",                    16.5),
    ("Suthediya Rahulbhai",                  27.5),
    ("Varli Himmatkumar Govindbhai",         26.0),
    ("Halpati Vishalbhai",                   31.0),
    ("Varli Nitinbhai",                      31.0),
    ("Kadu Dipeshbhai",                      26.0),
    ("Sangitaben Ramjibhai Varli",           31.0),
    ("Vanitaben Parsottambhai Varli",        30.0),
    ("Lataben Rajeshbhai Vadvi",             26.5),
    ("Varli Sarshvatiben Hasmukbhai",        31.0),
    ("Kadu Jaymatiben Dhaneshbhai",          30.0),
    ("Halpati Gudiben Sureshbhai",           28.5),
    ("Bhura Amitaben Sureshbhai",            29.0),
    ("Patel Urvashiben Sureshbhai",           0.0),
    ("Anjali Ajit Varghese",                 31.0),
    ("Baria Dhruvkumar Pradipbhai",          27.0),
]


def run():
    _fix_join_dates()
    frappe.db.commit()

    _backfill_attendance()
    frappe.db.commit()

    _create_payroll_entry()
    frappe.db.commit()

    print("\nDone.")


def _fix_join_dates():
    """Ensure all employees in the March sheet have join date <= 2026-03-01."""
    print("\n── Fixing join dates ────────────────────────")
    fixed = 0
    for emp_name, _ in ATTENDANCE_DATA:
        emp = frappe.db.get_value("Employee",
            {"employee_name": emp_name, "company": COMPANY},
            ["name", "date_of_joining"], as_dict=True)
        if not emp:
            continue
        if emp.date_of_joining and emp.date_of_joining > MONTH_START:
            frappe.db.set_value("Employee", emp.name, "date_of_joining", "2025-01-01")
            fixed += 1
    print(f"  ✓ Fixed {fixed} employees with join dates after March 2026")


def _backfill_attendance():
    print("\n── Backfilling March 2026 attendance ────────")
    created = skipped = errors = 0

    for emp_name, present_days in ATTENDANCE_DATA:
        emp_id = frappe.db.get_value("Employee",
            {"employee_name": emp_name, "company": COMPANY}, "name")
        if not emp_id:
            print(f"  ✗ Not found: {emp_name}")
            errors += 1
            continue

        # Build day-by-day status list for March
        full_present = int(present_days)          # whole present days
        has_half_day = (present_days % 1) == 0.5  # .5 means one half-day
        absent_days  = TOTAL_DAYS - full_present - (1 if has_half_day else 0)

        # Order: Present first, then Half Day (if any), then Absent
        statuses = (
            ["Present"] * full_present
            + (["Half Day"] if has_half_day else [])
            + ["Absent"] * absent_days
        )

        # Delete any existing unsubmitted attendance for this employee in March
        frappe.db.delete("Attendance", {
            "employee": emp_id,
            "attendance_date": ["between", ["2026-03-01", "2026-03-31"]],
            "docstatus": ["!=", 1],
        })

        emp_created = 0
        for i, status in enumerate(statuses):
            att_date = MONTH_START + timedelta(days=i)

            # Skip if already submitted
            if frappe.db.exists("Attendance", {
                "employee": emp_id,
                "attendance_date": att_date,
                "docstatus": 1,
            }):
                continue

            try:
                doc = frappe.get_doc({
                    "doctype": "Attendance",
                    "employee": emp_id,
                    "attendance_date": att_date,
                    "status": status,
                    "company": COMPANY,
                })
                doc.insert(ignore_permissions=True)
                doc.submit()
                emp_created += 1
            except Exception as e:
                print(f"  ✗ {emp_name} {att_date}: {e}")
                errors += 1

        created += emp_created
        skipped_days = TOTAL_DAYS - emp_created
        print(f"  ✓ {emp_name:<45} P={full_present}{'½' if has_half_day else ' '} A={absent_days}  ({emp_created} records)")

    print(f"\n  Total: {created} records created, {errors} errors")


def _create_payroll_entry():
    print("\n── Creating March 2026 Payroll Entry ────────")

    if frappe.db.exists("Payroll Entry", {"start_date": "2026-03-01", "end_date": "2026-03-31"}):
        print("  · Payroll Entry for March 2026 already exists — skipping")
        return

    try:
        pe = frappe.get_doc({
            "doctype": "Payroll Entry",
            "company": COMPANY,
            "start_date": "2026-03-01",
            "end_date": "2026-03-31",
            "payroll_frequency": "Monthly",
            "currency": "INR",
            "exchange_rate": 1,
            "payment_account": frappe.db.get_value("Company", COMPANY, "default_bank_account"),
            "payroll_payable_account": frappe.db.get_value("Company", COMPANY, "default_payroll_payable_account"),
        })
        pe.insert(ignore_permissions=True)
        print(f"  ✓ Created Payroll Entry: {pe.name}")
        print(f"  → Now open it in UI, click 'Get Employees' then 'Create Salary Slips' to verify")
    except Exception as e:
        print(f"  ✗ ERROR: {e}")
