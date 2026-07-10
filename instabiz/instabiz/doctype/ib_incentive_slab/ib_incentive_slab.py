import frappe
from frappe.model.document import Document


class IBIncentiveSlab(Document):
	pass


def seed_default_slabs():
	"""Seed 4 default slabs for Sales User and Sales Manager with 0% rates."""
	if frappe.db.count("IB Incentive Slab"):
		print("Slabs already exist, skipping.")
		return
	defaults = [
		{"slab_label": "Slab 1", "from_pct": 0,   "to_pct": 50,  "commission_pct": 0},
		{"slab_label": "Slab 2", "from_pct": 50,  "to_pct": 75,  "commission_pct": 0},
		{"slab_label": "Slab 3", "from_pct": 75,  "to_pct": 100, "commission_pct": 0},
		{"slab_label": "Slab 4", "from_pct": 100, "to_pct": 0,   "commission_pct": 0},
	]
	for desig in ("Sales User", "Sales Manager"):
		for s in defaults:
			doc = frappe.new_doc("IB Incentive Slab")
			doc.update({**s, "designation": desig, "is_active": 1})
			doc.insert(ignore_permissions=True)
	frappe.db.commit()
	print("Seeded 8 default incentive slabs.")
