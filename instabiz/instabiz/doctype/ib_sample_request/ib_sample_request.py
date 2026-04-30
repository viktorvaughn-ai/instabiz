# Copyright (c) 2026, Instabiz Solutions India Pvt Ltd
import frappe
from frappe.model.document import Document


class IBSampleRequest(Document):
	def validate(self):
		if not self.request_date:
			self.request_date = frappe.utils.today()
		if not self.assigned_to:
			self.assigned_to = frappe.session.user
