import frappe
from frappe.model.document import Document
from frappe.utils import date_diff, flt, getdate, today


class IBFullFinalSettlement(Document):
	def validate(self):
		if self.employee and not self.employee_name:
			self.employee_name = frappe.db.get_value("Employee", self.employee, "employee_name")
		self._compute_years_of_service()
		self._compute_gratuity()
		self._compute_leave_encashment()
		self._compute_total()

	def _compute_years_of_service(self):
		if self.date_of_joining and self.last_working_day:
			days = date_diff(self.last_working_day, self.date_of_joining)
			self.years_of_service = flt(days / 365, 2)

	def _compute_gratuity(self):
		# Gratuity = (Basic/26) * 15 * years_of_service (only if >= 5 years)
		yos = flt(self.years_of_service)
		basic = flt(self.basic_salary_monthly)
		if yos >= 5 and basic:
			self.gratuity_amount = flt((basic / 26) * 15 * yos, 2)
		else:
			self.gratuity_amount = 0

	def _compute_leave_encashment(self):
		# Leave encashment = (basic/26) * pending_leaves — if not manually set
		if not self.leave_encashment and self.pending_leaves and self.basic_salary_monthly:
			self.leave_encashment = flt((flt(self.basic_salary_monthly) / 26) * flt(self.pending_leaves), 2)

	def _compute_total(self):
		self.total_payable = flt(
			flt(self.leave_encashment)
			+ flt(self.gratuity_amount)
			+ flt(self.pending_expenses),
			2,
		)
