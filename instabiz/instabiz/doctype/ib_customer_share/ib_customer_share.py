import frappe
from frappe.model.document import Document


class IBCustomerShare(Document):
	def validate(self):
		if self.shared_with == frappe.db.get_value("Customer", self.customer, "custom_sales_person_user"):
			frappe.throw(frappe._("Cannot share with the customer's own assigned user."))
		# Dedup check
		exists = frappe.db.exists(
			"IB Customer Share",
			{"customer": self.customer, "shared_with": self.shared_with, "name": ["!=", self.name or ""]},
		)
		if exists:
			frappe.throw(frappe._("{0} is already shared with {1}.").format(self.customer, self.shared_with))
