import frappe
from frappe.model.document import Document


class IBWATemplate(Document):
	def validate(self):
		if not self.message:
			frappe.throw("Message cannot be empty.")
		if not self.template_name:
			frappe.throw("Template Name cannot be empty.")
