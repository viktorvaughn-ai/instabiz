"""IB Activity Log — Lead activity comments, Customer activity comments, Customer Assignments."""
import re
import frappe
from frappe import _
from frappe.utils import getdate, flt


def execute(filters=None):
	filters = filters or {}
	_enforce_user_scope(filters)
	_validate(filters)
	data = _data(filters)
	columns = _columns()
	return columns, data, None, _chart(data, filters), _summary(data)


def _enforce_user_scope(filters):
	"""Sales Users can only see their own activities — force-apply sales_person_user filter."""
	from instabiz.overrides.permissions import _is_privileged
	if not _is_privileged(frappe.session.user):
		filters["sales_person_user"] = frappe.session.user


def _validate(filters):
	if filters.get("from_date") and filters.get("to_date"):
		if getdate(filters["from_date"]) > getdate(filters["to_date"]):
			frappe.throw(_("From Date cannot be after To Date."))


def _columns():
	return [
		{"label": _("Date"),          "fieldname": "date",          "fieldtype": "Date",     "width": 100},
		{"label": _("Source"),        "fieldname": "source",        "fieldtype": "Data",     "width": 140},
		{"label": _("Reference"),     "fieldname": "reference",     "fieldtype": "Data",     "width": 160},
		{"label": _("Contact / Name"),"fieldname": "contact_name",  "fieldtype": "Data",     "width": 180},
		{"label": _("Sales Person"),  "fieldname": "sales_person",  "fieldtype": "Data",     "width": 160},
		{"label": _("State"),     "fieldname": "territory",     "fieldtype": "Data",     "width": 120},
		{"label": _("Activity"),      "fieldname": "activity_type", "fieldtype": "Data",     "width": 120},
		{"label": _("Outcome"),       "fieldname": "outcome",       "fieldtype": "Data",     "width": 130},
		{"label": _("Notes"),         "fieldname": "notes",         "fieldtype": "Data",     "width": 260},
		{"label": _("Actor"),         "fieldname": "actor",         "fieldtype": "Data",     "width": 140},
	]


# ── User name cache ───────────────────────────────────────────────────────────

def _user_name_map():
	rows = frappe.db.sql("SELECT name, full_name FROM tabUser", as_dict=True)
	return {r.name: (r.full_name or r.name) for r in rows}


# ── Comment parser ────────────────────────────────────────────────────────────

def _parse_comment(content):
	"""Extract activity_type, outcome, notes, actor from log_*_activity HTML comment."""
	m_type    = re.search(r"<b>(\w+)</b>\s+—", content)
	m_outcome = re.search(r"Outcome:\s*<b>(.+?)</b>", content)
	# Notes sit between the outcome closing tag and "Logged by"
	m_notes   = re.search(r"</b><br>(.+?)<br><i>Logged by", content, re.DOTALL)
	m_actor   = re.search(r"Logged by\s+(.+?)</i>", content)

	activity_type = m_type.group(1)   if m_type    else ""
	outcome       = m_outcome.group(1) if m_outcome else ""
	notes         = re.sub(r"<[^>]+>", "", m_notes.group(1)).strip() if m_notes else ""
	actor         = m_actor.group(1)   if m_actor   else ""
	return activity_type, outcome, notes, actor


# ── Data queries ──────────────────────────────────────────────────────────────

def _data(filters):
	from_date = filters.get("from_date")
	to_date   = filters.get("to_date")
	source_f  = filters.get("source") or "All"
	sp_filter = filters.get("sales_person_user") or ""
	terr_f    = filters.get("territory") or ""
	act_f     = filters.get("activity_type") or ""

	user_map = _user_name_map()
	rows = []

	# ── Lead activity comments ────────────────────────────────────────────────
	if source_f in ("All", "Lead Activity"):
		where = "c.reference_doctype = 'Lead' AND c.comment_type = 'Info' AND c.content LIKE %(marker)s"
		params = {"marker": "%— Outcome:%"}
		if from_date:
			where += " AND DATE(c.creation) >= %(from_date)s"
			params["from_date"] = from_date
		if to_date:
			where += " AND DATE(c.creation) <= %(to_date)s"
			params["to_date"] = to_date
		if sp_filter:
			where += " AND l.lead_owner = %(sp)s"
			params["sp"] = sp_filter
		if terr_f:
			where += " AND l.territory = %(terr)s"
			params["terr"] = terr_f

		lead_rows = frappe.db.sql(
			f"""
			SELECT DATE(c.creation) AS date,
			       c.reference_name AS reference,
			       l.lead_name      AS contact_name,
			       l.lead_owner     AS sp_user,
			       l.territory,
			       c.content
			FROM `tabComment` c
			JOIN `tabLead` l ON l.name = c.reference_name
			WHERE {where}
			ORDER BY c.creation DESC
			""",
			params,
			as_dict=True,
		)
		for r in lead_rows:
			act, outcome, notes, actor = _parse_comment(r.content or "")
			if act_f and act_f != act:
				continue
			rows.append({
				"date":          r.date,
				"source":        "Lead Activity",
				"reference":     r.reference,
				"contact_name":  r.contact_name or r.reference,
				"sales_person":  user_map.get(r.sp_user, r.sp_user or ""),
				"territory":     r.territory or "",
				"activity_type": act,
				"outcome":       outcome,
				"notes":         notes,
				"actor":         actor,
			})

	# ── Customer activity comments ────────────────────────────────────────────
	if source_f in ("All", "Customer Activity"):
		where = "c.reference_doctype = 'Customer' AND c.comment_type = 'Info' AND c.content LIKE %(marker)s"
		params = {"marker": "%— Outcome:%"}
		if from_date:
			where += " AND DATE(c.creation) >= %(from_date)s"
			params["from_date"] = from_date
		if to_date:
			where += " AND DATE(c.creation) <= %(to_date)s"
			params["to_date"] = to_date
		if sp_filter:
			where += " AND cu.custom_sales_person_user = %(sp)s"
			params["sp"] = sp_filter
		if terr_f:
			where += " AND cu.territory = %(terr)s"
			params["terr"] = terr_f

		cust_rows = frappe.db.sql(
			f"""
			SELECT DATE(c.creation)          AS date,
			       c.reference_name          AS reference,
			       cu.customer_name          AS contact_name,
			       cu.custom_sales_person_user AS sp_user,
			       cu.territory,
			       c.content
			FROM `tabComment` c
			JOIN `tabCustomer` cu ON cu.name = c.reference_name
			WHERE {where}
			ORDER BY c.creation DESC
			""",
			params,
			as_dict=True,
		)
		for r in cust_rows:
			act, outcome, notes, actor = _parse_comment(r.content or "")
			if act_f and act_f != act:
				continue
			rows.append({
				"date":          r.date,
				"source":        "Customer Activity",
				"reference":     r.reference,
				"contact_name":  r.contact_name or r.reference,
				"sales_person":  user_map.get(r.sp_user, r.sp_user or ""),
				"territory":     r.territory or "",
				"activity_type": act,
				"outcome":       outcome,
				"notes":         notes,
				"actor":         actor,
			})

	# ── IB Customer Assignment records ────────────────────────────────────────
	if source_f in ("All", "Assignment") and not act_f:
		where = "a.status IN ('Contacted', 'Order Placed', 'Skipped')"
		params = {}
		if from_date:
			where += " AND DATE(COALESCE(a.completed_at, a.assigned_date)) >= %(from_date)s"
			params["from_date"] = from_date
		if to_date:
			where += " AND DATE(COALESCE(a.completed_at, a.assigned_date)) <= %(to_date)s"
			params["to_date"] = to_date
		if sp_filter:
			where += " AND a.assigned_to = %(sp)s"
			params["sp"] = sp_filter
		if terr_f:
			where += " AND a.territory = %(terr)s"
			params["terr"] = terr_f

		assign_rows = frappe.db.sql(
			f"""
			SELECT DATE(COALESCE(a.completed_at, a.assigned_date)) AS date,
			       a.customer     AS reference,
			       cu.customer_name AS contact_name,
			       a.assigned_to  AS sp_user,
			       a.territory,
			       a.status       AS activity_type,
			       a.outcome,
			       a.notes
			FROM `tabIB Customer Assignment` a
			JOIN `tabCustomer` cu ON cu.name = a.customer
			WHERE {where}
			ORDER BY COALESCE(a.completed_at, a.assigned_date) DESC
			""",
			params,
			as_dict=True,
		)
		for r in assign_rows:
			rows.append({
				"date":          r.date,
				"source":        "Assignment",
				"reference":     r.reference,
				"contact_name":  r.contact_name or r.reference,
				"sales_person":  user_map.get(r.sp_user, r.sp_user or ""),
				"territory":     r.territory or "",
				"activity_type": r.activity_type or "",
				"outcome":       r.outcome or "",
				"notes":         r.notes or "",
				"actor":         user_map.get(r.sp_user, r.sp_user or ""),
			})

	rows.sort(key=lambda r: r["date"] or "", reverse=True)
	return rows


# ── Chart ─────────────────────────────────────────────────────────────────────

def _chart(data, filters=None):
	if not data:
		return None
	chart_type = (filters or {}).get("chart_type", "bar")

	counts = {}
	for r in data:
		sp = r.get("sales_person") or "Unknown"
		counts[sp] = counts.get(sp, 0) + 1

	counts = dict(sorted(counts.items(), key=lambda x: x[1], reverse=True)[:15])

	return {
		"data": {
			"labels": list(counts.keys()),
			"datasets": [{"name": "Activities", "values": list(counts.values())}],
		},
		"type": chart_type,
		"colors": ["#d97757"],
	}


# ── Summary ───────────────────────────────────────────────────────────────────

def _summary(data):
	lead_ct   = sum(1 for r in data if r["source"] == "Lead Activity")
	cust_ct   = sum(1 for r in data if r["source"] == "Customer Activity")
	assign_ct = sum(1 for r in data if r["source"] == "Assignment")
	total     = len(data)
	return [
		{"label": _("Total Activities"),      "value": total,     "datatype": "Int", "indicator": "blue"},
		{"label": _("Lead Activities"),        "value": lead_ct,   "datatype": "Int", "indicator": "green"},
		{"label": _("Customer Activities"),    "value": cust_ct,   "datatype": "Int", "indicator": "orange"},
		{"label": _("Assignments Completed"),  "value": assign_ct, "datatype": "Int", "indicator": "purple"},
	]
