"""
ERPNext v15 — Named Sales User Creation Script
===============================================
Users     : 11 specific staff members
Role      : Sales User
Password  : Instabiz@1234 (same for all)
Email fmt : firstname.lastname@instabiz.local

Usage (bench console):
    bench --site <site> console
    exec(open("create_named_sales_users.py").read())

Credentials dump:
    ~/frappe-bench/sites/named_sales_users_credentials.txt
"""

import os
import frappe
from frappe.utils import now_datetime
from frappe.utils.password import update_password

# ── User list ─────────────────────────────────────────────────────────────────

USERS = [
    {"first_name": "Ruhi",        "last_name": "Shaikh"},
    {"first_name": "Junaid",      "last_name": "Sayed"},
    {"first_name": "Amira",       "last_name": "Shaikh"},
    {"first_name": "Anas",        "last_name": "Khan"},
    {"first_name": "Nidhi",       "last_name": "Saini"},
    {"first_name": "Mantasha",    "last_name": "Khan"},
    {"first_name": "Tuba",        "last_name": "Ansari"},
    {"first_name": "Abdul Hamid", "last_name": "Ansari"},
    {"first_name": "Prajakta",    "last_name": "Chougale"},
    {"first_name": "Sarvjeet",    "last_name": "Kori"},
    {"first_name": "Zaid",        "last_name": "Khan"},
]

DOMAIN   = "instabizsolutions.com"
PASSWORD = "Instabiz@1234"
ROLES    = ["Sales User"]

SEND_WELCOME_EMAIL = False

CREDS_FILE = os.path.join(
    frappe.utils.get_bench_path(), "sites", "named_sales_users_credentials.txt"
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def make_email(first: str, last: str) -> str:
    # "Abdul Hamid" → "abdulhamid.ansari@instabiz.local"
    first_slug = first.lower().replace(" ", "")
    last_slug  = last.lower().replace(" ", "")
    return f"{first_slug}.{last_slug}@{DOMAIN}"

def make_username(first: str, last: str) -> str:
    return f"{first.lower().replace(' ', '')}.{last.lower().replace(' ', '')}"

def assign_roles(user_doc, roles):
    existing = {r.role for r in user_doc.roles}
    for role in roles:
        if role not in existing:
            user_doc.append("roles", {"role": role})

def write_credentials(records, filepath):
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    new_file = not os.path.exists(filepath)
    with open(filepath, "a") as fh:
        if new_file:
            fh.write("ERPNext — Named Sales User Credentials\n")
            fh.write("=" * 55 + "\n\n")
            fh.write(f"{'Full Name':<22} {'Email':<38} {'Username':<24} {'Password'}\n")
            fh.write(f"{'-'*20} {'-'*36} {'-'*22} {'-'*14}\n")
        fh.write(f"\n# Run: {now_datetime()}\n")
        for row in records:
            fh.write(f"{row['name']:<22} {row['email']:<38} {row['username']:<24} {row['password']}\n")


# ── Main ──────────────────────────────────────────────────────────────────────

def run():
    created, skipped, errors = [], [], []

    for u in USERS:
        first = u["first_name"]
        last  = u["last_name"]
        full  = f"{first} {last}"
        email = make_email(first, last)
        uname = make_username(first, last)

        try:
            if frappe.db.exists("User", email):
                doc = frappe.get_doc("User", email)
                assign_roles(doc, ROLES)
                doc.save(ignore_permissions=True)
                skipped.append(full)
                continue

            doc = frappe.get_doc({
                "doctype":            "User",
                "email":              email,
                "first_name":         first,
                "last_name":          last,
                "username":           uname,
                "enabled":            1,
                "user_type":          "System User",
                "send_welcome_email": SEND_WELCOME_EMAIL,
                "roles":              [],
            })

            assign_roles(doc, ROLES)
            doc.insert(ignore_permissions=True)
            update_password(email, PASSWORD)

            created.append({
                "name":     full,
                "email":    email,
                "username": uname,
                "password": PASSWORD,
            })

        except Exception as exc:
            errors.append({"name": full, "error": str(exc)})
            frappe.log_error(frappe.get_traceback(), f"User Creation Failed: {full}")

    frappe.db.commit()

    if created:
        write_credentials(created, CREDS_FILE)

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n" + "═" * 70)
    print(f"  Instabiz Sales User Creation — {now_datetime()}")
    print("═" * 70)

    print(f"\n✅  Created ({len(created)}):")
    print(f"    {'Full Name':<22} {'Email':<38} {'Password'}")
    print(f"    {'-'*20} {'-'*36} {'-'*14}")
    for r in created:
        print(f"    {r['name']:<22} {r['email']:<38} {r['password']}")

    if skipped:
        print(f"\n⏭   Skipped / already existed ({len(skipped)}):")
        for s in skipped:
            print(f"    {s}  (roles reconciled)")

    if errors:
        print(f"\n❌  Errors ({len(errors)}):")
        for e in errors:
            print(f"    {e['name']} → {e['error']}")

    if created:
        print(f"\n📄  Credentials saved to:")
        print(f"    {CREDS_FILE}")

    print("\n" + "═" * 70)
    print("  Done. Commit applied.")
    print("═" * 70 + "\n")


run()