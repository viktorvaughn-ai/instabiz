import frappe
from frappe.model.document import Document
from frappe.utils import today


class IBABCClassification(Document):
	def validate(self):
		if not self.item_name and self.item:
			self.item_name = frappe.db.get_value("Item", self.item, "item_name")
		if not self.computed_on:
			self.computed_on = today()
