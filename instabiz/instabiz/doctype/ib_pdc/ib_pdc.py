import frappe
from frappe.model.document import Document


class IBPDC(Document):
	def validate(self):
		if not self.received_date:
			self.received_date = frappe.utils.today()
		if not self.sales_person_user:
			# auto-fill from linked invoice
			if self.sales_invoice:
				self.sales_person_user = frappe.db.get_value(
					"Sales Invoice", self.sales_invoice, "custom_sales_person_user"
				)
