# Copyright (c) 2026, Instabiz Solutions India Pvt Ltd and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase

from instabiz.instabiz.doctype.ib_insight.ib_insight import acknowledge_insight, get_insights


class TestIBInsight(FrappeTestCase):
	def _make_insight(self, **kwargs):
		doc = frappe.get_doc({
			"doctype": "IB Insight",
			"title": "Test Insight",
			"domain": "Sales",
			"owner_role": "Sales Manager",
			"severity": "Warning",
			"status": "Open",
			"narrative": "Test narrative.",
			**kwargs,
		})
		doc.insert(ignore_permissions=True)
		return doc

	def tearDown(self):
		frappe.db.rollback()

	def test_acknowledge_sets_fields(self):
		doc = self._make_insight()
		frappe.set_user("Administrator")
		result = acknowledge_insight(doc.name)
		doc.reload()
		self.assertEqual(doc.status, "Acknowledged")
		self.assertEqual(doc.acknowledged_by, "Administrator")
		self.assertIsNotNone(doc.acknowledged_at)
		self.assertEqual(result["status"], "Acknowledged")

	def test_get_insights_filters_by_domain(self):
		self._make_insight(title="Sales Insight A")
		self._make_insight(title="Finance Insight B", domain="Finance", owner_role="Accounts Manager")
		frappe.set_user("Administrator")
		rows = get_insights(domain="Sales")
		self.assertTrue(all(r["domain"] == "Sales" for r in rows))
