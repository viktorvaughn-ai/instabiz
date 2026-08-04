"""instabiz.overrides.stock_events — publish realtime stock update events."""
import frappe


def publish_stock_update(doc, method=None):
	"""
	Fires on SO/DN/Stock Entry/Stock Reconciliation on_submit / on_cancel
	(see hooks.py doc_events for the full wiring).
	Publishes a realtime event so any open stock dashboard live-refreshes.

	Registers our own after-commit callback (instead of relying on
	frappe.publish_realtime's built-in after_commit=True path) so the
	actual redis emit is wrapped in try/except. frappe's after_commit
	callbacks are NOT exception-safe (CallbackManager.run() has no
	try/except of its own), and frappe.realtime.emit_via_redis only
	suppresses redis.exceptions.ConnectionError — any other redis/network
	failure at flush time would otherwise surface as an error on what is
	actually a successfully submitted/cancelled document. This keeps the
	event fire-and-forget end to end.
	"""
	def _emit():
		try:
			frappe.publish_realtime("ib_stock_update", {}, doctype="Bin")
		except Exception:
			frappe.log_error("IB Stock Realtime", frappe.get_traceback())

	frappe.db.after_commit.add(_emit)
