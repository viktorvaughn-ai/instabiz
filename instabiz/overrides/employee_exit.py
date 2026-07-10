"""instabiz.overrides.employee_exit

Scheduled jobs that drive the Employee Exit Handover workflow.

  run_exit_handover_daily   — fires on relieving_date:
                              collects pending documents owned by the leaving
                              employee, creates an Employee Exit Handover doc,
                              and notifies all HR Manager users.

  run_user_disable_daily    — fires on relieving_date + 1:
                              disables the User account and stamps exit
                              metadata (custom_user_status, custom_exit_date,
                              custom_exit_handover) on the User record.

Document discovery is registry-driven: each module declares its pending
documents via the `exit_handover_sources` hook in hooks.py.
frappe.get_hooks() aggregates them from all installed apps automatically.
Adding a new module = adding one dict to hooks.py. Zero engine changes.
"""

import frappe
from frappe import _
from frappe.utils import today, add_days


# ── Public scheduler entry points ─────────────────────────────────────────────

def run_exit_handover_daily():
    """
    Daily job — runs on/after the employee's relieving_date.
    Creates the handover doc and notifies HR Managers.
    Idempotent: skips employees who already have a handover doc for their relieving_date.

    Uses relieving_date <= today (not an exact match) and does NOT filter on
    Employee.status. HR commonly sets status="Left" at the same time they enter
    relieving_date — often for a date already in the past — so an exact-date +
    status="Active" filter would silently never catch that employee. Mirrors the
    retry-safe pattern already used by run_user_disable_daily.
    """
    employees = frappe.get_all(
        "Employee",
        filters=[
            ["relieving_date", "is", "set"],
            ["relieving_date", "<=", today()],
            ["user_id", "is", "set"],
        ],
        fields=["name", "employee_name", "user_id", "relieving_date"],
    )

    for emp in employees:
        try:
            _process_exit(emp)
        except Exception:
            frappe.log_error(
                title   = f"Exit Handover: failed for {emp.employee_name}",
                message = frappe.get_traceback(),
            )


def run_user_disable_daily():
    """
    Daily job — runs the morning after the employee's relieving_date.
    Disables the ERP user account and stamps exit metadata.
    The one-day delay ensures the employee retains access on their last day.

    Uses relieving_date <= yesterday so that a transient failure on day+1
    is automatically retried on subsequent days until the account is disabled.
    """
    yesterday = add_days(today(), -1)

    employees = frappe.get_all(
        "Employee",
        filters=[
            ["relieving_date", "is", "set"],
            ["relieving_date", "<=", yesterday],
            ["user_id", "is", "set"],
        ],
        fields=["name", "employee_name", "user_id", "relieving_date"],
    )

    for emp in employees:
        try:
            # Skip users already disabled — handles the retry-safe case
            if not frappe.db.get_value("User", emp.user_id, "enabled"):
                continue

            handover_name = frappe.db.get_value(
                "Employee Exit Handover",
                {"employee": emp.name, "relieving_date": emp.relieving_date},
                "name",
            )
            _disable_user(emp.user_id, handover_name)
        except Exception:
            frappe.log_error(
                title   = f"Exit Handover: user disable failed for {emp.employee_name}",
                message = frappe.get_traceback(),
            )


# ── Internal helpers ──────────────────────────────────────────────────────────

def _process_exit(emp):
    """Create the handover doc for one employee. Idempotent."""
    already_exists = frappe.db.exists(
        "Employee Exit Handover",
        {"employee": emp.name, "relieving_date": emp.relieving_date},
    )
    if already_exists:
        return

    items = _collect_pending_documents(emp.user_id)
    doc   = _create_handover_doc(emp, items)
    _notify_hr_managers(doc, len(items))
    # Commit AFTER notifications so both succeed or both rollback together.
    # If notifications fail the exception propagates, nothing is committed,
    # and the next scheduler run retries from scratch.
    frappe.db.commit()


def _collect_pending_documents(user_email):
    """
    Query every registered exit_handover_source for docs owned by user_email.

    Each source may declare `owner_value_from` (e.g. "first_name") meaning the
    owner_field on that DocType stores a derived User attribute rather than the
    email address directly. This is needed for custom Data fields like
    custom_sales_person which stores User.first_name.

    Returns a flat list of item dicts ready to be appended to the handover doc.
    """
    sources = frappe.get_hooks("exit_handover_sources")
    items   = []

    for source in sources:
        doctype          = source["doctype"]
        owner_field      = source["owner_field"]
        owner_value_from = source.get("owner_value_from")
        title_field      = source.get("title_field", "name")

        # Resolve filter value: email OR a derived attribute (e.g. first_name)
        if owner_value_from:
            filter_value = frappe.db.get_value("User", user_email, owner_value_from)
        else:
            filter_value = user_email

        if not filter_value:
            continue

        filters = {owner_field: filter_value}
        filters.update(source.get("pending_filter", {}))

        try:
            fetch_fields = ["name"]
            if title_field != "name":
                fetch_fields.append(title_field)

            docs = frappe.get_all(doctype, filters=filters, fields=fetch_fields)
        except Exception:
            frappe.log_error(
                title   = f"Exit Handover: failed collecting {doctype}",
                message = frappe.get_traceback(),
            )
            continue

        for doc in docs:
            items.append({
                "module":             source.get("module", ""),
                "document_type":      doctype,
                "document_name":      doc.name,
                "title":              doc.get(title_field) or doc.name,
                "owner_field":        owner_field,
                "owner_value_from":   owner_value_from or "",
                "display_name_field": source.get("display_name_field", ""),
            })

    return items


def _create_handover_doc(emp, items):
    """Insert the Employee Exit Handover document and return it."""
    doc = frappe.new_doc("Employee Exit Handover")
    doc.employee      = emp.name
    doc.employee_name = emp.employee_name
    doc.user_id       = emp.user_id
    doc.relieving_date = emp.relieving_date
    # Auto-complete when no pending docs exist — nothing for HR to do
    doc.status = "Completed" if not items else "Pending Review"

    for item in items:
        doc.append("items", item)

    doc.insert(ignore_permissions=True)
    return doc


def _disable_user(user_id, handover_name=None):
    """Disable the ERP user account and stamp exit metadata on the User record."""
    if not frappe.db.exists("User", user_id):
        return

    values = {
        "enabled":            0,
        "custom_user_status": "Exited",
        "custom_exit_date":   today(),
    }
    if handover_name:
        values["custom_exit_handover"] = handover_name

    frappe.db.set_value("User", user_id, values)
    frappe.db.commit()


def _notify_hr_managers(doc, item_count, subject=None):
    """Send a bell notification and real-time toast to all enabled HR Manager users."""
    hr_users = frappe.get_all(
        "Has Role",
        filters={"role": "HR Manager", "parenttype": "User"},
        pluck="parent",
    )
    # Filter to enabled users only
    hr_users = [u for u in hr_users if frappe.db.get_value("User", u, "enabled")]

    if not hr_users:
        return

    if not subject:
        if item_count:
            subject = _("{0} relieved — {1} pending document(s) need reassignment").format(
                doc.employee_name, item_count
            )
        else:
            subject = _("{0} relieved — no pending documents found").format(doc.employee_name)

    for user in hr_users:
        # ── Bell (Notification Log) ───────────────────────────────────────────
        frappe.get_doc({
            "doctype":       "Notification Log",
            "for_user":      user,
            "from_user":     "Administrator",
            "type":          "Alert",
            "document_type": "Employee Exit Handover",
            "document_name": doc.name,
            "subject":       subject,
        }).insert(ignore_permissions=True)

        # ── Toast (real-time, current session only) ───────────────────────────
        frappe.publish_realtime(
            event   = "msgprint",
            message = {
                "message":   subject,
                "title":     _("Employee Exit Handover"),
                # Green when called after reassignment (subject passed explicitly),
                # orange when called on initial EEH creation (action needed).
                "indicator": "green" if subject else ("orange" if item_count else "green"),
                "alert":     1,
            },
            user         = user,
            after_commit = True,
        )


@frappe.whitelist()
def test_notify(employee_name="Test Employee", item_count=2, handover_name="EXH-TEST-00001"):
    """
    Quick test helper — fires _notify_hr_managers without running the full scheduler.
    Run from console:
        frappe.call("instabiz.overrides.employee_exit.test_notify")
    """
    doc = frappe._dict(
        employee_name = employee_name,
        name          = handover_name,
    )
    _notify_hr_managers(doc, item_count)
    frappe.db.commit()
    return "Notifications sent to HR Managers"
