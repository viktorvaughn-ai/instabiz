import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import today, getdate

# Terminal statuses — no further transition allowed once here, same
# "final status" pattern as IB PDC's _ALLOWED_TRANSITIONS.
_TERMINAL_STATUSES = {"Returned", "Lost"}


class IBAssetLoan(Document):
	def validate(self):
		if self.employee and not self.employee_name:
			self.employee_name = frappe.db.get_value("Employee", self.employee, "employee_name")

		if self.expected_return_date and self.issue_date and \
				getdate(self.expected_return_date) < getdate(self.issue_date):
			frappe.throw(_("Expected Return Date cannot be before Issue Date."))

		self._check_not_already_out()
		# Guard must run BEFORE the auto-sync below — _sync_return_fields()
		# derives status from actual_return_date and would otherwise silently
		# flip an illegally-reopened terminal record back to its terminal
		# status (record stays correct, but the user gets no error explaining
		# why their edit didn't take effect). Checking the raw client-submitted
		# status first gives the same explicit-throw behavior IB PDC already has.
		self._guard_terminal_status()
		self._sync_return_fields()

	def _check_not_already_out(self):
		# Same asset_code can't be Issued/Overdue on two open records at once —
		# an issuer must mark the existing loan Returned/Lost before re-issuing
		# the same physical item to anyone (including the same employee again).
		if self.status not in ("Issued", "Overdue"):
			return
		clash = frappe.db.exists("IB Asset Loan", {
			"asset_code": self.asset_code,
			"status": ["in", ("Issued", "Overdue")],
			"name": ["!=", self.name or ""],
		})
		if clash:
			frappe.throw(
				_("Asset {0} is already out on loan ({1}) — mark it Returned or Lost before issuing it again.")
				.format(self.asset_code, clash)
			)

	def _sync_return_fields(self):
		# Setting an actual return date is what "returning" an asset means —
		# derive status from it rather than trusting two fields to agree.
		if self.actual_return_date and self.status not in _TERMINAL_STATUSES:
			self.status = "Returned"
		if self.status == "Returned" and not self.actual_return_date:
			self.actual_return_date = today()

	def _guard_terminal_status(self):
		if self.is_new():
			return
		before_status = frappe.db.get_value("IB Asset Loan", self.name, "status")
		if before_status in _TERMINAL_STATUSES and self.status != before_status:
			frappe.throw(
				_("This asset loan is already {0} and cannot be reopened. Create a new loan record instead.")
				.format(before_status)
			)


def get_permission_query_conditions(user=None):
	"""Employee role sees only loans against their own linked Employee record —
	HR Manager/HR User/System Manager see everything (their DocPerm rows have
	no such restriction, this only narrows the Employee role)."""
	user = user or frappe.session.user
	if {"HR Manager", "HR User", "System Manager"} & set(frappe.get_roles(user)):
		return ""
	employee = frappe.db.get_value("Employee", {"user_id": user}, "name")
	if not employee:
		return "1=0"
	return f"`tabIB Asset Loan`.employee = {frappe.db.escape(employee)}"
