"""instabiz.overrides.create_employees

One-time script to create HRMS Employee records from ERPNext Users.

Usage:
    bench --site frontend execute instabiz.overrides.create_employees.run \
        --kwargs '{"dry_run": false}'
"""
import frappe

COMPANY        = "Instabiz Solutions India Pvt Ltd"
ROLE_DESIGNATION = {
    "Sales Manager": "Sales Manager",
    "Sales User":    "Sales Representative",
}
# Per-user overrides — email: designation
USER_OVERRIDE = {
    "idris@instabizsolutions.com": "Managing Director",
}


def run(dry_run=True):
    users = frappe.db.sql("""
        SELECT u.name, u.first_name, u.last_name, u.email
        FROM `tabUser` u
        JOIN `tabHas Role` ur ON ur.parent = u.name
        WHERE u.enabled = 1
          AND u.name NOT IN ('Administrator', 'Guest')
          AND ur.role IN ('Sales User', 'Sales Manager')
        GROUP BY u.name
    """, as_dict=True)

    print("\n%s — %d user(s) found\n" % ("[DRY RUN]" if dry_run else "[LIVE]", len(users)))

    created = skipped = failed = 0

    for u in users:
        full_name = ("%s %s" % (u.first_name, u.last_name or "")).strip()

        # Designation
        if u.name in USER_OVERRIDE:
            designation = USER_OVERRIDE[u.name]
        else:
            roles = frappe.db.get_all(
                "Has Role",
                filters={"parent": u.name, "role": ["in", ["Sales Manager", "Sales User"]]},
                pluck="role",
            )
            top_role = "Sales Manager" if "Sales Manager" in roles else "Sales User"
            designation = ROLE_DESIGNATION[top_role]

        # Skip if Employee already linked to this user
        existing = frappe.db.get_value("Employee", {"user_id": u.name}, "name")
        if existing:
            print("  [SKIP]   %s -> %s (Employee: %s)" % (full_name, designation, existing))
            skipped += 1
            continue

        if dry_run:
            print("  [DRY]    %s -> %s" % (full_name, designation))
            created += 1
            continue

        try:
            emp = frappe.new_doc("Employee")
            emp.first_name      = u.first_name
            emp.last_name       = u.last_name or ""
            emp.employee_name   = full_name
            emp.company         = COMPANY
            emp.company_email   = u.email
            emp.user_id         = u.name
            emp.designation     = designation
            emp.status                  = "Active"
            emp.date_of_joining         = frappe.utils.today()
            emp.gender                  = "Male"
            emp.date_of_birth           = "1990-01-01"
            emp.create_user_permission  = 0
            emp.insert(ignore_permissions=True, ignore_if_duplicate=False)
            frappe.db.commit()
            print("  [OK]     %s -> %s (Employee: %s)" % (full_name, designation, emp.name))
            created += 1
        except Exception:
            frappe.db.rollback()
            print("  [FAIL]   %s -> see Error Log" % full_name)
            frappe.log_error(
                title="create_employees: failed for %s" % u.name,
                message=frappe.get_traceback(),
            )
            failed += 1

    print("\nDone. created=%d  skipped=%d  failed=%d\n" % (created, skipped, failed))
