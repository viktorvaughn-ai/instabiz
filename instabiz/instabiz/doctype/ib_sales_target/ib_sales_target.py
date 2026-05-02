import frappe
from frappe.model.document import Document


class IBSalesTarget(Document):
	def validate(self):
		# normalize month to first of month
		if self.month:
			import datetime
			d = frappe.utils.getdate(self.month)
			self.month = datetime.date(d.year, d.month, 1).strftime("%Y-%m-%d")

		# enforce uniqueness (sales_user, month)
		existing = frappe.db.get_value(
			"IB Sales Target",
			{"sales_user": self.sales_user, "month": self.month, "name": ["!=", self.name or ""]},
			"name",
		)
		if existing:
			frappe.throw(
				f"A target for {self.sales_user} in {frappe.utils.formatdate(self.month)} already exists ({existing})."
			)
