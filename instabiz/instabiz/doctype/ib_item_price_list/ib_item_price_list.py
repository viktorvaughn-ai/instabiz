import frappe
from frappe.model.document import Document
from frappe.utils import flt


class IBItemPriceList(Document):
	def validate(self):
		self.specification = _build_spec(self.item_code, self.uom)


def _build_spec(item_code, uom):
	if not item_code:
		return ""

	item = frappe.db.get_value(
		"Item",
		item_code,
		["stock_uom", "width_mm", "length_mtr", "custom_thickness", "color", "custom_liner", "custom_adhesive_type"],
		as_dict=True,
	)
	if not item:
		return ""

	effective_uom = uom or item.stock_uom or ""

	if effective_uom == "SQMT":
		parts = []
		w = _fmt_dim(item.width_mm)
		l = _fmt_dim(item.length_mtr)
		if w and l:
			parts.append(f"{w}mm × {l}mtr")
		if item.custom_thickness:
			parts.append(item.custom_thickness.strip())
		color = (item.color or "").strip()
		liner = (item.custom_liner or "").strip()
		if color and liner:
			parts.append(f"{color} with {liner}")
		elif color:
			parts.append(color)
		elif liner:
			parts.append(liner)
		return " | ".join(parts)

	if effective_uom == "PCS":
		return (item.color or "").strip()

	if effective_uom == "KG":
		return (item.custom_adhesive_type or "").strip()

	return ""


def _fmt_dim(val):
	if not val:
		return None
	f = flt(val)
	return str(int(f)) if f == int(f) else str(f)
