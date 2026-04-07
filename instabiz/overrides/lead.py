import frappe
from frappe import _
import urllib.request
import json as _json


def assign_lead_owner(doc, method=None):
    """
    Assign lead_owner via round-robin based on the lead's territory.
    Called on after_insert and on_update (only when territory changes).
    """
    if not doc.territory:
        return

    # On update, skip if territory hasn't changed
    if method != "after_insert":
        before = doc.get_doc_before_save()
        if not before:
            # on_update fired immediately after insert — after_insert already handled it
            return
        if before.territory == doc.territory:
            return

    _do_assign(doc)


def _do_assign(doc):
    rows = frappe.db.sql(
        """
        SELECT DISTINCT lst.name
        FROM `tabLead Sales Team` lst
        INNER JOIN `tabLead Sales Team Territory` lstt
            ON lstt.parent = lst.name
        WHERE lstt.territory = %(territory)s
        ORDER BY lst.name ASC
        LIMIT 1
        """,
        {"territory": doc.territory},
        as_dict=True,
    )

    if not rows:
        return

    team_name = rows[0].name

    # Acquire a per-team advisory lock to prevent concurrent leads from
    # reading the same rr_index before either has written the next value.
    lock_key = f"ib_rr_{team_name}"
    frappe.db.sql("SELECT GET_LOCK(%s, 10)", lock_key)
    try:
        team = frappe.get_doc("Lead Sales Team", team_name)

        if not team.members:
            return

        idx      = (team.rr_index or 0) % len(team.members)
        member   = team.members[idx]
        next_idx = (idx + 1) % len(team.members)

        full_name = frappe.db.get_value("User", member.user, "full_name") or member.user

        frappe.db.set_value("Lead Sales Team", team.name, "rr_index", next_idx)
        frappe.db.set_value("Lead", doc.name, {
            "lead_owner":             member.user,
            "custom_lead_owner_name": full_name,
        }, update_modified=False)
        doc.lead_owner             = member.user
        doc.custom_lead_owner_name = full_name

        doc.add_comment("Edit", _("Lead auto-assigned to {0} via round-robin").format(full_name))
    finally:
        frappe.db.sql("SELECT RELEASE_LOCK(%s)", lock_key)


@frappe.whitelist()
def get_pincode_info(pincode):
    """Fetch city, district and state for an Indian pincode via India Post API."""
    try:
        url = f"https://api.postalpincode.in/pincode/{pincode}"
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = _json.loads(resp.read().decode())
    except Exception:
        frappe.throw(_("Could not reach pincode lookup service. Please try again."))

    if not data or data[0].get("Status") != "Success" or not data[0].get("PostOffice"):
        return None

    po       = data[0]["PostOffice"][0]
    state    = po.get("State", "")
    district = po.get("District", "")
    city     = po.get("Division", "") or district

    # Match territory by state name
    territory = frappe.db.get_value("Territory", state) or None

    return {
        "city":      city,
        "district":  district,
        "state":     state,
        "territory": territory,
    }


@frappe.whitelist()
def transfer_leads(leads, to_user):
    """Bulk transfer lead ownership to a given user."""
    if isinstance(leads, str):
        import json
        leads = json.loads(leads)

    if not frappe.db.exists("User", to_user):
        frappe.throw(_("User {0} not found").format(to_user))

    full_name = frappe.db.get_value("User", to_user, "full_name") or to_user

    # Batch UPDATE — single query instead of one per lead
    placeholders = ", ".join(["%s"] * len(leads))
    frappe.db.sql(
        f"UPDATE `tabLead` SET lead_owner = %s, custom_lead_owner_name = %s"
        f" WHERE name IN ({placeholders})",
        [to_user, full_name] + list(leads),
    )

    # Batch INSERT all audit comments in one round-trip
    now     = frappe.utils.now()
    actor   = frappe.session.user
    content = _("Lead transferred to {0}").format(full_name)
    rows    = [
        (frappe.generate_hash(length=10), lead_name, content, actor, now, now, actor)
        for lead_name in leads
    ]
    frappe.db.sql(
        "INSERT INTO `tabComment`"
        " (name, comment_type, reference_doctype, reference_name, content,"
        "  owner, creation, modified, modified_by, docstatus, published, seen)"
        " VALUES " + ", ".join(["(%s, 'Info', 'Lead', %s, %s, %s, %s, %s, %s, 0, 0, 0)"] * len(rows)),
        [v for row in rows for v in row],
    )

    return {"transferred": len(leads), "to": full_name}
