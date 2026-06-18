import frappe
from frappe import _
from frappe.model.document import Document


class IBOrderSheet(Document):
	def validate(self):
		if not self.items:
			self._pull_items_from_so()

	def _pull_items_from_so(self):
		if not self.sales_order:
			return
		so = frappe.get_doc("Sales Order", self.sales_order)
		for row in so.items:
			self.append("items", {
				"item_code": row.item_code,
				"item_name": row.item_name,
				"qty": row.qty,
				"uom": row.uom,
			})

	def before_cancel(self):
		active_wos = frappe.get_all(
			"IB Work Order",
			filters={"order_sheet": self.name, "status": "In Progress"},
			fields=["name"],
		)
		if active_wos:
			names = ", ".join(w.name for w in active_wos)
			frappe.throw(
				_("Cannot cancel: the following Work Orders are In Progress: {0}").format(names)
			)

		# Cancel all non-active WOs (Pending, On Hold, Completed) so nothing lingers
		orphaned = frappe.get_all(
			"IB Work Order",
			filters={"order_sheet": self.name, "status": ["in", ["Pending", "On Hold", "Completed"]]},
			fields=["name"],
		)
		for wo in orphaned:
			frappe.db.set_value("IB Work Order", wo.name, "status", "Cancelled")
