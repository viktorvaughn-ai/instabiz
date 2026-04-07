"""
One-time script: seed initial employees for attendance use.
Run with:
    bench --site frontend execute instabiz.scripts.create_employees.run
"""
import frappe


EMPLOYEES = [
    # (full_name, designation, department, email, email_type: "company"|"personal"|None)
    ("Mustafa Bookwala", "HR Manager",           "HR",                "hr@instabizsolutions.com",          "company"),
    ("Vidhi Baukar",     "Accountant",            "Accounts",          "accounts@instabizsolutions.com",    "company"),
    ("Mohd Jassim",      "Accountant",            "Accounts",          "jassimabbas31@gmail.com",           "personal"),
    ("Puja Menon",       "Dispatch",              "Dispatch",          "despatch@instabizsolutions.com",    "company"),
    ("Dimple Pol",       "Director's Assistant",  "Administration",    "dimplevadhvana1@gmail.com",         "personal"),
    ("Maya Nirbas",      "Purchase",              "Purchase",          "purchase@instabizsolutions.com",    "company"),
    ("Aishwarya More",   "Digital Marketing",     "Digital Marketing", "development@instabizsolutions.com", "company"),
    ("Nisha",            "Clerk",                 None,                None,                               None),
    ("Percy Umapathy",   "Payment",               "Accounts",          "percyumapathy893@gmail.com",        "personal"),
]


def list_hr_roles():
    roles = frappe.db.get_all("Role", filters=[["role_name", "like", "%ttend%"]], pluck="name")
    print("Attendance roles:", roles)
    roles2 = frappe.db.get_all("Role", filters=[["role_name", "like", "%HR%"]], pluck="name")
    print("HR roles:", roles2)


def rename_percy_user():
    old = "despatch@instabizsolutions.com"
    new = "percyumapathy893@gmail.com"
    if not frappe.db.exists("User", old):
        print(f"User {old} not found.")
        return
    frappe.rename_doc("User", old, new, force=True)
    frappe.db.commit()
    print(f"User renamed: {old} → {new}")


def link_percy():
    emp = frappe.db.get_value("Employee", {"employee_name": "Percy Umapathy"}, "name")
    if not emp:
        print("Employee Percy Umapathy not found.")
        return
    frappe.db.set_value("Employee", emp, "user_id", "percyumapathy893@gmail.com")
    frappe.db.commit()
    print(f"Linked {emp} → percyumapathy893@gmail.com")


def fix_attendance_terminal_page():
    page = frappe.get_doc("Page", "attendance-terminal")
    existing_roles = [r.role for r in page.roles]
    if "HR Attendance Terminal User" not in existing_roles:
        page.append("roles", {"role": "HR Attendance Terminal User"})
        page.save(ignore_permissions=True)
        frappe.db.commit()
        print("Added 'HR Attendance Terminal User' to attendance-terminal page.")
    else:
        print("Role already present.")


def set_percy_role():
    user = frappe.get_doc("User", "percyumapathy893@gmail.com")
    user.add_roles("HR Attendance Terminal User")
    frappe.db.commit()
    print("Role 'HR Attendance Terminal User' assigned to Percy.")


def run():
    company = (
        frappe.db.get_single_value("Global Defaults", "default_company")
        or frappe.db.get_value("Company", {}, "name")
    )
    if not company:
        frappe.throw("No company found — set a default company first.")

    print(f"Using company: {company}")

    # ── ensure designations exist ─────────────────────────────────────────────
    designations = {desig for (_, desig, _, _, _) in EMPLOYEES if desig}
    for desig_name in sorted(designations):
        if not frappe.db.exists("Designation", desig_name):
            frappe.get_doc({
                "doctype": "Designation",
                "designation_name": desig_name,
            }).insert(ignore_permissions=True)
            print(f"  [desig created] {desig_name}")
        else:
            print(f"  [desig exists]  {desig_name}")

    frappe.db.commit()

    # ── ensure departments exist ──────────────────────────────────────────────
    departments = {dept for (_, _, dept, _, _) in EMPLOYEES if dept}
    for dept_name in sorted(departments):
        existing = frappe.db.get_value(
            "Department", {"department_name": dept_name, "company": company}
        )
        if not existing:
            frappe.get_doc({
                "doctype":         "Department",
                "department_name": dept_name,
                "company":         company,
            }).insert(ignore_permissions=True)
            print(f"  [dept created] {dept_name}")
        else:
            print(f"  [dept exists]  {dept_name}")

    frappe.db.commit()

    # ── create employees ──────────────────────────────────────────────────────
    for full_name, designation, dept_name, email, email_type in EMPLOYEES:
        if frappe.db.exists("Employee", {"employee_name": full_name, "company": company}):
            print(f"  [skip exists]  {full_name}")
            continue

        parts     = full_name.split(" ", 1)
        first     = parts[0]
        last      = parts[1] if len(parts) > 1 else ""

        dept_link = None
        if dept_name:
            dept_link = frappe.db.get_value(
                "Department", {"department_name": dept_name, "company": company}
            )

        doc = frappe.get_doc({
            "doctype":         "Employee",
            "first_name":      first,
            "last_name":       last,
            "employee_name":   full_name,
            "designation":     designation,
            "department":      dept_link,
            "company":         company,
            "status":          "Active",
            "date_of_joining": frappe.utils.today(),
        })

        if email and email_type == "company":
            doc.company_email = email
        elif email and email_type == "personal":
            doc.personal_email = email

        doc.flags.ignore_mandatory = True
        doc.insert(ignore_permissions=True)
        print(f"  [created]      {full_name} — {designation}")

    frappe.db.commit()
    print("\nDone.")
