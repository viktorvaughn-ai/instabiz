"""instabiz.overrides.stock_events — publish realtime stock update events."""
import frappe


def publish_stock_update(doc, method=None):
	"""
	Fires on SO and DN on_submit / on_cancel.
	Publishes to the Bin doctype room so any open stock dashboard
	receives the event and live-refreshes.
	after_commit=True ensures the bin rows are already updated in DB
	before the client re-fetches.
	"""
	frappe.publish_realtime(
		"ib_stock_update",
		{},
		doctype="Bin",
		after_commit=True,
	)
