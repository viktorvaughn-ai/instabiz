import frappe
from frappe.model.document import Document


class IBEscalationRule(Document):
	def validate(self):
		if self.ack_timeout_hours is not None and self.ack_timeout_hours <= 0:
			frappe.throw("Ack Timeout (Hours) must be greater than 0")
