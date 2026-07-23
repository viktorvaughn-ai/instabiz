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
		this.wrapper   = wrapper;
		this.page      = wrapper.page;
		this._fetching = false;
		this._inject_styles();
		this._build_layout();
		this._add_toolbar_buttons();
		this.refresh();
	}

	// ── Public ────────────────────────────────────────────────────────────────
	refresh() {
		if (this._fetching) return;
		this._fetching = true;
		this._set_refresh_label("Loading…");
		this.$container.find("#ib-pd-kpis").html(window.ib_skel_kpis ? ib_skel_kpis(4) : "");

		let _done = 0;
		const _total = 4;
		const _check_done = () => {
			if (++_done >= _total) {
				this._fetching = false;
				this._set_refresh_label("Updated " + frappe.datetime.now_time());
				ib_countup_all && ib_countup_all(this.$container);
			}
		};

		frappe.call({
			method: "instabiz.overrides.production.get_production_dashboard",
			callback: (r) => {
				if (r.message) this._render(r.message);
				else this._set_refresh_label("No data");
				_check_done();
			},
			error: () => { this._set_refresh_label("Error loading data"); _check_done(); },
		});
		frappe.call({
			method: "instabiz.overrides.production.get_production_plan",
			args: { limit: 25 },
			callback: (r) => {
				if (r.message) this._render_plan(r.message.order_wise || []);
				_check_done();
			},
			error: () => _check_done(),
		});
		frappe.call({
			method: "instabiz.overrides.ai_agents.get_ai_actions",
			args: { status: "pending", agent: "all", start: 0, page_length: 5 },
			callback: (r) => {
				if (r.message) {
					const prodAgents = ["prod_advance","prod_machine_assign","prod_notify_ready","prod_auto_os","prod_job_bundle"];
					const prodActions = (r.message.actions || []).filter(a => prodAgents.includes(a.agent));
					this._render_ai_prod_actions(prodActions);
				}
				_check_done();
			},
			error: () => _check_done(),
		});
		frappe.call({
			method: "instabiz.overrides.production.get_n8n_status",
			callback: (r) => {
				if (r.message) this._render_n8n_bar(r.message);
				_check_done();
			},
			error: () => _check_done(),
		});
	}

	// ── Layout ────────────────────────────────────────────────────────────────
	_build_layout() {
		this.$container = $(`
			<div class="ib-pd-page container">
				<div style="text-align:right;margin-bottom:8px">
					<span id="ib-pd-refresh-ts" class="ib-pd-refresh-time"></span>
				</div>
				<div id="ib-pd-n8n-bar"></div>
				<div class="ib-pd-kpi-row" id="ib-pd-kpis"></div>
				<div class="ib-pd-section-title">Pipeline</div>
				<div class="ib-pd-pipeline" id="ib-pd-pipeline"></div>
				<div class="ib-pd-row-2">
					<div class="ib-pd-priority-strip" id="ib-pd-priority"></div>
					<div class="ib-pd-wastage-card" id="ib-pd-wastage"></div>
				</div>
				<div class="ib-pd-section-title" id="ib-pd-ai-title" style="display:none">
					<iconify-icon icon="lucide:bot" width="13" height="13" style="vertical-align:middle;margin-right:5px"></iconify-icon>
					AI Production Actions
					<span id="ib-pd-ai-count" style="margin-left:6px;background:#2563eb;color:#fff;
						border-radius:10px;padding:1px 7px;font-size:10px;font-weight:700"></span>
				</div>
				<div id="ib-pd-ai-actions"></div>
				<div class="ib-pd-section-title" id="ib-pd-bundles-title" style="display:none">
					<iconify-icon icon="lucide:layers" width="13" height="13" style="vertical-align:middle;margin-right:5px"></iconify-icon>
					Job Bundles
				</div>
				<div id="ib-pd-bundles"></div>
				<div class="ib-pd-section-title">Active Production Plan</div>
				<div id="ib-pd-plan"></div>
				<div class="ib-pd-section-title">Recent Entries</div>
				<div id="ib-pd-recent"></div>
				<div class="ib-pd-quick-actions" id="ib-pd-actions"></div>
			</div>
		`).appendTo($(this.wrapper).find(".layout-main-section"));
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
		const today = frappe.datetime.get_today();
		const kpis = [
			{
				label: "Active Work Orders", value: s.active_work_orders ?? 0, color: "#2563eb", icon: "layers",
				sub: "Pending + In Progress",
				click() { frappe.route_options = { status: ["not in", ["Completed", "Cancelled"]] }; frappe.set_route("List", "IB Work Order"); },
			},
			{
				label: "Pending", value: s.pending ?? 0, color: "#d97706", icon: "clock",
				sub: "Awaiting start",
				click() { frappe.route_options = { status: "Pending" }; frappe.set_route("List", "IB Work Order"); },
			},
			{
				label: "Completed Today", value: s.completed_today ?? 0, color: "#059669", icon: "check-circle",
				sub: frappe.datetime.str_to_user(today),
				click() { frappe.route_options = { status: "Completed", modified: [">=", today] }; frappe.set_route("List", "IB Work Order"); },
			},
			{
				label: "Machines Active", value: s.machines_active ?? 0, color: "#0891b2", icon: "settings-2",
				sub: "Production floor",
				click() { frappe.set_route("List", "IB Machine"); },
			},
		];
		const $kpis = this.$container.find("#ib-pd-kpis").html(kpis.map((k, i) => `
			<div class="ib-pd-kpi-card ib-pd-kpi--link" data-kpi="${i}" style="border-top:3px solid ${k.color};cursor:pointer">
				<div class="ib-pd-kpi-icon-row">
					<div class="ib-pd-kpi-icon-wrap" style="background:${k.color}15;color:${k.color}">
						<iconify-icon icon="lucide:${k.icon}" width="16" height="16"></iconify-icon>
					</div>
					<div class="ib-pd-kpi-arrow" style="color:${k.color}">
						<iconify-icon icon="lucide:arrow-up-right" width="12" height="12"></iconify-icon>
					</div>
				</div>
				<div class="ib-pd-kpi-value" style="color:${k.color}">${k.value}</div>
				<div class="ib-pd-kpi-label">${k.label}</div>
				<div class="ib-pd-kpi-sub">${k.sub || ""}</div>
			</div>
		`).join(""));
		$kpis.find(".ib-pd-kpi--link").on("click", (e) => {
			kpis[parseInt($(e.currentTarget).data("kpi"), 10)].click();
		});
	}

	_render_pipeline(stages) {
		if (!stages.length) {
			stages = Object.keys(STAGE_COLORS).map(s => ({
				stage: s, pending: 0, in_progress: 0, completed: 0,
			}));
		}
		const STAGE_ICONS = {
			coating: "layers", slitting: "scissors", rewinding: "refresh-cw",
			cutting: "crop", packing: "package", ready_to_deliver: "truck", delivered: "check-circle",
		};
		const html = stages.map(s => {
			const color = STAGE_COLORS[s.stage] || "#888";
			const label = s.stage.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
			const total = (s.pending ?? 0) + (s.in_progress ?? 0) + (s.completed ?? 0);
			const active_pct = total > 0 ? Math.round(((s.in_progress ?? 0) / total) * 100) : 0;
			const done_pct = total > 0 ? Math.round(((s.completed ?? 0) / total) * 100) : 0;
			const icon_name = STAGE_ICONS[s.stage] || "circle";
			return `
				<div class="ib-pd-pipeline-card" style="border-top:3px solid ${color}"
					data-stage="${s.stage}" title="Go to ${label} in Production Stages">
					<div class="ib-pd-pipe-head">
						<span class="ib-pd-pipe-icon" style="background:${color}15;color:${color}">
						<iconify-icon icon="lucide:${icon_name}" width="14" height="14"></iconify-icon>
					</span>
						<span class="ib-pd-pipeline-name" style="color:${color}">${label}</span>
					</div>
					<div class="ib-pd-pipe-total" style="color:${color}">${total}</div>
					<div class="ib-pd-pipe-sublabel">total WOs</div>
					<div class="ib-pd-pipe-bar-stack">
						<div title="In Progress: ${s.in_progress}" style="width:${active_pct}%;background:${color};opacity:.85"></div>
						<div title="Completed: ${s.completed}" style="width:${done_pct}%;background:${color}40"></div>
					</div>
					<div class="ib-pd-pipe-counts">
						<span class="ib-pd-ps-badge pending">${s.pending ?? 0}</span>
						<span class="ib-pd-ps-badge inprog">${s.in_progress ?? 0}</span>
						<span class="ib-pd-ps-badge done">${s.completed ?? 0}</span>
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

			const itemCount = (os.items || []).length;
			const collapsedByDefault = itemCount > 2;

			return `
				<div class="ib-pd-plan-card">
					<div class="ib-pd-plan-header ib-pd-plan-toggle" data-os="${os.name}" style="cursor:pointer">
						<iconify-icon icon="lucide:chevron-right" width="13" height="13" class="ib-pd-plan-chevron"
							style="flex-shrink:0;transition:transform .15s;${collapsedByDefault ? "" : "transform:rotate(90deg)"}"></iconify-icon>
						<div class="ib-pd-plan-so">
							<a href="/app/sales-order/${os.sales_order || ""}" target="_blank" onclick="event.stopPropagation()">${os.sales_order || os.name}</a>
							— ${os.customer_name || os.customer || ""}
							<span style="color:var(--text-muted);font-size:11px;font-weight:400">(${itemCount} item${itemCount !== 1 ? "s" : ""})</span>
						</div>
						<div class="ib-pd-plan-meta">
							<span class="ib-pd-priority-badge" style="background:${pColor};font-size:11px;padding:2px 10px">${os.priority}</span>
							${os.delivery_date ? `<span class="ib-pd-plan-date"><iconify-icon icon="lucide:calendar" width="12" height="12" style="vertical-align:middle;margin-right:3px"></iconify-icon>${frappe.datetime.str_to_user(os.delivery_date)}</span>` : ""}
							<a href="/app/ib-order-sheet/${os.name}" target="_blank" class="ib-pd-plan-link" onclick="event.stopPropagation()">${os.name}</a>
						</div>
					</div>
					<table class="ib-pd-table ib-pd-plan-table" data-os-body="${os.name}" style="${collapsedByDefault ? "display:none" : ""}">
						<thead>
							<tr><th>Item</th><th>Qty</th><th>Current Stage</th><th>Stages</th><th>Progress</th></tr>
						</thead>
						<tbody>${itemRows}</tbody>
					</table>
				</div>`;
		}).join("");

		$el.html(rows);
		$el.off("click", ".ib-pd-plan-toggle").on("click", ".ib-pd-plan-toggle", (e) => {
			const os = $(e.currentTarget).data("os");
			const $body = $el.find(`[data-os-body="${os}"]`);
			const $chevron = $(e.currentTarget).find(".ib-pd-plan-chevron");
			const opening = $body.css("display") === "none";
			$body.css("display", opening ? "" : "none");
			$chevron.css("transform", opening ? "rotate(90deg)" : "");
		});
	}

	// ── n8n status bar ────────────────────────────────────────────────────────
	_render_n8n_bar(n8n) {
		const $bar = this.$container.find("#ib-pd-n8n-bar");
		if (!n8n) { $bar.hide(); return; }
		const configured = n8n.configured;
		const icon  = configured ? "lucide:plug-zap" : "lucide:plug";
		const color = configured ? "#059669" : "#9ca3af";
		const label = configured ? "n8n Connected" : "n8n Not Configured";
		const hint  = configured ? "" : `
			<a href="${n8n.n8n_ui}" target="_blank"
				style="font-size:11px;color:var(--primary);margin-left:8px">
				Open n8n UI
			</a>
			<span style="font-size:11px;color:var(--text-muted);margin-left:8px">
				→ set n8n_webhook_url in site_config.json
			</span>`;
		$bar.html(`
			<div style="padding:8px 12px;background:${color}0d;border:1px solid ${color}30;
				border-radius:6px;margin-bottom:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
				<iconify-icon icon="${icon}" width="14" height="14" style="color:${color};flex-shrink:0"></iconify-icon>
				<span style="font-size:12px;font-weight:600;color:${color}">${label}</span>
				${hint}
				${configured ? `
				<button onclick="frappe.call({
					method:'instabiz.overrides.production.test_n8n_connection',
					callback(r){
						const msg = r.message.ok ? 'n8n ping OK' : ('n8n error: ' + r.message.error);
						frappe.show_alert({message:msg,indicator:r.message.ok?'green':'red'});
					}
				})"
				style="margin-left:auto;background:none;border:1px solid ${color};color:${color};
					border-radius:4px;padding:2px 10px;font-size:11px;cursor:pointer">
					<iconify-icon icon="lucide:activity" width="11" height="11"
						style="vertical-align:middle;margin-right:3px"></iconify-icon>
					Test
				</button>` : ""}
			</div>
		`).show();
	}

	// ── AI prod actions panel ─────────────────────────────────────────────────
	_render_ai_prod_actions(actions) {
		const $el    = this.$container.find("#ib-pd-ai-actions");
		const $title = this.$container.find("#ib-pd-ai-title");
		const $count = this.$container.find("#ib-pd-ai-count");
		if (!actions.length) { $el.html(""); $title.hide(); return; }

		$title.show();
		$count.text(actions.length);

		const AGENT_LABELS = {
			prod_advance:       { label: "Advance Stage",     icon: "lucide:fast-forward",   color: "#2563eb" },
			prod_machine_assign:{ label: "Assign Machine",    icon: "lucide:settings-2",      color: "#0891b2" },
			prod_notify_ready:  { label: "Notify Sales",      icon: "lucide:bell",            color: "#ea580c" },
			prod_auto_os:       { label: "Create Order Sheet",icon: "lucide:file-plus",       color: "#7c3aed" },
			prod_job_bundle:    { label: "Bundle Jobs",       icon: "lucide:layers",          color: "#059669" },
		};

		const cards = actions.map(a => {
			const meta  = AGENT_LABELS[a.agent] || { label: a.agent, icon: "lucide:bot", color: "#888" };
			const refLink = a.reference_doctype && a.reference_name
				? `<a href="/app/${frappe.router.slug(a.reference_doctype)}/${a.reference_name}"
						target="_blank" style="font-size:11px;color:var(--primary)">${a.reference_name}</a>`
				: "";
			return `
			<div class="ib-pd-ai-card" data-action="${frappe.utils.escape_html(a.name)}">
				<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
					<iconify-icon icon="${meta.icon}" width="14" height="14"
						style="color:${meta.color};flex-shrink:0"></iconify-icon>
					<span style="font-size:11px;font-weight:700;text-transform:uppercase;
						color:${meta.color};letter-spacing:.04em">${meta.label}</span>
					${refLink}
					<span style="margin-left:auto;font-size:10px;color:var(--text-muted)">
						${frappe.datetime.str_to_user(a.creation)}</span>
				</div>
				<div style="font-size:12px;color:var(--text-color);margin-bottom:8px">
					${frappe.utils.escape_html(a.title || "")}</div>
				<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;
					white-space:pre-wrap">${frappe.utils.escape_html(a.summary || "")}</div>
				<div style="display:flex;gap:6px">
					<button class="ib-pd-ai-btn ib-pd-ai-approve" data-name="${frappe.utils.escape_html(a.name)}"
						style="background:#059669;color:#fff;border:none;border-radius:5px;
						padding:4px 12px;font-size:11px;font-weight:600;cursor:pointer">
						<iconify-icon icon="lucide:check" width="11" height="11"
							style="vertical-align:middle;margin-right:3px"></iconify-icon>
						Approve
					</button>
					<button class="ib-pd-ai-btn ib-pd-ai-reject" data-name="${frappe.utils.escape_html(a.name)}"
						style="background:none;border:1px solid #dc2626;color:#dc2626;border-radius:5px;
						padding:4px 12px;font-size:11px;font-weight:600;cursor:pointer">
						<iconify-icon icon="lucide:x" width="11" height="11"
							style="vertical-align:middle;margin-right:3px"></iconify-icon>
						Reject
					</button>
					<a href="/app/ib-ai-inbox" style="font-size:11px;color:var(--primary);
						margin-left:auto;align-self:center;text-decoration:none">
						View all in AI Inbox
						<iconify-icon icon="lucide:arrow-right" width="11" height="11"
							style="vertical-align:middle"></iconify-icon>
					</a>
				</div>
			</div>`;
		}).join("");

		$el.html(`<div class="ib-pd-ai-list">${cards}</div>`);

		$el.find(".ib-pd-ai-approve").on("click", (e) => {
			const name = $(e.currentTarget).data("name");
			frappe.call({
				method: "instabiz.overrides.ai_agents.approve_action",
				args: { name },
				callback: (r) => {
					frappe.show_alert({ message: r.message?.result || "Approved", indicator: "green" });
					$(e.currentTarget).closest(".ib-pd-ai-card").fadeOut(300, function() { $(this).remove(); });
				},
				error: () => frappe.show_alert({ message: "Approve failed", indicator: "red" }),
			});
		});
		$el.find(".ib-pd-ai-reject").on("click", (e) => {
			const name = $(e.currentTarget).data("name");
			frappe.call({
				method: "instabiz.overrides.ai_agents.reject_action",
				args: { name },
				callback: () => {
					frappe.show_alert({ message: "Rejected", indicator: "orange" });
					$(e.currentTarget).closest(".ib-pd-ai-card").fadeOut(300, function() { $(this).remove(); });
				},
				error: () => frappe.show_alert({ message: "Reject failed", indicator: "red" }),
			});
		});
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
				min-width: 155px;
				background: var(--card-bg, #fff);
				border: 1px solid var(--border-color, #e2e8f0);
				border-radius: 10px;
				padding: 16px 18px;
				box-shadow: 0 1px 4px rgba(0,0,0,.06);
				transition: transform .12s, box-shadow .12s;
			}
			.ib-pd-kpi-card:hover { transform: translateY(-2px); box-shadow: 0 4px 14px rgba(0,0,0,.10); }
			.ib-pd-kpi-icon-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
			.ib-pd-kpi-icon-wrap { width: 32px; height: 32px; border-radius: 8px; display:inline-flex; align-items:center; justify-content:center; }
			.ib-pd-kpi-arrow { opacity: .4; }
			.ib-pd-kpi-value {
				font-size: 30px;
				font-weight: 700;
				line-height: 1.05;
			}
			.ib-pd-kpi-label {
				font-size: 12px;
				color: var(--text-color, #374151);
				margin-top: 4px;
				font-weight: 600;
			}
			.ib-pd-kpi-sub {
				font-size: 11px;
				color: var(--text-muted, #6b7280);
				margin-top: 2px;
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
				flex: 0 0 145px;
				background: var(--card-bg, #fff);
				border: 1px solid var(--border-color, #e2e8f0);
				border-radius: 10px;
				padding: 14px 13px;
				cursor: pointer;
				transition: box-shadow .15s, transform .15s;
				box-shadow: 0 1px 3px rgba(0,0,0,.05);
			}
			.ib-pd-pipeline-card:hover {
				box-shadow: 0 6px 18px rgba(0,0,0,.12);
				transform: translateY(-3px);
			}
			.ib-pd-pipe-head { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
			.ib-pd-pipe-icon { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 6px; flex-shrink: 0; }
			.ib-pd-pipeline-name {
				font-size: 11px;
				font-weight: 700;
				text-transform: uppercase;
				letter-spacing: .04em;
			}
			.ib-pd-pipe-total { font-size: 26px; font-weight: 700; line-height: 1; margin-bottom: 2px; }
			.ib-pd-pipe-sublabel { font-size: 10px; color: var(--text-muted, #6b7280); margin-bottom: 8px; }
			.ib-pd-pipe-bar-stack {
				height: 4px; border-radius: 2px;
				background: var(--border-color, #e2e8f0);
				overflow: hidden; display: flex;
				margin-bottom: 8px;
			}
			.ib-pd-pipe-bar-stack > div { height: 100%; }
			.ib-pd-pipe-counts { display: flex; gap: 4px; }
			.ib-pd-ps-badge {
				font-size: 11px;
				font-weight: 700;
				min-width: 20px;
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
			.ib-pd-ai-list {
				display: grid;
				grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
				gap: 12px;
				margin-bottom: 20px;
			}
			.ib-pd-ai-card {
				background: var(--card-bg, #fff);
				border: 1px solid var(--border-color, #e2e8f0);
				border-radius: 8px;
				padding: 12px 14px;
				box-shadow: 0 1px 3px rgba(0,0,0,.05);
			}
		`;
		document.head.appendChild(style);
	}
}
