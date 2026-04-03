import frappe
from frappe.model.document import Document


class TerritorySalesTeam(Document):
	def validate(self):
		self._validate_no_duplicate_members()

	def _validate_no_duplicate_members(self):
		seen = set()
		for row in self.members:
			if row.user in seen:
				frappe.throw(frappe._("Duplicate member {0} in team").format(row.user))
			seen.add(row.user)
