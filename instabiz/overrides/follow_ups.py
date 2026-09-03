from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import getdate, today

# ── Registry: which doctypes participate, and how "my documents" resolves ─────
# owner_field:
#   None                -> only doc.owner / ToDo assignment count
#   "employee_user_id"  -> resolved via this doc's own `employee` link -> Employee.user_id
#   <field name>         -> that field directly holds the responsible user's email

SUBMITTABLE_DOCTYPES = {
	"Quotation", "Sales Order", "Delivery Note", "Sales Invoice",
	"Purchase Order", "Purchase Receipt", "Purchase Invoice",
}

# exclude_statuses: IB display statuses that mean "already decided, nothing to
# chase" — e.g. Quotation status "Confirmed" means it was already converted to
# a Sales Order (see instabiz.overrides.quotation.CustomQuotation.STATUS_MAP);
# following up on it wastes the rep's time. Only set where verified against a
# real STATUS_MAP, left empty elsewhere rather than guessed.
FOLLOW_UP_SOURCES = {
	"Quotation":                {"owner_field": "custom_sales_person_user", "display_fields": ["party_name", "grand_total", "contact_mobile"], "exclude_statuses": ["Confirmed", "Cancelled"]},
	"Sales Order":               {"owner_field": "custom_sales_person_user", "display_fields": ["customer_name", "grand_total", "contact_mobile"], "exclude_statuses": ["Confirmed", "Cancelled"]},
	"Delivery Note":             {"owner_field": "custom_sales_person_user", "display_fields": ["customer_name", "contact_mobile"], "exclude_statuses": []},
	"Sales Invoice":             {"owner_field": "custom_sales_person_user", "display_fields": ["customer_name", "grand_total", "contact_mobile"], "exclude_statuses": []},
	"Purchase Order":            {"owner_field": None, "display_fields": ["supplier_name", "grand_total"], "exclude_statuses": ["Completed", "Cancelled", "Closed", "Delivered"]},
	"Purchase Receipt":          {"owner_field": None, "display_fields": ["supplier_name"], "exclude_statuses": []},
	"Purchase Invoice":          {"owner_field": None, "display_fields": ["supplier_name", "grand_total"], "exclude_statuses": []},
	"Leave Application":         {"owner_field": "employee_user_id", "display_fields": ["employee_name", "leave_type"], "exclude_statuses": ["Approved", "Rejected", "Cancelled"]},
	"IB Overtime Request":       {"owner_field": "employee_user_id", "display_fields": ["employee_name", "status"], "exclude_statuses": ["Approved", "Rejected"]},
	"IB Full Final Settlement":  {"owner_field": "employee_user_id", "display_fields": ["employee_name", "status"], "exclude_statuses": ["Paid", "Cancelled"]},
	"Employee Exit Handover":    {"owner_field": "employee_user_id", "display_fields": ["employee_name", "status"], "exclude_statuses": []},
}


def _validate_doctype(doctype: str) -> dict:
	cfg = FOLLOW_UP_SOURCES.get(doctype)
	if not cfg:
		frappe.throw(_("{0} is not a supported document type for follow-ups").format(doctype))
	return cfg


def _assigned_names(doctype: str, user: str) -> set[str]:
	return set(frappe.get_all(
		"ToDo",
		filters={"reference_type": doctype, "allocated_to": user, "status": "Open"},
		pluck="reference_name",
	))


def _owner_field_names(doctype: str, cfg: dict, user: str) -> set[str]:
	owner_field = cfg.get("owner_field")
	if not owner_field:
		return set()
	if owner_field == "employee_user_id":
		employees = frappe.get_all("Employee", filters={"user_id": user}, pluck="name")
		if not employees:
			return set()
		return set(frappe.get_all(doctype, filters={"employee": ["in", employees]}, pluck="name"))
	return set(frappe.get_all(doctype, filters={owner_field: user}, pluck="name"))


def _my_document_names(doctype: str, cfg: dict, user: str) -> set[str]:
	owned = set(frappe.get_all(doctype, filters={"owner": user}, pluck="name"))
	return owned | _assigned_names(doctype, user) | _owner_field_names(doctype, cfg, user)


def _is_mine(doctype: str, docname: str, user: str) -> bool:
	cfg = _validate_doctype(doctype)
	return docname in _my_document_names(doctype, cfg, user)


@frappe.whitelist()
def get_my_documents(doctype: str) -> list[dict]:
	cfg = _validate_doctype(doctype)
	user = frappe.session.user
	names = _my_document_names(doctype, cfg, user)
	if not names:
		return []

	filters = {"name": ["in", list(names)]}
	if doctype in SUBMITTABLE_DOCTYPES:
		filters["docstatus"] = ["!=", 2]
	exclude_statuses = cfg.get("exclude_statuses") or []
	if exclude_statuses:
		filters["status"] = ["not in", exclude_statuses]

	fields = ["name", "modified"] + cfg["display_fields"]
	rows = frappe.get_all(doctype, filters=filters, fields=fields, order_by="modified desc")
	if not rows:
		return []

	names = [row.name for row in rows]
	latest = frappe.get_all(
		"IB Follow Up",
		filters={"reference_doctype": doctype, "reference_name": ["in", names]},
		fields=["reference_name", "next_follow_up_date", "creation"],
		order_by="creation desc",
	)
	latest_by_doc: dict[str, dict] = {}
	for row in latest:
		latest_by_doc.setdefault(row.reference_name, row)

	today_date = getdate(today())
	for row in rows:
		fu = latest_by_doc.get(row.name)
		if not fu:
			row["follow_up_status"] = "Never"
			row["last_follow_up"] = None
			row["next_follow_up_date"] = None
			row["days_overdue"] = None
			# never-followed docs are ranked by age — oldest first, most urgent
			row["_sort_key"] = (0, row.get("modified") and str(row["modified"]) or "")
		elif fu.next_follow_up_date and getdate(fu.next_follow_up_date) < today_date:
			row["follow_up_status"] = "Overdue"
			row["last_follow_up"] = fu.creation
			row["next_follow_up_date"] = fu.next_follow_up_date
			row["days_overdue"] = (today_date - getdate(fu.next_follow_up_date)).days
			row["_sort_key"] = (-2, -row["days_overdue"])
		else:
			row["follow_up_status"] = "Followed Up"
			row["last_follow_up"] = fu.creation
			row["next_follow_up_date"] = fu.next_follow_up_date
			row["days_overdue"] = None
			row["_sort_key"] = (1, str(fu.next_follow_up_date or ""))

	rows.sort(key=lambda r: r.pop("_sort_key"))
	return rows


@frappe.whitelist()
def get_follow_up_summary(doctype: str) -> dict:
	docs = get_my_documents(doctype)
	summary = {"total": len(docs), "followed_up": 0, "pending": 0, "overdue": 0}
	for d in docs:
		if d["follow_up_status"] == "Never":
			summary["pending"] += 1
		elif d["follow_up_status"] == "Overdue":
			summary["overdue"] += 1
		else:
			summary["followed_up"] += 1
	return summary


@frappe.whitelist()
def get_follow_up_history(reference_doctype: str, reference_name: str) -> list[dict]:
	"""Every past follow-up logged against one document, newest first — the
	log itself was already append-only and stored, it just had no read-back
	surface anywhere on the Follow-Ups page (only the single latest row was
	ever used, to compute status)."""
	if not _is_mine(reference_doctype, reference_name, frappe.session.user):
		frappe.throw(_("You can only view follow-ups against your own documents"))
	return frappe.get_all(
		"IB Follow Up",
		filters={"reference_doctype": reference_doctype, "reference_name": reference_name},
		fields=["name", "follow_up_type", "outcome", "notes", "next_follow_up_date", "owner", "creation"],
		order_by="creation desc",
	)


@frappe.whitelist()
def log_follow_up(
	reference_doctype: str,
	reference_name: str,
	follow_up_type: str,
	outcome: str,
	notes: str | None = None,
	next_follow_up_date: str | None = None,
) -> str:
	if not _is_mine(reference_doctype, reference_name, frappe.session.user):
		frappe.throw(_("You can only log follow-ups against your own documents"))

	doc = frappe.get_doc({
		"doctype": "IB Follow Up",
		"reference_doctype": reference_doctype,
		"reference_name": reference_name,
		"follow_up_type": follow_up_type,
		"outcome": outcome,
		"notes": notes,
		"next_follow_up_date": next_follow_up_date,
	})
	doc.insert()
	return doc.name
