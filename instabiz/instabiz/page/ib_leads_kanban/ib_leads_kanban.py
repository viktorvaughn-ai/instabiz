import frappe
from frappe.utils import nowdate, getdate, flt


def get_context(context):
	context.no_cache = 1


LEAD_COLUMNS = [
	{"key": "Open",           "label": "New / Open",    "color": "#6b7280"},
	{"key": "Replied",        "label": "Contacted",     "color": "#3b82f6"},
	{"key": "Interested",     "label": "Interested",    "color": "#8b5cf6"},
	{"key": "Opportunity",    "label": "Opportunity",   "color": "#f59e0b"},
	{"key": "Quotation",      "label": "Quoted",        "color": "#d97757"},
	{"key": "Converted",      "label": "Won",           "color": "#10b981"},
	{"key": "Lost Quotation", "label": "Lost",          "color": "#ef4444"},
]


def _lk_privileged(user):
	roles = frappe.get_roles(user)
	return "System Manager" in roles or "Sales Manager" in roles


@frappe.whitelist()
def get_leads_data(search=None):
	user = frappe.session.user
	privileged = _lk_privileged(user)

	conditions = ["l.status NOT IN ('Do Not Contact')"]
	params = []

	if not privileged:
		conditions.append("l.lead_owner = %s")
		params.append(user)

	if search:
		conditions.append("(l.lead_name LIKE %s OR l.company_name LIKE %s OR l.email_id LIKE %s OR l.mobile_no LIKE %s)")
		params += [f"%{search}%"] * 4

	where = " AND ".join(conditions)

	leads = frappe.db.sql(f"""
		SELECT l.name, l.lead_name, l.company_name, l.email_id,
			   l.mobile_no, l.status, l.source, l.lead_owner,
			   l.creation, l.modified,
			   l.custom_lead_score,
			   u.full_name as owner_name
		FROM `tabLead` l
		LEFT JOIN `tabUser` u ON u.name = l.lead_owner
		WHERE {where}
		ORDER BY l.modified DESC
		LIMIT 300
	""", params, as_dict=True)

	# Group by status
	columns = {}
	for col in LEAD_COLUMNS:
		columns[col["key"]] = {"meta": col, "cards": [], "count": 0}

	for lead in leads:
		key = lead.status or "Open"
		if key not in columns:
			columns[key] = {"meta": {"key": key, "label": key, "color": "#6b7280"}, "cards": [], "count": 0}
		columns[key]["cards"].append(lead)
		columns[key]["count"] += 1

	# Summary stats
	total = len(leads)
	converted = columns.get("Converted", {}).get("count", 0)
	lost = columns.get("Lost Quotation", {}).get("count", 0)
	active = total - converted - lost

	return {
		"columns": [columns[c["key"]] for c in LEAD_COLUMNS],
		"total": total,
		"converted": converted,
		"lost": lost,
		"active": active,
	}


@frappe.whitelist()
def move_lead(lead, status):
	allowed = [c["key"] for c in LEAD_COLUMNS]
	if status not in allowed:
		frappe.throw("Invalid status")
	user = frappe.session.user
	doc = frappe.get_doc("Lead", lead)
	if not _lk_privileged(user) and doc.lead_owner != user:
		frappe.throw("Not permitted to move this lead", frappe.PermissionError)
	doc.status = status
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"status": "ok", "new_status": status}
