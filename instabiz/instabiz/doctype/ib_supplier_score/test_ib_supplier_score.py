# Copyright (c) 2026, Instabiz Solutions India Pvt Ltd and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase

from instabiz.instabiz.doctype.ib_supplier_score.ib_supplier_score import rating_for_score


class TestIBSupplierScore(FrappeTestCase):
	def test_rating_bands(self):
		self.assertEqual(rating_for_score(100), "Excellent")
		self.assertEqual(rating_for_score(90), "Excellent")
		self.assertEqual(rating_for_score(89.99), "Good")
		self.assertEqual(rating_for_score(75), "Good")
		self.assertEqual(rating_for_score(74.99), "Fair")
		self.assertEqual(rating_for_score(60), "Fair")
		self.assertEqual(rating_for_score(59.99), "Poor")
		self.assertEqual(rating_for_score(0), "Poor")

	def test_overall_score_weighting(self):
		"""on_time*0.4 + quality*0.3 + fulfillment*0.3, computed in IBSupplierScore.validate()."""
		doc = frappe.get_doc({
			"doctype": "IB Supplier Score",
			"vendor": "_Test Supplier",
			"period_start": "2026-05-01",
			"period_end": "2026-08-01",
			"on_time_pct": 100,
			"quality_pct": 50,
			"fulfillment_pct": 0,
		})
		doc.run_method("validate")
		# 100*0.4 + 50*0.3 + 0*0.3 = 40 + 15 + 0 = 55
		self.assertEqual(doc.overall_score, 55)
		self.assertEqual(doc.rating, "Fair")
