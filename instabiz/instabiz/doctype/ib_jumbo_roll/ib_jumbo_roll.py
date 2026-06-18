# Copyright (c) 2026, Instabiz Solutions India Pvt Ltd
import frappe
from frappe.model.document import Document


class IBJumboRoll(Document):
	def validate(self):
		if not self.received_date:
			self.received_date = frappe.utils.today()
		self._compute_sqm()

	def _compute_sqm(self):
		w = float(self.width_mm or 0)
		l = float(self.length_mtr or 0)
		self.sqm = round((w / 1000) * l, 4) if w and l else 0.0
