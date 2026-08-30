// Global "select rows on any Script Report -> export as a branded PDF"
// feature (2026-08-30). Works on every report — native ERPNext/Frappe ones
// included — without editing frappe.views.QueryReport (core class): wrap
// two of its prototype methods, call the original first, layer this app's
// behavior on top. Same additive-monkeypatch pattern report_patches.py
// already uses for individual native reports' own client scripts.
frappe.provide("instabiz.report_export");

(function () {
	if (!frappe.views || !frappe.views.QueryReport) return;

	// Runs before render_datatable() — patches report_settings so the
	// datatable this report is about to build gets a checkbox column and a
	// row-check listener, chaining whatever get_datatable_options the
	// report itself (or report_patches.py's own per-report patch) already
	// defines rather than replacing it.
	const _orig_get_report_settings = frappe.views.QueryReport.prototype.get_report_settings;
	frappe.views.QueryReport.prototype.get_report_settings = function () {
		return _orig_get_report_settings.call(this).then(() => {
			this.report_settings = this.report_settings || {};
			if (this.report_settings._ib_export_patched) return;
			this.report_settings._ib_export_patched = true;
			const orig_dt_opts = this.report_settings.get_datatable_options;
			this.report_settings.get_datatable_options = (options) => {
				if (orig_dt_opts) options = orig_dt_opts(options);
				options.checkboxColumn = true;
				options.events = options.events || {};
				const orig_on_check = options.events.onCheckRow;
				options.events.onCheckRow = (row) => {
					if (orig_on_check) orig_on_check(row);
					instabiz.report_export.update_button(this);
				};
				return options;
			};
		});
	};

	const _orig_render_datatable = frappe.views.QueryReport.prototype.render_datatable;
	frappe.views.QueryReport.prototype.render_datatable = function () {
		_orig_render_datatable.apply(this, arguments);
		instabiz.report_export.ensure_button(this);
	};
})();

instabiz.report_export.ensure_button = function (report) {
	// frappe.query_report is one long-lived instance reused across report
	// navigations (set_route to a different report doesn't recreate it) —
	// but Frappe rebuilds page.inner_toolbar's DOM on every report load, so
	// a button reference from a PREVIOUS report is stale (detached from the
	// DOM) even though the JS property on `report` still points at it. Not
	// checking this meant the button silently never reappeared after the
	// first report visited in a session.
	if (report._ib_export_btn && !document.body.contains(report._ib_export_btn[0])) {
		report._ib_export_btn = null;
	}
	if (!report._ib_export_btn) {
		report._ib_export_btn = report.page.add_inner_button(
			__("Export Selected (PDF)"),
			() => instabiz.report_export.export(report),
		);
		// Real Frappe .btn-primary component, just recolored to this app's
		// own accent (--ib-primary) via a scoped class — not a retheme of
		// every primary button app-wide.
		instabiz.report_export._inject_btn_style();
		report._ib_export_btn.addClass("btn-primary ib-report-export-btn").hide();
	}
	instabiz.report_export.update_button(report);
};

instabiz.report_export._inject_btn_style = function () {
	if (document.getElementById("ib-report-export-style")) return;
	const style = document.createElement("style");
	style.id = "ib-report-export-style";
	style.textContent = `
		.btn-primary.ib-report-export-btn {
			background: var(--ib-primary, #d97757);
			border-color: var(--ib-primary, #d97757);
			color: #fff;
		}
		.btn-primary.ib-report-export-btn:hover {
			background: var(--ib-primary-dark, #c8674a);
			border-color: var(--ib-primary-dark, #c8674a);
		}
	`;
	document.head.appendChild(style);
};

instabiz.report_export.update_button = function (report) {
	if (!report._ib_export_btn || !report.datatable || !report.datatable.rowmanager) return;
	const checked = (report.datatable.rowmanager.getCheckedRows() || []).filter(
		(i) => i !== undefined && i !== null
	);
	report._ib_export_btn
		.toggle(checked.length > 0)
		.text(checked.length > 0 ? __("Export Selected ({0}) — PDF", [checked.length]) : __("Export Selected (PDF)"));
};

instabiz.report_export.export = function (report) {
	const indexes = (report.datatable.rowmanager.getCheckedRows() || []).filter(
		(i) => i !== undefined && i !== null
	);
	if (!indexes.length) return;

	// report.columns is the report's own FULL column list — a column hidden
	// only in the rendered datatable (report_patches.py's get_datatable_options
	// patch, e.g. Customer Group on Customer Ledger Summary) stays in that
	// array with no .hidden flag set, so reading it here would silently leak
	// a column the user deliberately hid back into the exported PDF. The
	// datatable's own options.columns is the real post-filter source of
	// truth — it's what's actually on screen, nothing more.
	const dt_columns = (report.datatable && report.datatable.options && report.datatable.options.columns) || report.columns || [];
	const columns = dt_columns
		.filter((c) => !c.hidden && c.fieldname && !(c.id || "").startsWith("_"))
		.map((c) => ({
			label: c.label || c.content || c.fieldname || c.id,
			fieldname: c.fieldname || c.id,
			fieldtype: c.fieldtype || "Data",
		}));
	const rows = indexes.map((i) => report.data[i]).filter(Boolean);
	if (!rows.length) {
		frappe.show_alert({ message: __("No matching rows to export."), indicator: "orange" });
		return;
	}

	let filters = {};
	try {
		filters = report.get_filter_values ? report.get_filter_values() : {};
	} catch (e) {
		filters = {};
	}

	frappe.show_alert({ message: __("Preparing PDF…"), indicator: "blue" }, 3);
	open_url_post(
		"/api/method/instabiz.overrides.report_export.export_selected_rows_pdf",
		{
			report_name: report.report_name,
			columns: columns,
			rows: rows,
			filters: filters,
		},
		true,
	);
};
