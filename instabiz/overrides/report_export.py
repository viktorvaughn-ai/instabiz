"""instabiz.overrides.report_export

Global "select rows on any Script Report → export as a real branded PDF"
feature (2026-08-30, user request — explicitly not Frappe's generic report
PDF dump). Frontend wiring lives in instabiz/public/js/report_export.js
(monkey-patches frappe.views.QueryReport to add a checkbox column + an
"Export Selected" button to every report page, native or custom, without
editing core). This module renders the actual PDF: one shared, deliberately
designed HTML template (letterhead, title, applied-filter summary, a proper
formatted table, a totals row for numeric columns, page-numbered footer) —
built once, reused by every report, since most reports here (aggregates
like Party Outstanding Summary / Customer Ledger Summary) have no single
underlying document a doctype print format could bind to.
"""
import json

import frappe
from frappe import _
from frappe.utils import cint, flt, fmt_money, format_datetime, formatdate, get_datetime

_NUMERIC_TYPES = {"Currency", "Float", "Percent"}
_INT_TYPES = {"Int", "Check"}
_DATE_TYPES = {"Date"}
_DATETIME_TYPES = {"Datetime"}


@frappe.whitelist()
def export_selected_rows_pdf(report_name, columns, rows, filters=None):
	columns = json.loads(columns) if isinstance(columns, str) else columns
	rows = json.loads(rows) if isinstance(rows, str) else rows
	filters = (json.loads(filters) if isinstance(filters, str) else filters) or {}

	if not columns or not rows:
		frappe.throw(_("No rows selected."))

	html = _build_html(report_name, columns, rows, filters)
	pdf = frappe.utils.pdf.get_pdf(html, {
		"page-size": "A4",
		"orientation": "Landscape" if len(columns) > 6 else "Portrait",
		"margin-top": "10mm",
		"margin-bottom": "16mm",
		"margin-left": "10mm",
		"margin-right": "10mm",
		"footer-center": "Page [page] of [topage]",
		"footer-font-size": "8",
		"footer-font-name": "Arial",
		"footer-spacing": "5",
	})

	fname = frappe.scrub(report_name).replace("_", "-")
	frappe.local.response.filename = f"{fname}-{frappe.utils.today()}.pdf"
	frappe.local.response.filecontent = pdf
	frappe.local.response.type = "pdf"


def _fmt_cell(value, fieldtype):
	if value in (None, ""):
		return ""
	if fieldtype in _NUMERIC_TYPES:
		return fmt_money(flt(value), precision=2)
	if fieldtype in _INT_TYPES:
		return "{:,}".format(cint(value))
	if fieldtype in _DATE_TYPES:
		try:
			return formatdate(value, "dd-MMM-yyyy")
		except Exception:
			return frappe.utils.escape_html(str(value))
	if fieldtype in _DATETIME_TYPES:
		try:
			return format_datetime(get_datetime(value), "dd-MMM-yyyy HH:mm")
		except Exception:
			return frappe.utils.escape_html(str(value))
	return frappe.utils.escape_html(str(value))


def _filters_line(filters):
	parts = []
	for k, v in filters.items():
		if v in (None, "", []):
			continue
		label = frappe.unscrub(k)
		val = ", ".join(str(x) for x in v) if isinstance(v, list) else str(v)
		parts.append(f"{frappe.utils.escape_html(label)}: <strong>{frappe.utils.escape_html(val)}</strong>")
	return " &nbsp;·&nbsp; ".join(parts)


def _build_html(report_name, columns, rows, filters):
	co_name = frappe.db.get_single_value("Global Defaults", "default_company")
	company = frappe.db.get_value(
		"Company", co_name, ["company_name", "phone_no", "email"], as_dict=True
	) if co_name else None

	header_cells = "".join(f"<th>{frappe.utils.escape_html(c.get('label') or c.get('fieldname'))}</th>" for c in columns)

	body_rows = []
	totals = {c["fieldname"]: 0.0 for c in columns if c.get("fieldtype") in _NUMERIC_TYPES | _INT_TYPES}
	for row in rows:
		cells = []
		for c in columns:
			fn = c.get("fieldname")
			ft = c.get("fieldtype") or "Data"
			raw = row.get(fn)
			if fn in totals and raw not in (None, ""):
				totals[fn] += flt(raw)
			align = "right" if ft in _NUMERIC_TYPES | _INT_TYPES else "left"
			cells.append(f'<td class="{align}">{_fmt_cell(raw, ft)}</td>')
		body_rows.append(f"<tr>{''.join(cells)}</tr>")

	totals_row = ""
	if totals:
		cells = []
		first = True
		for c in columns:
			fn = c.get("fieldname")
			if first:
				cells.append('<td class="total-label">Total</td>')
				first = False
			elif fn in totals:
				ft = c.get("fieldtype")
				cells.append(f'<td class="right total-val">{_fmt_cell(totals[fn], ft)}</td>')
			else:
				cells.append("<td></td>")
		totals_row = f'<tr class="totals">{"".join(cells)}</tr>'

	filters_line = _filters_line(filters)
	generated_by = frappe.utils.escape_html(frappe.session.user)
	generated_at = format_datetime(frappe.utils.now_datetime(), "dd-MMM-yyyy HH:mm")

	return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
	@font-face {{
		font-family: "Inter";
		src: url("/assets/instabiz/fonts/InterVariable.woff2") format("woff2");
		font-weight: 100 900; font-style: normal; font-display: swap;
	}}
	* {{ box-sizing: border-box; margin: 0; padding: 0; }}
	body {{ font-family: "Inter", Arial, sans-serif; font-size: 10.5px; color: #1a1a1a; }}
	.letterhead img {{ width: 100%; height: auto; max-height: 100px; object-fit: contain; display: block; margin-bottom: 6px; }}
	.ib-rule {{ border-top: 2.5px solid #d97757; margin-bottom: 12px; }}
	.title-row {{ display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }}
	.title {{ font-size: 16px; font-weight: 700; color: #1a1a1a; }}
	.co-name {{ font-size: 10px; color: #666; }}
	.meta {{ font-size: 9px; color: #666; margin-bottom: 10px; }}
	.filters {{ font-size: 9px; color: #444; background: #fdf1ec; border: 1px solid #f2d9cd; border-radius: 4px;
		padding: 5px 8px; margin-bottom: 12px; }}
	table.data {{ width: 100%; border-collapse: collapse; }}
	table.data th {{ background: #d97757; color: #fff; text-align: left; font-size: 9.5px; font-weight: 700;
		text-transform: uppercase; letter-spacing: .02em; padding: 6px 7px; }}
	table.data td {{ padding: 5px 7px; border-bottom: 1px solid #eee; font-size: 10px; }}
	table.data tr:nth-child(even) td {{ background: #fafafa; }}
	table.data td.right {{ text-align: right; font-variant-numeric: tabular-nums; }}
	tr.totals td {{ border-top: 2px solid #d97757; border-bottom: none; font-weight: 700; background: #fff !important; }}
	td.total-label {{ color: #d97757; text-transform: uppercase; font-size: 9px; letter-spacing: .04em; }}
	.footnote {{ margin-top: 14px; font-size: 8.5px; color: #999; }}
</style></head>
<body>
	<div class="letterhead"><img src="/files/Instabiz_LH_v2.png"></div>
	<div class="ib-rule"></div>
	<div class="title-row">
		<span class="title">{frappe.utils.escape_html(report_name)}</span>
		<span class="co-name">{frappe.utils.escape_html(company.company_name) if company else ""}</span>
	</div>
	<div class="meta">Generated by {generated_by} on {generated_at} &nbsp;·&nbsp; {len(rows)} row{"s" if len(rows) != 1 else ""} selected</div>
	{f'<div class="filters">{filters_line}</div>' if filters_line else ""}
	<table class="data">
		<thead><tr>{header_cells}</tr></thead>
		<tbody>{"".join(body_rows)}{totals_row}</tbody>
	</table>
	<div class="footnote">Exported from Instabiz — {frappe.utils.escape_html(report_name)}</div>
</body></html>"""
