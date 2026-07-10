import frappe
from frappe.model.document import Document
from frappe.utils import today


class IBOvertimeRequest(Document):
	def validate(self):
		if not self.date:
			self.date = today()
		if self.employee and not self.employee_name:
			self.employee_name = frappe.db.get_value("Employee", self.employee, "employee_name")
		if not self.overtime_hours or self.overtime_hours <= 0:
			frappe.throw("Overtime hours must be greater than 0.")
