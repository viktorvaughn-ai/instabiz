import re
import frappe
from frappe import _
from frappe.model.document import Document


class IBAgentDefinition(Document):
	def validate(self):
		if not re.match(r"^[a-z0-9_]+$", self.agent_code or ""):
			frappe.throw(_("Agent Code must be lowercase letters, digits, and underscores only"))
		# Warn if overwriting a built-in static agent code
		from instabiz.overrides.ai_agents import AGENT_FUNCS
		if self.agent_code in AGENT_FUNCS:
			frappe.msgprint(
				_(f"'{self.agent_code}' matches a built-in static agent. The dynamic definition will take precedence in the inbox but both will run in the scheduler."),
				alert=True,
			)
