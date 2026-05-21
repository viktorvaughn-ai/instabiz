from hrms.payroll.doctype.salary_slip.salary_slip import SalarySlip

_MONTHLY_LEAVE_CREDIT = 2.0


class CustomSalarySlip(SalarySlip):
	def calculate_net_pay(self, skip_tax_breakup_computation: bool = False):
		if self.salary_structure == "IB Payroll":
			deducted = (self.leave_without_pay or 0) + (self.absent_days or 0)
			credit = min(_MONTHLY_LEAVE_CREDIT, deducted)
			if credit > 0:
				self.payment_days = (self.payment_days or 0) + credit
		super().calculate_net_pay(skip_tax_breakup_computation=skip_tax_breakup_computation)
