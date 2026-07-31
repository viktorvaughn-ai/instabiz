"""instabiz.overrides.payment_entry

before_submit → _auto_reconcile   (Receive, no refs → link open SIs FIFO)
on_submit     → _notify_accounts, _update_so_advance
on_cancel     → _update_so_advance
"""
import frappe
from frappe.utils import flt, fmt_money

_ACCOUNTS_ROLES = frozenset({"Accounts User", "Accounts Manager", "System Manager"})


def before_submit(doc, method=None):
	_auto_reconcile(doc)


def on_submit(doc, method=None):
	_notify_accounts(doc)
	_update_so_advance(doc)
	_update_customer_outstanding(doc)


def on_cancel(doc, method=None):
	_update_so_advance(doc)
	_update_customer_outstanding(doc)


def _auto_reconcile(doc):
	"""Auto-link PE to outstanding SIs (oldest-first) when references are empty."""
	if doc.payment_type != "Receive" or doc.party_type != "Customer":
		return
	if doc.references:
		return

	remaining = flt(doc.paid_amount)
	open_invoices = frappe.db.sql(
		"""
		SELECT name, outstanding_amount
		FROM `tabSales Invoice`
		WHERE customer = %s
		  AND docstatus = 1
		  AND outstanding_amount > 0
		ORDER BY posting_date ASC, name ASC
		""",
		doc.party,
		as_dict=True,
	)

	added = False
	for inv in open_invoices:
		if remaining <= 0:
			break
		allocated = min(remaining, flt(inv.outstanding_amount))
		doc.append("references", {
			"reference_doctype": "Sales Invoice",
			"reference_name":    inv.name,
			"allocated_amount":  allocated,
		})
		remaining -= allocated
		added = True

	if added:
		doc.set_amounts()

	if remaining > 0.01:
		frappe.msgprint(
			f"₹{remaining:,.2f} could not be matched to any outstanding invoice. "
			"This amount will remain unallocated — reconcile manually if needed.",
			title="Partial Allocation",
			indicator="orange",
		)


def _notify_accounts(doc):
	"""Bell notification to Accounts roles on PE submit (Receive and Pay)."""
	if doc.payment_type not in ("Receive", "Pay"):
		return

	marker = f"[ib-payment-{doc.name}]"
	users = frappe.db.sql(
		"""
		SELECT DISTINCT ur.parent
		FROM `tabHas Role` ur
		INNER JOIN `tabUser` u ON u.name = ur.parent
		WHERE ur.role IN %(roles)s
		  AND ur.parent != 'Administrator'
		  AND u.enabled = 1
		""",
		{"roles": list(_ACCOUNTS_ROLES)},
		pluck="parent",
	)
	if not users:
		return

	direction = "received from" if doc.payment_type == "Receive" else "paid to"
	currency  = doc.paid_to_account_currency or frappe.defaults.get_global_default("currency") or "INR"
	amt_fmt   = fmt_money(doc.paid_amount, currency=currency)
	subject   = f"{marker} Payment {doc.payment_type}: {doc.party} — {amt_fmt}"
	content   = (
		f"Payment {direction} <b>{doc.party}</b>. "
		f"Amount: {amt_fmt}. "
		f"Ref No: {doc.reference_no or '—'}. "
		f"Doc: {doc.name}."
	)

	for user in users:
		if frappe.db.exists("Notification Log", {"subject": subject[:140], "for_user": user}):
			continue
		frappe.get_doc({
			"doctype":       "Notification Log",
			"subject":       subject[:140],
			"email_content": content,
			"for_user":      user,
			"from_user":     "Administrator",
			"type":          "Alert",
			"document_type": "Payment Entry",
			"document_name": doc.name,
		}).insert(ignore_permissions=True)


def _update_customer_outstanding(doc):
	"""Refresh custom_outstanding_amount on the customer after PE submit/cancel.
	Also clears the overdue block flag if the customer now has no overdue invoices.
	"""
	if doc.party_type != "Customer" or not doc.party:
		return
	from instabiz.overrides.customer import refresh_customer_outstanding
	refresh_customer_outstanding(doc.party)
	_maybe_clear_overdue_block(doc.party)

def _maybe_clear_overdue_block(customer):
	"""Lift custom_overdue_block when no more overdue invoices exist for customer."""
	if not frappe.db.get_value("Customer", customer, "custom_overdue_block"):
		return
	from frappe.utils import today
	still_overdue = frappe.db.sql(
		"""
		SELECT COUNT(*) FROM `tabSales Invoice`
		WHERE customer = %s AND docstatus = 1
		  AND outstanding_amount > 0
		  AND due_date < %s
		""",
		(customer, today()),
	)[0][0]
	if not still_overdue:
		frappe.db.set_value("Customer", customer, "custom_overdue_block", 0, update_modified=False)
		frappe.logger().info(f"IB: overdue block cleared for {customer} — all dues paid")


def _update_so_advance(doc):
	"""Recompute custom_advance_paid on every Sales Order referenced by this PE."""
	so_names = {
		ref.reference_name
		for ref in doc.references
		if ref.reference_doctype == "Sales Order"
	}
	for so_name in so_names:
		# A Rejected advance is a deliberate decision that the current advance
		# no longer counts for this order — don't let an unrelated PE event
		# (submit/cancel of some other PE still referencing this SO) silently
		# recompute it back to a nonzero value. See set_advance_approval().
		if frappe.db.get_value("Sales Order", so_name, "custom_advance_approval_status") == "Rejected":
			continue
		total = frappe.db.sql(
			"""
			SELECT COALESCE(SUM(per.allocated_amount), 0)
			FROM `tabPayment Entry` pe
			INNER JOIN `tabPayment Entry Reference` per ON per.parent = pe.name
			WHERE per.reference_doctype = 'Sales Order'
			  AND per.reference_name    = %s
			  AND pe.payment_type       = 'Receive'
			  AND pe.docstatus          = 1
			""",
			so_name,
		)[0][0]
		frappe.db.set_value("Sales Order", so_name, "custom_advance_paid", flt(total))
		_maybe_flag_advance_pending(so_name, flt(total))
		# Dev-mode customer outstanding (Customer.custom_outstanding_amount) is
		# grand_total - custom_advance_paid — an advance landing changes it
		# just as much as the SO submit/cancel events that already refresh it.
		customer = frappe.db.get_value("Sales Order", so_name, "customer")
		if customer:
			from instabiz.overrides.customer import refresh_customer_outstanding
			refresh_customer_outstanding(customer)


def _maybe_flag_advance_pending(so_name, total_advance):
	"""First time an advance lands on a still-Draft SO, flag it Pending approval
	(see advance_approval.py). Only matters pre-confirmation — once the SO is
	submitted the gate no longer applies, so leave submitted orders untouched."""
	if total_advance <= 0:
		return
	row = frappe.db.get_value(
		"Sales Order", so_name,
		["docstatus", "custom_advance_approval_status", "customer_name", "currency"],
		as_dict=True,
	)
	if row and row.docstatus == 0 and not row.custom_advance_approval_status:
		frappe.db.set_value(
			"Sales Order", so_name, "custom_advance_approval_status", "Pending", update_modified=False
		)
		_notify_advance_approver(so_name, row.customer_name, total_advance, row.currency)


def _notify_advance_approver(so_name, customer_name, total_advance, currency):
	"""Ping the designated approver — without this, a Pending advance sits silent
	until someone happens to reopen that Draft SO; the approve/reject UI already
	existed but nothing ever told the approver there was something to act on."""
	from instabiz.overrides.advance_approval import APPROVER_EMAIL

	if not frappe.db.exists("User", APPROVER_EMAIL):
		return
	marker = f"[ib-advance-pending-{so_name}]"
	frappe.get_doc({
		"doctype":       "Notification Log",
		"subject":       f"Advance approval needed: {so_name} {marker}"[:140],
		"email_content": (
			f"An advance payment of {fmt_money(total_advance, currency=currency)} was collected against "
			f"Draft Sales Order {so_name} ({customer_name or ''}). It cannot be confirmed until you approve it."
		),
		"for_user":      APPROVER_EMAIL,
		"from_user":     "Administrator",
		"type":          "Alert",
		"document_type": "Sales Order",
		"document_name": so_name,
	}).insert(ignore_permissions=True)
