import frappe
from frappe import _
from frappe.utils import today, add_days, getdate

_HR_ROLES = {"System Manager", "HR Manager", "HR User"}

# Doc types that have an expiry date worth tracking
_EXPIRY_DOC_TYPES = {"Passport", "AADHAR CARD", "PANCARD", "Bank Passbook"}
_ALERT_DAYS = [30, 7]


def _hr_users():
	return frappe.db.sql_list(
		"""
		SELECT DISTINCT u.name FROM `tabUser` u
		JOIN `tabHas Role` r ON r.parent = u.name
		WHERE r.role IN %(roles)s AND u.enabled = 1 AND u.name != 'Guest'
		""",
		{"roles": list(_HR_ROLES)},
	)


@frappe.whitelist()
def run_employee_doc_expiry():
	"""Daily scheduler: alert HR when employee documents expire within 30 or 7 days."""
	hr_users = _hr_users()
	if not hr_users:
		return

	check_dates = {add_days(today(), d): d for d in _ALERT_DAYS}

	rows = frappe.db.sql(
		"""
		SELECT
			ed.name          AS row_name,
			ed.parent        AS employee,
			emp.employee_name,
			ed.document_type,
			ed.document_number,
			ed.expiry_date
		FROM `tabEmployee Document` ed
		JOIN `tabEmployee` emp ON emp.name = ed.parent
		WHERE ed.expiry_date IN %(dates)s
		  AND ed.document_type IN %(types)s
		  AND emp.status = 'Active'
		""",
		{"dates": list(check_dates.keys()), "types": list(_EXPIRY_DOC_TYPES)},
		as_dict=True,
	)

	for row in rows:
		days_left = check_dates[str(row.expiry_date)]
		marker = f"[ib-doc-expiry-{row.row_name}-{row.expiry_date}]"

		for user in hr_users:
			already = frappe.db.exists("Notification Log", {
				"for_user": user,
				"subject": ["like", f"%{marker}%"],
			})
			if already:
				continue

			doc_num = f" ({row.document_number})" if row.document_number else ""
			frappe.get_doc({
				"doctype":    "Notification Log",
				"for_user":   user,
				"type":       "Alert",
				"document_type": "Employee",
				"document_name": row.employee,
				"subject":    (
					f"{row.employee_name} — {row.document_type}{doc_num} "
					f"expires in {days_left} day{'s' if days_left != 1 else ''} "
					f"({row.expiry_date}) {marker}"
				),
			}).insert(ignore_permissions=True)

	frappe.db.commit()
