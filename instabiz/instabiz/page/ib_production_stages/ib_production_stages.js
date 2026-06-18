frappe.pages["ib-production-stages"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: "Production Stages",
		single_column: true,
	});
	const page = new IBProductionStages(wrapper);
	wrapper._page_instance = page;
};

frappe.pages["ib-production-stages"].on_page_show = function (wrapper) {
	if (wrapper._page_instance) {
		wrapper._page_instance.refresh();
	}
};

// ---------------------------------------------------------------------------
// Stage definitions
// ---------------------------------------------------------------------------
const IB_STAGES = [
	{ key: "coating", label: "Coating", color: "#7c3aed" },
	{ key: "slitting", label: "Slitting", color: "#2563eb" },
	{ key: "rewinding", label: "Rewinding", color: "#0891b2" },
	{ key: "cutting", label: "Cutting", color: "#059669" },
	{ key: "packing", label: "Packing", color: "#d97706" },
	{ key: "ready_to_deliver", label: "Ready to Deliver", color: "#ea580c" },
	{ key: "delivered", label: "Delivered", color: "#10b981" },
];

const IB_PRIORITY_META = {
	Urgent: { cls: "ib-ps-badge--urgent", label: "Urgent" },
	High: { cls: "ib-ps-badge--high", label: "High" },
	Normal: { cls: "ib-ps-badge--normal", label: "Normal" },
	Low: { cls: "ib-ps-badge--low", label: "Low" },
};

// ---------------------------------------------------------------------------
// Stage-specific entry fields
// ---------------------------------------------------------------------------
const STAGE_FIELDS = {
	coating: [
		{ fieldname: "jumbo_roll_width", label: "Jumbo Roll Width (mm)", fieldtype: "Float" },
		{ fieldname: "jumbo_roll_length", label: "Jumbo Roll Length (m)", fieldtype: "Float" },
		{ fieldname: "coating_speed", label: "Coating Speed (m/min)", fieldtype: "Float" },
		{ fieldname: "adhesive_consumption", label: "Adhesive Consumption (kg)", fieldtype: "Float" },
	],
	slitting: [
		{ fieldname: "no_of_slits", label: "No. of Slits", fieldtype: "Int" },
		{ fieldname: "slit_widths", label: "Slit Widths (mm, comma separated)", fieldtype: "Data" },
		{ fieldname: "edge_trim_width", label: "Edge Trim Width (mm)", fieldtype: "Float" },
	],
	rewinding: [
		{ fieldname: "no_of_logs", label: "No. of Logs", fieldtype: "Int" },
		{ fieldname: "log_length", label: "Log Length (m)", fieldtype: "Float" },
		{
			fieldname: "core_size",
			label: "Core Size",
			fieldtype: "Select",
			options: ["1 inch", "1.5 inch", "2 inch", "3 inch"],
		},
	],
	cutting: [
		{ fieldname: "cut_length", label: "Cut Length (m)", fieldtype: "Float" },
		{ fieldname: "pieces_per_log", label: "Pieces per Log", fieldtype: "Int" },
	],
	packing: [
		{
			fieldname: "packing_type",
			label: "Packing Type",
			fieldtype: "Select",
			options: ["Carton", "Shrink Wrap", "Poly Bag", "Loose"],
		},
		{ fieldname: "pieces_per_carton", label: "Pieces per Carton", fieldtype: "Int" },
		{ fieldname: "cartons_packed", label: "Cartons Packed", fieldtype: "Int" },
		{
			fieldname: "qc_status",
			label: "QC Status",
			fieldtype: "Select",
			options: ["Pass", "Fail", "Pending"],
		},
	],
};

const WASTAGE_REASONS = [
	"Defective Material",
	"Machine Error",
	"Operator Error",
	"Edge Trim",
	"Start-up Waste",
	"Other",
];

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------
class IBProductionStages {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = wrapper.page;
		this.$body = $(wrapper).find(".page-content");

		// State
		this.active_tab = "pipeline";
		this.os_status_filter = "All";
		this.os_priority_filter = "All";
		this.current_os = null;
		this.current_os_tab = "order_wise";
		this.active_wo = null;
		this.machines_cache = null;
		this.item_wise_search = "";

		this._inject_styles();
		this._build_shell();
		this.refresh();
	}

	// -----------------------------------------------------------------------
	// Shell / toolbar
	// -----------------------------------------------------------------------
	_build_shell() {
		// Toolbar tabs
		const tabs_html = `
			<div class="ib-ps-tabs">
				<button class="ib-ps-tab active" data-tab="pipeline">Pipeline</button>
				<button class="ib-ps-tab" data-tab="item_wise">Item-wise</button>
				<button class="ib-ps-tab" data-tab="order_wise">Order-wise</button>
				<button class="ib-ps-tab" data-tab="machine_wise">Machine-wise</button>
				<button class="ib-ps-refresh-btn" id="ib-ps-refresh">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4"/></svg>
					Refresh
				</button>
			</div>`;

		this.$body.html(`
			${tabs_html}
			<div class="ib-ps-content" id="ib-ps-content"></div>
			<div class="ib-ps-side-backdrop" id="ib-ps-backdrop" style="display:none"></div>
			<div class="ib-ps-side-panel" id="ib-ps-side-panel" style="display:none"></div>
		`);

		// Tab clicks
		this.$body.on("click", ".ib-ps-tab", (e) => {
			const tab = $(e.currentTarget).data("tab");
			this._switch_tab(tab);
		});

		this.$body.on("click", "#ib-ps-refresh", () => this.refresh());

		// Side panel close via backdrop
		this.$body.on("click", "#ib-ps-backdrop", () => this._close_side_panel());
	}

	_switch_tab(tab) {
		this.active_tab = tab;
		this.current_os = null;
		this.$body.find(".ib-ps-tab").removeClass("active");
		this.$body.find(`.ib-ps-tab[data-tab="${tab}"]`).addClass("active");
		this._close_side_panel();
		this.refresh();
	}

	refresh() {
		if (this.active_tab === "pipeline") {
			this._load_pipeline();
		} else if (this.active_tab === "item_wise") {
			this._load_item_wise();
		} else if (this.active_tab === "order_wise") {
			if (this.current_os) {
				this._load_os_detail(this.current_os);
			} else {
				this._load_order_sheets();
			}
		} else if (this.active_tab === "machine_wise") {
			this._load_machine_wise();
		}
	}

	_content() {
		return this.$body.find("#ib-ps-content");
	}

	// -----------------------------------------------------------------------
	// TAB 1 — Pipeline
	// -----------------------------------------------------------------------
	_load_pipeline() {
		const $c = this._content();
		$c.html('<div class="ib-ps-loading">Loading pipeline…</div>');
		frappe.call({
			method: "instabiz.overrides.production.get_stage_pipeline",
			callback: (r) => {
				if (r.exc) {
					$c.html('<div class="ib-ps-empty">Failed to load pipeline.</div>');
					return;
				}
				this._render_pipeline(r.message || {});
			},
		});
	}

	_render_pipeline(data) {
		const $c = this._content();

		const cols = IB_STAGES.map((s) => {
			const wos = (data[s.key] || []);
			const count = wos.length;
			const cards = wos.length
				? wos.map((wo) => this._wo_card_html(wo, s)).join("")
				: `<div class="ib-ps-col-empty">No WOs</div>`;

			return `
				<div class="ib-ps-col">
					<div class="ib-ps-col-header" style="border-top:3px solid ${s.color}">
						<span class="ib-ps-col-title">${s.label}</span>
						<span class="ib-ps-count-badge" style="background:${s.color}">${count}</span>
					</div>
					<div class="ib-ps-col-body">${cards}</div>
				</div>`;
		}).join("");

		$c.html(`<div class="ib-ps-pipeline">${cols}</div>`);

		// WO card click → side panel
		$c.on("click", ".ib-ps-wo-card", (e) => {
			const wo = $(e.currentTarget).data("wo");
			const stage = $(e.currentTarget).data("stage");
			this._open_wo_panel(wo, stage);
		});
	}

	_wo_card_html(wo, stage) {
		const pct = wo.target_qty > 0 ? Math.min(100, Math.round((wo.completed_qty / wo.target_qty) * 100)) : 0;
		const pm = IB_PRIORITY_META[wo.priority] || IB_PRIORITY_META["Normal"];
		const machine_chip = wo.machine ? `<span class="ib-ps-machine-chip">${frappe.utils.escape_html(wo.machine)}</span>` : "";
		const status_chip = `<span class="ib-ps-status-chip ib-ps-status--${(wo.status || "pending").toLowerCase().replace(/ /g, "_")}">${frappe.utils.escape_html(wo.status || "Pending")}</span>`;

		return `
			<div class="ib-ps-wo-card" data-wo='${JSON.stringify(wo)}' data-stage="${stage.key}">
				<div class="ib-ps-card-top">
					<span class="ib-ps-item-code">${frappe.utils.escape_html(wo.item_code || "")}</span>
					<span class="ib-ps-priority-badge ${pm.cls}">${pm.label}</span>
				</div>
				<div class="ib-ps-card-meta">
					${machine_chip}
					${status_chip}
				</div>
				<div class="ib-ps-progress-wrap">
					<div class="ib-ps-progress-bar" style="width:${pct}%;background:${stage.color}"></div>
				</div>
				<div class="ib-ps-progress-label">${wo.completed_qty || 0} / ${wo.target_qty || 0}</div>
			</div>`;
	}

	// -----------------------------------------------------------------------
	// TAB 2 — Item-wise view
	// -----------------------------------------------------------------------
	_load_item_wise() {
		const $c = this._content();
		$c.html('<div class="ib-ps-loading">Loading item view…</div>');
		frappe.call({
			method: "instabiz.overrides.production.get_item_wise_view",
			callback: (r) => {
				if (r.exc) {
					$c.html('<div class="ib-ps-empty">Failed to load item view.</div>');
					return;
				}
				this._render_item_wise(r.message || []);
			},
		});
	}

	_render_item_wise(items) {
		const $c = this._content();
		if (!items.length) {
			$c.html('<div class="ib-ps-empty">No active production items found.</div>');
			return;
		}

		const toolbar = `
			<div class="ib-ps-os-toolbar" style="margin-bottom:12px">
				<input class="ib-ps-search-input" id="ib-iw-search" placeholder="Search item code…" value="${frappe.utils.escape_html(this.item_wise_search || "")}">
				<span class="ib-ps-stat-pill">${items.length} items</span>
			</div>`;

		const cards = items.map((item) => this._item_wise_card(item)).join("");
		$c.html(toolbar + `<div class="ib-iw-grid" id="ib-iw-grid">${cards}</div>`);

		$c.on("input", "#ib-iw-search", (e) => {
			const q = $(e.target).val().toLowerCase();
			this.item_wise_search = q;
			$c.find(".ib-iw-card").each(function () {
				const ic = ($(this).data("item") || "").toLowerCase();
				$(this).toggle(!q || ic.includes(q));
			});
		});

		if (this.item_wise_search) {
			$c.find("#ib-iw-search").trigger("input");
		}

		$c.on("click", ".ib-iw-card", (e) => {
			const ic = $(e.currentTarget).data("item");
			const item = items.find((x) => x.item_code === ic);
			if (item) this._show_item_detail(item);
		});

		$c.on("click", ".ib-iw-link-jr-btn", (e) => {
			e.stopPropagation();
			const wo_name = $(e.currentTarget).data("wo");
			const ic = $(e.currentTarget).closest(".ib-iw-card").data("item");
			const item = items.find((x) => x.item_code === ic);
			this._show_link_jr_dialog(wo_name, () => this._load_item_wise());
		});
	}

	_item_wise_card(item) {
		const pct = item.completion_pct || 0;
		const active_stages = (item.stages_active || []).map((s) => {
			const stg = IB_STAGES.find((x) => x.label === s || x.key === s.toLowerCase().replace(/ /g, "_"));
			const color = stg ? stg.color : "#888";
			return `<span class="ib-ps-stage-chip" style="background:${color}">${frappe.utils.escape_html(s)}</span>`;
		}).join("");

		const jr_pills = (item.jumbo_rolls || []).map((jr) => {
			const sqm_label = jr.sqm ? `${jr.sqm} SQMT` : (jr.width_mm && jr.length_mtr ? `${((jr.width_mm / 1000) * jr.length_mtr).toFixed(2)} SQMT` : "");
			return `
			<span class="ib-iw-jr-pill" title="${frappe.utils.escape_html(jr.name || "")} · ${sqm_label}">
				<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
				${frappe.utils.escape_html(jr.batch_no || jr.name || "JR")}
				${sqm_label ? `<span style="font-weight:400;color:var(--text-muted)">${sqm_label}</span>` : ""}
				<span class="ib-iw-jr-status ib-iw-jr-${(jr.status || "").toLowerCase().replace(/ /g, "_")}">${frappe.utils.escape_html(jr.status || "")}</span>
			</span>`;
		}).join("");

		const no_jr_wos = (item.work_orders || []).filter((wo) =>
			!wo.jumbo_roll && (wo.stage === "Coating" || wo.stage === "Slitting")
		);
		const link_btns = no_jr_wos.map((wo) => `
			<button class="ib-iw-link-jr-btn ib-ps-btn-sm" data-wo="${frappe.utils.escape_html(wo.name)}" title="Link Jumbo Roll to ${wo.name}">
				<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
				Link JR → ${frappe.utils.escape_html(wo.name)}
			</button>`).join("");

		return `
			<div class="ib-iw-card" data-item="${frappe.utils.escape_html(item.item_code)}">
				<div class="ib-iw-card-top">
					<strong class="ib-ps-item-code">${frappe.utils.escape_html(item.item_code)}</strong>
					<span class="ib-ps-stat-pill">${item.completed_wos}/${item.total_wos} stages</span>
				</div>
				<div class="ib-iw-item-name">${frappe.utils.escape_html(item.item_name || "")}</div>
				${active_stages ? `<div class="ib-iw-active-stages">${active_stages}</div>` : ""}
				<div class="ib-ps-progress-wrap"><div class="ib-ps-progress-bar" style="width:${pct}%;background:var(--ib-primary)"></div></div>
				<div class="ib-ps-progress-label">${pct}% complete</div>
				${jr_pills ? `<div class="ib-iw-jr-row">${jr_pills}</div>` : ""}
				${link_btns ? `<div class="ib-iw-link-row" style="margin-top:6px">${link_btns}</div>` : ""}
			</div>`;
	}

	_show_item_detail(item) {
		const $c = this._content();

		const back = `<button class="ib-ps-back-btn" id="ib-iw-back">← Back</button>`;

		const stage_rows = (item.work_orders || []).map((wo) => {
			const stg = IB_STAGES.find((x) => x.label === wo.stage || x.key === (wo.stage || "").toLowerCase().replace(/ /g, "_"));
			const color = stg ? stg.color : "#888";
			const pct = wo.target_qty > 0 ? Math.min(100, Math.round((wo.completed_qty / wo.target_qty) * 100)) : 0;
			const jr_cell = wo.jumbo_roll
				? `<span class="ib-iw-jr-pill" style="font-size:11px">${frappe.utils.escape_html(wo.jumbo_roll)}</span>`
				: (wo.stage === "Coating" || wo.stage === "Slitting")
					? `<button class="ib-iw-link-jr-btn ib-ps-btn-sm" data-wo="${frappe.utils.escape_html(wo.name)}" style="font-size:11px">Link JR</button>`
					: "—";

			return `<tr>
				<td><span class="ib-ps-stage-chip" style="background:${color};color:#fff">${frappe.utils.escape_html(wo.stage || "")}</span></td>
				<td><code style="font-size:11px">${frappe.utils.escape_html(wo.name)}</code></td>
				<td><span class="ib-ps-status-chip ib-ps-status--${(wo.status || "").toLowerCase().replace(/ /g, "_")}">${frappe.utils.escape_html(wo.status || "")}</span></td>
				<td>${wo.machine ? frappe.utils.escape_html(wo.machine) : "—"}</td>
				<td>
					<div class="ib-ps-progress-wrap" style="min-width:60px"><div class="ib-ps-progress-bar" style="width:${pct}%;background:${color}"></div></div>
					<small>${wo.completed_qty || 0}/${wo.target_qty || 0}</small>
				</td>
				<td>${jr_cell}</td>
			</tr>`;
		}).join("");

		const batch_section = (item.batch_chains || []).length
			? item.batch_chains.map((chain) => {
				const jr = chain.jumbo_roll || {};
				return `
					<div class="ib-iw-batch-block">
						<div class="ib-iw-batch-header">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
							<strong>${frappe.utils.escape_html(jr.batch_no || jr.name || "JR")}</strong>
							<span class="ib-iw-jr-status ib-iw-jr-${(jr.status || "").toLowerCase().replace(/ /g, "_")}">${frappe.utils.escape_html(jr.status || "")}</span>
							${jr.width_mm ? `<span style="font-size:11px;color:var(--text-muted)">${jr.gsm ? jr.gsm + " GSM · " : ""}${jr.width_mm}mm × ${jr.length_mtr}m = ${jr.sqm || ((jr.width_mm / 1000) * jr.length_mtr).toFixed(2)} SQMT</span>` : ""}
						</div>
						<div class="ib-iw-batch-wos">
							${(chain.work_orders || []).map((wo) => `<span class="ib-ps-stage-chip" style="background:${IB_STAGES.find((s) => s.label === wo.stage)?.color || "#888"}">${frappe.utils.escape_html(wo.stage || "")}: ${frappe.utils.escape_html(wo.name)}</span>`).join(" → ")}
						</div>
					</div>`;
			}).join("")
			: '<div class="ib-ps-empty" style="padding:8px">No Jumbo Roll batches linked yet.</div>';

		$c.html(`
			<div class="ib-iw-detail">
				<div class="ib-ps-detail-header">
					${back}
					<div class="ib-ps-detail-meta">
						<strong class="ib-ps-detail-name">${frappe.utils.escape_html(item.item_code)}</strong>
						<span class="ib-ps-detail-customer">${frappe.utils.escape_html(item.item_name || "")}</span>
					</div>
				</div>

				<div class="ib-iw-section-title">Stage Progress</div>
				<div class="ib-ps-table-wrap">
					<table class="ib-ps-table">
						<thead><tr><th>Stage</th><th>Work Order</th><th>Status</th><th>Machine</th><th>Progress</th><th>Jumbo Roll</th></tr></thead>
						<tbody>${stage_rows}</tbody>
					</table>
				</div>

				<div class="ib-iw-section-title" style="margin-top:16px">Batch Lineage (Jumbo Rolls)</div>
				<div class="ib-iw-batches">${batch_section}</div>
			</div>`);

		$c.on("click", "#ib-iw-back", () => this._load_item_wise());
		$c.on("click", ".ib-iw-link-jr-btn", (e) => {
			const wo_name = $(e.currentTarget).data("wo");
			this._show_link_jr_dialog(wo_name, () => this._show_item_detail(item));
		});
	}

	_show_link_jr_dialog(work_order, on_success) {
		frappe.call({
			method: "instabiz.overrides.production.get_jumbo_rolls_available",
			callback: (r) => {
				const jrs = r.message || [];
				if (!jrs.length) {
					frappe.show_alert({ message: "No Jumbo Rolls available (In Stock or In Production).", indicator: "orange" });
					return;
				}
				const options = jrs.map((jr) => {
					const sqm = jr.sqm || ((jr.width_mm && jr.length_mtr) ? ((jr.width_mm / 1000) * jr.length_mtr).toFixed(2) : "?");
					return `${jr.name} — ${jr.batch_no || "no batch"} · ${sqm} SQMT · ${jr.width_mm || "?"}mm × ${jr.length_mtr || "?"}m [${jr.status}]`;
				});
				const d = new frappe.ui.Dialog({
					title: `Link Jumbo Roll → ${work_order}`,
					fields: [
						{
							fieldname: "jumbo_roll",
							label: "Jumbo Roll",
							fieldtype: "Select",
							options: jrs.map((jr) => jr.name).join("\n"),
							description: options.join("\n"),
							reqd: 1,
						},
					],
					primary_action_label: "Link",
					primary_action: (vals) => {
						frappe.call({
							method: "instabiz.overrides.production.link_jumbo_roll_to_wo",
							args: { work_order, jumbo_roll: vals.jumbo_roll },
							callback: (r2) => {
								if (r2.exc) {
									frappe.show_alert({ message: "Failed to link Jumbo Roll.", indicator: "red" });
									return;
								}
								frappe.show_alert({ message: `JR ${vals.jumbo_roll} linked to ${work_order}`, indicator: "green" });
								d.hide();
								if (on_success) on_success();
							},
						});
					},
				});
				d.show();
			},
		});
	}

	// -----------------------------------------------------------------------
	// TAB 3 — Order-wise (Order Sheets list + detail)
	// -----------------------------------------------------------------------
	_load_order_sheets() {
		const $c = this._content();
		$c.html('<div class="ib-ps-loading">Loading order sheets…</div>');
		frappe.call({
			method: "instabiz.overrides.production.get_order_sheets",
			args: {
				status: this.os_status_filter === "All" ? "" : this.os_status_filter,
				priority: this.os_priority_filter === "All" ? "" : this.os_priority_filter,
			},
			callback: (r) => {
				if (r.exc) {
					$c.html('<div class="ib-ps-empty">Failed to load order sheets.</div>');
					return;
				}
				this._render_os_list(r.message || []);
			},
		});
	}

	_render_os_list(rows) {
		const $c = this._content();

		const toolbar = `
			<div class="ib-ps-os-toolbar">
				<div class="ib-ps-filter-group">
					<label>Status</label>
					<select id="ib-os-status-filter" class="ib-ps-select">
						${["All", "Draft", "In Progress", "Completed"].map((s) => `<option value="${s}" ${s === this.os_status_filter ? "selected" : ""}>${s}</option>`).join("")}
					</select>
				</div>
				<div class="ib-ps-filter-group">
					<label>Priority</label>
					<select id="ib-os-priority-filter" class="ib-ps-select">
						${["All", "Urgent", "High", "Normal", "Low"].map((p) => `<option value="${p}" ${p === this.os_priority_filter ? "selected" : ""}>${p}</option>`).join("")}
					</select>
				</div>
				<button class="ib-ps-btn-primary" id="ib-new-os-btn">+ New Order Sheet</button>
			</div>`;

		let table_html = "";
		if (!rows.length) {
			table_html = '<div class="ib-ps-empty">No order sheets found.</div>';
		} else {
			const rows_html = rows.map((os) => {
				const pm = IB_PRIORITY_META[os.priority] || IB_PRIORITY_META["Normal"];
				const pct = os.progress_pct || 0;
				return `
					<tr class="ib-ps-os-row" data-os="${frappe.utils.escape_html(os.name)}">
						<td><a class="ib-ps-os-link" data-os="${frappe.utils.escape_html(os.name)}">${frappe.utils.escape_html(os.name)}</a></td>
						<td>${frappe.utils.escape_html(os.customer || "")}</td>
						<td>${frappe.utils.escape_html(os.items_summary || "")}</td>
						<td>
							<div class="ib-ps-progress-wrap" style="min-width:80px">
								<div class="ib-ps-progress-bar" style="width:${pct}%;background:var(--ib-primary)"></div>
							</div>
							<small>${pct}%</small>
						</td>
						<td><span class="ib-ps-priority-badge ${pm.cls}">${pm.label}</span></td>
						<td><span class="ib-ps-status-chip">${frappe.utils.escape_html(os.status || "")}</span></td>
						<td>
							<button class="ib-ps-btn-sm ib-ps-os-view-btn" data-os="${frappe.utils.escape_html(os.name)}">View</button>
						</td>
					</tr>`;
			}).join("");

			table_html = `
				<div class="ib-ps-table-wrap">
					<table class="ib-ps-table">
						<thead>
							<tr>
								<th>OS#</th><th>Customer</th><th>Items</th><th>Progress</th><th>Priority</th><th>Status</th><th>Actions</th>
							</tr>
						</thead>
						<tbody>${rows_html}</tbody>
					</table>
				</div>`;
		}

		$c.html(toolbar + table_html);

		// Filter changes
		$c.on("change", "#ib-os-status-filter", (e) => {
			this.os_status_filter = $(e.target).val();
			this._load_order_sheets();
		});
		$c.on("change", "#ib-os-priority-filter", (e) => {
			this.os_priority_filter = $(e.target).val();
			this._load_order_sheets();
		});

		// View / row click
		$c.on("click", ".ib-ps-os-view-btn, .ib-ps-os-link", (e) => {
			e.stopPropagation();
			const os_name = $(e.currentTarget).data("os");
			this.current_os = os_name;
			this._load_os_detail(os_name);
		});
		$c.on("click", ".ib-ps-os-row", (e) => {
			const os_name = $(e.currentTarget).data("os");
			this.current_os = os_name;
			this._load_os_detail(os_name);
		});

		// New Order Sheet
		$c.on("click", "#ib-new-os-btn", () => this._show_new_os_dialog());
	}

	// -----------------------------------------------------------------------
	// Order Sheet Detail
	// -----------------------------------------------------------------------
	_load_os_detail(os_name) {
		const $c = this._content();
		$c.html('<div class="ib-ps-loading">Loading order sheet…</div>');
		frappe.call({
			method: "instabiz.overrides.production.get_order_sheet_detail",
			args: { order_sheet: os_name },
			callback: (r) => {
				if (r.exc) {
					$c.html('<div class="ib-ps-empty">Failed to load order sheet.</div>');
					return;
				}
				this._render_os_detail(r.message || {});
			},
		});
	}

	_render_os_detail(detail) {
		const $c = this._content();
		const os = detail.order_sheet || {};
		const pm = IB_PRIORITY_META[os.priority] || IB_PRIORITY_META["Normal"];

		const header = `
			<div class="ib-ps-detail-header">
				<button class="ib-ps-back-btn" id="ib-os-back">← Back</button>
				<div class="ib-ps-detail-meta">
					<span class="ib-ps-detail-name">${frappe.utils.escape_html(os.name || "")}</span>
					<span class="ib-ps-detail-customer">${frappe.utils.escape_html(os.customer || "")}</span>
					<span class="ib-ps-priority-badge ${pm.cls}">${pm.label}</span>
					<span class="ib-ps-status-chip">${frappe.utils.escape_html(os.status || "")}</span>
				</div>
			</div>`;

		const tab_active = this.current_os_tab;
		const subtabs = `
			<div class="ib-ps-subtabs">
				<button class="ib-ps-subtab ${tab_active === "order_wise" ? "active" : ""}" data-subtab="order_wise">Order-wise</button>
				<button class="ib-ps-subtab ${tab_active === "product_wise" ? "active" : ""}" data-subtab="product_wise">Product-wise</button>
				<button class="ib-ps-subtab ${tab_active === "machine_wise" ? "active" : ""}" data-subtab="machine_wise">Machine-wise</button>
			</div>`;

		$c.html(header + subtabs + '<div class="ib-ps-detail-body" id="ib-ps-detail-body"></div>');

		this._render_os_subtab(detail);

		// Subtab switch
		$c.on("click", ".ib-ps-subtab", (e) => {
			const st = $(e.currentTarget).data("subtab");
			this.current_os_tab = st;
			$c.find(".ib-ps-subtab").removeClass("active");
			$(e.currentTarget).addClass("active");
			this._render_os_subtab(detail);
		});

		// Back button
		$c.on("click", "#ib-os-back", () => {
			this.current_os = null;
			this._load_order_sheets();
		});
	}

	_render_os_subtab(detail) {
		const $body = this.$body.find("#ib-ps-detail-body");
		if (this.current_os_tab === "order_wise") {
			this._render_os_order_wise($body, detail);
		} else if (this.current_os_tab === "product_wise") {
			this._render_os_product_wise($body, detail);
		} else if (this.current_os_tab === "machine_wise") {
			this._render_os_machine_wise($body, detail);
		}
	}

	_render_os_order_wise($body, detail) {
		const items = detail.order_wise_view || [];
		if (!items.length) {
			$body.html('<div class="ib-ps-empty">No items found.</div>');
			return;
		}

		const rows = items.map((item) => {
			const pct = item.qty > 0 ? Math.min(100, Math.round((item.completed_qty / item.qty) * 100)) : 0;
			const wo_rows = (item.work_orders || []).map((wo) => {
				return `<li class="ib-ps-wo-sub-item">
					<span class="ib-ps-stage-chip" style="background:${this._stage_color(wo.stage)}">${frappe.utils.escape_html(wo.stage || "")}</span>
					<span>${frappe.utils.escape_html(wo.name || "")}</span>
					<span class="ib-ps-status-chip">${frappe.utils.escape_html(wo.status || "")}</span>
					<span>${wo.completed_qty || 0}/${wo.target_qty || 0}</span>
				</li>`;
			}).join("");

			return `
				<tr>
					<td>${frappe.utils.escape_html(item.item_code || "")}</td>
					<td>${frappe.utils.escape_html(item.item_name || "")}</td>
					<td>${item.qty || 0} ${frappe.utils.escape_html(item.uom || "")}</td>
					<td>
						<div class="ib-ps-progress-wrap">
							<div class="ib-ps-progress-bar" style="width:${pct}%;background:var(--ib-primary)"></div>
						</div>
						<small>${pct}%</small>
					</td>
					<td>
						<ul class="ib-ps-wo-sub-list">${wo_rows}</ul>
					</td>
				</tr>`;
		}).join("");

		$body.html(`
			<div class="ib-ps-table-wrap">
				<table class="ib-ps-table">
					<thead><tr><th>Item Code</th><th>Item Name</th><th>Qty</th><th>Progress</th><th>Work Orders</th></tr></thead>
					<tbody>${rows}</tbody>
				</table>
			</div>`);
	}

	_render_os_product_wise($body, detail) {
		const items = detail.order_wise_view || [];
		if (!items.length) {
			$body.html('<div class="ib-ps-empty">No items found.</div>');
			return;
		}

		const stage_headers = IB_STAGES.map((s) => `<th style="color:${s.color};font-size:11px">${s.label}</th>`).join("");

		const rows = items.map((item) => {
			// Build a map of stage label → WO state (wo.stage is a label like "Coating")
			const stage_map = {};
			(item.work_orders || []).forEach((wo) => {
				stage_map[wo.stage] = wo;
			});

			const cells = IB_STAGES.map((s) => {
				const wo = stage_map[s.label];
				let cell_html;
				if (!wo) {
					// No WO — grey + plus icon (clickable)
					cell_html = `
						<div class="ib-ps-stage-cell ib-ps-stage-cell--none"
							title="Create WO for ${s.label}"
							data-action="create_wo"
							data-item="${frappe.utils.escape_html(item.item_code)}"
							data-os="${frappe.utils.escape_html((detail.order_sheet || {}).name || "")}"
							data-stage="${s.key}">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
						</div>`;
				} else if (wo.status === "Completed") {
					cell_html = `
						<div class="ib-ps-stage-cell ib-ps-stage-cell--done" title="${s.label}: Completed">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
						</div>`;
				} else if (wo.status === "In Progress") {
					cell_html = `
						<div class="ib-ps-stage-cell ib-ps-stage-cell--active ib-ps-pulse" title="${s.label}: In Progress">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
						</div>`;
				} else {
					// Pending WO
					cell_html = `
						<div class="ib-ps-stage-cell ib-ps-stage-cell--pending" title="${s.label}: ${wo.status || 'Pending'}">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
						</div>`;
				}
				return `<td style="text-align:center">${cell_html}</td>`;
			}).join("");

			return `
				<tr>
					<td><strong>${frappe.utils.escape_html(item.item_code || "")}</strong></td>
					<td>${frappe.utils.escape_html(item.item_name || "")}</td>
					${cells}
				</tr>`;
		}).join("");

		$body.html(`
			<div class="ib-ps-table-wrap" style="overflow-x:auto">
				<table class="ib-ps-table">
					<thead><tr><th>Item Code</th><th>Item Name</th>${stage_headers}</tr></thead>
					<tbody>${rows}</tbody>
				</table>
			</div>`);

		// Create WO via + icon
		$body.on("click", ".ib-ps-stage-cell--none[data-action='create_wo']", (e) => {
			const $cell = $(e.currentTarget);
			const item_code = $cell.data("item");
			const os_name = $cell.data("os");
			const stage = $cell.data("stage");
			this._create_wo_for_item(os_name, item_code, stage, $cell);
		});
	}

	_create_wo_for_item(os_name, item_code, stage, $cell) {
		frappe.confirm(
			`Create Work Order for <b>${frappe.utils.escape_html(item_code)}</b> — stage <b>${stage}</b>?`,
			() => {
				frappe.call({
					method: "instabiz.overrides.production.create_work_orders_for_item",
					args: { order_sheet: os_name, item_code: item_code, stages: [stage] },
					callback: (r) => {
						if (r.exc) {
							frappe.show_alert({ message: "Failed to create Work Order.", indicator: "red" });
							return;
						}
						frappe.show_alert({ message: "Work Order created.", indicator: "green" });
						// reload detail
						this._load_os_detail(os_name);
					},
				});
			}
		);
	}

	_render_os_machine_wise($body, detail) {
		const machines = Object.values(detail.machine_wise_view || {});
		if (!machines.length) {
			$body.html('<div class="ib-ps-empty">No machine assignments found.</div>');
			return;
		}

		const cards = machines.map((m) => {
			const wo_items = (m.wos || []).map((wo) => {
				return `<li class="ib-ps-wo-sub-item">
					<span class="ib-ps-stage-chip" style="background:${this._stage_color(wo.stage)}">${frappe.utils.escape_html(wo.stage || "")}</span>
					<span>${frappe.utils.escape_html(wo.name || "")}</span>
					<span class="ib-ps-status-chip">${frappe.utils.escape_html(wo.status || "")}</span>
				</li>`;
			}).join("");

			return `
				<div class="ib-ps-machine-card">
					<div class="ib-ps-machine-card-header">
						<code class="ib-ps-machine-code">${frappe.utils.escape_html(m.machine_code || "")}</code>
						<strong>${frappe.utils.escape_html(m.machine_name || "")}</strong>
						<span class="ib-ps-type-chip">${frappe.utils.escape_html(m.machine_type || "")}</span>
					</div>
					<ul class="ib-ps-wo-sub-list">${wo_items || "<li style='color:var(--text-muted)'>No WOs assigned</li>"}</ul>
				</div>`;
		}).join("");

		$body.html(`<div class="ib-ps-machine-grid">${cards}</div>`);
	}

	// -----------------------------------------------------------------------
	// New Order Sheet dialog
	// -----------------------------------------------------------------------
	_show_new_os_dialog() {
		const d = new frappe.ui.Dialog({
			title: "New Order Sheet",
			fields: [
				{
					fieldname: "sales_order",
					label: "Sales Order",
					fieldtype: "Link",
					options: "Sales Order",
					get_query: () => ({ filters: { docstatus: 1 } }),
					reqd: 1,
				},
				{
					fieldname: "priority",
					label: "Priority",
					fieldtype: "Select",
					options: ["Normal", "High", "Urgent", "Low"],
					default: "Normal",
				},
				{ fieldname: "notes", label: "Notes", fieldtype: "Small Text" },
			],
			primary_action_label: "Create",
			primary_action: (values) => {
				frappe.call({
					method: "instabiz.overrides.production.create_order_sheet",
					args: values,
					callback: (r) => {
						if (r.exc) {
							frappe.show_alert({ message: "Failed to create Order Sheet.", indicator: "red" });
							return;
						}
						frappe.show_alert({ message: `Order Sheet ${r.message || ""} created.`, indicator: "green" });
						d.hide();
						this._load_order_sheets();
					},
				});
			},
		});
		d.show();
	}

	// -----------------------------------------------------------------------
	// TAB 4 — Machine-wise dashboard
	// -----------------------------------------------------------------------
	_load_machine_wise() {
		const $c = this._content();
		$c.html('<div class="ib-ps-loading">Loading machine dashboard…</div>');
		frappe.call({
			method: "instabiz.overrides.production.get_machine_wise_dashboard",
			callback: (r) => {
				if (r.exc) {
					$c.html('<div class="ib-ps-empty">Failed to load machine dashboard.</div>');
					return;
				}
				this.machines_cache = r.message || [];
				this._render_machine_wise(this.machines_cache);
			},
		});
	}

	_render_machine_wise(machines) {
		const $c = this._content();

		const toolbar = `
			<div class="ib-ps-os-toolbar" style="margin-bottom:12px">
				<span class="ib-ps-stat-pill">${machines.length} active machines</span>
				<button class="ib-ps-btn-primary" id="ib-new-machine-btn" style="margin-left:auto">+ New Machine</button>
			</div>`;

		if (!machines.length) {
			$c.html(toolbar + '<div class="ib-ps-empty">No active machines configured.</div>');
			$c.on("click", "#ib-new-machine-btn", () => this._show_machine_dialog(null));
			return;
		}

		const cards = machines.map((m) => {
			const load_color = m.load_pct > 90 ? "#dc2626" : m.load_pct > 60 ? "#d97706" : "#16a34a";
			const wo_rows = (m.current_wos || []).map((wo) => {
				const stg = IB_STAGES.find((x) => x.label === wo.stage);
				const color = stg ? stg.color : "#888";
				const pct = wo.target_qty > 0 ? Math.min(100, Math.round((wo.completed_qty / wo.target_qty) * 100)) : 0;
				return `<div class="ib-mw-wo-row">
					<span class="ib-ps-stage-chip" style="background:${color}">${frappe.utils.escape_html(wo.stage || "")}</span>
					<span style="font-size:11px;flex:1">${frappe.utils.escape_html(wo.item_code || "")}</span>
					<span class="ib-ps-status-chip ib-ps-status--${(wo.status || "").toLowerCase().replace(/ /g, "_")}" style="font-size:10px">${frappe.utils.escape_html(wo.status || "")}</span>
					<div class="ib-ps-progress-wrap" style="min-width:40px;height:4px"><div class="ib-ps-progress-bar" style="width:${pct}%;background:${color}"></div></div>
				</div>`;
			}).join("") || '<div style="font-size:11px;color:var(--text-muted);padding:4px 0">No active WOs</div>';

			const today_wastage_color = m.today_avg_wastage > (m.wastage_norm_pct || 3) ? "#dc2626" : "#16a34a";

			return `
				<div class="ib-mw-card">
					<div class="ib-mw-card-header">
						<div>
							<code class="ib-ps-machine-code">${frappe.utils.escape_html(m.machine_code || "")}</code>
							<span class="ib-ps-type-chip" style="margin-left:4px">${frappe.utils.escape_html(m.machine_type || "")}</span>
						</div>
						<strong class="ib-ps-machine-name">${frappe.utils.escape_html(m.machine_name || "")}</strong>
						<span class="ib-ps-location-badge">${frappe.utils.escape_html(m.location || "")}</span>
					</div>

					<div class="ib-mw-stats-row">
						<div class="ib-mw-stat">
							<div class="ib-mw-stat-val">${m.today_output || 0}</div>
							<div class="ib-mw-stat-label">Output today</div>
						</div>
						<div class="ib-mw-stat">
							<div class="ib-mw-stat-val" style="color:${today_wastage_color}">${m.today_avg_wastage || 0}%</div>
							<div class="ib-mw-stat-label">Avg wastage</div>
						</div>
						<div class="ib-mw-stat">
							<div class="ib-mw-stat-val">${m.today_entry_count || 0}</div>
							<div class="ib-mw-stat-label">Entries</div>
						</div>
						<div class="ib-mw-stat">
							<div class="ib-mw-stat-val" style="color:${load_color}">${m.load_pct || 0}%</div>
							<div class="ib-mw-stat-label">Load</div>
						</div>
					</div>

					<div class="ib-mw-wo-list">${wo_rows}</div>

					<div class="ib-mw-card-footer">
						<button class="ib-ps-btn-sm ib-ps-machine-edit-btn" data-machine='${JSON.stringify({
							name: m.name, machine_code: m.machine_code, machine_name: m.machine_name,
							machine_type: m.machine_type, location: m.location, capacity: m.capacity,
							capacity_uom: m.capacity_uom, wastage_norm_pct: m.wastage_norm_pct, status: m.status
						})}'>Edit Machine</button>
					</div>
				</div>`;
		}).join("");

		$c.html(toolbar + `<div class="ib-mw-grid">${cards}</div>`);

		$c.on("click", "#ib-new-machine-btn", () => this._show_machine_dialog(null));
		$c.on("click", ".ib-ps-machine-edit-btn", (e) => {
			const machine = $(e.currentTarget).data("machine");
			this._show_machine_dialog(machine);
		});
	}

	_show_machine_dialog(machine) {
		const is_edit = !!machine;
		const d = new frappe.ui.Dialog({
			title: is_edit ? "Edit Machine" : "New Machine",
			fields: [
				{ fieldname: "machine_code", label: "Machine Code", fieldtype: "Data", reqd: 1, default: machine?.machine_code },
				{ fieldname: "machine_name", label: "Machine Name", fieldtype: "Data", reqd: 1, default: machine?.machine_name },
				{
					fieldname: "machine_type",
					label: "Machine Type",
					fieldtype: "Select",
					options: ["Coating", "Slitting", "Rewinding", "Cutting", "Packing"],
					default: machine?.machine_type || "Coating",
				},
				{
					fieldname: "location",
					label: "Location",
					fieldtype: "Select",
					options: ["maharashtra", "gujarat", "chennai"],
					default: machine?.location || "maharashtra",
				},
				{ fieldname: "capacity", label: "Capacity", fieldtype: "Float", default: machine?.capacity || 0 },
				{
					fieldname: "capacity_uom",
					label: "Capacity UOM",
					fieldtype: "Select",
					options: ["m/min", "kg/hr", "rolls/shift", "pcs/hr"],
					default: machine?.capacity_uom || "m/min",
				},
				{ fieldname: "wastage_norm_pct", label: "Wastage Norm %", fieldtype: "Float", default: machine?.wastage_norm_pct || 2.0 },
				{
					fieldname: "status",
					label: "Status",
					fieldtype: "Select",
					options: ["Active", "Inactive", "Maintenance"],
					default: machine?.status || "Active",
				},
			],
			primary_action_label: "Save",
			primary_action: (values) => {
				frappe.call({
					method: "instabiz.overrides.production.save_machine",
					args: values,
					callback: (r) => {
						if (r.exc) {
							frappe.show_alert({ message: "Failed to save machine.", indicator: "red" });
							return;
						}
						frappe.show_alert({ message: "Machine saved.", indicator: "green" });
						d.hide();
						this._load_machine_wise();
					},
				});
			},
		});
		d.show();
	}

	// -----------------------------------------------------------------------
	// WO Side Panel
	// -----------------------------------------------------------------------
	_open_wo_panel(wo, stage_key) {
		this.active_wo = wo;
		const $panel = this.$body.find("#ib-ps-side-panel");
		const $backdrop = this.$body.find("#ib-ps-backdrop");
		$backdrop.show();
		$panel.show().addClass("ib-ps-side-panel--open");
		this._render_wo_panel(wo, stage_key);
		// Fetch entries immediately so panel shows history without waiting for user action
		this._reload_wo_entries(wo, stage_key);
	}

	_close_side_panel() {
		const $panel = this.$body.find("#ib-ps-side-panel");
		const $backdrop = this.$body.find("#ib-ps-backdrop");
		$panel.removeClass("ib-ps-side-panel--open").hide();
		$backdrop.hide();
		this.active_wo = null;
	}

	_render_wo_panel(wo, stage_key) {
		const $panel = this.$body.find("#ib-ps-side-panel");
		const stage = IB_STAGES.find((s) => s.key === stage_key) || { label: stage_key, color: "#888" };
		const pm = IB_PRIORITY_META[wo.priority] || IB_PRIORITY_META["Normal"];

		const assign_btn = !wo.machine
			? `<button class="ib-ps-btn-primary ib-ps-panel-btn" id="ib-wo-assign-machine">Assign Machine</button>`
			: "";
		const start_btn = wo.status === "Pending" || wo.status === "Draft"
			? `<button class="ib-ps-btn-success ib-ps-panel-btn" id="ib-wo-start">Start</button>`
			: "";
		const hold_btn = wo.status === "In Progress"
			? `<button class="ib-ps-btn-warn ib-ps-panel-btn" id="ib-wo-hold">On Hold</button>`
			: "";
		const complete_btn = wo.status === "In Progress"
			? `<button class="ib-ps-btn-success ib-ps-panel-btn" id="ib-wo-complete">Complete</button>`
			: "";
		const link_jr_btn = (stage_key === "coating" || stage_key === "slitting") && !wo.jumbo_roll
			? `<button class="ib-ps-btn-primary ib-ps-panel-btn" id="ib-wo-link-jr">
					<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
					Link Jumbo Roll
				</button>`
			: "";

		const entries_html = (wo.entries || []).map((entry) => `
			<div class="ib-ps-entry-row">
				<span class="ib-ps-entry-date">${frappe.utils.escape_html(entry.entry_date || "")}</span>
				<span>Output: ${entry.output_qty || 0} ${frappe.utils.escape_html(entry.output_uom || "")}</span>
				<span>Wastage: ${entry.wastage_pct || 0}%</span>
				<span>Hours: ${entry.hours || 0}</span>
			</div>`).join("") || '<div class="ib-ps-empty" style="padding:8px">No entries yet.</div>';

		$panel.html(`
			<div class="ib-ps-panel-inner">
				<div class="ib-ps-panel-header">
					<div class="ib-ps-panel-title-row">
						<strong>${frappe.utils.escape_html(wo.name || "")}</strong>
						<button class="ib-ps-panel-close" id="ib-panel-close">✕</button>
					</div>
					<div class="ib-ps-panel-meta">
						<span class="ib-ps-item-code">${frappe.utils.escape_html(wo.item_code || "")}</span>
						<span class="ib-ps-stage-chip" style="background:${stage.color};color:#fff">${stage.label}</span>
						<span class="ib-ps-priority-badge ${pm.cls}">${pm.label}</span>
						<span class="ib-ps-status-chip">${frappe.utils.escape_html(wo.status || "")}</span>
					</div>
					${wo.machine ? `<div class="ib-ps-panel-machine">Machine: <strong>${frappe.utils.escape_html(wo.machine)}</strong></div>` : ""}
				</div>

				<div class="ib-ps-panel-actions">
					${assign_btn}${start_btn}${hold_btn}${complete_btn}${link_jr_btn}
					<button class="ib-ps-btn-primary ib-ps-panel-btn" id="ib-wo-new-entry">+ New Entry</button>
				</div>
				${wo.jumbo_roll ? `<div class="ib-ps-panel-machine" style="padding:0 16px 8px">Jumbo Roll: <strong>${frappe.utils.escape_html(wo.jumbo_roll)}</strong></div>` : ""}

				<div class="ib-ps-panel-section">
					<div class="ib-ps-panel-section-title">Entries</div>
					<div class="ib-ps-entries-list" id="ib-ps-entries-list">${entries_html}</div>
				</div>
			</div>`);

		$panel.on("click", "#ib-panel-close", () => this._close_side_panel());
		$panel.on("click", "#ib-wo-assign-machine", () => this._assign_machine_to_wo(wo, stage_key));
		$panel.on("click", "#ib-wo-start", () => this._update_wo_status(wo, "In Progress", stage_key));
		$panel.on("click", "#ib-wo-hold", () => this._update_wo_status(wo, "On Hold", stage_key));
		$panel.on("click", "#ib-wo-complete", () => this._update_wo_status(wo, "Completed", stage_key));
		$panel.on("click", "#ib-wo-link-jr", () => this._show_link_jr_dialog(wo.name, () => {
			wo.jumbo_roll = "..."; // optimistic placeholder until refresh
			this._close_side_panel();
			this.refresh();
		}));
		$panel.on("click", "#ib-wo-new-entry", () => this._show_entry_dialog(wo, stage_key));
	}

	_assign_machine_to_wo(wo, stage_key) {
		const machine_type = IB_STAGES.find((s) => s.key === stage_key)?.label || "";
		frappe.call({
			method: "instabiz.overrides.production.get_machines",
			args: { machine_type, status: "Active" },
			callback: (r) => {
				const machines = (r.message || []).map((m) => ({ label: `${m.machine_code} — ${m.machine_name}`, value: m.name || m.machine_code }));
				if (!machines.length) {
					frappe.show_alert({ message: "No active machines available.", indicator: "orange" });
					return;
				}
				const d = new frappe.ui.Dialog({
					title: "Assign Machine",
					fields: [
						{
							fieldname: "machine",
							label: "Machine",
							fieldtype: "Select",
							options: machines.map((m) => m.value),
							reqd: 1,
						},
					],
					primary_action_label: "Assign",
					primary_action: (vals) => {
						frappe.call({
							method: "instabiz.overrides.production.assign_machine_to_wo",
							args: { work_order: wo.name, machine: vals.machine },
							callback: (r2) => {
								if (r2.exc) {
									frappe.show_alert({ message: "Failed to assign machine.", indicator: "red" });
									return;
								}
								frappe.show_alert({ message: "Machine assigned.", indicator: "green" });
								d.hide();
								wo.machine = vals.machine;
								this._render_wo_panel(wo, stage_key);
							},
						});
					},
				});
				d.show();
			},
		});
	}

	_update_wo_status(wo, new_status, stage_key) {
		const method_map = {
			"In Progress": "instabiz.overrides.production.start_work_order",
			"On Hold": "instabiz.overrides.production.hold_work_order",
			"Completed": "instabiz.overrides.production.complete_work_order",
		};
		const method = method_map[new_status];
		if (!method) return;
		frappe.call({
			method,
			args: { work_order: wo.name },
			callback: (r) => {
				if (r.exc) {
					frappe.show_alert({ message: `Failed to set status to ${new_status}.`, indicator: "red" });
					return;
				}
				frappe.show_alert({ message: `Status updated to ${new_status}.`, indicator: "green" });
				wo.status = new_status;
				this._render_wo_panel(wo, stage_key);
				// Optionally refresh pipeline if on that tab
				if (this.active_tab === "pipeline") this._load_pipeline();
			},
		});
	}

	// -----------------------------------------------------------------------
	// Entry Dialog
	// -----------------------------------------------------------------------
	_show_entry_dialog(wo, stage_key) {
		const stage_fields = STAGE_FIELDS[stage_key] || [];

		const fields = [
			// Section 1 — Time & Operator (grey)
			{ fieldname: "sec_time", label: "Time & Operator", fieldtype: "Section Break", collapsible: 0 },
			{ fieldname: "entry_date", label: "Entry Date", fieldtype: "Date", default: frappe.datetime.get_today(), reqd: 1 },
			{ fieldname: "col1", fieldtype: "Column Break" },
			{ fieldname: "operator", label: "Operator", fieldtype: "Link", options: "User" },
			{ fieldname: "col2", fieldtype: "Column Break" },
			{ fieldname: "start_time", label: "Start Time", fieldtype: "Time" },
			{ fieldname: "col3", fieldtype: "Column Break" },
			{ fieldname: "end_time", label: "End Time", fieldtype: "Time" },

			// Section 2 — Input / Output (blue)
			{ fieldname: "sec_qty", label: "Input / Output", fieldtype: "Section Break", collapsible: 0 },
			{ fieldname: "input_qty", label: "Input Qty", fieldtype: "Float", reqd: 1 },
			{ fieldname: "col_io1", fieldtype: "Column Break" },
			{ fieldname: "input_uom", label: "Input UOM", fieldtype: "Select", options: ["MTR", "KG", "NOS", "SQMT", "PCS"] },
			{ fieldname: "col_io2", fieldtype: "Column Break" },
			{ fieldname: "output_qty", label: "Output Qty", fieldtype: "Float", reqd: 1 },
			{ fieldname: "col_io3", fieldtype: "Column Break" },
			{ fieldname: "output_uom", label: "Output UOM", fieldtype: "Select", options: ["MTR", "KG", "NOS", "SQMT", "PCS"] },
		];

		// Section 3 — Stage Details (if any)
		if (stage_fields.length) {
			fields.push({ fieldname: "sec_stage", label: `Stage Details (${IB_STAGES.find((s) => s.key === stage_key)?.label || stage_key})`, fieldtype: "Section Break", collapsible: 0 });
			stage_fields.forEach((sf, idx) => {
				if (idx > 0 && idx % 2 === 0) fields.push({ fieldname: `col_sd_${idx}`, fieldtype: "Column Break" });
				const f = { ...sf };
				if (sf.fieldtype === "Select" && Array.isArray(sf.options)) {
					f.options = sf.options.join("\n");
				}
				fields.push(f);
			});
		}

		// Section 4 — Wastage (red)
		fields.push(
			{ fieldname: "sec_wastage", label: "Wastage", fieldtype: "Section Break", collapsible: 0 },
			{ fieldname: "wastage_qty", label: "Wastage Qty", fieldtype: "Float", default: 0 },
			{ fieldname: "col_w1", fieldtype: "Column Break" },
			{
				fieldname: "wastage_reason",
				label: "Wastage Reason",
				fieldtype: "Select",
				options: WASTAGE_REASONS.join("\n"),
			},
			{ fieldname: "col_w2", fieldtype: "Column Break" },
			{ fieldname: "wastage_notes", label: "Wastage Notes", fieldtype: "Small Text" }
		);

		const d = new frappe.ui.Dialog({
			title: `New Entry — ${wo.name} (${IB_STAGES.find((s) => s.key === stage_key)?.label || stage_key})`,
			fields,
			size: "large",
			primary_action_label: "Save & Submit",
			primary_action: (values) => {
				const input_qty = values.input_qty || 0;
				const output_qty = values.output_qty || 0;
				const wastage_qty = values.wastage_qty || 0;
				const wastage_pct = input_qty > 0 ? ((wastage_qty / input_qty) * 100).toFixed(2) : 0;

				// Compute hours
				let hours = 0;
				if (values.start_time && values.end_time) {
					const [sh, sm] = values.start_time.split(":").map(Number);
					const [eh, em] = values.end_time.split(":").map(Number);
					hours = parseFloat(((eh * 60 + em - sh * 60 - sm) / 60).toFixed(2));
				}

				// Convert lowercase stage_key → title-case label matching doctype Select options
				const stage_label = IB_STAGES.find((s) => s.key === stage_key)?.label || stage_key;

				const entry_doc = {
					doctype: "IB Production Entry",
					work_order: wo.name,
					stage: stage_label,
					entry_date: values.entry_date,
					operator: values.operator,
					start_time: values.start_time,
					end_time: values.end_time,
					hours_worked: hours,
					input_qty: values.input_qty,
					input_uom: values.input_uom,
					output_qty: values.output_qty,
					output_uom: values.output_uom,
					wastage_qty: values.wastage_qty,
					wastage_reason: values.wastage_reason,
					wastage_notes: values.wastage_notes,
					wastage_pct,
				};

				// Stage-specific fields
				stage_fields.forEach((sf) => {
					if (values[sf.fieldname] !== undefined) {
						entry_doc[sf.fieldname] = values[sf.fieldname];
					}
				});

				// Save doc
				frappe.call({
					method: "frappe.client.save",
					args: { doc: entry_doc },
					callback: (r) => {
						if (r.exc || !r.message) {
							frappe.show_alert({ message: "Failed to save entry.", indicator: "red" });
							return;
						}
						const saved = r.message;
						// Submit doc
						frappe.call({
							method: "frappe.client.submit",
							args: { doc: saved },
							callback: (r2) => {
								if (r2.exc) {
									frappe.show_alert({ message: "Entry saved but not submitted.", indicator: "orange" });
								} else {
									frappe.show_alert({
										message: `Entry saved. Wastage: ${wastage_pct}%`,
										indicator: "green",
									});
								}
								d.hide();
								// Reload WO entries
								this._reload_wo_entries(wo, stage_key);
							},
						});
					},
				});
			},
		});

		// Style section headers after dialog renders
		setTimeout(() => {
			this._style_entry_dialog_sections(d);
		}, 100);

		d.show();
	}

	_style_entry_dialog_sections(d) {
		const $modal = d.$wrapper;
		const sections = $modal.find(".form-section");
		const section_styles = [
			{ bg: "#f3f4f6", border: "#d1d5db" }, // Time & Operator — grey
			{ bg: "#eff6ff", border: "#bfdbfe" }, // Input/Output — blue
			{ bg: "#f5f3ff", border: "#ddd6fe" }, // Stage Details — purple
			{ bg: "#fff1f2", border: "#fecdd3" }, // Wastage — red
		];
		sections.each(function (i) {
			const style = section_styles[i] || {};
			if (style.bg) {
				$(this).css({ background: style.bg, borderRadius: "6px", marginBottom: "8px", padding: "8px", borderLeft: `3px solid ${style.border}` });
			}
		});
	}

	_reload_wo_entries(wo, stage_key) {
		frappe.call({
			method: "instabiz.overrides.production.get_wo_entries",
			args: { work_order: wo.name },
			callback: (r) => {
				if (r.message) {
					wo.entries = r.message;
					this._render_wo_panel(wo, stage_key);
				}
			},
		});
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------
	_stage_color(stage_key) {
		const s = IB_STAGES.find((x) => x.label === stage_key || x.key === (stage_key || "").toLowerCase().replace(/ /g, "_"));
		return s ? s.color : "#888";
	}

	// -----------------------------------------------------------------------
	// CSS injection
	// -----------------------------------------------------------------------
	_inject_styles() {
		if (document.getElementById("ib-ps-styles")) return;
		const css = `
/* ============================================================
   IB Production Stages — Page Styles
   ============================================================ */
:root {
	--ib-ps-coating:   #7c3aed;
	--ib-ps-slitting:  #2563eb;
	--ib-ps-rewinding: #0891b2;
	--ib-ps-cutting:   #059669;
	--ib-ps-packing:   #d97706;
	--ib-ps-rtd:       #ea580c;
	--ib-ps-delivered: #10b981;
}

/* Tabs toolbar */
.ib-ps-tabs {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 12px 16px 8px;
	border-bottom: 1px solid var(--border-color);
	flex-wrap: wrap;
}
.ib-ps-tab {
	padding: 5px 16px;
	border-radius: 20px;
	border: 1px solid var(--border-color);
	background: var(--card-bg);
	color: var(--text-color);
	font-size: 13px;
	font-family: inherit;
	cursor: pointer;
	transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.ib-ps-tab:hover { border-color: var(--ib-primary); color: var(--ib-primary); }
.ib-ps-tab.active {
	background: var(--ib-primary);
	border-color: var(--ib-primary);
	color: #fff;
	font-weight: 600;
}
.ib-ps-refresh-btn {
	margin-left: auto;
	display: flex; align-items: center; gap: 5px;
	padding: 5px 12px;
	border-radius: 6px;
	border: 1px solid var(--border-color);
	background: var(--card-bg);
	color: var(--text-muted);
	font-size: 12px;
	font-family: inherit;
	cursor: pointer;
}
.ib-ps-refresh-btn:hover { border-color: var(--ib-primary); color: var(--ib-primary); }

/* Content area */
.ib-ps-content { padding: 16px; min-height: 200px; }

/* Loading / empty */
.ib-ps-loading { padding: 40px; text-align: center; color: var(--text-muted); font-size: 14px; }
.ib-ps-empty   { padding: 40px; text-align: center; color: var(--text-muted); font-size: 13px; }

/* ----------------------------------------------------------------
   Pipeline Kanban
   ---------------------------------------------------------------- */
.ib-ps-pipeline {
	display: flex;
	gap: 12px;
	overflow-x: auto;
	padding-bottom: 12px;
}
.ib-ps-col {
	min-width: 220px;
	flex: 0 0 220px;
	background: var(--fg-color, #f9fafb);
	border-radius: 8px;
	border: 1px solid var(--border-color);
	display: flex;
	flex-direction: column;
	max-height: calc(100vh - 200px);
}
.ib-ps-col-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 10px 12px 8px;
	flex-shrink: 0;
}
.ib-ps-col-title { font-size: 12px; font-weight: 600; color: var(--text-color); }
.ib-ps-count-badge {
	font-size: 11px; font-weight: 700;
	color: #fff; padding: 1px 7px;
	border-radius: 10px; min-width: 20px;
	text-align: center;
}
.ib-ps-col-body {
	overflow-y: auto;
	flex: 1;
	padding: 6px;
	display: flex;
	flex-direction: column;
	gap: 6px;
}
.ib-ps-col-empty { padding: 20px; text-align: center; color: var(--text-muted); font-size: 12px; }

/* WO Cards */
.ib-ps-wo-card {
	background: var(--card-bg);
	border: 1px solid var(--border-color);
	border-radius: 6px;
	padding: 10px;
	cursor: pointer;
	transition: transform 0.1s, box-shadow 0.1s;
}
.ib-ps-wo-card:hover {
	transform: translateY(-2px);
	box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
.ib-ps-card-top {
	display: flex;
	justify-content: space-between;
	align-items: flex-start;
	gap: 6px;
	margin-bottom: 6px;
}
.ib-ps-item-code { font-size: 12px; font-weight: 700; color: var(--text-color); word-break: break-all; }
.ib-ps-card-meta { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }

/* Priority badges */
.ib-ps-priority-badge {
	font-size: 10px; font-weight: 600;
	padding: 2px 8px; border-radius: 10px; white-space: nowrap;
}
.ib-ps-badge--urgent  { background: #fef2f2; color: #dc2626; border: 1px solid #fca5a5; }
.ib-ps-badge--high    { background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; }
.ib-ps-badge--normal  { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
.ib-ps-badge--low     { background: #f9fafb; color: #6b7280; border: 1px solid #d1d5db; }

/* Status chip */
.ib-ps-status-chip {
	font-size: 10px; font-weight: 600;
	padding: 2px 7px; border-radius: 10px;
	background: var(--fg-color, #f3f4f6); color: var(--text-muted);
	border: 1px solid var(--border-color);
}
.ib-ps-status--in_progress { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
.ib-ps-status--completed   { background: #f0fdf4; color: #16a34a; border-color: #bbf7d0; }
.ib-ps-status--on_hold     { background: #fffbeb; color: #92400e; border-color: #fde68a; }

/* Machine chip */
.ib-ps-machine-chip {
	font-size: 10px; background: #f3f4f6; color: var(--text-color);
	border-radius: 4px; padding: 1px 6px; font-family: monospace;
}

/* Stage chip (used in sub-lists) */
.ib-ps-stage-chip {
	font-size: 10px; color: #fff; font-weight: 600;
	border-radius: 4px; padding: 2px 7px; display: inline-block;
}

/* Progress bar */
.ib-ps-progress-wrap {
	height: 5px; background: var(--border-color);
	border-radius: 3px; overflow: hidden;
	margin-bottom: 3px;
}
.ib-ps-progress-bar { height: 100%; border-radius: 3px; transition: width 0.3s; }
.ib-ps-progress-label { font-size: 10px; color: var(--text-muted); }

/* ----------------------------------------------------------------
   Order Sheet / Tables
   ---------------------------------------------------------------- */
.ib-ps-os-toolbar {
	display: flex;
	align-items: center;
	gap: 10px;
	padding-bottom: 12px;
	flex-wrap: wrap;
}
.ib-ps-filter-group {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 13px;
	color: var(--text-muted);
}
.ib-ps-select {
	padding: 5px 10px;
	border: 1px solid var(--border-color);
	border-radius: 6px;
	background: var(--card-bg);
	font-size: 13px;
	font-family: inherit;
	color: var(--text-color);
}
.ib-ps-table-wrap { overflow-x: auto; }
.ib-ps-table {
	width: 100%;
	border-collapse: collapse;
	font-size: 13px;
}
.ib-ps-table thead th {
	background: var(--fg-color, #f9fafb);
	padding: 8px 12px;
	text-align: left;
	border-bottom: 1px solid var(--border-color);
	font-weight: 600;
	font-size: 12px;
	color: var(--text-muted);
}
.ib-ps-table tbody tr {
	border-bottom: 1px solid var(--border-color);
	cursor: pointer;
	transition: background 0.1s;
}
.ib-ps-table tbody tr:hover { background: var(--fg-color, #f9fafb); }
.ib-ps-table td { padding: 8px 12px; vertical-align: middle; }
.ib-ps-os-link { color: var(--ib-primary); text-decoration: none; font-weight: 600; }
.ib-ps-os-link:hover { text-decoration: underline; }

/* ----------------------------------------------------------------
   Order Sheet Detail
   ---------------------------------------------------------------- */
.ib-ps-detail-header {
	display: flex;
	align-items: center;
	gap: 16px;
	padding-bottom: 12px;
	border-bottom: 1px solid var(--border-color);
	margin-bottom: 12px;
	flex-wrap: wrap;
}
.ib-ps-back-btn {
	padding: 5px 12px;
	border: 1px solid var(--border-color);
	border-radius: 6px;
	background: var(--card-bg);
	font-size: 12px; font-family: inherit;
	cursor: pointer; white-space: nowrap;
	color: var(--text-color);
}
.ib-ps-back-btn:hover { border-color: var(--ib-primary); color: var(--ib-primary); }
.ib-ps-detail-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ib-ps-detail-name { font-size: 15px; font-weight: 700; color: var(--text-color); }
.ib-ps-detail-customer { font-size: 13px; color: var(--text-muted); }

/* Subtabs */
.ib-ps-subtabs {
	display: flex; gap: 4px;
	padding-bottom: 12px;
}
.ib-ps-subtab {
	padding: 5px 14px;
	border-radius: 6px;
	border: 1px solid var(--border-color);
	background: var(--card-bg);
	font-size: 12px; font-family: inherit;
	cursor: pointer; color: var(--text-muted);
	transition: background 0.12s;
}
.ib-ps-subtab:hover { background: var(--fg-color, #f3f4f6); }
.ib-ps-subtab.active {
	background: var(--ib-primary);
	border-color: var(--ib-primary);
	color: #fff; font-weight: 600;
}

/* Product-wise stage cells */
.ib-ps-stage-cell {
	width: 40px; height: 40px;
	display: inline-flex; align-items: center; justify-content: center;
	border-radius: 6px; cursor: default;
}
.ib-ps-stage-cell--done    { background: #dcfce7; color: #16a34a; }
.ib-ps-stage-cell--active  { background: #dbeafe; color: #1d4ed8; }
.ib-ps-stage-cell--pending { background: #fef9c3; color: #92400e; }
.ib-ps-stage-cell--none    { background: #f3f4f6; color: #9ca3af; cursor: pointer; }
.ib-ps-stage-cell--none:hover { background: #e5e7eb; }

/* Pulse animation */
@keyframes ib-ps-pulse {
	0%, 100% { opacity: 1; }
	50%       { opacity: 0.5; }
}
.ib-ps-pulse { animation: ib-ps-pulse 1.5s ease-in-out infinite; }

/* Sub WO list */
.ib-ps-wo-sub-list { list-style: none; margin: 0; padding: 0; }
.ib-ps-wo-sub-item {
	display: flex; align-items: center; gap: 8px;
	font-size: 12px; padding: 3px 0;
	color: var(--text-color);
}

/* ----------------------------------------------------------------
   Machines grid
   ---------------------------------------------------------------- */
.ib-ps-machines-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
	gap: 12px;
}
.ib-ps-machine-master-card {
	background: var(--card-bg);
	border: 1px solid var(--border-color);
	border-radius: 8px;
	padding: 14px;
	display: flex; flex-direction: column; gap: 8px;
}
.ib-ps-machine-master-top {
	display: flex; flex-direction: column; gap: 4px;
}
.ib-ps-machine-code { font-family: monospace; font-size: 12px; color: var(--ib-primary); }
.ib-ps-machine-name { font-size: 14px; font-weight: 700; color: var(--text-color); }
.ib-ps-machine-master-meta { display: flex; gap: 6px; flex-wrap: wrap; }
.ib-ps-machine-master-stats { font-size: 12px; color: var(--text-muted); display: flex; flex-direction: column; gap: 2px; }

.ib-ps-type-chip {
	font-size: 10px; font-weight: 600;
	background: #ede9fe; color: #5b21b6;
	border-radius: 4px; padding: 2px 7px;
}
.ib-ps-location-badge {
	font-size: 10px; font-weight: 600;
	background: #f3f4f6; color: #374151;
	border-radius: 4px; padding: 2px 7px;
	text-transform: capitalize;
}

/* Status dot */
.ib-ps-status-dot {
	display: inline-block; width: 8px; height: 8px;
	border-radius: 50%; margin-left: 6px;
}
.ib-ps-status-dot--active      { background: #22c55e; }
.ib-ps-status-dot--inactive    { background: #ef4444; }
.ib-ps-status-dot--maintenance { background: #f59e0b; }

/* Machine card (detail / machine-wise view) */
.ib-ps-machine-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
	gap: 12px;
}
.ib-ps-machine-card {
	background: var(--card-bg);
	border: 1px solid var(--border-color);
	border-radius: 8px;
	padding: 12px;
}
.ib-ps-machine-card-header {
	display: flex; align-items: center; gap: 8px;
	margin-bottom: 8px;
}

/* ----------------------------------------------------------------
   Buttons
   ---------------------------------------------------------------- */
.ib-ps-btn-primary {
	padding: 6px 14px;
	border-radius: 6px;
	border: none;
	background: var(--ib-primary);
	color: #fff; font-size: 13px;
	font-family: inherit; cursor: pointer;
	font-weight: 600;
	transition: opacity 0.15s;
}
.ib-ps-btn-primary:hover { opacity: 0.88; }
.ib-ps-btn-success {
	padding: 6px 14px;
	border-radius: 6px;
	border: none;
	background: #16a34a;
	color: #fff; font-size: 13px;
	font-family: inherit; cursor: pointer;
	font-weight: 600;
}
.ib-ps-btn-success:hover { background: #15803d; }
.ib-ps-btn-warn {
	padding: 6px 14px;
	border-radius: 6px;
	border: none;
	background: #d97706;
	color: #fff; font-size: 13px;
	font-family: inherit; cursor: pointer;
	font-weight: 600;
}
.ib-ps-btn-warn:hover { background: #b45309; }
.ib-ps-btn-sm {
	padding: 4px 10px;
	border-radius: 5px;
	border: 1px solid var(--border-color);
	background: var(--card-bg);
	font-size: 12px; font-family: inherit;
	cursor: pointer; color: var(--text-color);
}
.ib-ps-btn-sm:hover { border-color: var(--ib-primary); color: var(--ib-primary); }

/* ----------------------------------------------------------------
   Side Panel
   ---------------------------------------------------------------- */
.ib-ps-side-backdrop {
	position: fixed;
	inset: 0;
	background: rgba(0,0,0,0.3);
	z-index: 1040;
}
.ib-ps-side-panel {
	position: fixed;
	top: 0; right: 0; bottom: 0;
	width: 400px;
	max-width: 95vw;
	background: var(--card-bg);
	border-left: 1px solid var(--border-color);
	z-index: 1050;
	overflow-y: auto;
	transform: translateX(100%);
	transition: transform 0.25s ease;
}
.ib-ps-side-panel--open { transform: translateX(0) !important; }
.ib-ps-panel-inner { display: flex; flex-direction: column; height: 100%; }
.ib-ps-panel-header {
	padding: 16px;
	border-bottom: 1px solid var(--border-color);
	flex-shrink: 0;
}
.ib-ps-panel-title-row {
	display: flex; justify-content: space-between; align-items: center;
	margin-bottom: 8px;
}
.ib-ps-panel-title-row strong { font-size: 15px; font-weight: 700; }
.ib-ps-panel-close {
	background: none; border: none; cursor: pointer;
	font-size: 16px; color: var(--text-muted); padding: 2px 6px;
}
.ib-ps-panel-close:hover { color: var(--text-color); }
.ib-ps-panel-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ib-ps-panel-machine { font-size: 12px; color: var(--text-muted); margin-top: 6px; }
.ib-ps-panel-actions {
	padding: 12px 16px;
	display: flex; gap: 8px; flex-wrap: wrap;
	border-bottom: 1px solid var(--border-color);
	flex-shrink: 0;
}
.ib-ps-panel-btn { /* inherits from btn classes */ }
.ib-ps-panel-section { padding: 12px 16px; flex: 1; }
.ib-ps-panel-section-title { font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 8px; }
.ib-ps-entries-list { display: flex; flex-direction: column; gap: 6px; }
.ib-ps-entry-row {
	background: var(--fg-color, #f9fafb);
	border-radius: 5px;
	padding: 8px 10px;
	font-size: 12px;
	display: flex; gap: 12px; flex-wrap: wrap;
	color: var(--text-color);
}
.ib-ps-entry-date { font-weight: 600; color: var(--ib-primary); }

/* Stat pill */
.ib-ps-stat-pill {
	font-size: 11px; font-weight: 600;
	background: var(--fg-color, #f3f4f6);
	color: var(--text-muted);
	border: 1px solid var(--border-color);
	border-radius: 10px;
	padding: 2px 10px;
}

/* Search input */
.ib-ps-search-input {
	padding: 5px 10px;
	border: 1px solid var(--border-color);
	border-radius: 6px;
	background: var(--card-bg);
	font-size: 13px;
	font-family: inherit;
	color: var(--text-color);
	min-width: 180px;
}
.ib-ps-search-input:focus { outline: none; border-color: var(--ib-primary); }

/* ----------------------------------------------------------------
   Item-wise view
   ---------------------------------------------------------------- */
.ib-iw-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
	gap: 12px;
}
.ib-iw-card {
	background: var(--card-bg);
	border: 1px solid var(--border-color);
	border-radius: 8px;
	padding: 14px;
	cursor: pointer;
	transition: box-shadow 0.15s, transform 0.1s;
}
.ib-iw-card:hover { box-shadow: 0 4px 14px rgba(0,0,0,0.1); transform: translateY(-1px); }
.ib-iw-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; margin-bottom: 4px; }
.ib-iw-item-name { font-size: 12px; color: var(--text-muted); margin-bottom: 6px; }
.ib-iw-active-stages { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
.ib-iw-jr-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.ib-iw-jr-pill {
	display: inline-flex; align-items: center; gap: 4px;
	font-size: 11px; font-weight: 600;
	background: #eff6ff; color: #1d4ed8;
	border: 1px solid #bfdbfe;
	border-radius: 10px; padding: 2px 8px;
}
.ib-iw-jr-status { font-size: 10px; font-weight: 400; color: var(--text-muted); }
.ib-iw-jr-in_stock { color: #16a34a; }
.ib-iw-jr-in_production { color: #2563eb; }
.ib-iw-jr-consumed { color: #6b7280; }
.ib-iw-link-row { display: flex; gap: 6px; flex-wrap: wrap; }

/* Item detail */
.ib-iw-detail {}
.ib-iw-section-title {
	font-size: 12px; font-weight: 700; color: var(--text-muted);
	text-transform: uppercase; letter-spacing: 0.05em;
	margin-bottom: 8px; padding-bottom: 4px;
	border-bottom: 1px solid var(--border-color);
}
.ib-iw-batches { display: flex; flex-direction: column; gap: 8px; }
.ib-iw-batch-block {
	background: var(--fg-color, #f9fafb);
	border: 1px solid var(--border-color);
	border-radius: 6px; padding: 10px 12px;
}
.ib-iw-batch-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
.ib-iw-batch-wos { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px; }

/* ----------------------------------------------------------------
   Machine-wise view
   ---------------------------------------------------------------- */
.ib-mw-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
	gap: 12px;
}
.ib-mw-card {
	background: var(--card-bg);
	border: 1px solid var(--border-color);
	border-radius: 8px;
	padding: 14px;
	display: flex; flex-direction: column; gap: 10px;
}
.ib-mw-card-header { display: flex; flex-direction: column; gap: 4px; }
.ib-mw-stats-row {
	display: grid; grid-template-columns: repeat(4, 1fr);
	gap: 6px;
	background: var(--fg-color, #f9fafb);
	border-radius: 6px; padding: 8px;
	border: 1px solid var(--border-color);
}
.ib-mw-stat { text-align: center; }
.ib-mw-stat-val { font-size: 16px; font-weight: 700; color: var(--text-color); }
.ib-mw-stat-label { font-size: 10px; color: var(--text-muted); margin-top: 2px; }
.ib-mw-wo-list { display: flex; flex-direction: column; gap: 5px; min-height: 40px; }
.ib-mw-wo-row {
	display: flex; align-items: center; gap: 6px;
	font-size: 12px; padding: 4px 6px;
	background: var(--fg-color, #f9fafb);
	border-radius: 4px;
}
.ib-mw-card-footer { margin-top: auto; padding-top: 4px; }
`;
		const $style = $(`<style id="ib-ps-styles">${css}</style>`);
		$("head").append($style);
	}
}
