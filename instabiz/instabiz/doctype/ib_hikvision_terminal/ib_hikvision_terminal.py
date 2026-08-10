import secrets

import frappe
from frappe.model.document import Document


class IBHikvisionTerminal(Document):
	def before_insert(self):
		# Push-model webhook auth token (see hikvision.hikvision_webhook) — the
		# device has no Frappe login, and Hikvision push payloads carry no
		# HMAC/signature of their own, so a per-terminal shared secret in the
		# push target URL is the only lightweight authenticity check available
		# without a real device to test a stronger scheme against.
		if not self.webhook_secret:
			self.webhook_secret = secrets.token_urlsafe(24)
