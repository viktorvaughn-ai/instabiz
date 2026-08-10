"""instabiz.overrides.vendor_scorecard

Daily scheduler: compute a trailing-90-day Vendor Scorecard (IB Supplier
Score) per vendor from real Purchase Order -> Purchase Receipt (GRN) data.

Window: [nowdate() - 90 days, nowdate()], scoped by Purchase Order.transaction_date
(i.e. POs *placed* in the trailing 90 days). Receipts against those POs are
pulled regardless of when they were posted, so a PO placed on day 1 of the
window that is still being received late in the window is still counted.

Metrics (per vendor, i.e. per Supplier):
  - On-Time %:  of Purchase Receipt Item lines linked to a window PO Item
                that has a schedule date (falls back to the PO-level
                schedule_date when the item-level one is blank), the % whose
                parent PR.posting_date is on-or-before that expected date.
  - Quality %:  SUM(accepted qty) / SUM(received qty) across those same PR
                lines. Purchase Receipt Item.qty is the accepted qty net of
                rejection in ERPNext's model; received_qty is the gross
                received qty (accepted + rejected).
  - Fulfillment %: SUM(PO Item.received_qty) / SUM(PO Item.qty) across every
                PO Item on a window PO for that vendor (received_qty is a
                running total ERPNext maintains on the PO Item itself, so
                this does not need a separate receipt join).
  - Overall = on_time_pct*0.4 + quality_pct*0.3 + fulfillment_pct*0.3
              (see IBSupplierScore.validate() in ib_supplier_score.py, which
              also derives the Excellent/Good/Fair/Poor rating band).

Vendors with zero submitted POs in the window are skipped entirely (nothing
to score). One new IB Supplier Score row is inserted per vendor per run —
history is intentionally never overwritten, so the doctype itself is the
trend line.

Whitelisted as run_vendor_scorecard() so it can also be triggered manually
(bench console, a future "Run Now" button) — same function the scheduler calls.
"""
import frappe
from frappe.utils import add_days, flt, nowdate

_WINDOW_DAYS = 90


def _fulfillment_by_vendor(start, end):
	rows = frappe.db.sql(
		"""
		SELECT po.supplier AS vendor,
		       SUM(poi.qty) AS po_qty_sum,
		       SUM(poi.received_qty) AS received_qty_sum
		FROM `tabPurchase Order Item` poi
		INNER JOIN `tabPurchase Order` po ON po.name = poi.parent
		WHERE po.docstatus = 1
		  AND po.transaction_date BETWEEN %(start)s AND %(end)s
		GROUP BY po.supplier
		""",
		{"start": start, "end": end},
		as_dict=True,
	)
	return {r.vendor: r for r in rows}


def _receipt_stats_by_vendor(start, end):
	rows = frappe.db.sql(
		"""
		SELECT po.supplier AS vendor,
		       SUM(CASE WHEN COALESCE(poi.schedule_date, po.schedule_date) IS NOT NULL
		                THEN 1 ELSE 0 END) AS ontime_eligible_lines,
		       SUM(CASE WHEN COALESCE(poi.schedule_date, po.schedule_date) IS NOT NULL
		                 AND pr.posting_date <= COALESCE(poi.schedule_date, po.schedule_date)
		                THEN 1 ELSE 0 END) AS ontime_lines,
		       SUM(pri.qty) AS accepted_qty_sum,
		       SUM(pri.received_qty) AS pri_received_qty_sum
		FROM `tabPurchase Receipt Item` pri
		INNER JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent AND pr.docstatus = 1
		INNER JOIN `tabPurchase Order Item` poi ON poi.name = pri.purchase_order_item
		INNER JOIN `tabPurchase Order` po ON po.name = poi.parent AND po.docstatus = 1
		WHERE po.transaction_date BETWEEN %(start)s AND %(end)s
		GROUP BY po.supplier
		""",
		{"start": start, "end": end},
		as_dict=True,
	)
	return {r.vendor: r for r in rows}


def run_vendor_scorecard():
	try:
		_run_vendor_scorecard()
	except Exception:
		frappe.log_error(
			title="vendor_scorecard: run failed",
			message=frappe.get_traceback(),
		)


def _run_vendor_scorecard():
	period_end = nowdate()
	period_start = add_days(period_end, -_WINDOW_DAYS)

	fulfillment_map = _fulfillment_by_vendor(period_start, period_end)
	receipt_map = _receipt_stats_by_vendor(period_start, period_end)

	# Vendor population = suppliers with >=1 submitted PO in the window.
	vendors = sorted(fulfillment_map.keys())
	if not vendors:
		frappe.logger().info("[vendor_scorecard] no vendors with POs in window — nothing to score")
		return

	# Idempotent per calendar day: a re-run today (manual "Run Now" after the
	# scheduler already ran, or two manual runs) must not double up rows for
	# the same period_end -- that breaks the report's "latest per vendor"
	# reading and inflates the history count. History across *different*
	# days is untouched -- only today's own prior rows are replaced.
	frappe.db.delete("IB Supplier Score", {"period_end": period_end})

	created = 0
	errors = 0
	for vendor in vendors:
		save_point = f"vendor_scorecard_{vendor}".replace("-", "_").replace(" ", "_")
		try:
			frappe.db.savepoint(save_point)

			fr = fulfillment_map.get(vendor)
			po_qty_sum = flt(fr.po_qty_sum) if fr else 0
			received_qty_sum = flt(fr.received_qty_sum) if fr else 0
			fulfillment_pct = min(flt(received_qty_sum / po_qty_sum * 100, 2), 100) if po_qty_sum else 0

			rc = receipt_map.get(vendor)
			if rc and flt(rc.ontime_eligible_lines):
				on_time_pct = flt(flt(rc.ontime_lines) / flt(rc.ontime_eligible_lines) * 100, 2)
			else:
				on_time_pct = 0

			if rc and flt(rc.pri_received_qty_sum):
				quality_pct = min(
					flt(flt(rc.accepted_qty_sum) / flt(rc.pri_received_qty_sum) * 100, 2), 100
				)
			else:
				quality_pct = 0

			doc = frappe.get_doc({
				"doctype": "IB Supplier Score",
				"vendor": vendor,
				"period_start": period_start,
				"period_end": period_end,
				"on_time_pct": on_time_pct,
				"quality_pct": quality_pct,
				"fulfillment_pct": fulfillment_pct,
			})
			doc.insert(ignore_permissions=True)
			created += 1
		except Exception:
			errors += 1
			frappe.log_error(
				title=f"vendor_scorecard: failed for {vendor}",
				message=frappe.get_traceback(),
			)
			frappe.db.rollback(save_point=save_point)
			continue

	if created:
		frappe.db.commit()

	frappe.logger().info(
		f"[vendor_scorecard] {period_start} to {period_end}: "
		f"scored {created} vendors, {errors} errors"
	)


@frappe.whitelist()
def run_vendor_scorecard_manual():
	"""Manual trigger (console / future 'Run Now' button). Requires Purchase Manager/System Manager."""
	if not ({"Purchase Manager", "System Manager"} & set(frappe.get_roles(frappe.session.user))):
		frappe.throw(frappe._("Not permitted."), frappe.PermissionError)
	run_vendor_scorecard()
	return {"ok": True}
