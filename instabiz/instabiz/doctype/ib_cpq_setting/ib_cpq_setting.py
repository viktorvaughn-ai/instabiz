# Copyright (c) 2026, Instabiz Solutions India Pvt Ltd and Contributors
# See license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class IBCPQSetting(Document):
	def validate(self):
		if not self.item and not self.item_group:
			frappe.throw(_("Select either an Item or an Item Group"))
		for row in self.slabs:
			if flt(row.qty_to) and flt(row.qty_to) < flt(row.qty_from):
				frappe.throw(_("Row {0}: Qty To cannot be less than Qty From").format(row.idx))
			if not row.rate and not row.discount_pct:
				frappe.throw(_("Row {0}: Set either Rate or Discount %").format(row.idx))
