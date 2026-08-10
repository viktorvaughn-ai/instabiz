# Copyright (c) 2026, Instabiz Solutions India Pvt Ltd and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase


class TestIBEscalationRule(FrappeTestCase):
	def tearDown(self):
		frappe.db.rollback()

	def test_rejects_zero_timeout(self):
		doc = frappe.get_doc({
			"doctype": "IB Escalation Rule",
			"severity": "Critical",
			"ack_timeout_hours": 0,
			"escalate_to_role": "System Manager",
		})
		self.assertRaises(frappe.ValidationError, doc.insert, ignore_permissions=True)

	def test_valid_rule_saves(self):
		doc = frappe.get_doc({
			"doctype": "IB Escalation Rule",
			"severity": "Warning",
			"ack_timeout_hours": 4,
			"escalate_to_role": "System Manager",
		})
		doc.insert(ignore_permissions=True)
		self.assertTrue(doc.name)
