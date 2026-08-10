# Copyright (c) 2026, Instabiz Solutions India Pvt Ltd and Contributors
# See license.txt

from frappe.tests.utils import FrappeTestCase

from instabiz.overrides.abc_analysis import classify


class TestIBABCClassification(FrappeTestCase):
	def test_classify_a_band(self):
		self.assertEqual(classify(0), "A")
		self.assertEqual(classify(50), "A")
		self.assertEqual(classify(80), "A")

	def test_classify_b_band(self):
		self.assertEqual(classify(80.01), "B")
		self.assertEqual(classify(90), "B")
		self.assertEqual(classify(95), "B")

	def test_classify_c_band(self):
		self.assertEqual(classify(95.01), "C")
		self.assertEqual(classify(100), "C")

	def test_cumulative_classification_walk(self):
		"""Simulates the real run_abc_analysis() loop against a small, hand-computed
		consumption list to verify the running-cumulative-% classification logic end to end."""
		# Descending consumption values, total = 1000
		values = [500, 200, 150, 100, 30, 20]
		total = sum(values)
		running = 0
		classes = []
		for v in values:
			running += v
			cumulative_pct = running / total * 100
			classes.append(classify(cumulative_pct))
		# 500 -> 50% (A), 700 -> 70% (A), 850 -> 85% (B), 950 -> 95% (B), 980 -> 98% (C), 1000 -> 100% (C)
		self.assertEqual(classes, ["A", "A", "B", "B", "C", "C"])
