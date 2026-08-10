import frappe
from frappe.model.document import Document
from frappe.utils import today

_APPROVER_ROLES = {"HR Manager", "HR User", "System Manager"}


class IBOvertimeRequest(Document):
	def validate(self):
		if not self.date:
			self.date = today()
		if self.employee and not self.employee_name:
			self.employee_name = frappe.db.get_value("Employee", self.employee, "employee_name")
		if not self.overtime_hours or self.overtime_hours <= 0:
			frappe.throw("Overtime hours must be greater than 0.")
		self._guard_approval_change()

	def _guard_approval_change(self):
		# The "Employee" role has doc-level write=1 on this doctype (needed for
		# self-service create/edit of their own request) and `status`/`approved_by`
		# are only client-side read_only — nothing server-side previously stopped
		# any employee from setting their own (or, before the if_owner fix, anyone
		# else's) request straight to "Approved" via the form or a direct API call.
		if self.status not in ("Approved", "Rejected"):
			return
		if _APPROVER_ROLES & set(frappe.get_roles(frappe.session.user)):
			return
		before = self.get_doc_before_save()
		if before and before.status == self.status:
			return  # no-op resave by someone who didn't touch status
		frappe.throw(
			frappe._("Only HR can approve or reject an overtime request."),
			frappe.PermissionError,
		)
