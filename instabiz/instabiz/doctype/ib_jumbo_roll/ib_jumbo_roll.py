# Copyright (c) 2026, Instabiz Solutions India Pvt Ltd
import frappe
from frappe.model.document import Document


class IBJumboRoll(Document):
	def validate(self):
		if not self.received_date:
			self.received_date = frappe.utils.today()
