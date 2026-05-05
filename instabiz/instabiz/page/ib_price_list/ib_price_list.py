import re
import frappe
from frappe.utils import flt

_RATE_FIELDS = {"rate1", "rate2", "rate3", "rate4"}


def _parse_rate(val):
    """Parse currency value from Version data — Frappe stores as '₹ 13.00'."""
    if val is None:
        return 0.0
    cleaned = re.sub(r"[^\d.\-]", "", str(val))
    return flt(cleaned) if cleaned else 0.0


@frappe.whitelist()
def get_price_history(item_code):
	"""Return chronological rate-change log for an IB Item Price List record."""
	versions = frappe.db.get_all(
		"Version",
		filters={"ref_doctype": "IB Item Price List", "docname": item_code},
		fields=["creation", "owner", "data"],
		order_by="creation desc",
		limit=100,
	)
	history = []
	for v in versions:
		try:
			data = frappe.parse_json(v.data or "{}")
		except Exception:
			continue
		changed = [c for c in (data.get("changed") or []) if c[0] in _RATE_FIELDS]
		if not changed:
			continue
		history.append({
			"timestamp": str(v.creation),
			"user": v.owner,
			"changes": [[c[0], _parse_rate(c[1]), _parse_rate(c[2])] for c in changed],
		})
	return history


@frappe.whitelist()
def get_item_price_list():
	rows = frappe.db.sql(
		"""
		SELECT
			p.item_code, p.item_name, p.uom, p.rate1, p.rate2, p.rate3, p.rate4,
			i.stock_uom,
			i.width_mm, i.length_mtr,
			i.custom_thickness, i.color, i.custom_liner, i.custom_adhesive_type
		FROM `tabIB Item Price List` p
		LEFT JOIN tabItem i ON i.item_code = p.item_code
		ORDER BY p.item_name ASC
		""",
		as_dict=True,
	)

	for row in rows:
		w = _fmt_dim(row.width_mm)
		l = _fmt_dim(row.length_mtr)
		row["spec_width"]     = w or ""
		row["spec_length"]    = l or ""
		row["spec_dimension"] = f"{w}mm × {l}mtr" if (w and l) else ""
		row["spec_sqmt"]      = _fmt_qty(flt(w) / 1000 * flt(l)) if (w and l) else ""
		row["spec_thickness"] = (row.custom_thickness or "").strip()
		row["spec_color"]     = (row.color or "").strip()
		row["spec_liner"]     = (row.custom_liner or "").strip()
		row["spec_adhesive"]  = (row.custom_adhesive_type or "").strip()
		row["specification"]  = _build_spec(row)

	return rows


def _build_spec(row):
	uom = row.uom or row.stock_uom or ""

	if uom == "SQMT":
		parts = []
		w = _fmt_dim(row.width_mm)
		l = _fmt_dim(row.length_mtr)
		if w and l:
			parts.append(f"{w}mm × {l}mtr")
		if row.custom_thickness:
			parts.append(row.custom_thickness.strip())
		color = (row.color or "").strip()
		liner = (row.custom_liner or "").strip()
		if color and liner:
			parts.append(f"{color} with {liner}")
		elif color:
			parts.append(color)
		elif liner:
			parts.append(liner)
		return " | ".join(parts)

	if uom == "PCS":
		return (row.color or "").strip()

	if uom == "KG":
		return (row.custom_adhesive_type or "").strip()

	return ""


def _fmt_dim(val):
	if not val:
		return None
	f = flt(val)
	return str(int(f)) if f == int(f) else str(f)


def _fmt_qty(val):
	f = flt(val)
	if f == 0:
		return 0
	return int(f) if f == int(f) else round(f, 4)
