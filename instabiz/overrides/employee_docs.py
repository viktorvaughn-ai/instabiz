import frappe
from frappe.utils import today, add_days, getdate, date_diff, escape_html

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
	"""Daily scheduler: alert HR when employee documents expire within 30 or 7 days.

	Uses a catch-up window (expiry_date between today and today+30), not an
	exact-date match — a document whose expiry falls exactly on the 30-day or
	7-day mark on a day the scheduler doesn't run (downtime, a row added/edited
	after that day already passed) would otherwise be silently skipped forever.
	Mirrors the tiered catch-up pattern already used by overdue_alert.py
	(age >= threshold, marker keyed by tier not by date) instead of the
	fragile `field = today()` pattern this codebase has been bitten by before
	(see run_exit_handover_daily's pre-2026-07-02 bug).
	"""
	frappe.only_for(["System Manager", "HR Manager"])
	hr_users = _hr_users()
	if not hr_users:
		return

	max_days = max(_ALERT_DAYS)
	window_end = add_days(today(), max_days)

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
		WHERE ed.expiry_date >= %(today)s
		  AND ed.expiry_date <= %(window_end)s
		  AND ed.document_type IN %(types)s
		  AND emp.status = 'Active'
		""",
		{"today": today(), "window_end": window_end, "types": list(_EXPIRY_DOC_TYPES)},
		as_dict=True,
	)

	for row in rows:
		days_left = date_diff(getdate(row.expiry_date), getdate(today()))
		# Fire the single most urgent tier this row currently qualifies for —
		# same "elif cascade, one alert per run" shape as overdue_alert.py.
		tier = None
		for threshold in sorted(_ALERT_DAYS):
			if days_left <= threshold:
				tier = threshold
				break
		if tier is None:
			continue

		marker = f"[ib-doc-expiry-{row.row_name}-{tier}]"

		for user in hr_users:
			already = frappe.db.exists("Notification Log", {
				"for_user": user,
				"subject": ["like", f"%{marker}%"],
			})
			if already:
				continue

			doc_num = f" ({escape_html(row.document_number)})" if row.document_number else ""
			base = (
				f"{escape_html(row.employee_name or '')} — {escape_html(row.document_type or '')}{doc_num} "
				f"expires in {days_left} day{'s' if days_left != 1 else ''} "
				f"({row.expiry_date})"
			)
			max_base = 140 - len(marker) - 1
			subject = f"{marker} {base[:max_base]}"
			frappe.get_doc({
				"doctype":    "Notification Log",
				"for_user":   user,
				"from_user":  "Administrator",
				"type":       "Alert",
				"document_type": "Employee",
				"document_name": row.employee,
				"subject":    subject,
			}).insert(ignore_permissions=True)

	frappe.db.commit()
