"""instabiz.overrides.reorder_alert

Daily scheduler: alert purchase team when bin qty falls to or below
reorder level. Uses Item Reorder (per-warehouse) level first, falls back
to Item.reorder_level. Deduplicates via [ib-reorder] marker — one alert
per item per warehouse per 7 days.
"""
import frappe
from frappe.utils import flt, add_days, nowdate

_MARKER       = "[ib-reorder]"
_COOLDOWN_DAYS = 7


def run_reorder_alert():
	overdue = frappe.db.sql(
		"""
		SELECT
			b.item_code, b.warehouse,
			b.actual_qty, b.reserved_qty,
			COALESCE(r.warehouse_reorder_level, i.reorder_level, 0) AS reorder_level,
			COALESCE(r.warehouse_reorder_qty,   0)                   AS reorder_qty,
			i.item_name, i.stock_uom
		FROM `tabBin` b
		INNER JOIN `tabItem` i ON i.name = b.item_code
		LEFT JOIN `tabItem Reorder` r
			ON r.parent = b.item_code AND r.warehouse = b.warehouse
		WHERE COALESCE(r.warehouse_reorder_level, i.reorder_level, 0) > 0
		  AND b.actual_qty <= COALESCE(r.warehouse_reorder_level, i.reorder_level, 0)
		  AND i.disabled = 0
		  AND i.is_stock_item = 1
		""",
		as_dict=True,
	)

	if not overdue:
		frappe.logger().info("[reorder_alert] no items below reorder level")
		return

	notify_users = frappe.db.sql_list(
		"""
		SELECT DISTINCT u.name
		FROM `tabUser` u
		INNER JOIN `tabHas Role` hr ON hr.parent = u.name
		WHERE hr.role IN ('Purchase Manager', 'System Manager', 'Purchase User')
		  AND u.enabled = 1
		  AND u.name != 'Administrator'
		"""
	)
	if not notify_users:
		frappe.logger().info("[reorder_alert] no purchase users to notify")
		return

	cooldown = add_days(nowdate(), -_COOLDOWN_DAYS)
	created  = 0

	for item in overdue:
		# Skip if already alerted for this item within cooldown window
		if frappe.db.exists("Notification Log", {
			"document_name": item.item_code,
			"subject": ["like", f"%{_MARKER}%{item.warehouse}%"],
			"creation": [">", cooldown],
		}):
			continue

		available = flt(item.actual_qty) - flt(item.reserved_qty)
		subject = (
			f"{_MARKER} Low stock: {item.item_code} at {item.warehouse} — "
			f"qty {flt(item.actual_qty):.2f} (avail {available:.2f}) ≤ "
			f"reorder {flt(item.reorder_level):.2f} {item.stock_uom}"
		)

		for user in notify_users:
			frappe.get_doc({
				"doctype":       "Notification Log",
				"subject":       subject,
				"for_user":      user,
				"from_user":     "Administrator",
				"type":          "Alert",
				"document_type": "Item",
				"document_name": item.item_code,
			}).insert(ignore_permissions=True)

		created += 1

	if created:
		frappe.db.commit()
	frappe.logger().info(f"[reorder_alert] {created} low-stock alerts sent")
