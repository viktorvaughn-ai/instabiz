"""instabiz.overrides.abc_analysis

Weekly scheduler: trailing-12-month ABC (Pareto) classification of items by
consumption value, from real Stock Ledger Entry data.

Consumption = outgoing stock movements (actual_qty < 0 -- deliveries/issues,
NOT incoming receipts), valued at each SLE's own stock_value_difference
(negative on an outgoing entry; consumption value = its absolute value).
is_cancelled entries are excluded. A single aggregating SQL query groups by
item_code -- Stock Ledger Entry is large in production ERPNext, so this is
deliberately not a Python loop over raw rows.

Classification: sort items descending by trailing-12-month consumption
value, then walk the sorted list accumulating a running cumulative % of the
grand total:
  - cumulative % <= 80        -> A
  - 80 < cumulative % <= 95    -> B
  - cumulative % > 95          -> C
(An item whose running total crosses a boundary is classified by its own
post-inclusion cumulative %, the standard ABC convention.)

One new IB ABC Classification row is inserted per item per run -- history is
intentionally never overwritten (that's the trend line). The latest
classification is also written onto Item.custom_abc_classification (a
Select custom field shipped via instabiz/fixtures/custom_field.json) via
frappe.db.set_value so it's visible directly on the Item form without
opening the ABC doctype. db.set_value is used deliberately instead of
doc.save() -- this is a bulk background field sync, not a user edit, and
should not re-run Item.validate()/before_save (which includes unrelated FG
batch-numbering logic in instabiz.overrides.item.set_batch_no_for_fg).

Whitelisted as run_abc_analysis() so it can also be triggered manually
(bench console, a future "Run Now" button) -- same function the scheduler calls.
"""
import frappe
from frappe.utils import add_months, flt, nowdate

_WINDOW_MONTHS = 12
_A_CUTOFF = 80
_B_CUTOFF = 95


def classify(cumulative_pct):
	"""Pure classification helper -- unit tested directly (no DB needed)."""
	if cumulative_pct <= _A_CUTOFF:
		return "A"
	if cumulative_pct <= _B_CUTOFF:
		return "B"
	return "C"


def _consumption_by_item(start, end):
	return frappe.db.sql(
		"""
		SELECT item_code,
		       SUM(-1 * stock_value_difference) AS consumption_value
		FROM `tabStock Ledger Entry`
		WHERE actual_qty < 0
		  AND is_cancelled = 0
		  AND posting_date BETWEEN %(start)s AND %(end)s
		GROUP BY item_code
		HAVING consumption_value > 0
		ORDER BY consumption_value DESC
		""",
		{"start": start, "end": end},
		as_dict=True,
	)


def run_abc_analysis():
	try:
		_run_abc_analysis()
	except Exception:
		frappe.log_error(
			title="abc_analysis: run failed",
			message=frappe.get_traceback(),
		)


def _run_abc_analysis():
	period_end = nowdate()
	period_start = add_months(period_end, -_WINDOW_MONTHS)

	rows = _consumption_by_item(period_start, period_end)
	if not rows:
		frappe.logger().info("[abc_analysis] no outgoing stock movement in window — nothing to classify")
		return

	total_value = flt(sum(flt(r.consumption_value) for r in rows))
	if total_value <= 0:
		frappe.logger().info("[abc_analysis] total consumption value is zero — nothing to classify")
		return

	computed_on = nowdate()
	created = 0
	errors = 0
	running = 0.0

	# Idempotent per calendar day: a re-run today (manual "Run Now" after the
	# scheduler already ran, or two manual runs) must not double up rows for
	# the same computed_on -- that breaks the report's "latest run" reading
	# (every item shown twice, totals doubled). History across *different*
	# days is untouched -- only today's own prior rows are replaced.
	frappe.db.delete("IB ABC Classification", {"computed_on": computed_on})

	for row in rows:
		item_code = row.item_code
		value = flt(row.consumption_value)
		running += value
		cumulative_pct = flt(running / total_value * 100, 4)
		item_pct = flt(value / total_value * 100, 4)
		classification = classify(cumulative_pct)

		save_point = f"abc_analysis_{item_code}".replace("-", "_").replace(" ", "_").replace(".", "_")
		try:
			frappe.db.savepoint(save_point)

			doc = frappe.get_doc({
				"doctype": "IB ABC Classification",
				"item": item_code,
				"classification": classification,
				"annual_consumption_value": value,
				"pct_of_total": item_pct,
				"computed_on": computed_on,
			})
			doc.insert(ignore_permissions=True)

			frappe.db.set_value(
				"Item", item_code, "custom_abc_classification", classification, update_modified=False
			)
			created += 1
		except Exception:
			errors += 1
			frappe.log_error(
				title=f"abc_analysis: failed for {item_code}",
				message=frappe.get_traceback(),
			)
			frappe.db.rollback(save_point=save_point)
			continue

	if created:
		frappe.db.commit()

	frappe.logger().info(
		f"[abc_analysis] {period_start} to {period_end}: "
		f"classified {created} items ({errors} errors), total consumption value {total_value:,.2f}"
	)


@frappe.whitelist()
def run_abc_analysis_manual():
	"""Manual trigger (console / future 'Run Now' button). Requires Stock Manager/System Manager."""
	if not ({"Stock Manager", "System Manager"} & set(frappe.get_roles(frappe.session.user))):
		frappe.throw(frappe._("Not permitted."), frappe.PermissionError)
	run_abc_analysis()
	return {"ok": True}
