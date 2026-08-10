# Copyright (c) 2026, Instabiz Solutions India Pvt Ltd and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase

from instabiz.instabiz.doctype.ib_autonomy_setting.ib_autonomy_setting import validate_conditions_json


class TestIBAutonomySetting(FrappeTestCase):
	def test_blank_conditions_ok(self):
		self.assertEqual(validate_conditions_json(""), {})
		self.assertEqual(validate_conditions_json(None), {})

	def test_valid_conditions_parsed(self):
		self.assertEqual(
			validate_conditions_json('{"max_amount": 50000, "customer_credit_ok": true}'),
			{"max_amount": 50000, "customer_credit_ok": True},
		)

	def test_invalid_json_throws(self):
		with self.assertRaises(frappe.ValidationError):
			validate_conditions_json("{not valid json")

	def test_non_dict_json_throws(self):
		with self.assertRaises(frappe.ValidationError):
			validate_conditions_json("[1, 2, 3]")

	def test_unknown_key_throws(self):
		with self.assertRaises(frappe.ValidationError):
			validate_conditions_json('{"max_amount": 50000, "explode_the_warehouse": true}')

	def test_enabled_defaults_off(self):
		"""Non-negotiable safety default — see IB Autonomy Setting.enabled field."""
		doc = frappe.new_doc("IB Autonomy Setting")
		self.assertEqual(doc.enabled, 0)

	def test_doc_validate_rejects_bad_conditions(self):
		doc = frappe.get_doc({
			"doctype": "IB Autonomy Setting",
			"action_type": "MRP Draft Material Request",
			"enabled": 0,
			"auto_approve_conditions": "{bad json",
		})
		with self.assertRaises(frappe.ValidationError):
			doc.run_method("validate")

	def test_doc_validate_accepts_good_conditions(self):
		doc = frappe.get_doc({
			"doctype": "IB Autonomy Setting",
			"action_type": "MRP Draft Material Request",
			"enabled": 0,
			"max_auto_approvals_per_day": 5,
			"auto_approve_conditions": '{"max_qty": 1000}',
		})
		doc.run_method("validate")  # should not throw

	def test_negative_cap_rejected(self):
		doc = frappe.get_doc({
			"doctype": "IB Autonomy Setting",
			"action_type": "CPQ Draft Quotation",
			"max_auto_approvals_per_day": -1,
		})
		with self.assertRaises(frappe.ValidationError):
			doc.run_method("validate")
