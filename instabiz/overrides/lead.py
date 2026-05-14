import re
import frappe
from frappe import _
import urllib.request
import json as _json

from instabiz.overrides.permissions import _is_privileged

# ── Lead scoring ──────────────────────────────────────────────────────────────
_TEMP_SCORE  = {"Hot": 60, "Warm": 30, "Cold": 0}
_STATUS_BONUS = {
	"Negotiation": 30, "Proposal": 20, "Qualified": 15,
	"Contacted": 5, "Hot Lead": 10,
}


def compute_lead_score(doc, method=None):
	"""Auto-compute custom_lead_score (0–100) on every save."""
	score = _TEMP_SCORE.get(doc.get("custom_lead_temperature") or "Cold", 0)
	score += _STATUS_BONUS.get(doc.get("custom_status") or "", 0)
	if doc.get("mobile_no"):
		score += 5
	if doc.get("email_id"):
		score += 5
	if doc.get("custom_product_of_interest") or doc.get("custom_poi"):
		score += 10
	if doc.get("custom_next_follow_up_date"):
		score += 10
	doc.custom_lead_score = min(score, 100)


def get_permission_query_conditions(user):
    """Limit Lead list to rows owned by or assigned to the current user.

    lead_owner is authoritative when set; owner is the fallback for leads
    that pre-date the round-robin assignment feature (lead_owner = NULL/'').
    """
    if not user:
        user = frappe.session.user
    if _is_privileged(user):
        return "1=1"
    u = frappe.db.escape(user)
    return (
        f"(`tabLead`.`lead_owner` = {u}"
        f" OR ((`tabLead`.`lead_owner` IS NULL OR `tabLead`.`lead_owner` = '')"
        f" AND `tabLead`.`owner` = {u}))"
    )


def has_permission(doc, ptype, user):
    """Allow access to a Lead only if the user owns or is assigned to it."""
    if not user:
        user = frappe.session.user
    if _is_privileged(user):
        return True
    # Allow create and new unsaved docs — lead_owner not set yet
    if ptype == "create" or not doc.name:
        return True
    assigned = doc.lead_owner
    if assigned:
        return assigned == user
    return doc.owner == user


def check_duplicate_lead(doc, method=None):
    """Block lead creation if same mobile_no or email_id already exists."""
    existing = None
    if doc.mobile_no:
        existing = frappe.db.get_value(
            "Lead", {"mobile_no": doc.mobile_no}, ["name", "lead_name"], as_dict=True
        )
    if not existing and doc.email_id:
        existing = frappe.db.get_value(
            "Lead", {"email_id": doc.email_id}, ["name", "lead_name"], as_dict=True
        )
    if existing:
        link = f'<a href="/app/lead/{existing.name}">{existing.lead_name or existing.name}</a>'
        frappe.throw(
            f"Duplicate lead: {link} already exists with this phone or email.",
            title=_("Duplicate Lead"),
        )


def set_territory_from_pincode(doc, method=None):
    """If territory not set but custom_pincode is, derive territory from pincode via India Post."""
    if doc.territory or not doc.get("custom_pincode"):
        return
    pincode = str(doc.custom_pincode).strip()
    if not re.match(r"^\d{6}$", pincode):
        return
    try:
        url = f"https://api.postalpincode.in/pincode/{pincode}"
        with urllib.request.urlopen(url, timeout=3) as resp:
            data = _json.loads(resp.read().decode())
        if data and data[0].get("Status") == "Success" and data[0].get("PostOffice"):
            state = data[0]["PostOffice"][0].get("State", "")
            territory = frappe.db.get_value("Territory", state) or None
            if territory:
                doc.territory = territory
    except Exception:
        pass  # silent — pincode lookup is best-effort on insert


def assign_lead_owner(doc, method=None):
    """Assign lead_owner via round-robin based on the lead's territory.

    Called on after_insert and on_update (only when territory changes).
    Never overwrites a lead that already has a manually assigned lead_owner.
    """
    if not doc.territory:
        return

    # Never overwrite a manually assigned lead_owner
    if doc.lead_owner:
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

    territory = frappe.db.get_value("Territory", state) or None

    return {
        "city":      city,
        "district":  district,
        "state":     state,
        "territory": territory,
    }


@frappe.whitelist()
def set_lead_status(lead, status):
	"""Update custom_status directly — bypasses full validate."""
	VALID = {"Cold Lead", "Hot Lead", "Contacted", "Qualified", "Proposal", "Negotiation", "Converted", "Customer", "Lost"}
	if status not in VALID:
		frappe.throw(_("Invalid status"))
	doc = frappe.get_doc("Lead", lead)
	if not has_permission(doc, "write", frappe.session.user):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	old_status = doc.custom_status or ""
	frappe.db.set_value("Lead", lead, "custom_status", status)
	if old_status != status:
		actor = frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user
		frappe.get_doc({
			"doctype": "Comment",
			"comment_type": "Info",
			"reference_doctype": "Lead",
			"reference_name": lead,
			"content": f"Status changed: <b>{old_status or '—'}</b> → <b>{status}</b> by {actor}",
			"owner": frappe.session.user,
		}).insert(ignore_permissions=True)
	return status


@frappe.whitelist()
def custom_make_customer(source_name, target_doc=None):
	"""Wrap ERPNext make_customer and carry instabiz custom fields to Customer."""
	from erpnext.crm.doctype.lead.lead import _make_customer
	customer_doc = _make_customer(source_name, target_doc)

	lead = frappe.get_doc("Lead", source_name)

	# Carry territory
	if lead.territory and not customer_doc.territory:
		customer_doc.territory = lead.territory

	# Carry pincode → billing pincode on Customer
	if lead.get("custom_pincode"):
		customer_doc.custom_bt_pincode = lead.custom_pincode

	# Carry city / district / state from lead custom fields
	if lead.get("city"):
		customer_doc.custom_bt_city = lead.city
	if lead.get("custom_district"):
		customer_doc.custom_district = lead.custom_district

	# Wire the sales person user so permissions work immediately
	if lead.lead_owner:
		customer_doc.custom_sales_person_user = lead.lead_owner

	return customer_doc


@frappe.whitelist()
def transfer_leads(leads, to_user):
    """Bulk transfer lead ownership to a given user.

    Restricted to Sales Manager and System Manager only.
    """
    if frappe.session.user != "Administrator" and not any(
        r in frappe.get_roles() for r in ("Sales Manager", "System Manager")
    ):
        frappe.throw(_("Only Sales Managers can transfer leads."), frappe.PermissionError)

    if isinstance(leads, str):
        leads = _json.loads(leads)

    leads = list(leads)

    if not leads:
        return {"transferred": 0, "to": to_user}

    if not frappe.db.exists("User", to_user):
        frappe.throw(_("User {0} not found").format(to_user))

    full_name = frappe.db.get_value("User", to_user, "full_name") or to_user

    placeholders = ", ".join(["%s"] * len(leads))
    frappe.db.sql(
        f"UPDATE `tabLead` SET lead_owner = %s, custom_lead_owner_name = %s"
        f" WHERE name IN ({placeholders})",
        [to_user, full_name] + leads,
    )

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


@frappe.whitelist()
def log_lead_activity(lead, activity_type, outcome, notes, next_follow_up_date=None):
	"""Log a call/meeting/WA/email/visit activity on a Lead timeline."""
	doc = frappe.get_doc("Lead", lead)
	if not has_permission(doc, "write", frappe.session.user):
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	VALID_TYPES = {"Call", "Meeting", "WhatsApp", "Email", "Visit"}
	VALID_OUTCOMES = {"Positive", "Neutral", "Negative", "No Answer"}
	if activity_type not in VALID_TYPES:
		frappe.throw(_("Invalid activity type"))
	if outcome not in VALID_OUTCOMES:
		frappe.throw(_("Invalid outcome"))

	actor = frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user
	icon_map = {"Call": "📞", "Meeting": "🤝", "WhatsApp": "💬", "Email": "📧", "Visit": "📍"}

	parts = [f"{icon_map[activity_type]} <b>{activity_type}</b> — Outcome: <b>{outcome}</b>"]
	if notes:
		parts.append(frappe.utils.escape_html(notes).replace("\n", "<br>"))
	if next_follow_up_date:
		parts.append(f"Next follow-up: <b>{next_follow_up_date}</b>")
	parts.append(f"<i>Logged by {actor}</i>")

	frappe.get_doc({
		"doctype": "Comment",
		"comment_type": "Info",
		"reference_doctype": "Lead",
		"reference_name": lead,
		"content": "<br>".join(parts),
		"owner": frappe.session.user,
	}).insert(ignore_permissions=True)

	if next_follow_up_date:
		frappe.db.set_value("Lead", lead, "custom_next_follow_up_date", next_follow_up_date, update_modified=False)

	return "ok"
