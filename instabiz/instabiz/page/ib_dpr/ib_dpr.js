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

		this.$btn_daily  = this.page.add_button("Daily",  () => this._set_mode("daily"),  { btn_class: "btn-default ib-dpr-toggle" });
		this.$btn_weekly = this.page.add_button("Weekly", () => this._set_mode("weekly"), { btn_class: "btn-default ib-dpr-toggle" });
		this._highlight_mode_btn();

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
			.appendTo($(this.wrapper).find(".layout-main-section"));
	}

	// ── Skeleton ─────────────────────────────────────────────────────────────
	_show_skeleton(cols = 5) {
		const cards = Array(cols).fill(0).map(() => `
			<div class="ib-dpr-kpi-card ib-dpr-skeleton">
				<div class="ib-dpr-sk-val"></div>
				<div class="ib-dpr-sk-lbl"></div>
			</div>`).join("");
		const rows  = Array(4).fill(0).map(() => `
			<tr>${Array(8).fill(0).map(() => `<td><div class="ib-dpr-sk-cell"></div></td>`).join("")}</tr>`).join("");
		this.$container.html(`
			<div class="ib-dpr-kpi-row">${cards}</div>
			<div class="ib-dpr-section-title ib-dpr-sk-title"></div>
			<div class="ib-dpr-table-wrap">
				<table class="ib-dpr-table"><tbody>${rows}</tbody></table>
			</div>`);
	}

	// ── Data loaders ─────────────────────────────────────────────────────────
	_load_daily() {
		this._set_refresh_label("Loading…");
		this._show_skeleton(5);
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
		this._show_skeleton(3);
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

	// ── KPI card helper ───────────────────────────────────────────────────────
	_kpi_card(label, value, accent, icon_name, sub = "") {
		const icon = `<iconify-icon icon="lucide:${icon_name}" width="18" height="18"></iconify-icon>`;
		return `<div class="ib-dpr-kpi-card" style="--dpr-kc:${accent}">
			<div class="ib-dpr-kpi-icon-wrap" style="background:${accent}18;color:${accent}">${icon}</div>
			<div class="ib-dpr-kpi-value">${value}</div>
			<div class="ib-dpr-kpi-label">${label}</div>
			${sub ? `<div class="ib-dpr-kpi-sub">${sub}</div>` : ""}
		</div>`;
	}

	// ── Daily render ─────────────────────────────────────────────────────────
	_render_daily(data) {
		const s = data.summary || {};
		const wastePct = s.avg_wastage_pct != null ? parseFloat(s.avg_wastage_pct).toFixed(2) : "0.00";
		const wasteColor = parseFloat(wastePct) > 5 ? "#dc2626" : parseFloat(wastePct) > 2 ? "#ea580c" : "#10b981";
		const woCompleted = s.wo_completed || 0;
		const woByStage = s.wo_by_stage || {};

		// WO completion badge (always visible)
		const wo_notice = woCompleted > 0 ? `
			<div class="ib-dpr-wo-notice">
				<iconify-icon icon="lucide:check-circle" width="14" height="14"></iconify-icon>
				<strong>${woCompleted}</strong> Work Order${woCompleted !== 1 ? "s" : ""} completed today
				<span class="ib-dpr-wo-by-stage">
					${Object.entries(woByStage).map(([stage, v]) => {
						const color = DPR_STAGE_COLORS[(stage || "").toLowerCase().replace(/ /g, "_")] || "#888";
						return `<span class="ib-dpr-wo-stage-chip" style="background:${color}18;color:${color};border:1px solid ${color}30">
							${stage}: ${v.count}
						</span>`;
					}).join("")}
				</span>
			</div>` : "";

		const kpi_html = [
			this._kpi_card("WOs Completed", woCompleted, "#7c3aed", "check-circle"),
			this._kpi_card("Total Entries",  s.total_entries  ?? 0,   "#2563eb", "list"),
			this._kpi_card("Total Output",   s.total_output   ?? 0,   "#059669", "trending-up"),
			this._kpi_card("Avg Wastage %",  wastePct + "%",         wasteColor, "alert-triangle"),
			this._kpi_card("Total Hours",    s.total_hours    ?? 0,   "#d97706", "clock"),
		].join("");

		const stage_rows = (data.stages || []).map(st => {
			const color    = DPR_STAGE_COLORS[st.stage] || "#888";
			const label    = (st.stage || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
			const wPct     = st.wastage_pct != null ? parseFloat(st.wastage_pct).toFixed(2) : "0.00";
			const w_class  = parseFloat(wPct) > 5 ? "ib-dpr-w-red" : parseFloat(wPct) > 2 ? "ib-dpr-w-orange" : "";
			const norm_badge = (st.above_norm_count > 0)
				? `<span class="ib-dpr-above-norm">⚠ ABOVE NORM</span>` : "";
			// Efficiency bar: output / input ratio
			const eff_pct  = st.input_qty > 0 ? Math.min(100, Math.round((st.output_qty / st.input_qty) * 100)) : 0;
			const eff_color = eff_pct >= 95 ? "#10b981" : eff_pct >= 80 ? "#d97706" : "#dc2626";
			const eff_bar  = `<div class="ib-dpr-eff-wrap">
				<div class="ib-dpr-eff-bar" style="width:${eff_pct}%;background:${eff_color}"></div>
			</div>`;
			const machine_rows = (st.machines || []).map(m => {
				const mWPct   = m.wastage_pct != null ? parseFloat(m.wastage_pct).toFixed(2) : "0.00";
				const norm_m  = m.above_norm ? `<span class="ib-dpr-above-norm">ABOVE NORM</span>` : "";
				const m_class = parseFloat(mWPct) > 5 ? "ib-dpr-w-red" : parseFloat(mWPct) > 2 ? "ib-dpr-w-orange" : "";
				return `
					<tr class="ib-dpr-machine-row">
						<td><span class="ib-dpr-machine-pill">${m.machine || "—"}</span></td>
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
										<th>Machine</th><th>Entries</th>
										<th>Output</th><th>Wastage %</th><th>Status</th>
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
						<div class="ib-dpr-stage-cell">
							<span class="ib-dpr-stage-dot" style="background:${color}"></span>
							<span class="ib-dpr-stage-name" style="color:${color}">${label}</span>
							${st.machines && st.machines.length ? `<span class="ib-dpr-chevron">▾</span>` : ""}
						</div>
					</td>
					<td>${st.entries ?? 0}</td>
					<td>${st.input_qty ?? 0}</td>
					<td>
						${st.output_qty ?? 0}
						${eff_bar}
					</td>
					<td>${st.wastage_qty ?? 0}</td>
					<td class="${w_class}">${wPct}% ${norm_badge}</td>
					<td>${st.hours ?? "—"}</td>
					<td>${st.hourly_avg ?? "—"}</td>
				</tr>
				${sub_table}
			`;
		}).join("");

		const empty_row = `<tr><td colspan="8" class="ib-dpr-empty">
			<iconify-icon icon="lucide:file-x" width="14" height="14"></iconify-icon> No production entries logged for this date.
			${woCompleted > 0 ? `<br><span style="color:#7c3aed;font-weight:600">${woCompleted} Work Orders were completed — log entries via Production Entry to see detailed stats.</span>` : ""}
		</td></tr>`;

		this.$container.html(`
			<div class="ib-dpr-kpi-row">${kpi_html}</div>
			${wo_notice}
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
					<tbody>${stage_rows || empty_row}</tbody>
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
		const wPctAvg = s.avg_wastage_pct != null ? parseFloat(s.avg_wastage_pct).toFixed(2) : "0.00";
		const wColor  = parseFloat(wPctAvg) > 5 ? "#dc2626" : parseFloat(wPctAvg) > 2 ? "#ea580c" : "#10b981";
		const kpi_html = [
			this._kpi_card("Total Output (Week)", s.total_output ?? 0, "#059669", "box"),
			this._kpi_card("Avg Daily Output",    s.avg_daily   ?? 0, "#2563eb", "bar-chart-2"),
			this._kpi_card("Avg Wastage %", wPctAvg + "%",           wColor,    "alert-triangle"),
		].join("");

		// Max output for bar scaling
		const maxOut = Math.max(1, ...(data.days || []).map(d => d.output_qty || 0));

		const day_rows = (data.days || []).map(d => {
			const wPct   = d.wastage_pct != null ? parseFloat(d.wastage_pct).toFixed(2) : null;
			const wClass = wPct > 5 ? "ib-dpr-w-red" : wPct > 2 ? "ib-dpr-w-orange" : "";
			const barPct = Math.round(((d.output_qty || 0) / maxOut) * 100);
			const output_bar = `<div class="ib-dpr-week-cell">
				<span>${d.output_qty ?? 0}</span>
				<div class="ib-dpr-eff-wrap" style="margin-top:3px">
					<div class="ib-dpr-eff-bar" style="width:${barPct}%;background:#059669"></div>
				</div>
			</div>`;
			return `
				<tr>
					<td><strong>${frappe.datetime.str_to_user(d.date) || d.date || "—"}</strong></td>
					<td>${d.entries ?? 0}</td>
					<td>${d.input_qty ?? 0}</td>
					<td>${output_bar}</td>
					<td class="${wClass}">${wPct != null ? wPct + "%" : "—"}</td>
					<td>${d.hours ?? "—"}</td>
				</tr>
			`;
		}).join("");

		this.$container.html(`
			<div class="ib-dpr-kpi-row">${kpi_html}</div>
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
			.ib-dpr-page { padding: 20px 0; font-family: inherit; }

			/* ── KPI cards ── */
			.ib-dpr-kpi-row { display: flex; gap: 14px; margin-bottom: 24px; flex-wrap: wrap; }
			.ib-dpr-kpi-card {
				flex: 1; min-width: 140px; position: relative; overflow: hidden;
				background: var(--card-bg, #fff);
				border: 1px solid var(--border-color, #e2e8f0);
				border-left: 4px solid var(--dpr-kc, #d97757);
				border-radius: 10px; padding: 16px 18px;
				box-shadow: 0 1px 4px rgba(0,0,0,.06);
				transition: transform .15s, box-shadow .15s;
			}
			.ib-dpr-kpi-card:hover { transform: translateY(-2px); box-shadow: 0 4px 14px rgba(0,0,0,.10); }
			.ib-dpr-kpi-icon-wrap {
				display: inline-flex; align-items: center; justify-content: center;
				width: 32px; height: 32px; border-radius: 8px;
				margin-bottom: 8px;
			}
			.ib-dpr-kpi-value {
				font-size: 28px; font-weight: 700;
				color: var(--dpr-kc, #d97757); line-height: 1.1;
			}
			.ib-dpr-kpi-label {
				font-size: 12px; color: var(--text-muted, #6b7280);
				margin-top: 4px; font-weight: 500;
			}
			.ib-dpr-kpi-sub {
				font-size: 10px; color: var(--text-muted, #6b7280);
				margin-top: 2px;
			}
			.ib-dpr-wo-notice {
				display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
				background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 8px;
				padding: 10px 14px; margin-bottom: 16px;
				font-size: 13px; color: #5b21b6;
			}
			.ib-dpr-wo-by-stage { display: flex; gap: 5px; flex-wrap: wrap; margin-left: 4px; }
			.ib-dpr-wo-stage-chip {
				font-size: 11px; font-weight: 600; border-radius: 10px;
				padding: 2px 8px; white-space: nowrap;
			}

			/* ── Section title ── */
			.ib-dpr-section-title {
				font-size: 11px; font-weight: 700; text-transform: uppercase;
				letter-spacing: .07em; color: var(--text-muted, #6b7280);
				margin: 20px 0 10px; display: flex; align-items: center; gap: 8px;
			}
			.ib-dpr-section-title::after {
				content: ''; flex: 1; height: 1px; background: var(--border-color, #e2e8f0);
			}

			/* ── Table ── */
			.ib-dpr-table-wrap { overflow-x: auto; margin-bottom: 20px; border-radius: 10px; border: 1px solid var(--border-color, #e2e8f0); }
			.ib-dpr-table { width: 100%; border-collapse: collapse; background: var(--card-bg, #fff); font-size: 13px; }
			.ib-dpr-table th {
				background: var(--subtle-fg, #f8fafc); font-size: 11px; font-weight: 700;
				text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted, #6b7280);
				padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border-color, #e2e8f0); white-space: nowrap;
			}
			.ib-dpr-table td { padding: 9px 12px; border-bottom: 1px solid var(--border-color, #f1f5f9); color: var(--text-color, #1e293b); }
			.ib-dpr-table tr:last-child td { border-bottom: none; }
			.ib-dpr-stage-row { cursor: pointer; transition: background .1s; }
			.ib-dpr-stage-row:hover td { background: rgba(217,119,87,.05) !important; }
			.ib-dpr-machine-subtable-row { display: none; }
			.ib-dpr-machine-subtable { padding: 8px 16px 8px 32px; background: var(--subtle-fg, #f8fafc); }
			.ib-dpr-sub-table { width: 100%; border-collapse: collapse; font-size: 12px; }
			.ib-dpr-sub-table th {
				background: #f1f5f9; font-size: 11px; font-weight: 700;
				text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted, #6b7280);
				padding: 6px 10px; text-align: left;
			}
			.ib-dpr-sub-table td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; }
			.ib-dpr-sub-table tr:last-child td { border-bottom: none; }

			/* ── Stage cell ── */
			.ib-dpr-stage-cell { display: flex; align-items: center; gap: 7px; }
			.ib-dpr-stage-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
			.ib-dpr-stage-name { font-weight: 600; font-size: 13px; }
			.ib-dpr-chevron { font-size: 11px; color: var(--text-muted); margin-left: 2px; }

			/* ── Machine pill ── */
			.ib-dpr-machine-pill {
				background: #f1f5f9; border-radius: 4px; padding: 2px 7px;
				font-size: 11px; font-weight: 600; color: var(--text-color);
			}

			/* ── Efficiency bar ── */
			.ib-dpr-eff-wrap { height: 3px; background: var(--border-color, #e2e8f0); border-radius: 2px; overflow: hidden; margin-top: 4px; width: 100%; min-width: 48px; max-width: 96px; }
			.ib-dpr-eff-bar { height: 100%; border-radius: 2px; transition: width .5s cubic-bezier(.4,0,.2,1); }
			.ib-dpr-week-cell { display: flex; flex-direction: column; }

			/* ── Badges ── */
			.ib-dpr-w-orange { color: #ea580c; font-weight: 600; }
			.ib-dpr-w-red    { color: #dc2626; font-weight: 700; }
			.ib-dpr-above-norm {
				background: #dc2626; color: #fff; font-size: 10px; font-weight: 700;
				border-radius: 4px; padding: 1px 5px; margin-left: 4px; vertical-align: middle;
			}
			.ib-dpr-empty { text-align: center; padding: 32px; color: var(--text-muted, #6b7280); font-size: 13px; }
			.ib-dpr-refresh-time { font-size: 11px; color: var(--text-muted, #6b7280); margin-right: 8px; }
			.btn-primary.ib-dpr-toggle  { background: #d97757; border-color: #d97757; color: #fff; }
			.btn-default.ib-dpr-toggle  { background: var(--card-bg, #fff); color: var(--text-color, #333); }

			/* ── Skeleton ── */
			@keyframes ib-dpr-shimmer { 0%{opacity:.5} 50%{opacity:1} 100%{opacity:.5} }
			.ib-dpr-skeleton { animation: ib-dpr-shimmer 1.3s ease-in-out infinite; }
			.ib-dpr-sk-val { height: 28px; background: var(--border-color, #e2e8f0); border-radius: 5px; width: 60%; margin-bottom: 8px; }
			.ib-dpr-sk-lbl { height: 12px; background: var(--border-color, #e2e8f0); border-radius: 4px; width: 80%; }
			.ib-dpr-sk-cell { height: 14px; background: var(--border-color, #e2e8f0); border-radius: 3px; animation: ib-dpr-shimmer 1.3s ease-in-out infinite; }
			.ib-dpr-sk-title { height: 12px; background: var(--border-color, #e2e8f0); border-radius: 3px; width: 120px; animation: ib-dpr-shimmer 1.3s ease-in-out infinite; }
		`;
		document.head.appendChild(style);
	}
}
