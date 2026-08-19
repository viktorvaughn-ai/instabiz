from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import getdate, today

# ── Registry: which doctypes participate, and how "my documents" resolves ─────
# owner_field:
#   None                -> only doc.owner / ToDo assignment count
#   "employee_user_id"  -> resolved via this doc's own `employee` link -> Employee.user_id
#   <field name>         -> that field directly holds the responsible user's email

FOLLOW_UP_SOURCES = {
	"Quotation":                {"owner_field": "custom_sales_person_user", "display_fields": ["party_name", "grand_total"]},
	"Sales Order":               {"owner_field": "custom_sales_person_user", "display_fields": ["customer_name", "grand_total"]},
	"Delivery Note":             {"owner_field": "custom_sales_person_user", "display_fields": ["customer_name"]},
	"Sales Invoice":             {"owner_field": "custom_sales_person_user", "display_fields": ["customer_name", "grand_total"]},
	"Purchase Order":            {"owner_field": None, "display_fields": ["supplier_name", "grand_total"]},
	"Purchase Receipt":          {"owner_field": None, "display_fields": ["supplier_name"]},
	"Purchase Invoice":          {"owner_field": None, "display_fields": ["supplier_name", "grand_total"]},
	"Leave Application":         {"owner_field": "employee_user_id", "display_fields": ["employee_name", "leave_type"]},
	"IB Overtime Request":       {"owner_field": "employee_user_id", "display_fields": ["employee_name", "status"]},
	"IB Full Final Settlement":  {"owner_field": "employee_user_id", "display_fields": ["employee_name", "status"]},
	"Employee Exit Handover":    {"owner_field": "employee_user_id", "display_fields": ["employee_name", "status"]},
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

	fields = ["name"] + cfg["display_fields"]
	rows = frappe.get_all(doctype, filters={"name": ["in", list(names)]}, fields=fields, order_by="modified desc")

	latest = frappe.get_all(
		"IB Follow Up",
		filters={"reference_doctype": doctype, "reference_name": ["in", list(names)]},
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
		elif fu.next_follow_up_date and getdate(fu.next_follow_up_date) < today_date:
			row["follow_up_status"] = "Overdue"
			row["last_follow_up"] = fu.creation
		else:
			row["follow_up_status"] = "Followed Up"
			row["last_follow_up"] = fu.creation
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
