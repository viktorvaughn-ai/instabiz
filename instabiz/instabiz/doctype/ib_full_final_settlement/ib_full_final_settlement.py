import frappe
from frappe.model.document import Document
from frappe.utils import date_diff, flt, getdate, today

_LOCKED_STATUSES = {"Paid", "Cancelled"}
# Fields that actually affect the settlement amount or its underlying facts —
# not `notes` (harmless to keep editable) and not the auto-computed fields
# (years_of_service/gratuity_amount/total_payable), which only ever change
# as a downstream effect of one of these.
_GUARDED_FIELDS = (
	"employee", "last_working_day", "resignation_date", "status",
	"date_of_joining", "basic_salary_monthly", "notice_period_days",
	"notice_period_served", "pending_leaves", "leave_encashment", "pending_expenses",
)


class IBFullFinalSettlement(Document):
	def validate(self):
		if self.employee and not self.employee_name:
			self.employee_name = frappe.db.get_value("Employee", self.employee, "employee_name")
		self._compute_years_of_service()
		self._compute_gratuity()
		self._compute_leave_encashment()
		self._compute_total()
		self._guard_locked_edit()

	def _guard_locked_edit(self):
		# This doctype is not submittable (is_submittable=0), so nothing
		# previously stopped HR Manager/HR User from continuing to edit
		# settlement amounts (basic salary, pending leaves/expenses, leave
		# encashment override) on a record already marked Paid — i.e. after
		# the money has actually gone out the door — or Cancelled. Same
		# terminal-state class of bug already guarded against on IB Overtime
		# Request's status field (_guard_approval_change).
		if self.is_new():
			return
		before = self.get_doc_before_save()
		if not before or before.status not in _LOCKED_STATUSES:
			return
		if "System Manager" in frappe.get_roles(frappe.session.user):
			return
		if all(self.get(f) == before.get(f) for f in _GUARDED_FIELDS):
			return  # no-op resave (e.g. opening and saving with nothing changed)
		frappe.throw(
			frappe._(
				"This settlement is already {0} and its amounts can no longer be "
				"edited. Contact a System Manager if a genuine correction is needed."
			).format(before.status),
			frappe.PermissionError,
		)

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
		# Leave encashment = (basic/26) * pending_leaves — auto-filled as a
		# default only on creation, same "derive once, then respect
		# whatever's actually saved" pattern used elsewhere in this app (see
		# ib_transport.py's GSTIN->state sync). `not self.leave_encashment`
		# used to gate this on every save, not just creation — since a
		# Currency field's "not yet touched" and "deliberately set to 0"
		# states are indistinguishable, that silently overwrote a genuine ₹0
		# (e.g. leaves already encashed elsewhere) back to the formula value
		# on every subsequent save, with no way to make ₹0 stick.
		if self.is_new() and not self.leave_encashment and self.pending_leaves and self.basic_salary_monthly:
			self.leave_encashment = flt((flt(self.basic_salary_monthly) / 26) * flt(self.pending_leaves), 2)

	def _compute_total(self):
		self.total_payable = flt(
			flt(self.leave_encashment)
			+ flt(self.gratuity_amount)
			+ flt(self.pending_expenses),
			2,
		)
