frappe.pages["ib-dpr"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: "Daily Production Report",
		single_column: true,
	});

	const page = new IBDPRPage(wrapper);
	wrapper.ib_dpr = page;
};

frappe.pages["ib-dpr"].on_page_show = function (wrapper) {
	if (wrapper.ib_dpr) {
		wrapper.ib_dpr.refresh();
	}
};

// ── Stage colour palette ──────────────────────────────────────────────────────
const DPR_STAGE_COLORS = {
	coating:          "#7c3aed",
	slitting:         "#2563eb",
	rewinding:        "#0891b2",
	cutting:          "#059669",
	packing:          "#d97706",
	ready_to_deliver: "#ea580c",
	delivered:        "#10b981",
};

class IBDPRPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page    = wrapper.page;
		this._mode   = "daily";   // "daily" | "weekly"
		this._date   = frappe.datetime.get_today();
		this._inject_styles();
		this._build_toolbar();
		this._build_layout();
		this.refresh();
	}

	// ── Public ────────────────────────────────────────────────────────────────
	refresh() {
		if (this._mode === "daily") {
			this._load_daily();
		} else {
			this._load_weekly();
		}
	}

	// ── Toolbar ───────────────────────────────────────────────────────────────
	_build_toolbar() {
		// Date picker
		this.$date_field = frappe.ui.form.make_control({
			parent: this.page.add_field({
				fieldtype: "Date",
				fieldname: "dpr_date",
				label: "Date",
				default: this._date,
			}),
			df: { fieldtype: "Date", fieldname: "dpr_date", label: "Date" },
			render_input: true,
		});

		// Fallback: add a plain date input if frappe.ui approach didn't attach
		if (!this.$date_input) {
			const $wrap = $(`<div style="display:inline-block;margin-right:10px;">`);
			this.$date_input_el = $(`<input type="date" class="ib-dpr-date-input" value="${this._date}">`);
			$wrap.append(this.$date_input_el);
			$(this.wrapper).find(".page-head .page-title").after($wrap);
			this.$date_input_el.on("change", (e) => {
				this._date = e.target.value;
				this.refresh();
			});
		}

		// Mode toggle buttons
		this.$btn_daily  = this.page.add_button("Daily",  () => this._set_mode("daily"),  { btn_class: "btn-default ib-dpr-toggle" });
		this.$btn_weekly = this.page.add_button("Weekly", () => this._set_mode("weekly"), { btn_class: "btn-default ib-dpr-toggle" });
		this._highlight_mode_btn();

		// Date field in page form
		this._date_control = this.page.add_field({
			fieldtype: "Date",
			fieldname: "dpr_date",
			label: "Date",
			default: this._date,
			change: () => {
				const val = this.page.fields_dict.dpr_date.get_value();
				if (val) {
					this._date = val;
					this.refresh();
				}
			},
		});

		// Refresh button
		this.$refresh_label = $(`<span class="ib-dpr-refresh-time"></span>`);
		this.page.add_inner_message(this.$refresh_label);
		this.page.add_button("Refresh", () => this.refresh(), { icon: "refresh" });
	}

	_set_mode(mode) {
		this._mode = mode;
		this._highlight_mode_btn();
		this.refresh();
	}

	_highlight_mode_btn() {
		if (this.$btn_daily)  this.$btn_daily.toggleClass("btn-primary",  this._mode === "daily").toggleClass("btn-default", this._mode !== "daily");
		if (this.$btn_weekly) this.$btn_weekly.toggleClass("btn-primary", this._mode === "weekly").toggleClass("btn-default", this._mode !== "weekly");
	}

	_set_refresh_label(text) {
		if (this.$refresh_label) this.$refresh_label.text(text);
	}

	// ── Layout ────────────────────────────────────────────────────────────────
	_build_layout() {
		this.$container = $(`<div class="ib-dpr-page container"></div>`)
			.appendTo($(this.wrapper).find(".page-content"));
	}

	// ── Data loaders ─────────────────────────────────────────────────────────
	_load_daily() {
		this._set_refresh_label("Loading…");
		frappe.call({
			method: "instabiz.overrides.production.get_dpr",
			args:   { date: this._date },
			callback: (r) => {
				if (r.message) {
					this._render_daily(r.message);
					this._set_refresh_label("Updated " + frappe.datetime.now_time());
				}
			},
			error: () => this._set_refresh_label("Error loading data"),
		});
	}

	_load_weekly() {
		this._set_refresh_label("Loading…");
		frappe.call({
			method: "instabiz.overrides.production.get_weekly_dpr",
			args:   { date: this._date },
			callback: (r) => {
				if (r.message) {
					this._render_weekly(r.message);
					this._set_refresh_label("Updated " + frappe.datetime.now_time());
				}
			},
			error: () => this._set_refresh_label("Error loading data"),
		});
	}

	// ── Daily render ─────────────────────────────────────────────────────────
	_render_daily(data) {
		const s = data.summary || {};
		const kpis = [
			{ label: "Total Entries",  value: s.total_entries  ?? 0 },
			{ label: "Total Input",    value: s.total_input    ?? 0 },
			{ label: "Total Output",   value: s.total_output   ?? 0 },
			{ label: "Avg Wastage %",  value: s.avg_wastage_pct != null ? parseFloat(s.avg_wastage_pct).toFixed(2) + "%" : "—" },
			{ label: "Total Hours",    value: s.total_hours    ?? 0 },
		];
		const kpi_html = kpis.map(k => `
			<div class="ib-dpr-kpi-card">
				<div class="ib-dpr-kpi-value">${k.value}</div>
				<div class="ib-dpr-kpi-label">${k.label}</div>
			</div>
		`).join("");

		const stage_rows = (data.stages || []).map(st => {
			const color    = DPR_STAGE_COLORS[st.stage] || "#888";
			const label    = (st.stage || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
			const wPct     = st.wastage_pct != null ? parseFloat(st.wastage_pct).toFixed(2) : "0.00";
			const w_class  = parseFloat(wPct) > 5 ? "ib-dpr-w-red" : parseFloat(wPct) > 2 ? "ib-dpr-w-orange" : "";
			const norm_badge = (st.above_norm_count > 0)
				? `<span class="ib-dpr-above-norm">⚠ ABOVE NORM</span>` : "";
			const machine_rows = (st.machines || []).map(m => {
				const mWPct   = m.wastage_pct != null ? parseFloat(m.wastage_pct).toFixed(2) : "0.00";
				const norm_m  = m.above_norm ? `<span class="ib-dpr-above-norm">ABOVE NORM</span>` : "";
				const m_class = parseFloat(mWPct) > 5 ? "ib-dpr-w-red" : parseFloat(mWPct) > 2 ? "ib-dpr-w-orange" : "";
				return `
					<tr class="ib-dpr-machine-row">
						<td>${m.machine || "—"}</td>
						<td>${m.entries ?? "—"}</td>
						<td>${m.output_qty ?? "—"}</td>
						<td class="${m_class}">${mWPct}% ${norm_m}</td>
						<td>${m.status || "—"}</td>
					</tr>
				`;
			}).join("");
			const sub_table = st.machines && st.machines.length ? `
				<tr class="ib-dpr-machine-subtable-row">
					<td colspan="8">
						<div class="ib-dpr-machine-subtable">
							<table class="ib-dpr-sub-table">
								<thead>
									<tr>
										<th>Machine</th>
										<th>Entries</th>
										<th>Output</th>
										<th>Wastage %</th>
										<th>Status</th>
									</tr>
								</thead>
								<tbody>${machine_rows}</tbody>
							</table>
						</div>
					</td>
				</tr>
			` : "";
			return `
				<tr class="ib-dpr-stage-row" data-stage="${st.stage}">
					<td>
						<span class="ib-dpr-stage-label" style="border-left:3px solid ${color};padding-left:8px;color:${color};font-weight:600">
							${label}
						</span>
					</td>
					<td>${st.entries ?? 0}</td>
					<td>${st.input_qty ?? 0}</td>
					<td>${st.output_qty ?? 0}</td>
					<td>${st.wastage_qty ?? 0}</td>
					<td class="${w_class}">${wPct}% ${norm_badge}</td>
					<td>${st.hours ?? "—"}</td>
					<td>${st.hourly_avg ?? "—"}</td>
				</tr>
				${sub_table}
			`;
		}).join("");

		this.$container.html(`
			<div class="ib-dpr-kpi-row">${kpi_html}</div>
			<div class="ib-dpr-section-title">Stage Breakdown</div>
			<div class="ib-dpr-table-wrap">
				<table class="ib-dpr-table">
					<thead>
						<tr>
							<th>Stage</th>
							<th>Entries</th>
							<th>Input Qty</th>
							<th>Output Qty</th>
							<th>Wastage Qty</th>
							<th>Wastage %</th>
							<th>Hours</th>
							<th>Hourly Avg</th>
						</tr>
					</thead>
					<tbody>${stage_rows || '<tr><td colspan="8" class="ib-dpr-empty">No data for this date.</td></tr>'}</tbody>
				</table>
			</div>
		`);

		// Collapsible machine subtables — click stage row to toggle
		this.$container.find(".ib-dpr-stage-row").on("click", function () {
			$(this).next(".ib-dpr-machine-subtable-row").toggle();
		});
	}

	// ── Weekly render ─────────────────────────────────────────────────────────
	_render_weekly(data) {
		const s = data.summary || {};
		const cards_html = [
			{ label: "Total Output (Week)", value: s.total_output   ?? 0 },
			{ label: "Avg Daily Output",    value: s.avg_daily      ?? 0 },
			{ label: "Avg Wastage %",       value: s.avg_wastage_pct != null ? parseFloat(s.avg_wastage_pct).toFixed(2) + "%" : "—" },
		].map(k => `
			<div class="ib-dpr-kpi-card">
				<div class="ib-dpr-kpi-value">${k.value}</div>
				<div class="ib-dpr-kpi-label">${k.label}</div>
			</div>
		`).join("");

		const day_rows = (data.days || []).map(d => {
			const wPct   = d.wastage_pct != null ? parseFloat(d.wastage_pct).toFixed(2) + "%" : "—";
			const wClass = d.wastage_pct > 5 ? "ib-dpr-w-red" : d.wastage_pct > 2 ? "ib-dpr-w-orange" : "";
			return `
				<tr>
					<td>${frappe.datetime.str_to_user(d.date) || d.date || "—"}</td>
					<td>${d.entries ?? 0}</td>
					<td>${d.input_qty ?? 0}</td>
					<td>${d.output_qty ?? 0}</td>
					<td class="${wClass}">${wPct}</td>
					<td>${d.hours ?? "—"}</td>
				</tr>
			`;
		}).join("");

		this.$container.html(`
			<div class="ib-dpr-kpi-row">${cards_html}</div>
			<div class="ib-dpr-section-title">Daily Breakdown</div>
			<div class="ib-dpr-table-wrap">
				<table class="ib-dpr-table">
					<thead>
						<tr>
							<th>Date</th>
							<th>Entries</th>
							<th>Input</th>
							<th>Output</th>
							<th>Wastage %</th>
							<th>Hours</th>
						</tr>
					</thead>
					<tbody>${day_rows || '<tr><td colspan="6" class="ib-dpr-empty">No data for this week.</td></tr>'}</tbody>
				</table>
			</div>
		`);
	}

	// ── Styles ────────────────────────────────────────────────────────────────
	_inject_styles() {
		if (document.getElementById("ib-dpr-styles")) return;
		const style = document.createElement("style");
		style.id = "ib-dpr-styles";
		style.textContent = `
			.ib-dpr-page {
				padding: 20px 0;
				font-family: inherit;
			}
			.ib-dpr-kpi-row {
				display: flex;
				gap: 16px;
				margin-bottom: 24px;
				flex-wrap: wrap;
			}
			.ib-dpr-kpi-card {
				flex: 1;
				min-width: 140px;
				background: var(--card-bg, #fff);
				border: 1px solid var(--border-color, #e2e8f0);
				border-radius: 10px;
				padding: 16px 18px;
				box-shadow: 0 1px 4px rgba(0,0,0,.06);
			}
			.ib-dpr-kpi-value {
				font-size: 26px;
				font-weight: 700;
				color: #d97757;
				line-height: 1.1;
			}
			.ib-dpr-kpi-label {
				font-size: 12px;
				color: var(--text-muted, #6b7280);
				margin-top: 4px;
				font-weight: 500;
			}
			.ib-dpr-section-title {
				font-size: 13px;
				font-weight: 700;
				text-transform: uppercase;
				letter-spacing: .06em;
				color: var(--text-muted, #6b7280);
				margin: 18px 0 10px;
			}
			.ib-dpr-table-wrap {
				overflow-x: auto;
				margin-bottom: 20px;
			}
			.ib-dpr-table {
				width: 100%;
				border-collapse: collapse;
				background: var(--card-bg, #fff);
				border: 1px solid var(--border-color, #e2e8f0);
				border-radius: 10px;
				overflow: hidden;
				font-size: 13px;
			}
			.ib-dpr-table th {
				background: var(--subtle-fg, #f8fafc);
				font-size: 11px;
				font-weight: 700;
				text-transform: uppercase;
				letter-spacing: .05em;
				color: var(--text-muted, #6b7280);
				padding: 10px 12px;
				text-align: left;
				border-bottom: 1px solid var(--border-color, #e2e8f0);
				white-space: nowrap;
			}
			.ib-dpr-table td {
				padding: 9px 12px;
				border-bottom: 1px solid var(--border-color, #f1f5f9);
				color: var(--text-color, #1e293b);
			}
			.ib-dpr-table tr:last-child td { border-bottom: none; }
			.ib-dpr-table tbody tr:nth-child(even) td { background: var(--subtle-fg, #f8fafc); }
			.ib-dpr-stage-row { cursor: pointer; }
			.ib-dpr-stage-row:hover td { background: #fef9f7 !important; }
			.ib-dpr-machine-subtable-row { display: none; }
			.ib-dpr-machine-subtable {
				padding: 8px 16px 8px 32px;
				background: #fafbff;
			}
			.ib-dpr-sub-table {
				width: 100%;
				border-collapse: collapse;
				font-size: 12px;
				border: 1px solid var(--border-color, #e2e8f0);
				border-radius: 6px;
				overflow: hidden;
			}
			.ib-dpr-sub-table th {
				background: #f1f5f9;
				font-size: 11px;
				font-weight: 700;
				text-transform: uppercase;
				letter-spacing: .04em;
				color: var(--text-muted, #6b7280);
				padding: 7px 10px;
				text-align: left;
			}
			.ib-dpr-sub-table td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; }
			.ib-dpr-sub-table tr:last-child td { border-bottom: none; }
			.ib-dpr-machine-row:nth-child(even) td { background: #f8fafc; }
			.ib-dpr-w-orange { color: #ea580c; font-weight: 600; }
			.ib-dpr-w-red    { color: #dc2626; font-weight: 700; }
			.ib-dpr-above-norm {
				background: #dc2626;
				color: #fff;
				font-size: 10px;
				font-weight: 700;
				border-radius: 4px;
				padding: 1px 5px;
				margin-left: 4px;
				vertical-align: middle;
			}
			.ib-dpr-empty {
				text-align: center;
				padding: 24px;
				color: var(--text-muted, #6b7280);
			}
			.ib-dpr-refresh-time {
				font-size: 11px;
				color: var(--text-muted, #6b7280);
				margin-right: 8px;
			}
			.ib-dpr-date-input {
				border: 1px solid var(--border-color, #e2e8f0);
				border-radius: 6px;
				padding: 5px 10px;
				font-size: 13px;
				font-family: inherit;
				margin-right: 8px;
			}
			.btn-primary.ib-dpr-toggle  { background: #d97757; border-color: #d97757; color: #fff; }
			.btn-default.ib-dpr-toggle  { background: var(--card-bg, #fff); color: var(--text-color, #333); }
		`;
		document.head.appendChild(style);
	}
}
