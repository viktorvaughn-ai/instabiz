import frappe
from frappe import _
from frappe.model.document import Document


class IBCustomerItemSpec(Document):
	def validate(self):
		existing = frappe.db.get_value(
			"IB Customer Item Spec",
			{"customer": self.customer, "item_code": self.item_code, "name": ("!=", self.name)},
			"name",
		)
		if existing:
			frappe.throw(
				_("Spec for {0} + {1} already exists: {2}").format(self.customer, self.item_code, existing),
				title=_("Duplicate Spec"),
			)
