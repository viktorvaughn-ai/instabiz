import frappe
from frappe.utils import today, add_days


_ALERT_DAYS = [15, 7, 1]
_OPEN_STATUSES = ["Open", "Replied"]


def run_quotation_expiry():
	_send_expiry_alerts()
	_auto_expire_quotations()


def _send_expiry_alerts():
	today_str = today()
	for days in _ALERT_DAYS:
		target_date = add_days(today_str, days)
		quotations = frappe.get_all(
			"Quotation",
			filters={
				"valid_till": target_date,
				"status": ["in", _OPEN_STATUSES],
				"docstatus": 1,
			},
			fields=["name", "customer_name", "valid_till", "grand_total", "custom_sales_person_user"],
		)
		for q in quotations:
			if not q.custom_sales_person_user:
				continue
			try:
				_send_expiry_alert_email(q, days)
			except Exception:
				frappe.log_error(f"IB Quotation expiry alert: {q.name}", frappe.get_traceback())


def _send_expiry_alert_email(q: dict, days_remaining: int) -> None:
	link = f'<a href="/app/quotation/{q.name}">{q.name}</a>'
	day_label = "day" if days_remaining == 1 else "days"
	message = f"""
<p>Quotation {link} for <strong>{q.customer_name}</strong> expires in
<strong>{days_remaining} {day_label}</strong> (on {q.valid_till}).</p>
<p>Grand Total: ₹{(q.grand_total or 0):,.2f}</p>
<p>Please follow up with the customer or extend the validity date.</p>
"""
	frappe.sendmail(
		recipients=[q.custom_sales_person_user],
		subject=f"[Instabiz] Quotation {q.name} expires in {days_remaining} {day_label}",
		message=message,
		now=True,
	)


def _auto_expire_quotations():
	today_str = today()
	overdue = frappe.get_all(
		"Quotation",
		filters={
			"valid_till": ["<", today_str],
			"status": ["in", _OPEN_STATUSES],
			"docstatus": 1,
		},
		fields=["name"],
	)
	for q in overdue:
		try:
			frappe.db.set_value("Quotation", q.name, "status", "Expired")
		except Exception:
			frappe.log_error(f"IB Auto-expire failed: {q.name}", frappe.get_traceback())
	if overdue:
		frappe.db.commit()
