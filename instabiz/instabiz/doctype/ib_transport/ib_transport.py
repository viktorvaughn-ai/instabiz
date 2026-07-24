import frappe
from frappe.model.document import Document

from instabiz.overrides.utils import territory_from_gstin


class IBTransport(Document):
    def before_save(self):
        if self.custom_transport_gst:
            territory = territory_from_gstin(self.custom_transport_gst)
            if territory:
                self.custom_transport_state = territory
