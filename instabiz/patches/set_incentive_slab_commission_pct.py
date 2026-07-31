import frappe

# (from_pct, to_pct) -> commission_pct. to_pct=0 means open-ended (100%+).
RATES = {
	(0, 50): 0,
	(50, 75): 1,
	(75, 100): 1.5,
	(100, 0): 2,
}


def execute():
	for designation in ("Sales User", "Sales Manager"):
		for (from_pct, to_pct), commission_pct in RATES.items():
			name = frappe.db.get_value(
				"IB Incentive Slab",
				{"designation": designation, "from_pct": from_pct, "to_pct": to_pct},
			)
			if name:
				frappe.db.set_value("IB Incentive Slab", name, "commission_pct", commission_pct)
				continue

			# Sales Manager previously had no 100%+ tier — create it to mirror
			# Sales User's slab structure, per business decision that Sales
			# Manager incentive matches Sales User rates exactly.
			existing_count = frappe.db.count("IB Incentive Slab", {"designation": designation})
			frappe.get_doc({
				"doctype": "IB Incentive Slab",
				"designation": designation,
				"slab_label": f"Slab {existing_count + 1}",
				"from_pct": from_pct,
				"to_pct": to_pct,
				"commission_pct": commission_pct,
				"is_active": 1,
			}).insert(ignore_permissions=True)
