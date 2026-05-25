"""
instabiz.overrides.permissions

Shared row-level permission helpers for sales documents.

Privileged roles (System Manager, Sales Manager) see all documents.
All other users see only documents they own (owner) or are assigned to
(custom_sales_person_user).
"""

import frappe

_PRIVILEGED_ROLES = {"System Manager", "Sales Manager"}


def _is_privileged(user):
    # Primary check: does the user have any of the privileged roles directly?
    if _PRIVILEGED_ROLES & set(frappe.get_roles(user)):
        return True
    # Fallback: check the role profile name — covers cases where the Role
    # Profile "Sales Manager" was not configured to propagate the "Sales Manager"
    # role to the user's Has Role table
    profile = frappe.db.get_value("User", user, "role_profile_name") or ""
    return profile in _PRIVILEGED_ROLES


def _sales_doc_query_conditions(doctype, user):
    """Return a SQL WHERE fragment limiting list results to the current user.

    Privileged users receive "1=1" (match everything) rather than "" (empty).
    Returning "" is falsy — Frappe treats it as "no custom condition" and falls
    back to its own DocType if_owner logic, which may restrict custom roles.
    Returning "1=1" is truthy — Frappe uses it as the sole condition and skips
    the fallback, so privileged users genuinely see all documents.
    """
    if not user:
        user = frappe.session.user
    if _is_privileged(user):
        return "1=1"
    u = frappe.db.escape(user)
    # If custom_sales_person_user is set use it exclusively (respects reassignment).
    # Fall back to owner when the field is NULL or empty string (pre-deployment docs).
    return (
        f"(`tab{doctype}`.`custom_sales_person_user` = {u}"
        f" OR ((`tab{doctype}`.`custom_sales_person_user` IS NULL"
        f" OR `tab{doctype}`.`custom_sales_person_user` = '')"
        f" AND `tab{doctype}`.`owner` = {u}))"
    )


def _sales_doc_has_permission(doc, ptype, user):
    """Allow access only if the user is assigned to the document."""
    if not user:
        user = frappe.session.user
    if _is_privileged(user):
        return True
    # Allow create and new unsaved docs — custom_sales_person_user not set yet
    if ptype == "create" or not doc.name:
        return True
    assigned = doc.get("custom_sales_person_user")
    if assigned:
        # Field is set — use it exclusively (respects reassignment)
        return assigned == user
    # Field is NULL (doc pre-dates the sales person tracking) — fall back to owner
    return doc.owner == user


# ── Customer: restrict Sales Users to their assignments + owned records ───────

def _is_sales_user_only(user):
    """True when user has Sales User role but NO privileged role.
    Accounts, HR, Purchase, Stock roles etc. all bypass restriction.
    """
    if not user:
        user = frappe.session.user
    roles = set(frappe.get_roles(user))
    if _PRIVILEGED_ROLES & roles:
        return False
    return "Sales User" in roles


def customer_query_conditions(user):
    """Sales Users see only customers they own or are assigned to.
    Everyone else (Sales Manager, Accounts, System Manager …) sees all.
    """
    if not user:
        user = frappe.session.user
    if not _is_sales_user_only(user):
        return "1=1"
    u = frappe.db.escape(user)
    return (
        f"(`tabCustomer`.`owner` = {u}"
        f" OR `tabCustomer`.`name` IN ("
        f"   SELECT `customer` FROM `tabIB Customer Assignment`"
        f"   WHERE `assigned_to` = {u}"
        f" ))"
    )


def customer_has_permission(doc, ptype, user):
    """Allow create always; for existing docs check ownership or assignment."""
    if not user:
        user = frappe.session.user
    if not _is_sales_user_only(user):
        return True
    if ptype == "create" or not doc.name:
        return True
    if doc.owner == user:
        return True
    return frappe.db.exists(
        "IB Customer Assignment",
        {"customer": doc.name, "assigned_to": user},
    )


# ── Per-doctype entry points registered in hooks.py ──────────────────────────

def quotation_query_conditions(user):
    return _sales_doc_query_conditions("Quotation", user)

def quotation_has_permission(doc, ptype, user):
    return _sales_doc_has_permission(doc, ptype, user)


def sales_order_query_conditions(user):
    return _sales_doc_query_conditions("Sales Order", user)

def sales_order_has_permission(doc, ptype, user):
    return _sales_doc_has_permission(doc, ptype, user)


def delivery_note_query_conditions(user):
    return _sales_doc_query_conditions("Delivery Note", user)

def delivery_note_has_permission(doc, ptype, user):
    return _sales_doc_has_permission(doc, ptype, user)


def sales_invoice_query_conditions(user):
    return _sales_doc_query_conditions("Sales Invoice", user)

def sales_invoice_has_permission(doc, ptype, user):
    return _sales_doc_has_permission(doc, ptype, user)
