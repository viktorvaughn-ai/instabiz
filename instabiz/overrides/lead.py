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
        if before and before.territory == doc.territory:
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

    team = frappe.get_doc("Lead Sales Team", rows[0].name)

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
    })
    doc.lead_owner             = member.user
    doc.custom_lead_owner_name = full_name


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

    for lead_name in leads:
        frappe.db.set_value("Lead", lead_name, {
            "lead_owner":             to_user,
            "custom_lead_owner_name": full_name,
        })

    return {"transferred": len(leads), "to": full_name}
