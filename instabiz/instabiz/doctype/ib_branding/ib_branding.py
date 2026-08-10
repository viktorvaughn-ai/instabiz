import frappe
from frappe.model.document import Document

class IBBranding(Document):
	def before_save(self):
		# before_save runs ahead of mandatory-field validation, so an unset
		# `branding` would previously crash with a raw AttributeError instead
		# of the normal "Branding is mandatory" message — guard it.
		if not self.branding:
			return
		self.branding = self.branding.upper()
		self.name = self.branding
