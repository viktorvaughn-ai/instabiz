import frappe
from frappe import _
from frappe.model.document import Document


# Cheque lifecycle: Pending -> Presented -> Cleared/Bounced; Cancelled from any
# non-terminal state; Bounced -> Pending (re-deposit). Cleared/Cancelled are
# terminal — nothing else on this doctype enforced that (no client JS exists,
# `status` is a plain Select field writable by every role with write access),
# so a user could jump straight to "Cleared" without ever presenting the
# cheque, or flip an already-Cleared/Cancelled record back to any other state.
_ALLOWED_TRANSITIONS = {
	"Pending":    {"Presented", "Cancelled"},
	"Presented":  {"Cleared", "Bounced", "Cancelled"},
	"Bounced":    {"Pending", "Cancelled"},
	"Cleared":    set(),
	"Cancelled":  set(),
}


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
		self._check_status_transition()

	def _check_status_transition(self):
		if self.is_new():
			return
		old_status = frappe.db.get_value("IB PDC", self.name, "status")
		if not old_status or old_status == self.status:
			return
		allowed = _ALLOWED_TRANSITIONS.get(old_status, set())
		if self.status not in allowed:
			frappe.throw(
				_("Cannot change PDC status from {0} to {1}. Allowed: {2}.").format(
					old_status, self.status, ", ".join(sorted(allowed)) or "none (final status)"
				)
			)
