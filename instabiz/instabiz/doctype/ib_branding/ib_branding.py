import frappe
from frappe.model.document import Document

class IBBranding(Document):
	def before_save(self):
		self.branding = self.branding.upper()
		self.name = self.branding
