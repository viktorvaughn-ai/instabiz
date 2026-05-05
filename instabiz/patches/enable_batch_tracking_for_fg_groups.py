"""instabiz patch: enable has_batch_no=1 on Items in finished-goods item groups.

Target groups : BOPP, CLOTH, FOAM, SPECIALTY
Excluded groups: RM, PACKAGING (intentionally not touched)

Idempotent — safe to run multiple times.
"""
import frappe

_FG_GROUPS = ("BOPP", "CLOTH", "FOAM", "SPECIALTY")
_BATCH_SERIES = {
	"BOPP":      "BOPP-.YY.-.#####",
	"CLOTH":     "CLOTH-.YY.-.#####",
	"FOAM":      "FOAM-.YY.-.#####",
	"SPECIALTY": "SPEC-.YY.-.#####",
}


def execute():
	# Build SET clause for has_batch_no and batch_number_series per group
	for group in _FG_GROUPS:
		series = _BATCH_SERIES[group]
		frappe.db.sql(
			"""
			UPDATE `tabItem`
			SET
				has_batch_no = 1,
				batch_number_series = CASE
					WHEN (batch_number_series IS NULL OR batch_number_series = '')
					THEN %(series)s
					ELSE batch_number_series
				END,
				modified = NOW()
			WHERE item_group = %(group)s
			  AND disabled = 0
			  AND is_stock_item = 1
			  AND has_serial_no = 0
			""",
			{"group": group, "series": series},
		)
		count = frappe.db.sql(
			"SELECT COUNT(*) FROM `tabItem` WHERE item_group = %s AND has_batch_no = 1",
			group,
		)[0][0]
		frappe.logger().info(
			f"[batch_tracking] {group}: {count} items now have has_batch_no=1"
		)

	frappe.db.commit()
	frappe.logger().info("[batch_tracking] patch complete")
