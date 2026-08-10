# Copyright (c) 2026, Instabiz Solutions India Pvt Ltd and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase

from instabiz.instabiz.doctype.ib_kpi_snapshot.ib_kpi_snapshot import get_kpi_snapshots


class TestIBKPISnapshot(FrappeTestCase):
	def tearDown(self):
		frappe.db.rollback()

	def test_get_kpi_snapshots_filters_by_domain_and_metric(self):
		frappe.get_doc({
			"doctype": "IB KPI Snapshot",
			"domain": "Sales",
			"metric_name": "Revenue MTD",
			"period": "2026-08-10 09:00:00",
			"metric_value": 100000,
		}).insert(ignore_permissions=True)
		frappe.get_doc({
			"doctype": "IB KPI Snapshot",
			"domain": "Finance",
			"metric_name": "Outstanding AR",
			"period": "2026-08-10 09:00:00",
			"metric_value": 50000,
		}).insert(ignore_permissions=True)

		frappe.set_user("Administrator")
		rows = get_kpi_snapshots(domain="Sales")
		self.assertTrue(all(r["domain"] == "Sales" for r in rows))
		self.assertTrue(any(r["metric_name"] == "Revenue MTD" for r in rows))
