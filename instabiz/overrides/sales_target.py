import datetime
import calendar

import frappe
from frappe.utils import flt, getdate, nowdate


# ── Helpers ───────────────────────────────────────────────────────────────────

def _month_first(d=None):
	"""Return YYYY-MM-01 for the given date (or today)."""
	d = getdate(d or nowdate())
	return datetime.date(d.year, d.month, 1).strftime("%Y-%m-%d")


def _month_last(d=None):
	d = getdate(d or nowdate())
	last = calendar.monthrange(d.year, d.month)[1]
	return datetime.date(d.year, d.month, last).strftime("%Y-%m-%d")


def _month_days(d=None):
	d = getdate(d or nowdate())
	return calendar.monthrange(d.year, d.month)[1]


def _get_actuals(sales_user, month_first):
	"""Sum of submitted SO grand_total for the user in the given month."""
	month_last = _month_last(month_first)
	result = frappe.db.sql(
		"""
		SELECT COALESCE(SUM(grand_total), 0) AS total
		FROM `tabSales Order`
		WHERE docstatus = 1
		  AND custom_sales_person_user = %(user)s
		  AND transaction_date BETWEEN %(from_date)s AND %(to_date)s
		""",
		{"user": sales_user, "from_date": month_first, "to_date": month_last},
	)
	return flt(result[0][0]) if result else 0.0


def _get_target_doc(sales_user, month_first):
	return frappe.db.get_value(
		"IB Sales Target",
		{"sales_user": sales_user, "month": month_first},
		["name", "target_amount"],
		as_dict=True,
	)


# ── Whitelisted API ───────────────────────────────────────────────────────────

@frappe.whitelist()
def get_my_target(month=None):
	"""Return current user's target + actuals for the given month (defaults to this month)."""
	user = frappe.session.user
	mf = _month_first(month)
	doc = _get_target_doc(user, mf)
	target = flt(doc.target_amount) if doc else 0.0
	actual = _get_actuals(user, mf)
	pct = round(actual / target * 100) if target else 0
	return {
		"month": mf,
		"target": target,
		"actual": actual,
		"pct": min(pct, 100),
		"has_target": bool(doc),
	}


@frappe.whitelist()
def get_all_targets(month=None):
	"""Return all users' targets + actuals. Requires Sales Manager or System Manager."""
	_require_manager()
	mf = _month_first(month)

	docs = frappe.db.get_all(
		"IB Sales Target",
		filters={"month": mf},
		fields=["sales_user", "target_amount"],
	)
	result = []
	for d in docs:
		actual = _get_actuals(d.sales_user, mf)
		target = flt(d.target_amount)
		pct = round(actual / target * 100) if target else 0
		full_name = frappe.db.get_value("User", d.sales_user, "full_name") or d.sales_user
		result.append({
			"sales_user": d.sales_user,
			"full_name": full_name,
			"target": target,
			"actual": actual,
			"pct": min(pct, 100),
		})
	return result


def get_target_map(month_first):
	"""Return {sales_user: {target, actual, pct}} for embedding in roster."""
	docs = frappe.db.get_all(
		"IB Sales Target",
		filters={"month": month_first},
		fields=["sales_user", "target_amount"],
	)
	result = {}
	for d in docs:
		actual = _get_actuals(d.sales_user, month_first)
		target = flt(d.target_amount)
		pct = round(actual / target * 100) if target else 0
		result[d.sales_user] = {
			"target": target,
			"actual": actual,
			"pct": min(pct, 100),
		}
	return result


@frappe.whitelist()
def set_user_target(sales_user, month, target_amount):
	"""Create or update IB Sales Target for a user. Requires Sales Manager / System Manager."""
	_require_manager()
	mf = _month_first(month)
	target_amount = flt(target_amount)
	existing = _get_target_doc(sales_user, mf)
	if existing:
		frappe.db.set_value("IB Sales Target", existing.name, "target_amount", target_amount)
	else:
		doc = frappe.get_doc({
			"doctype": "IB Sales Target",
			"sales_user": sales_user,
			"month": mf,
			"target_amount": target_amount,
		})
		doc.insert(ignore_permissions=True)
	frappe.db.commit()
	actual = _get_actuals(sales_user, mf)
	pct = round(actual / target_amount * 100) if target_amount else 0
	return {"status": "ok", "target": target_amount, "actual": actual, "pct": min(pct, 100)}


def _require_manager():
	if not any(r in frappe.get_roles() for r in ["Sales Manager", "System Manager"]):
		frappe.throw("Not permitted", frappe.PermissionError)


# ── Scheduler ─────────────────────────────────────────────────────────────────

_MARKER_50 = "[ib-target-50]"
_MARKER_75 = "[ib-target-75]"
_MARKER_EOM = "[ib-target-eom]"


@frappe.whitelist()
def run_target_notifications():
	"""Daily check — send bell notifications for target milestones."""
	today = getdate(nowdate())
	mf = _month_first(today)
	total_days = _month_days(today)
	day_of_month = today.day
	last_day = calendar.monthrange(today.year, today.month)[1]

	elapsed_pct = day_of_month / total_days * 100

	docs = frappe.db.get_all(
		"IB Sales Target",
		filters={"month": mf},
		fields=["sales_user", "target_amount"],
	)

	sent = 0
	for d in docs:
		user = d.sales_user
		target = flt(d.target_amount)
		if not target:
			continue
		actual = _get_actuals(user, mf)
		achieved_pct = actual / target * 100

		if elapsed_pct >= 50 and achieved_pct < 50:
			sent += _notify_if_new(
				user, mf, _MARKER_50,
				f"Halfway through {_month_label(mf)}: {round(achieved_pct)}% of target reached",
				f"You have achieved ₹{_fmt(actual)} of your ₹{_fmt(target)} target. "
				f"Half the month is done — keep pushing!",
			)

		if elapsed_pct >= 75 and achieved_pct < 75:
			sent += _notify_if_new(
				user, mf, _MARKER_75,
				f"75% of {_month_label(mf)} elapsed: {round(achieved_pct)}% of target reached",
				f"Only {last_day - day_of_month + 1} days left. "
				f"Current: ₹{_fmt(actual)} / ₹{_fmt(target)}.",
			)

		if day_of_month == last_day and achieved_pct < 100:
			sent += _notify_if_new(
				user, mf, _MARKER_EOM,
				f"{_month_label(mf)} target not met: {round(achieved_pct)}%",
				f"Month ended. Final: ₹{_fmt(actual)} of ₹{_fmt(target)} target.",
			)

	frappe.db.commit()
	frappe.logger().info(f"[sales_target] sent {sent} notifications")


def _notify_if_new(user, month_first, marker, subject, body):
	if frappe.db.exists("Notification Log", {
		"for_user": user,
		"subject": ["like", f"%{marker}%"],
		"creation": [">=", month_first],
	}):
		return 0
	frappe.get_doc({
		"doctype": "Notification Log",
		"subject": f"{subject} {marker}",
		"email_content": body,
		"for_user": user,
		"type": "Alert",
		"document_type": "IB Sales Target",
		"document_name": "",
	}).insert(ignore_permissions=True)
	return 1


def _month_label(month_first):
	d = getdate(month_first)
	return d.strftime("%B %Y")


def _fmt(amount):
	return f"{flt(amount):,.0f}"
