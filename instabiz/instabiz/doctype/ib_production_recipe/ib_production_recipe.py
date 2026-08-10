import frappe
from frappe.model.document import Document


class IBProductionRecipe(Document):
	"""Flat single-level BOM row: finished_item consumes qty_per units of
	recipe_item (per 1 stock unit of finished_item). Deliberately NOT routed
	through ERPNext's native multi-level `BOM` doctype — MRP Phase 1 wants a
	lightweight flat table, exploded one level by instabiz.overrides.mrp.
	"""

	def validate(self):
		if not self.finished_item:
			frappe.throw("Finished Item is required.")
		if not self.recipe_item:
			frappe.throw("Recipe Item is required.")
		if self.finished_item == self.recipe_item:
			frappe.throw("Finished Item and Recipe Item cannot be the same item.")
		if not self.qty_per or self.qty_per <= 0:
			frappe.throw("Qty Per must be greater than 0.")

		# Composite dedup: only one recipe row per (finished_item, recipe_item)
		# pair. Frappe has no native unique-together constraint across two
		# Link fields, so enforce it here — mirrors IB Sales Target's
		# (sales_user, month) uniqueness pattern.
		existing = frappe.db.get_value(
			"IB Production Recipe",
			{
				"finished_item": self.finished_item,
				"recipe_item": self.recipe_item,
				"name": ["!=", self.name or ""],
			},
			"name",
		)
		if existing:
			frappe.throw(
				f"A recipe for {self.finished_item} → {self.recipe_item} "
				f"already exists ({existing})."
			)
