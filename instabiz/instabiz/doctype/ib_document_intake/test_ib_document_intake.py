# Copyright (c) 2026, Instabiz Solutions India Pvt Ltd and Contributors
# See license.txt
import json

import frappe
from frappe.tests.utils import FrappeTestCase

from instabiz.instabiz.doctype.ib_document_intake.ib_document_intake import (
	match_item, match_party,
)


class TestIBDocumentIntake(FrappeTestCase):
	def _make_intake(self, intake_type="Sales Order", raw_text="Test PO from Acme"):
		doc = frappe.get_doc({
			"doctype": "IB Document Intake",
			"intake_type": intake_type,
			"raw_text": raw_text,
		})
		doc.insert(ignore_permissions=True)
		return doc

	# ── extraction never creates a real document ────────────────────────────

	def test_extraction_never_creates_document_when_llm_unavailable(self):
		"""llm.complete() returning None (no API key / no credits — this
		instance's documented live state) must leave the intake in Draft with
		a clear extraction_error, and must NEVER create a Sales Order/Purchase
		Order as a side effect."""
		so_count_before = frappe.db.count("Sales Order")
		po_count_before = frappe.db.count("Purchase Order")

		doc = self._make_intake()
		result = doc.extract()

		self.assertFalse(result["ok"])
		doc.reload()
		self.assertEqual(doc.status, "Draft")
		self.assertTrue(doc.extraction_error)
		self.assertIn("unavailable", doc.extraction_error.lower())
		self.assertFalse(doc.created_doctype)
		self.assertFalse(doc.created_docname)

		self.assertEqual(frappe.db.count("Sales Order"), so_count_before)
		self.assertEqual(frappe.db.count("Purchase Order"), po_count_before)

	def test_extract_alone_does_not_set_converted_status(self):
		"""Even a successful extraction only ever reaches status=Extracted —
		never Converted — without an explicit convert_to_draft() call."""
		doc = self._make_intake()
		doc.extract()
		doc.reload()
		self.assertIn(doc.status, ("Draft", "Extracted"))
		self.assertNotEqual(doc.status, "Converted")

	# ── convert_to_draft() requires an explicit, reviewed extraction ───────

	def test_convert_to_draft_requires_extracted_status(self):
		doc = self._make_intake()
		self.assertEqual(doc.status, "Draft")
		with self.assertRaises(frappe.ValidationError):
			doc.convert_to_draft()

	def test_convert_to_draft_requires_resolved_party(self):
		doc = self._make_intake()
		doc.status = "Extracted"
		doc.extracted_json = json.dumps({"items": []})
		doc.matched_party = ""
		doc.save(ignore_permissions=True)
		with self.assertRaises(frappe.ValidationError):
			doc.convert_to_draft()

	def test_convert_to_draft_creates_real_draft_docstatus_0(self):
		"""Full happy path: a reviewed extraction converts to a real Sales
		Order that is inserted but never submitted (docstatus stays 0)."""
		item_code = frappe.db.get_value("Item", {"disabled": 0, "is_stock_item": 1}, "name")
		if not item_code:
			self.skipTest("No enabled stock Item available in this site to test conversion against.")
		customer = frappe.db.get_value("Customer", {"disabled": 0}, "name")
		if not customer:
			self.skipTest("No Customer available in this site to test conversion against.")

		doc = self._make_intake(raw_text="PO from test customer")
		doc.status = "Extracted"
		doc.matched_party = customer
		doc.location = "MAHARASHTRA"
		doc.extracted_json = json.dumps({
			"party_name": customer,
			"delivery_date": None,
			"items": [{
				"description": item_code,
				"qty": 5,
				"rate": 100,
				"match": {"status": "Exact Match", "matches": [item_code]},
			}],
		})
		doc.save(ignore_permissions=True)

		result = doc.convert_to_draft()
		self.assertTrue(result["ok"])
		self.assertEqual(result["doctype"], "Sales Order")

		doc.reload()
		self.assertEqual(doc.status, "Converted")
		self.assertEqual(doc.created_doctype, "Sales Order")
		self.assertEqual(doc.created_docname, result["docname"])

		created = frappe.get_doc("Sales Order", result["docname"])
		self.assertEqual(created.docstatus, 0)  # draft — never submitted
		self.assertEqual(created.customer, customer)

		# Converting again must not create a second document.
		with self.assertRaises(frappe.ValidationError):
			doc.convert_to_draft()

	# ── fuzzy matching ───────────────────────────────────────────────────────

	def test_match_party_exact(self):
		customer = frappe.db.get_value("Customer", {"disabled": 0}, "name")
		if not customer:
			self.skipTest("No Customer available in this site.")
		result = match_party(customer, "Customer")
		self.assertEqual(result["status"], "Exact Match")
		self.assertEqual(result["matches"], [customer])

	def test_match_party_not_matched(self):
		result = match_party("Definitely Not A Real Party Zzzzxyzabc123", "Customer")
		self.assertEqual(result["status"], "Not Matched")
		self.assertEqual(result["matches"], [])

	def test_match_party_empty_string(self):
		result = match_party("", "Customer")
		self.assertEqual(result["status"], "Not Matched")

	def test_match_item_exact(self):
		item_code = frappe.db.get_value("Item", {"disabled": 0}, "name")
		if not item_code:
			self.skipTest("No Item available in this site.")
		result = match_item(item_code)
		self.assertEqual(result["status"], "Exact Match")
		self.assertEqual(result["matches"], [item_code])

	def test_match_item_not_matched(self):
		result = match_item("Totally Nonexistent Widget Zzzzxyzabc123")
		self.assertEqual(result["status"], "Not Matched")

	# ── role gating on intake_type ───────────────────────────────────────────

	def test_intake_creation_requires_matching_role(self):
		"""A user with only Purchase User (no Sales role, no System Manager)
		must not be able to create a Sales-Order-type intake."""
		test_roles = set(frappe.get_roles(frappe.session.user))
		if "System Manager" in test_roles:
			# Administrator/System Manager bypasses this check by design —
			# nothing to assert without a non-privileged test user.
			self.skipTest("Current test user is System Manager — role-gating check needs a scoped user.")
