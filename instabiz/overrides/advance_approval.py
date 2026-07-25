"""instabiz.overrides.advance_approval

Gate: a Sales Order that has an advance payment collected while still Draft
(custom_advance_paid > 0, docstatus == 0) can't be submitted/confirmed until
the designated approver signs off. custom_advance_approval_status is set to
"Pending" automatically the first time an advance lands on a Draft SO (see
payment_entry.py._update_so_advance) and resolved here via set_advance_approval().

Orders where the advance is collected AFTER the SO is already submitted are
unaffected — the gate only applies pre-confirmation.
"""
import frappe
from frappe import _
from frappe.utils import flt, fmt_money

APPROVER_EMAIL = "idris@instabizsolutions.com"


def _is_advance_approver(user=None):
	user = user or frappe.session.user
	if user == APPROVER_EMAIL:
		return True
	return "System Manager" in frappe.get_roles(user)


def check_advance_approval(doc):
	"""Called from Sales Order.before_submit()."""
	if flt(doc.custom_advance_paid) > 0 and doc.custom_advance_approval_status != "Approved":
		frappe.throw(
			_("Cannot confirm this Sales Order: an advance payment of {0} was collected "
			  "but has not been approved yet. {1} must approve it first.").format(
				fmt_money(doc.custom_advance_paid, currency=doc.currency),
				APPROVER_EMAIL,
			)
		)


@frappe.whitelist()
def set_advance_approval(sales_order, status, remarks=None):
	"""Approve or reject the advance collected against a Draft Sales Order."""
	if status not in ("Approved", "Rejected"):
		frappe.throw(_("Status must be Approved or Rejected."))
	if not _is_advance_approver():
		frappe.throw(_("Only {0} can approve advance payments.").format(APPROVER_EMAIL))

	doc = frappe.get_doc("Sales Order", sales_order)
	if doc.docstatus != 0:
		frappe.throw(_("This Sales Order is no longer in Draft — nothing to approve."))
	if flt(doc.custom_advance_paid) <= 0:
		frappe.throw(_("No advance payment recorded against this order."))

	doc.db_set("custom_advance_approval_status", status, update_modified=False)
	doc.db_set("custom_advance_approval_remarks", remarks or "", update_modified=False)

	doc.add_comment(
		"Info",
		_("Advance payment {0} by {1}{2}").format(
			status, frappe.session.user, f" — {remarks}" if remarks else ""
		),
	)

	if doc.custom_sales_person_user:
		frappe.get_doc({
			"doctype":       "Notification Log",
			"subject":       f"[ib-advance-approval-{doc.name}] Advance {status.lower()} for {doc.name}"[:140],
			"email_content": _("Advance payment of {0} for {1} was {2} by {3}.{4}").format(
				fmt_money(doc.custom_advance_paid, currency=doc.currency),
				doc.name, status.lower(), frappe.session.user,
				f" Remarks: {remarks}" if remarks else "",
			),
			"for_user":      doc.custom_sales_person_user,
			"from_user":     frappe.session.user,
			"type":          "Alert",
			"document_type": "Sales Order",
			"document_name": doc.name,
		}).insert(ignore_permissions=True)

	return {"status": status}
