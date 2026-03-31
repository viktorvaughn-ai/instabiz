"""instabiz.overrides.user"""
import frappe

# Keys that are session/internal state — never copy these
_SKIP_PREFIXES = ("_",)
_SKIP_KEYS = frozenset({"redirect_to", "last_known_versions", "system_generated_desktop_icons"})

SYSTEM_USERS = frozenset({"Administrator", "Guest"})


def create_sales_person_for_user(doc, method=None):
    """
    Create a Sales Person master record when a new Sales User is created.
    Skips system users, users without a first name, and duplicates.
    """
    if doc.name in SYSTEM_USERS:
        return

    # Only users that carry the Sales User role
    role_names = {r.role for r in doc.get("roles") or []}
    if "Sales User" not in role_names:
        return

    first_name = (doc.first_name or "").strip()
    if not first_name:
        return

    # Avoid duplicate Sales Person records
    existing = frappe.db.get_value("Sales Person", {"sales_person_name": first_name}, "name")
    if existing:
        return

    sp = frappe.new_doc("Sales Person")
    sp.sales_person_name = first_name
    sp.enabled = 1
    sp.insert(ignore_permissions=True)


def copy_admin_defaults(doc, method=None):
    """
    Copy every DefaultValue record from Administrator to the newly created user.
    Skips internal/session keys (prefixed with '_' or in the skip list).
    """
    if doc.name in SYSTEM_USERS:
        return

    admin_defaults = frappe.db.get_all(
        "DefaultValue",
        filters={"parent": "Administrator"},
        fields=["defkey", "defvalue"],
    )

    for d in admin_defaults:
        key = (d.defkey or "").strip()
        if not key:
            continue
        if any(key.startswith(p) for p in _SKIP_PREFIXES):
            continue
        if key in _SKIP_KEYS:
            continue
        frappe.defaults.set_user_default(key, d.defvalue, user=doc.name)


def copy_admin_ui_settings(doc, method=None):
    """
    Copy list view / column / sort settings from Administrator's __UserSettings
    to the newly created user. Skips rows with empty data ({}).
    """
    if doc.name in SYSTEM_USERS:
        return

    rows = frappe.db.sql(
        "SELECT doctype, data FROM `__UserSettings` WHERE user = 'Administrator' AND data != '{}'",
        as_dict=True,
    )

    for row in rows:
        # INSERT ... ON DUPLICATE KEY UPDATE so re-running never creates duplicates
        frappe.db.sql(
            """
            INSERT INTO `__UserSettings` (user, doctype, data)
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE data = VALUES(data)
            """,
            (doc.name, row.doctype, row.data),
        )
