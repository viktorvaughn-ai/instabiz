import frappe
from frappe.model.document import Document
from frappe.utils import now


class IBWASession(Document):
	def on_update(self):
		if self.status == "Connected" and not self.last_connected_at:
			self.db_set("last_connected_at", now())
