import frappe
from frappe.model.document import Document


class IBCustomerAssignment(Document):
	def validate(self):
		if self.status == "Contacted":
			if not self.notes or not self.outcome:
				frappe.throw("Notes and Outcome are required when marking as Contacted.")
		if self.status in ("Contacted", "Order Placed", "Skipped", "Rolled Over"):
			if not self.completed_at:
				self.completed_at = frappe.utils.now()
