import frappe
from frappe.model.document import Document
from frappe.utils import flt

# Rating bands, derived from overall_score (see run_vendor_scorecard() in
# instabiz.overrides.vendor_scorecard for how overall_score is computed).
_RATING_BANDS = (
	(90, "Excellent"),
	(75, "Good"),
	(60, "Fair"),
)


def rating_for_score(score):
	score = flt(score)
	for threshold, label in _RATING_BANDS:
		if score >= threshold:
			return label
	return "Poor"


class IBSupplierScore(Document):
	def validate(self):
		if not self.vendor_name and self.vendor:
			self.vendor_name = frappe.db.get_value("Supplier", self.vendor, "supplier_name")
		self.overall_score = flt(
			flt(self.on_time_pct) * 0.4 + flt(self.quality_pct) * 0.3 + flt(self.fulfillment_pct) * 0.3,
			2,
		)
		self.rating = rating_for_score(self.overall_score)
