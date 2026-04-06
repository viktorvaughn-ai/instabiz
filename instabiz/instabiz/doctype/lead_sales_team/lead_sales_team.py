import frappe
from frappe import _
from frappe.model.document import Document


class LeadSalesTeam(Document):
    def validate(self):
        self._validate_no_duplicate_members()
        self._validate_no_duplicate_territories()

    def _validate_no_duplicate_members(self):
        seen = set()
        for row in self.members:
            if row.user in seen:
                frappe.throw(_("Duplicate member {0} in team").format(row.user))
            seen.add(row.user)

    def _validate_no_duplicate_territories(self):
        seen = set()
        for row in self.territories:
            if row.territory in seen:
                frappe.throw(_("Duplicate territory {0} in team").format(row.territory))
            seen.add(row.territory)
