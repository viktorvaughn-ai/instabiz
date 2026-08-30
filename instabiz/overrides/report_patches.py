"""instabiz.overrides.report_patches

Small, additive client-script patches for NATIVE (core Frappe/ERPNext)
Script Reports — never edit the shipped .js file directly, that's core
code and gets overwritten on any bench update/git pull. Instead this
overrides frappe.desk.query_report.get_script (via
hooks.override_whitelisted_methods, same mechanism already used elsewhere
in this app — see get_desktop_page) to run the original script exactly as
shipped, then APPEND a small chained patch on top — the report keeps every
bit of its own native behavior (filters, formatter, chart), this only adds
what's listed below.
"""
import frappe
from frappe.desk.query_report import get_script as _core_get_script
from frappe.desk.query_report import run as _core_run

# report_name -> list of fieldnames to hide from the rendered datatable.
# Chained onto the report's own get_datatable_options (if it defines one)
# rather than replacing it.
_REPORT_HIDE_COLUMNS = {
	# Native ERPNext report — shows a Customer Group column instabiz doesn't
	# want surfaced here (2026-08-30, user request).
	"Customer Ledger Summary": ["customer_group"],
}


def _inject_customer_ledger_handled_by(result):
	"""Add a "Handled By" column (Customer.custom_sales_person) to Customer
	Ledger Summary — the native report has no sales-rep concept at all, and
	this app already stores it directly on Customer (custom_sales_person),
	so no join/lookup chain is needed, just one bulk fetch keyed by the
	report's own "party" row field (2026-08-30, user request)."""
	rows = result.get("result") or []
	party_names = sorted({r.get("party") for r in rows if isinstance(r, dict) and r.get("party")})
	if not party_names:
		return
	sp_map = {
		c.name: c.custom_sales_person
		for c in frappe.db.get_all(
			"Customer", filters={"name": ["in", party_names]}, fields=["name", "custom_sales_person"]
		)
	}
	for row in rows:
		if isinstance(row, dict):
			row["handled_by"] = sp_map.get(row.get("party")) or ""

	columns = result.get("columns") or []
	idx = next((i for i, c in enumerate(columns) if c.get("fieldname") == "party"), len(columns) - 1)
	columns.insert(idx + 1, {
		"label": "Handled By", "fieldname": "handled_by", "fieldtype": "Data", "width": 140,
	})


# report_name -> injector(result) — mutates result["columns"]/result["result"]
# in place, called after the report's own native run() has already produced
# them (additive, never replaces the native query).
_REPORT_EXTRA_COLUMNS = {
	"Customer Ledger Summary": _inject_customer_ledger_handled_by,
}


@frappe.whitelist()
@frappe.read_only()
def run(report_name, filters=None, user=None, ignore_prepared_report=False,
	custom_columns=None, is_tree=False, parent_field=None, are_default_filters=True):
	result = _core_run(
		report_name, filters=filters, user=user, ignore_prepared_report=ignore_prepared_report,
		custom_columns=custom_columns, is_tree=is_tree, parent_field=parent_field,
		are_default_filters=are_default_filters,
	)
	injector = _REPORT_EXTRA_COLUMNS.get(report_name)
	if injector:
		injector(result)
	return result


@frappe.whitelist()
def get_script(report_name):
	result = _core_get_script(report_name)
	hide_fields = _REPORT_HIDE_COLUMNS.get(report_name)
	if hide_fields and result.get("script"):
		hide_json = frappe.as_json(hide_fields)
		result["script"] += f"""

;(function() {{
	var _cfg = frappe.query_reports["{report_name}"] = frappe.query_reports["{report_name}"] || {{}};
	var _orig_dt_opts = _cfg.get_datatable_options;
	var _hide = {hide_json};
	_cfg.get_datatable_options = function(options) {{
		if (_orig_dt_opts) options = _orig_dt_opts(options);
		options.columns = (options.columns || []).filter(function(c) {{
			return _hide.indexOf(c.fieldname) === -1;
		}});
		return options;
	}};
}})();
"""
	return result
