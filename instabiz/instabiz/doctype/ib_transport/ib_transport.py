import frappe
from frappe.model.document import Document

from instabiz.overrides.utils import territory_from_gstin


class IBTransport(Document):
    def before_save(self):
        # Only re-derive on create or when the GSTIN itself changes — otherwise
        # this silently overwrote any manual correction to custom_transport_state
        # on every unrelated save, contradicting the field's own "editable" label.
        if self.custom_transport_gst and (self.is_new() or self.has_value_changed("custom_transport_gst")):
            territory = territory_from_gstin(self.custom_transport_gst)
            if territory:
                self.custom_transport_state = territory
