from __future__ import annotations

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import escape_html


class IBFollowUp(Document):
	def after_insert(self) -> None:
		note = escape_html(self.notes) if self.notes else ""
		text = _("Follow-up ({0}, {1}){2}").format(
			self.follow_up_type, self.outcome, f": {note}" if note else ""
		)
		frappe.get_doc({
			"doctype": "Comment",
			"comment_type": "Info",
			"reference_doctype": self.reference_doctype,
			"reference_name": self.reference_name,
			"content": text,
		}).insert(ignore_permissions=True)
