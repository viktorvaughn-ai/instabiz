# Copyright (c) 2026, Instabiz Solutions India Pvt Ltd
# Licence: MIT

"""Employee Exit Handover — DocType controller."""

import frappe
from frappe import _
from frappe.model.document import Document
from instabiz.overrides.employee_exit import _notify_hr_managers
from collections import defaultdict


class EmployeeExitHandover(Document):

    @frappe.whitelist()
    def execute_reassignment(self):
        """
        Bulk-reassign all pending documents to their nominated replacements.

        Groups child rows by (doctype, owner_field, owner_value_from,
        display_name_field, reassign_to) and calls transfer_documents()
        once per group for a single batch SQL UPDATE per group.

        Returns {"reassigned": <int>} — count of documents updated.
        """
        if frappe.session.user != "Administrator" and not any(
            r in frappe.get_roles() for r in ("HR Manager", "System Manager")
        ):
            frappe.throw(_("Only HR Managers can execute reassignment."), frappe.PermissionError)

        if self.status == "Completed":
            frappe.throw(_("This handover is already completed."))

        # Every row must have a replacement user before we proceed
        missing = [row.document_name for row in self.items if not row.reassign_to]
        if missing:
            frappe.throw(
                _("{0} document(s) are missing a Reassign To value: {1}").format(
                    len(missing),
                    ", ".join(missing[:5]) + (" …" if len(missing) > 5 else ""),
                )
            )

        from instabiz.overrides.utils import transfer_documents

        # Group rows so each (doctype + owner config + target user) is one SQL call
        groups = defaultdict(list)
        for row in self.items:
            key = (
                row.document_type,
                row.owner_field,
                row.owner_value_from or "",
                row.display_name_field or "",
                row.reassign_to,
            )
            groups[key].append(row.document_name)

        total = 0
        for (doctype, owner_field, owner_value_from,
             display_name_field, to_user), names in groups.items():

            # Resolve the exact value to write into owner_field.
            # When owner_value_from is set (e.g. "first_name"), the field stores
            # a User attribute rather than the email — look it up from the new user.
            owner_set_value = (
                frappe.db.get_value("User", to_user, owner_value_from)
                if owner_value_from
                else None
            )

            total += transfer_documents(
                doctype            = doctype,
                owner_field        = owner_field,
                names              = names,
                to_user            = to_user,
                owner_set_value    = owner_set_value,
                display_name_field = display_name_field or None,
                handover_ref       = self.name,
            )

        self.db_set("status", "Completed")
        frappe.db.commit()

        # Notify HR Managers that reassignment is done
        _notify_hr_managers(
            frappe._dict(employee_name=self.employee_name, name=self.name),
            item_count = total,
            subject    = _("{0} — {1} document(s) reassigned successfully.").format(
                self.employee_name, total
            ),
        )

        return {"reassigned": total}
