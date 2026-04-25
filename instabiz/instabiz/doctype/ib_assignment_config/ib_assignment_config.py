import frappe
from frappe.model.document import Document


class IBAssignmentConfig(Document):
	def validate(self):
		if self.assignments_per_day < 1:
			frappe.throw("Assignments Per Day must be at least 1.")
		if self.dormant_threshold_days < 1:
			frappe.throw("Dormant Threshold must be at least 1 day.")
		if not (0 <= self.dormant_ratio <= 100):
			frappe.throw("Dormant Mix Ratio must be between 0 and 100.")
