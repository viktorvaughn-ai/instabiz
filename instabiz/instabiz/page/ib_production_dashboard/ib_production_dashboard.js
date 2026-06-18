frappe.pages["ib-production-dashboard"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: "Production Dashboard",
		single_column: true,
	});

	const page = new IBProductionDashboard(wrapper);
	wrapper.ib_production_dashboard = page;
};

frappe.pages["ib-production-dashboard"].on_page_show = function (wrapper) {
	if (wrapper.ib_production_dashboard) {
		wrapper.ib_production_dashboard.refresh();
	}
};

// ── Stage colour palette ──────────────────────────────────────────────────────
const STAGE_COLORS = {
	coating:          "#7c3aed",
	slitting:         "#2563eb",
	rewinding:        "#0891b2",
	cutting:          "#059669",
	packing:          "#d97706",
	ready_to_deliver: "#ea580c",
	delivered:        "#10b981",
};

class IBProductionDashboard {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page    = wrapper.page;
		this._inject_styles();
		this._build_layout();
		this._add_toolbar_buttons();
		this.refresh();
	}

	// ── Public ────────────────────────────────────────────────────────────────
	refresh() {
		this._set_refresh_label("Loading…");
		frappe.call({
			method: "instabiz.overrides.production.get_production_dashboard",
			callback: (r) => {
				if (r.message) {
					this._render(r.message);
					this._set_refresh_label("Updated " + frappe.datetime.now_time());
				}
			},
			error: () => this._set_refresh_label("Error loading data"),
		});
		frappe.call({
			method: "instabiz.overrides.production.get_production_plan",
			args: { limit: 25 },
			callback: (r) => {
				if (r.message) this._render_plan(r.message.order_wise || []);
			},
		});
	}

	// ── Layout ────────────────────────────────────────────────────────────────
	_build_layout() {
		this.$container = $(`
			<div class="ib-pd-page container">
				<div style="text-align:right;margin-bottom:8px">
					<span id="ib-pd-refresh-ts" class="ib-pd-refresh-time"></span>
				</div>
				<div class="ib-pd-kpi-row" id="ib-pd-kpis"></div>
				<div class="ib-pd-section-title">Pipeline</div>
				<div class="ib-pd-pipeline" id="ib-pd-pipeline"></div>
				<div class="ib-pd-row-2">
					<div class="ib-pd-priority-strip" id="ib-pd-priority"></div>
					<div class="ib-pd-wastage-card" id="ib-pd-wastage"></div>
				</div>
				<div class="ib-pd-section-title">Active Production Plan</div>
				<div id="ib-pd-plan"></div>
				<div class="ib-pd-section-title">Recent Entries</div>
				<div id="ib-pd-recent"></div>
				<div class="ib-pd-quick-actions" id="ib-pd-actions"></div>
			</div>
		`).appendTo($(this.wrapper).find(".page-content"));
	}

	_add_toolbar_buttons() {
		this.page.add_button(__("Refresh"), () => this.refresh(), { icon: "refresh" });
	}

	_set_refresh_label(text) {
		this.$container.find("#ib-pd-refresh-ts").text(text);
	}

	// ── Render ────────────────────────────────────────────────────────────────
	_render(data) {
		this._render_kpis(data.summary || {});
		this._render_pipeline(data.pipeline || []);
		this._render_priority(data.priority_overview || {});
		this._render_wastage(data.avg_wastage_today);
		this._render_recent(data.recent_entries || []);
		this._render_actions();
	}

	_render_kpis(s) {
		const kpis = [
			{ label: "Active Work Orders", value: s.active_work_orders ?? 0, color: "#2563eb" },
			{ label: "Pending",            value: s.pending             ?? 0, color: "#d97706" },
			{ label: "Completed Today",    value: s.completed_today     ?? 0, color: "#059669" },
			{ label: "Machines Active",    value: s.machines_active     ?? 0, color: "#0891b2" },
		];
		const html = kpis.map(k => `
			<div class="ib-pd-kpi-card" style="border-top:4px solid ${k.color}">
				<div class="ib-pd-kpi-value" style="color:${k.color}">${k.value}</div>
				<div class="ib-pd-kpi-label">${k.label}</div>
			</div>
		`).join("");
		this.$container.find("#ib-pd-kpis").html(html);
	}

	_render_pipeline(stages) {
		if (!stages.length) {
			// Render empty stage cards for all known stages
			stages = Object.keys(STAGE_COLORS).map(s => ({
				stage: s, pending: 0, in_progress: 0, completed: 0,
			}));
		}
		const html = stages.map(s => {
			const color = STAGE_COLORS[s.stage] || "#888";
			const label = s.stage.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
			return `
				<div class="ib-pd-pipeline-card" style="border-left:4px solid ${color}"
					data-stage="${s.stage}" title="Go to Production Stages">
					<div class="ib-pd-pipeline-name" style="color:${color}">${label}</div>
					<div class="ib-pd-pipeline-stat">
						<span class="ib-pd-ps-badge pending">${s.pending ?? 0}</span>
						<span class="ib-pd-ps-label">Pending</span>
					</div>
					<div class="ib-pd-pipeline-stat">
						<span class="ib-pd-ps-badge inprog">${s.in_progress ?? 0}</span>
						<span class="ib-pd-ps-label">In Progress</span>
					</div>
					<div class="ib-pd-pipeline-stat">
						<span class="ib-pd-ps-badge done">${s.completed ?? 0}</span>
						<span class="ib-pd-ps-label">Done</span>
					</div>
				</div>
			`;
		}).join("");
		const $pipeline = this.$container.find("#ib-pd-pipeline").html(html);
		$pipeline.find(".ib-pd-pipeline-card").on("click", () => {
			frappe.set_route("ib-production-stages");
		});
	}

	_render_priority(p) {
		const badges = [
			{ label: "Urgent", key: "urgent", color: "#dc2626" },
			{ label: "High",   key: "high",   color: "#ea580c" },
			{ label: "Normal", key: "normal",  color: "#2563eb" },
			{ label: "Low",    key: "low",     color: "#6b7280" },
		];
		const html = `
			<div class="ib-pd-priority-title">Priority</div>
			<div class="ib-pd-priority-badges">
				${badges.map(b => `
					<span class="ib-pd-priority-badge" style="background:${b.color}">
						${b.label} <strong>${p[b.key] ?? 0}</strong>
					</span>
				`).join("")}
			</div>
		`;
		this.$container.find("#ib-pd-priority").html(html);
	}

	_render_wastage(pct) {
		const val  = pct != null ? parseFloat(pct).toFixed(2) : "—";
		const color = pct == null ? "#6b7280"
			: pct > 5  ? "#dc2626"
			: pct > 2  ? "#ea580c"
			: "#059669";
		this.$container.find("#ib-pd-wastage").html(`
			<div class="ib-pd-wastage-label">Avg Wastage Today</div>
			<div class="ib-pd-wastage-value" style="color:${color}">
				${val}${pct != null ? "%" : ""}
			</div>
		`);
	}

	_render_recent(entries) {
		if (!entries.length) {
			this.$container.find("#ib-pd-recent").html(
				`<div class="ib-pd-empty">No recent entries today.</div>`
			);
			return;
		}
		const rows = entries.map(e => {
			const wPct = e.wastage_pct != null ? parseFloat(e.wastage_pct).toFixed(2) + "%" : "—";
			return `
				<tr>
					<td>${frappe.datetime.str_to_user(e.entry_date) || e.entry_date || "—"}</td>
					<td><span style="color:${STAGE_COLORS[e.stage] || "#888"}">${
						(e.stage || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
					}</span></td>
					<td>${e.machine || "—"}</td>
					<td>${e.output_qty ?? "—"}</td>
					<td>${wPct}</td>
				</tr>
			`;
		}).join("");
		this.$container.find("#ib-pd-recent").html(`
			<table class="ib-pd-table">
				<thead>
					<tr>
						<th>Date</th>
						<th>Stage</th>
						<th>Machine</th>
						<th>Output Qty</th>
						<th>Wastage %</th>
					</tr>
				</thead>
				<tbody>${rows}</tbody>
			</table>
		`);
	}

	_render_actions() {
		this.$container.find("#ib-pd-actions").html(`
			<button class="ib-pd-quick-btn" onclick="frappe.set_route('ib-production-stages')">
				Production Stages →
			</button>
			<button class="ib-pd-quick-btn" onclick="frappe.set_route('List','IB Order Sheet')">
				Order Sheets →
			</button>
			<button class="ib-pd-quick-btn" onclick="frappe.set_route('ib-dpr')">
				DPR Report →
			</button>
		`);
	}

	_render_plan(order_sheets) {
		const $el = this.$container.find("#ib-pd-plan");
		if (!order_sheets.length) {
			$el.html(`<div class="ib-pd-empty">No active Order Sheets. Submit a Sales Order to auto-generate production.</div>`);
			return;
		}

		const priorityColor = { Urgent: "#dc2626", High: "#ea580c", Normal: "#2563eb", Low: "#6b7280" };
		const stageAbbr = {
			"Coating": "CT", "Slitting": "SL", "Rewinding": "RW", "Cutting": "CU",
			"Packing": "PK", "Ready to Deliver": "RTD", "Delivered": "DL",
		};
		const stageStatusCls = { "Completed": "ib-pd-stg--done", "In Progress": "ib-pd-stg--inprog", "Pending": "ib-pd-stg--pending" };

		const rows = order_sheets.map(os => {
			const pColor = priorityColor[os.priority] || "#6b7280";
			const itemRows = (os.items || []).map(item => {
				const currentStage = item.current_stage || "";
				const stagePills = Object.entries(item.stage_map || {}).map(([stage, info]) => {
					if (!info.status) return "";
					const cls = stageStatusCls[info.status] || "ib-pd-stg--pending";
					const abbr = stageAbbr[stage] || stage.substring(0, 3).toUpperCase();
					const title = `${stage}: ${info.status} (${info.completed_qty}/${info.target_qty})`;
					return `<span class="ib-pd-stg-chip ${cls}" title="${title}">${abbr}</span>`;
				}).join("");

				const completedStages = Object.values(item.stage_map || {}).filter(v => v.status === "Completed").length;
				const totalStages = Object.values(item.stage_map || {}).filter(v => v.status).length;
				const pct = totalStages ? Math.round(completedStages / totalStages * 100) : 0;

				return `
					<tr>
						<td class="ib-pd-plan-item">${item.item_code || ""}</td>
						<td>${item.qty || 0} ${item.uom || ""}</td>
						<td>${currentStage || "—"}</td>
						<td><div class="ib-pd-stg-pills">${stagePills}</div></td>
						<td>
							<div class="ib-pd-prog-bar-wrap">
								<div class="ib-pd-prog-bar" style="width:${pct}%"></div>
							</div>
							<span class="ib-pd-prog-pct">${pct}%</span>
						</td>
					</tr>`;
			}).join("");

			return `
				<div class="ib-pd-plan-card">
					<div class="ib-pd-plan-header">
						<div class="ib-pd-plan-so">
							<a href="/app/sales-order/${os.sales_order || ""}" target="_blank">${os.sales_order || os.name}</a>
							— ${os.customer_name || os.customer || ""}
						</div>
						<div class="ib-pd-plan-meta">
							<span class="ib-pd-priority-badge" style="background:${pColor};font-size:11px;padding:2px 10px">${os.priority}</span>
							${os.delivery_date ? `<span class="ib-pd-plan-date">📦 ${frappe.datetime.str_to_user(os.delivery_date)}</span>` : ""}
							<a href="/app/ib-order-sheet/${os.name}" target="_blank" class="ib-pd-plan-link">${os.name}</a>
						</div>
					</div>
					<table class="ib-pd-table ib-pd-plan-table">
						<thead>
							<tr><th>Item</th><th>Qty</th><th>Current Stage</th><th>Stages</th><th>Progress</th></tr>
						</thead>
						<tbody>${itemRows}</tbody>
					</table>
				</div>`;
		}).join("");

		$el.html(rows);
	}

	// ── Styles ────────────────────────────────────────────────────────────────
	_inject_styles() {
		if (document.getElementById("ib-pd-styles")) return;
		const style = document.createElement("style");
		style.id = "ib-pd-styles";
		style.textContent = `
			.ib-pd-page {
				padding: 20px 0;
				font-family: inherit;
			}
			.ib-pd-kpi-row {
				display: flex;
				gap: 16px;
				margin-bottom: 24px;
				flex-wrap: wrap;
			}
			.ib-pd-kpi-card {
				flex: 1;
				min-width: 160px;
				background: var(--card-bg, #fff);
				border: 1px solid var(--border-color, #e2e8f0);
				border-radius: 10px;
				padding: 18px 20px;
				box-shadow: 0 1px 4px rgba(0,0,0,.06);
			}
			.ib-pd-kpi-value {
				font-size: 28px;
				font-weight: 700;
				line-height: 1.1;
			}
			.ib-pd-kpi-label {
				font-size: 12px;
				color: var(--text-muted, #6b7280);
				margin-top: 4px;
				font-weight: 500;
			}
			.ib-pd-section-title {
				font-size: 13px;
				font-weight: 700;
				text-transform: uppercase;
				letter-spacing: .06em;
				color: var(--text-muted, #6b7280);
				margin: 20px 0 10px;
			}
			.ib-pd-pipeline {
				display: flex;
				gap: 12px;
				overflow-x: auto;
				padding-bottom: 6px;
				margin-bottom: 20px;
			}
			.ib-pd-pipeline-card {
				flex: 0 0 130px;
				background: var(--card-bg, #fff);
				border: 1px solid var(--border-color, #e2e8f0);
				border-radius: 10px;
				padding: 14px 12px;
				cursor: pointer;
				transition: box-shadow .15s, transform .15s;
				box-shadow: 0 1px 4px rgba(0,0,0,.06);
			}
			.ib-pd-pipeline-card:hover {
				box-shadow: 0 4px 14px rgba(0,0,0,.12);
				transform: translateY(-2px);
			}
			.ib-pd-pipeline-name {
				font-size: 11px;
				font-weight: 700;
				text-transform: uppercase;
				letter-spacing: .04em;
				margin-bottom: 10px;
			}
			.ib-pd-pipeline-stat {
				display: flex;
				align-items: center;
				gap: 6px;
				margin: 4px 0;
			}
			.ib-pd-ps-badge {
				font-size: 12px;
				font-weight: 700;
				min-width: 22px;
				text-align: center;
				border-radius: 4px;
				padding: 1px 5px;
			}
			.ib-pd-ps-badge.pending { background: #fef3c7; color: #92400e; }
			.ib-pd-ps-badge.inprog  { background: #dbeafe; color: #1e3a8a; }
			.ib-pd-ps-badge.done    { background: #d1fae5; color: #064e3b; }
			.ib-pd-ps-label {
				font-size: 11px;
				color: var(--text-muted, #6b7280);
			}
			.ib-pd-row-2 {
				display: flex;
				gap: 16px;
				margin-bottom: 20px;
				flex-wrap: wrap;
			}
			.ib-pd-priority-strip {
				flex: 1;
				min-width: 220px;
				background: var(--card-bg, #fff);
				border: 1px solid var(--border-color, #e2e8f0);
				border-radius: 10px;
				padding: 16px 18px;
			}
			.ib-pd-priority-title {
				font-size: 11px;
				font-weight: 700;
				text-transform: uppercase;
				letter-spacing: .06em;
				color: var(--text-muted, #6b7280);
				margin-bottom: 10px;
			}
			.ib-pd-priority-badges {
				display: flex;
				gap: 8px;
				flex-wrap: wrap;
			}
			.ib-pd-priority-badge {
				color: #fff;
				font-size: 12px;
				border-radius: 14px;
				padding: 4px 12px;
				font-weight: 500;
			}
			.ib-pd-wastage-card {
				min-width: 160px;
				background: var(--card-bg, #fff);
				border: 1px solid var(--border-color, #e2e8f0);
				border-radius: 10px;
				padding: 18px 24px;
				text-align: center;
				box-shadow: 0 1px 4px rgba(0,0,0,.06);
			}
			.ib-pd-wastage-label {
				font-size: 11px;
				font-weight: 700;
				text-transform: uppercase;
				letter-spacing: .06em;
				color: var(--text-muted, #6b7280);
				margin-bottom: 8px;
			}
			.ib-pd-wastage-value {
				font-size: 32px;
				font-weight: 700;
			}
			.ib-pd-table {
				width: 100%;
				border-collapse: collapse;
				background: var(--card-bg, #fff);
				border: 1px solid var(--border-color, #e2e8f0);
				border-radius: 10px;
				overflow: hidden;
				font-size: 13px;
				margin-bottom: 20px;
			}
			.ib-pd-table th {
				background: var(--subtle-fg, #f8fafc);
				font-size: 11px;
				font-weight: 700;
				text-transform: uppercase;
				letter-spacing: .05em;
				color: var(--text-muted, #6b7280);
				padding: 10px 12px;
				text-align: left;
				border-bottom: 1px solid var(--border-color, #e2e8f0);
			}
			.ib-pd-table td {
				padding: 9px 12px;
				border-bottom: 1px solid var(--border-color, #f1f5f9);
				color: var(--text-color, #1e293b);
			}
			.ib-pd-table tr:last-child td { border-bottom: none; }
			.ib-pd-table tr:nth-child(even) td { background: var(--subtle-fg, #f8fafc); }
			.ib-pd-quick-actions {
				display: flex;
				gap: 12px;
				flex-wrap: wrap;
				margin-top: 8px;
			}
			.ib-pd-quick-btn {
				background: #d97757;
				color: #fff;
				border: none;
				border-radius: 8px;
				padding: 9px 20px;
				font-size: 13px;
				font-weight: 600;
				cursor: pointer;
				transition: background .15s;
			}
			.ib-pd-quick-btn:hover { background: #c4623e; }
			.ib-pd-empty {
				padding: 24px;
				color: var(--text-muted, #6b7280);
				font-size: 13px;
				text-align: center;
			}
			.ib-pd-refresh-time {
				font-size: 11px;
				color: var(--text-muted, #6b7280);
				margin-right: 8px;
			}
			.ib-pd-plan-card {
				background: var(--card-bg, #fff);
				border: 1px solid var(--border-color, #e2e8f0);
				border-radius: 10px;
				margin-bottom: 14px;
				overflow: hidden;
			}
			.ib-pd-plan-header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				padding: 10px 14px;
				background: var(--subtle-fg, #f8fafc);
				border-bottom: 1px solid var(--border-color, #e2e8f0);
				flex-wrap: wrap;
				gap: 6px;
			}
			.ib-pd-plan-so {
				font-size: 13px;
				font-weight: 600;
				color: var(--text-color, #1e293b);
			}
			.ib-pd-plan-meta {
				display: flex;
				align-items: center;
				gap: 8px;
			}
			.ib-pd-plan-date {
				font-size: 11px;
				color: var(--text-muted, #6b7280);
			}
			.ib-pd-plan-link {
				font-size: 11px;
				color: var(--primary, #d97757);
				text-decoration: none;
			}
			.ib-pd-plan-item { font-size: 12px; font-family: monospace; color: #1e293b; }
			.ib-pd-plan-table { margin-bottom: 0; border-radius: 0; border: none; }
			.ib-pd-stg-pills { display: flex; gap: 3px; flex-wrap: wrap; }
			.ib-pd-stg-chip {
				font-size: 10px;
				font-weight: 700;
				border-radius: 4px;
				padding: 2px 5px;
				letter-spacing: .03em;
				cursor: default;
			}
			.ib-pd-stg--done    { background: #d1fae5; color: #065f46; }
			.ib-pd-stg--inprog  { background: #dbeafe; color: #1e3a8a; }
			.ib-pd-stg--pending { background: #f1f5f9; color: #64748b; }
			.ib-pd-prog-bar-wrap {
				height: 6px;
				background: #e2e8f0;
				border-radius: 3px;
				overflow: hidden;
				width: 80px;
				display: inline-block;
				vertical-align: middle;
				margin-right: 4px;
			}
			.ib-pd-prog-bar {
				height: 100%;
				background: #059669;
				border-radius: 3px;
				transition: width .3s;
			}
			.ib-pd-prog-pct { font-size: 11px; color: var(--text-muted, #6b7280); }
		`;
		document.head.appendChild(style);
	}
}
