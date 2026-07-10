"""instabiz.overrides.customer_score — daily customer health score computation."""
import frappe
from frappe.utils import today, add_days


_WEIGHTS = {
	"payment":   0.35,
	"order":     0.30,
	"complaint": 0.20,
	"csat":      0.15,
}

_SCORE_DROP_ALERT_THRESHOLD = 15.0


def run_customer_score():
	customers = frappe.get_all(
		"Customer",
		filters={"disabled": 0},
		fields=["name", "customer_name", "custom_complaint_count"],
	)
	for c in customers:
		try:
			_compute_and_save(c)
		except Exception:
			frappe.log_error(f"IB Customer score: {c.name}"[:140], frappe.get_traceback())
	frappe.db.commit()


def _compute_and_save(customer: dict) -> None:
	today_str = today()

	# Skip if already computed today
	already_done = frappe.db.exists(
		"IB Customer Score",
		{"customer": customer.name, "score_date": today_str},
	)
	if already_done:
		return

	payment_score    = _payment_score(customer.name)
	order_score      = _order_score(customer.name)
	complaint_score  = _complaint_score(customer.get("custom_complaint_count") or 0)
	csat_score       = _csat_score(customer.name)

	total = (
		payment_score    * _WEIGHTS["payment"]
		+ order_score    * _WEIGHTS["order"]
		+ complaint_score * _WEIGHTS["complaint"]
		+ csat_score     * _WEIGHTS["csat"]
	)

	if total >= 70:
		health_status = "Green"
	elif total >= 40:
		health_status = "Amber"
	else:
		health_status = "Red"

	prev_record = frappe.db.get_value(
		"IB Customer Score",
		{"customer": customer.name},
		["name", "total_score"],
		order_by="score_date desc",
		as_dict=True,
	)
	previous_score = (prev_record.total_score if prev_record else None) or 0.0
	score_change   = round(total - previous_score, 1)

	frappe.get_doc({
		"doctype":         "IB Customer Score",
		"customer":        customer.name,
		"score_date":      today_str,
		"health_status":   health_status,
		"total_score":     round(total, 1),
		"previous_score":  round(previous_score, 1),
		"score_change":    score_change,
		"payment_score":   round(payment_score, 1),
		"order_score":     round(order_score, 1),
		"complaint_score": round(complaint_score, 1),
		"csat_score":      round(csat_score, 1),
	}).insert(ignore_permissions=True)

	if score_change <= -_SCORE_DROP_ALERT_THRESHOLD:
		_alert_score_drop(customer, round(total, 1), round(previous_score, 1), health_status)


def _payment_score(customer: str) -> float:
	rows = frappe.db.sql(
		"""
		SELECT
			si.due_date,
			COALESCE(MAX(pe.posting_date), CURDATE()) AS paid_on
		FROM `tabSales Invoice` si
		LEFT JOIN `tabPayment Entry Reference` per
			ON per.reference_name = si.name
			AND per.reference_doctype = 'Sales Invoice'
		LEFT JOIN `tabPayment Entry` pe
			ON pe.name = per.parent
			AND pe.docstatus = 1
		WHERE si.customer = %s
		  AND si.docstatus = 1
		  AND si.is_return = 0
		  AND si.status IN ('Paid', 'Overdue', 'Unpaid')
		  AND si.posting_date >= %s
		GROUP BY si.name, si.due_date
		""",
		(customer, add_days(today(), -365)),
		as_dict=True,
	)
	if not rows:
		return 60.0

	total_late = sum(max(0, (r.paid_on - r.due_date).days if r.paid_on and r.due_date and r.paid_on > r.due_date else 0) for r in rows)
	avg_late = total_late / len(rows)
	return min(100.0, max(0.0, 100.0 - avg_late * 5))


def _order_score(customer: str) -> float:
	count = frappe.db.count(
		"Sales Order",
		filters={
			"customer": customer,
			"docstatus": 1,
			"transaction_date": [">=", add_days(today(), -90)],
		},
	)
	return min(100.0, count * 20.0)


def _complaint_score(complaint_count: int) -> float:
	return max(0.0, 100.0 - complaint_count * 20.0)


def _csat_score(customer: str) -> float:
	result = frappe.db.sql(
		"""
		SELECT AVG(CAST(custom_csat_rating AS UNSIGNED)) AS avg_rating
		FROM `tabSales Invoice`
		WHERE customer = %s
		  AND docstatus = 1
		  AND is_return = 0
		  AND custom_csat_rating IS NOT NULL
		  AND custom_csat_rating != ''
		  AND posting_date >= %s
		""",
		(customer, add_days(today(), -365)),
	)
	avg = result[0][0] if result and result[0][0] else None
	if avg is None:
		return 60.0
	return min(100.0, max(0.0, (float(avg) - 1) / 4 * 100))


def _alert_score_drop(customer: dict, new_score: float, prev_score: float, status: str) -> None:
	managers = frappe.get_all(
		"Has Role",
		filters={"role": ["in", ["Sales Manager", "System Manager"]], "parenttype": "User"},
		pluck="parent",
	)
	recipients = list({m for m in managers if m and "@" in m})
	if not recipients:
		return

	drop = round(prev_score - new_score, 1)
	link = f'<a href="/app/customer/{customer.name}">{customer.get("customer_name") or customer.name}</a>'
	message = f"""
<p>Customer health score alert for {link}:</p>
<ul>
  <li>Previous score: {prev_score}</li>
  <li>New score: {new_score} ({status})</li>
  <li>Drop: {drop} points</li>
</ul>
<p>Review the customer's payment history, order activity, and complaints.</p>
"""
	frappe.sendmail(
		recipients=recipients,
		subject=f"[Instabiz] Health score dropped {drop} pts — {customer.get('customer_name') or customer.name}",
		message=message,
		now=True,
	)
