# Copyright (c) 2026, Instabiz Solutions India Pvt Ltd and Contributors
# See license.txt

import json

import frappe
from frappe import _
from frappe.model.document import Document

#: Keys understood by instabiz.overrides.autonomy's condition evaluators.
#: Kept deliberately small/flat — see the doctype's own field description.
ALLOWED_CONDITION_KEYS = {"max_qty", "max_amount", "customer_credit_ok"}


def validate_conditions_json(raw):
	"""Parse + sanity-check auto_approve_conditions. Returns the parsed dict
	(empty dict if blank). Throws a user-facing error on invalid JSON, a
	non-dict payload, or an unrecognised key — used by both the doctype's own
	validate() and the update_autonomy_setting() whitelisted method so both
	paths reject bad config the same way.
	"""
	if not raw or not str(raw).strip():
		return {}
	try:
		data = json.loads(raw)
	except (TypeError, ValueError):
		frappe.throw(_("Auto-Approve Conditions must be valid JSON."))
	if not isinstance(data, dict):
		frappe.throw(_("Auto-Approve Conditions must be a flat JSON object (e.g. {{\"max_amount\": 50000}})."))
	unknown = set(data.keys()) - ALLOWED_CONDITION_KEYS
	if unknown:
		frappe.throw(
			_("Unknown Auto-Approve Conditions key(s): {0}. Supported keys: {1}.").format(
				", ".join(sorted(unknown)), ", ".join(sorted(ALLOWED_CONDITION_KEYS))
			)
		)
	return data


class IBAutonomySetting(Document):
	def validate(self):
		# Throws on bad JSON / unknown keys; result intentionally discarded here
		# (autonomy.py re-parses at evaluation time) — this call exists purely
		# to reject bad config at save time instead of silently no-op'ing later.
		validate_conditions_json(self.auto_approve_conditions)
		if (self.max_auto_approvals_per_day or 0) < 0:
			frappe.throw(_("Max Auto-Approvals Per Day cannot be negative."))
