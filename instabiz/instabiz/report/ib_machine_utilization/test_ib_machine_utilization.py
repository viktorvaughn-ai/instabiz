# Copyright (c) 2026, Instabiz Solutions India Pvt Ltd and Contributors
# See license.txt

"""Tests for the pure OEE calc functions in instabiz.overrides.production
(compute_oee / _capacity_per_hour / _get_available_hours_per_day) — the same
functions both this report and the Production Dashboard's Machine-wise tab
call, so correctness here covers both surfaces. Modeled off
instabiz/instabiz/doctype/ib_supplier_score/test_ib_supplier_score.py — plain
values in, no fixtures/DB writes needed for the calc itself.
"""

from frappe.tests.utils import FrappeTestCase

from instabiz.overrides.production import (
	_capacity_per_hour,
	_get_available_hours_per_day,
	compute_oee,
)


class TestMachineUtilizationCalc(FrappeTestCase):
	# ---- _capacity_per_hour ------------------------------------------------

	def test_capacity_per_hour_blank_capacity_returns_none(self):
		"""Many real IB Machines have capacity/capacity_uom blank — must not crash
		or silently divide by zero; caller (compute_oee) must see None."""
		self.assertIsNone(_capacity_per_hour(None, None, 12))
		self.assertIsNone(_capacity_per_hour(0, "rolls/hour", 12))
		self.assertIsNone(_capacity_per_hour(1000, None, 12))

	def test_capacity_per_hour_already_per_hour_uom(self):
		self.assertEqual(_capacity_per_hour(1000, "rolls/hour", 12), 1000)
		self.assertEqual(_capacity_per_hour(3800, "sqm/hour", 12), 3800)

	def test_capacity_per_hour_ctn_per_shift_normalized(self):
		# 4000 ctn/shift over a 12h shift => ~333.33 ctn/hour.
		self.assertAlmostEqual(_capacity_per_hour(4000, "ctn/shift", 12), 4000 / 12, places=4)

	def test_capacity_per_hour_ctn_per_shift_zero_available_hours(self):
		self.assertIsNone(_capacity_per_hour(4000, "ctn/shift", 0))

	# ---- _get_available_hours_per_day --------------------------------------

	def test_available_hours_explicit_override(self):
		self.assertEqual(_get_available_hours_per_day(8), 8.0)
		self.assertEqual(_get_available_hours_per_day(24), 24.0)

	def test_available_hours_falls_back_to_real_shift_or_constant(self):
		# No override: reads the real "Factory Shift" Shift Type if present
		# (08:00-20:00 = 12h, confirmed live), else the documented 8.0
		# last-resort constant. Either is a valid positive number — this test
		# only asserts it never crashes and never returns a non-positive span.
		hours = _get_available_hours_per_day()
		self.assertGreater(hours, 0)

	# ---- compute_oee — Availability -----------------------------------------

	def test_availability_capped_at_100(self):
		result = compute_oee(
			run_hours=20, output_qty=0, avg_wastage_pct=0, wo_count=0,
			capacity=None, capacity_uom=None, available_hours=12,
		)
		self.assertEqual(result["availability_pct"], 100.0)

	def test_availability_normal_ratio(self):
		result = compute_oee(
			run_hours=6, output_qty=0, avg_wastage_pct=0, wo_count=0,
			capacity=None, capacity_uom=None, available_hours=12,
		)
		self.assertEqual(result["availability_pct"], 50.0)

	def test_availability_none_when_no_available_hours(self):
		result = compute_oee(
			run_hours=6, output_qty=0, avg_wastage_pct=0, wo_count=0,
			capacity=None, capacity_uom=None, available_hours=0,
		)
		self.assertIsNone(result["availability_pct"])

	# ---- compute_oee — Performance ------------------------------------------

	def test_performance_none_when_capacity_blank(self):
		"""Many real IB Machines have capacity blank — must read as 'no data',
		never a misleading 0% or 100%."""
		result = compute_oee(
			run_hours=4, output_qty=1000, avg_wastage_pct=0, wo_count=1,
			capacity=None, capacity_uom=None, available_hours=12,
		)
		self.assertIsNone(result["performance_pct"])

	def test_performance_none_when_run_hours_zero(self):
		result = compute_oee(
			run_hours=0, output_qty=1000, avg_wastage_pct=0, wo_count=1,
			capacity=1000, capacity_uom="rolls/hour", available_hours=12,
		)
		self.assertIsNone(result["performance_pct"])

	def test_performance_normal_ratio_and_cap(self):
		# capacity 1000 rolls/hour, actual output 2000 over 4h run => ideal
		# time = 2000/1000 = 2h; performance = 2/4 = 50%.
		result = compute_oee(
			run_hours=4, output_qty=2000, avg_wastage_pct=0, wo_count=1,
			capacity=1000, capacity_uom="rolls/hour", available_hours=12,
		)
		self.assertEqual(result["performance_pct"], 50.0)

		# Output achieved faster than rated capacity implies -> capped at 100,
		# not left at some nonsensical >100% reading.
		result_over = compute_oee(
			run_hours=1, output_qty=5000, avg_wastage_pct=0, wo_count=1,
			capacity=1000, capacity_uom="rolls/hour", available_hours=12,
		)
		self.assertEqual(result_over["performance_pct"], 100.0)

	# ---- compute_oee — Quality ------------------------------------------------

	def test_quality_none_when_wastage_never_recorded(self):
		"""wastage_pct is hardcoded 0.0 at WO creation and never written by any
		real completion path in this app (confirmed live, 2026-08-10: 0/34
		Completed WOs have nonzero wastage) — a 0.0 average must read as
		'not recorded', never a false 100% quality score."""
		result = compute_oee(
			run_hours=4, output_qty=1000, avg_wastage_pct=0, wo_count=5,
			capacity=None, capacity_uom=None, available_hours=12,
		)
		self.assertIsNone(result["quality_pct"])

	def test_quality_none_when_no_wos(self):
		result = compute_oee(
			run_hours=0, output_qty=0, avg_wastage_pct=0, wo_count=0,
			capacity=None, capacity_uom=None, available_hours=12,
		)
		self.assertIsNone(result["quality_pct"])

	def test_quality_computed_when_wastage_genuinely_recorded(self):
		result = compute_oee(
			run_hours=4, output_qty=1000, avg_wastage_pct=3.5, wo_count=5,
			capacity=None, capacity_uom=None, available_hours=12,
		)
		self.assertEqual(result["quality_pct"], 96.5)

	# ---- compute_oee — OEE composite ----------------------------------------

	def test_oee_none_when_any_leg_missing(self):
		"""Real 2026-08-10 data: every machine has capacity set but zero
		wastage ever recorded -> Quality is None -> OEE must be None too, not
		silently computed as Availability x Performance x (assumed 100%)."""
		result = compute_oee(
			run_hours=4, output_qty=1000, avg_wastage_pct=0, wo_count=5,
			capacity=1000, capacity_uom="rolls/hour", available_hours=12,
		)
		self.assertIsNotNone(result["availability_pct"])
		self.assertIsNotNone(result["performance_pct"])
		self.assertIsNone(result["quality_pct"])
		self.assertIsNone(result["oee_pct"])

	def test_oee_multiplies_all_three_legs_when_all_present(self):
		# Availability 50% (6/12), Performance: capacity 1000/h, output 2000
		# over 6h run => ideal 2h / 6h run = 33.3% -> 33.3, Quality 90%
		# (10% wastage). OEE = .5 * .333 * .9 = .15 -> 15.0%ish.
		result = compute_oee(
			run_hours=6, output_qty=2000, avg_wastage_pct=10, wo_count=3,
			capacity=1000, capacity_uom="rolls/hour", available_hours=12,
		)
		self.assertEqual(result["availability_pct"], 50.0)
		self.assertEqual(result["performance_pct"], 33.3)
		self.assertEqual(result["quality_pct"], 90.0)
		expected = round((50.0 / 100) * (33.3 / 100) * (90.0 / 100) * 100, 1)
		self.assertEqual(result["oee_pct"], expected)

	def test_oee_shape_always_has_all_keys(self):
		result = compute_oee(
			run_hours=0, output_qty=0, avg_wastage_pct=0, wo_count=0,
			capacity=None, capacity_uom=None, available_hours=12,
		)
		for key in ("run_hours", "available_hours", "availability_pct", "performance_pct", "quality_pct", "oee_pct"):
			self.assertIn(key, result)
