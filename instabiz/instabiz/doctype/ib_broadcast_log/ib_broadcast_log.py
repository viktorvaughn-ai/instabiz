import frappe
from frappe.model.document import Document


class IBBroadcastLog(Document):
	def before_insert(self):
		if not self.sent_at:
			self.sent_at = frappe.utils.now_datetime()
		if not self.sent_by:
			self.sent_by = frappe.session.user
