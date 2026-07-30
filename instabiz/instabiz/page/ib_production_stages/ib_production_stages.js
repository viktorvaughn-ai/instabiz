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

frappe.pages["ib-production-stages"].on_page_hide = function (wrapper) {
	const inst = wrapper._page_instance;
	if (inst) {
		if (inst._key_handler) document.removeEventListener("keydown", inst._key_handler);
		if (inst._sortables) inst._sortables.forEach(s => s.destroy && s.destroy());
	}
};

// ---------------------------------------------------------------------------
// Stage definitions
// ---------------------------------------------------------------------------
const IB_STAGES = [
	{ key: "coating",          label: "Coating",          icon: "layers",       color: "#7c3aed" },
	{ key: "slitting",         label: "Slitting",         icon: "scissors",     color: "#2563eb" },
	{ key: "rewinding",        label: "Rewinding",        icon: "refresh-cw",   color: "#0891b2" },
	{ key: "cutting",          label: "Cutting",          icon: "crop",         color: "#059669" },
	{ key: "packing",          label: "Packing",          icon: "package",     color: "#d97706" },
	{ key: "ready_to_deliver", label: "Ready to Deliver", icon: "truck",        color: "#ea580c" },
	{ key: "delivered",        label: "Delivered",        icon: "check-circle", color: "#10b981" },
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
		{ fieldname: "parent_roll_id_cut", label: "Parent Roll ID", fieldtype: "Data" },
		{ fieldname: "roll_width_mm", label: "Roll Width (mm)", fieldtype: "Float" },
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

		// Data stores — avoids JSON.stringify in data attributes
		this._wo_data = new Map();
		this._machine_data = new Map();
		this._sortables = [];

		this._inject_styles();
		this._build_shell();
		this.refresh();
		this._start_live_updates();
	}

	// Server already publishes "ib_floor_update" (production.py _notify_floor_update)
	// on every Start/Advance/Hold/Complete — nothing client-side was listening,
	// so multi-terminal floor use required a manual Refresh click to see any
	// other station's progress. Debounced (1.5s) + route-checked, matching the
	// established pattern in ib_stock_common.js's make_live().
	_start_live_updates() {
		frappe.realtime.off("ib_floor_update");
		let timer = null;
		frappe.realtime.on("ib_floor_update", () => {
			if (frappe.get_route()[0] !== "ib-production-stages") return;
			if (this.active_wo) return;
			clearTimeout(timer);
			timer = setTimeout(() => this.refresh(), 1500);
		});
	}

	// -----------------------------------------------------------------------
	// Shell / toolbar
	// -----------------------------------------------------------------------
	_build_shell() {
		// Toolbar tabs
		const tabs_html = `
			<div class="ib-ps-tabs">
				<button class="ib-ps-tab active" data-tab="pipeline">
					<iconify-icon icon="lucide:kanban" width="12" height="12" style="vertical-align:middle;margin-right:4px"></iconify-icon>
					Pipeline
				</button>
				<button class="ib-ps-tab" data-tab="item_wise">
					<iconify-icon icon="lucide:box" width="12" height="12" style="vertical-align:middle;margin-right:4px"></iconify-icon>
					Item-wise
				</button>
				<button class="ib-ps-tab" data-tab="order_wise">
					<iconify-icon icon="lucide:clipboard-list" width="12" height="12" style="vertical-align:middle;margin-right:4px"></iconify-icon>
					Order-wise
				</button>
				<button class="ib-ps-tab" data-tab="machine_wise">
					<iconify-icon icon="lucide:settings-2" width="12" height="12" style="vertical-align:middle;margin-right:4px"></iconify-icon>
					Machine-wise
				</button>
				<button class="ib-ps-tab" data-tab="job_bundles">
					<iconify-icon icon="lucide:layers" width="12" height="12" style="vertical-align:middle;margin-right:4px"></iconify-icon>
					Job Bundles
				</button>
				<button class="ib-ps-refresh-btn" id="ib-ps-refresh">
					<iconify-icon icon="lucide:refresh-cw" width="13" height="13" style="vertical-align:middle;margin-right:4px"></iconify-icon>
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

		// Keyboard shortcuts: Esc = close panel, R = refresh
		this._key_handler = (e) => {
			if (e.key === "Escape") { this._close_side_panel(); return; }
			const tag = (e.target || {}).tagName || "";
			if (e.key === "r" && !e.ctrlKey && !e.metaKey && !["INPUT","TEXTAREA","SELECT"].includes(tag)) {
				this.refresh();
			}
		};
		document.addEventListener("keydown", this._key_handler);
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
		} else if (this.active_tab === "job_bundles") {
			this._load_job_bundles();
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
		// Skeleton columns during load
		$c.html(`<div class="ib-ps-pipeline">${IB_STAGES.map(s => `
			<div class="ib-ps-col">
				<div class="ib-ps-col-header" style="border-top:3px solid ${s.color}">
					<span class="ib-ps-col-title">${s.label}</span>
					<div class="ib-skel" style="width:24px;height:20px;border-radius:10px;display:inline-block"></div>
				</div>
				<div class="ib-ps-col-body">
					${[1,2,3].map(() => `<div class="ib-skel ib-skel-wo-card"></div>`).join("")}
				</div>
			</div>`).join("")}</div>`);
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
		this._wo_data = new Map();

		const cols = IB_STAGES.map((s) => {
			const wos = (data[s.key] || []);
			wos.forEach(wo => this._wo_data.set(wo.name, wo));
			const count = wos.length;
			const cards = wos.length
				? wos.map((wo) => this._wo_card_html(wo, s)).join("")
				: `<div class="ib-ps-col-empty">No WOs</div>`;

			const icon_html = s.icon ? `<span class="ib-ps-col-icon" style="color:${s.color}"><iconify-icon icon="lucide:${s.icon}" width="14" height="14"></iconify-icon></span>` : "";
			return `
				<div class="ib-ps-col">
					<div class="ib-ps-col-header" style="border-top:3px solid ${s.color}">
						<span class="ib-ps-col-title">${icon_html}${s.label}</span>
						<span class="ib-ps-count-badge" style="background:${s.color}">${count}</span>
					</div>
					<div class="ib-ps-col-body" data-stage="${s.key}">${cards}</div>
				</div>`;
		}).join("");

		$c.html(`<div class="ib-ps-pipeline">${cols}</div>`);
		$c.off("click");

		// WO card click → side panel (skip if action button was clicked or card is being dragged)
		$c.on("click", ".ib-ps-wo-card", (e) => {
			if ($(e.target).closest(".ib-ps-card-actions").length) return;
			if ($(e.currentTarget).hasClass("ib-ps-wo-dragging")) return;
			const woid = $(e.currentTarget).data("woid");
			const stage = $(e.currentTarget).data("stage");
			const wo = this._wo_data.get(woid);
			if (wo) this._open_wo_panel(wo, stage);
		});

		// Inline: Start / Resume
		$c.on("click", ".ib-ps-action-start", (e) => {
			e.stopPropagation();
			const $card = $(e.currentTarget).closest(".ib-ps-wo-card");
			this._do_inline_start($card.data("woid"), $card.data("stage"), $card);
		});

		// Inline: Next Stage (calls advance_to_next_stage, moves card)
		$c.on("click", ".ib-ps-action-advance", (e) => {
			e.stopPropagation();
			const $card = $(e.currentTarget).closest(".ib-ps-wo-card");
			this._do_inline_advance($card.data("woid"), $card.data("stage"), $card);
		});

		// Inline: Hold
		$c.on("click", ".ib-ps-action-hold-btn", (e) => {
			e.stopPropagation();
			const $card = $(e.currentTarget).closest(".ib-ps-wo-card");
			this._do_inline_hold($card.data("woid"), $card.data("stage"), $card);
		});

		// Init SortableJS drag-and-drop
		this._init_pipeline_sortable();
	}

	_init_pipeline_sortable() {
		// Destroy previous sortable instances
		this._sortables.forEach(s => s.destroy && s.destroy());
		this._sortables = [];

		frappe.require("https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js", () => {
			this.$body.find(".ib-ps-col-body").each((_, col_body) => {
				const s = new Sortable(col_body, {
					group: "ib-pipeline",
					animation: 150,
					ghostClass: "ib-ps-wo-ghost",
					dragClass: "ib-ps-wo-drag",
					draggable: ".ib-ps-wo-card",
					filter: ".ib-ps-card-actions, .ib-ps-action-btn",
					preventOnFilter: false,
					delay: 200,
					delayOnTouchOnly: true,
					onStart: (evt) => { $(evt.item).addClass("ib-ps-wo-dragging"); },
					onEnd: (evt) => {
						$(evt.item).removeClass("ib-ps-wo-dragging");
						const $to_col = $(evt.to).closest(".ib-ps-col");
						$to_col.find(".ib-ps-col-body").removeClass("ib-ps-col-body--drag-over");
						const woid = evt.item.dataset.woid;
						const new_stage_key = evt.to.dataset.stage;
						const old_stage_key = evt.from.dataset.stage;
						if (!woid || !new_stage_key || new_stage_key === old_stage_key) return;
						const new_stage_label = IB_STAGES.find(s => s.key === new_stage_key)?.label;
						if (!new_stage_label) return;
						this._move_wo_stage(woid, new_stage_label, evt.item, evt.from, evt.to, evt.oldIndex);
					},
					onOver: (evt) => { $(evt.to).addClass("ib-ps-col-body--drag-over"); },
					onLeave: (evt) => { $(evt.to).removeClass("ib-ps-col-body--drag-over"); },
				});
				this._sortables.push(s);
			});
		});
	}

	_move_wo_stage(woid, new_stage_label, card_el, from_col, to_col, old_index) {
		frappe.call({
			method: "instabiz.overrides.production.move_work_order_stage",
			args: { work_order: woid, new_stage: new_stage_label },
			callback: (r) => {
				if (r.exc || !r.message?.ok) {
					// Revert: move card back to original column at original position
					const children = from_col.children;
					if (old_index < children.length) {
						from_col.insertBefore(card_el, children[old_index]);
					} else {
						from_col.appendChild(card_el);
					}
					frappe.show_alert({ message: "Failed to move Work Order.", indicator: "red" });
					return;
				}
				// Update the WO data in local map
				const wo = this._wo_data.get(woid);
				if (wo) { wo.stage = new_stage_label; $(card_el).attr("data-stage", IB_STAGES.find(s => s.label === new_stage_label)?.key || ""); }
				// Update column count badges
				const old_stage_key = from_col.dataset.stage;
				const new_stage_key = to_col.dataset.stage;
				this._update_col_count(old_stage_key);
				this._update_col_count(new_stage_key);
				frappe.show_alert({ message: `Moved to ${new_stage_label}`, indicator: "green" }, 2);
			},
		});
	}

	_update_col_count(stage_key) {
		const $col = this.$body.find(`.ib-ps-col-body[data-stage="${stage_key}"]`).closest(".ib-ps-col");
		const count = $col.find(".ib-ps-wo-card").length;
		$col.find(".ib-ps-count-badge").text(count);
	}

	// ------------------------------------------------------------------
	// Inline card actions (no side panel required)
	// ------------------------------------------------------------------

	_do_inline_start(woid, stage_key, $card) {
		$card.addClass("ib-ps-wo-card--loading");
		frappe.call({
			method: "instabiz.overrides.production.start_work_order",
			args: { work_order: woid },
			callback: (r) => {
				$card.removeClass("ib-ps-wo-card--loading");
				if (r.exc || r.message?.status !== "ok") {
					frappe.show_alert({ message: "Failed to start.", indicator: "red" });
					return;
				}
				const wo = this._wo_data.get(woid);
				if (wo) wo.status = "In Progress";
				const stage = IB_STAGES.find(s => s.key === stage_key);
				if (wo && stage) $card.replaceWith(this._wo_card_html(wo, stage));
				frappe.show_alert({ message: "Started", indicator: "green" }, 2);
			},
		});
	}

	_do_inline_advance(woid, stage_key, $card) {
		$card.addClass("ib-ps-wo-card--loading");
		frappe.call({
			method: "instabiz.overrides.production.advance_to_next_stage",
			args: { work_order: woid },
			callback: (r) => {
				$card.removeClass("ib-ps-wo-card--loading");
				if (r.exc) {
					// If already completed (stale card), remove it silently
					if ((Array.isArray(r.exc) ? r.exc : [r.exc]).some(s => typeof s === "string" && s.includes("Current status: Completed"))) {
						$card.remove();
						this._update_col_count(stage_key);
					} else {
						frappe.show_alert({ message: "Advance failed.", indicator: "red" });
					}
					return;
				}
				const res = r.message;
				if (!res || res.status !== "ok") {
					frappe.show_alert({ message: res?.message || "Error", indicator: "red" });
					return;
				}

				// Remove card from current column, update badge
				$card.remove();
				this._update_col_count(stage_key);

				if (res.next_stage && res.new_work_order) {
					const next_key = res.next_stage.toLowerCase().replace(/ /g, "_");
					const next_stage = IB_STAGES.find(s => s.key === next_key);
					if (next_stage) {
						// Fetch the new WO to get its machine assignment etc.
						frappe.call({
							method: "frappe.client.get",
							args: { doctype: "IB Work Order", name: res.new_work_order },
							callback: (gr) => {
								if (!gr.doc) return;
								const prev_wo = this._wo_data.get(woid) || {};
								const new_wo = {
									name: gr.doc.name,
									item_code: gr.doc.item_code,
									item_name: gr.doc.item_name,
									machine: gr.doc.machine,
									priority: gr.doc.priority,
									status: gr.doc.status,
									target_qty: gr.doc.target_qty,
									target_uom: gr.doc.target_uom,
									completed_qty: gr.doc.completed_qty || 0,
									wastage_pct: gr.doc.wastage_pct || 0,
									order_sheet: gr.doc.order_sheet,
									order_sheet_item: gr.doc.order_sheet_item,
									customer_name: prev_wo.customer_name || "",
								};
								this._wo_data.set(new_wo.name, new_wo);
								const $col_body = this.$body.find(`.ib-ps-col-body[data-stage="${next_key}"]`);
								const $empty = $col_body.find(".ib-ps-col-empty");
								if ($empty.length) $empty.remove();
								$col_body.prepend(this._wo_card_html(new_wo, next_stage));
								this._update_col_count(next_key);
							},
						});
					}
					frappe.show_alert({ message: `→ ${res.next_stage}`, indicator: "green" }, 2);
				} else {
					frappe.show_alert({ message: "✓ Production complete", indicator: "green" }, 3);
				}
			},
		});
	}

	_do_inline_hold(woid, stage_key, $card) {
		$card.addClass("ib-ps-wo-card--loading");
		frappe.call({
			method: "instabiz.overrides.production.put_on_hold",
			args: { work_order: woid },
			callback: (r) => {
				$card.removeClass("ib-ps-wo-card--loading");
				if (r.exc) {
					frappe.show_alert({ message: "Failed to hold.", indicator: "red" });
					return;
				}
				const wo = this._wo_data.get(woid);
				if (wo) wo.status = "On Hold";
				const stage = IB_STAGES.find(s => s.key === stage_key);
				if (wo && stage) $card.replaceWith(this._wo_card_html(wo, stage));
				frappe.show_alert({ message: "On Hold", indicator: "orange" }, 2);
			},
		});
	}

	_wo_card_html(wo, stage) {
		const pct = wo.target_qty > 0 ? Math.min(100, Math.round((wo.completed_qty / wo.target_qty) * 100)) : 0;
		const pm = IB_PRIORITY_META[wo.priority] || IB_PRIORITY_META["Normal"];
		const machine_chip = wo.machine
			? `<span class="ib-ps-machine-chip">${frappe.utils.escape_html(wo.machine)}</span>`
			: `<span class="ib-ps-machine-chip ib-ps-machine-chip--unset">No machine</span>`;
		const qty_chip = wo.target_qty
			? `<span class="ib-ps-qty-chip">${wo.target_qty}${wo.target_uom ? " " + frappe.utils.escape_html(wo.target_uom) : ""}</span>`
			: "";
		const customer_html = wo.customer_name
			? `<div class="ib-ps-card-customer" title="${frappe.utils.escape_html(wo.customer_name)}">${frappe.utils.escape_html(wo.customer_name)}</div>`
			: "";

		const ic = (name) => `<iconify-icon icon="lucide:${name}" width="11" height="11" style="vertical-align:middle"></iconify-icon>`;
		let action_html = "";
		if (wo.status === "Pending") {
			action_html = `<button class="ib-ps-action-btn ib-ps-action-start">${ic("play")} Start</button>`;
		} else if (wo.status === "In Progress") {
			action_html = `
				<button class="ib-ps-action-btn ib-ps-action-advance">${ic("arrow-right")} Next Stage</button>
				<button class="ib-ps-action-btn ib-ps-action-hold-btn" title="Put on Hold">${ic("pause")}</button>`;
		} else if (wo.status === "On Hold") {
			action_html = `<button class="ib-ps-action-btn ib-ps-action-start">${ic("play")} Resume</button>`;
		}

		return `
			<div class="ib-ps-wo-card" data-woid="${frappe.utils.escape_html(wo.name)}" data-stage="${stage.key}">
				<div class="ib-ps-card-top">
					<span class="ib-ps-item-code">${frappe.utils.escape_html(wo.item_code || "")}</span>
					<span class="ib-ps-priority-badge ${pm.cls}">${pm.label}</span>
				</div>
				${customer_html}
				<div class="ib-ps-card-chips">
					${machine_chip}${qty_chip}
				</div>
				<div class="ib-ps-progress-wrap">
					<div class="ib-ps-progress-bar" style="width:${pct}%;background:${stage.color}"></div>
				</div>
				<div class="ib-ps-card-actions">${action_html}</div>
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

	_render_item_wise(items, page) {
		const $c = this._content();
		this._item_wise_all = items = items || this._item_wise_all || [];
		if (!items.length) {
			$c.html('<div class="ib-ps-empty">No active production items found.</div>');
			return;
		}

		const filtered = window.ib_multi_token_filter(items, ["item_code"], this.item_wise_search);

		const PAGE_SIZE = 24;
		const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
		this._item_wise_page = page || this._item_wise_page || 1;
		if (this._item_wise_page > totalPages) this._item_wise_page = totalPages;
		const start = (this._item_wise_page - 1) * PAGE_SIZE;
		const pageItems = filtered.slice(start, start + PAGE_SIZE);

		const toolbar = `
			<div class="ib-ps-os-toolbar" style="margin-bottom:12px">
				<input class="ib-ps-search-input form-control" id="ib-iw-search" placeholder="Search item code…" value="${frappe.utils.escape_html(this.item_wise_search || "")}">
				<span class="ib-ps-stat-pill">${filtered.length} items</span>
			</div>`;

		const cards = pageItems.map((item) => this._item_wise_card(item)).join("");
		const pager = totalPages > 1 ? `
			<div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:16px">
				<button class="btn btn-default btn-xs ib-iw-prev" ${this._item_wise_page <= 1 ? "disabled" : ""}>Prev</button>
				<span style="font-size:12px;color:var(--text-muted)">Page ${this._item_wise_page} of ${totalPages}</span>
				<button class="btn btn-default btn-xs ib-iw-next" ${this._item_wise_page >= totalPages ? "disabled" : ""}>Next</button>
			</div>` : "";
		$c.html(toolbar + `<div class="ib-iw-grid" id="ib-iw-grid">${cards}</div>${pager}`);
		$c.off();

		$c.on("input", "#ib-iw-search", (e) => {
			this.item_wise_search = $(e.target).val();
			const cursorPos = e.target.selectionStart;
			this._render_item_wise(this._item_wise_all, 1);
			const $input = $c.find("#ib-iw-search").get(0);
			if ($input) {
				$input.focus();
				$input.setSelectionRange(cursorPos, cursorPos);
			}
		});

		$c.on("click", ".ib-iw-prev", () => this._render_item_wise(this._item_wise_all, this._item_wise_page - 1));
		$c.on("click", ".ib-iw-next", () => this._render_item_wise(this._item_wise_all, this._item_wise_page + 1));

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

	_render_os_list(rows, page) {
		const $c = this._content();
		this._os_list_all = rows = rows || this._os_list_all || [];

		const PAGE_SIZE = 20;
		const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
		this._os_list_page = page || this._os_list_page || 1;
		if (this._os_list_page > totalPages) this._os_list_page = totalPages;
		const start = (this._os_list_page - 1) * PAGE_SIZE;
		const pageRows = rows.slice(start, start + PAGE_SIZE);

		const toolbar = `
			<div class="ib-ps-os-toolbar">
				<div class="ib-ps-filter-group">
					<label>Status</label>
					<select id="ib-os-status-filter" class="ib-ps-select form-control">
						${["All", "Draft", "In Progress", "Completed"].map((s) => `<option value="${s}" ${s === this.os_status_filter ? "selected" : ""}>${s}</option>`).join("")}
					</select>
				</div>
				<div class="ib-ps-filter-group">
					<label>Priority</label>
					<select id="ib-os-priority-filter" class="ib-ps-select form-control">
						${["All", "Urgent", "High", "Normal", "Low"].map((p) => `<option value="${p}" ${p === this.os_priority_filter ? "selected" : ""}>${p}</option>`).join("")}
					</select>
				</div>
				<button class="ib-ps-btn-primary btn btn-primary btn-sm" id="ib-new-os-btn">+ Start Production</button>
			</div>`;

		let table_html = "";
		let pager_html = "";
		if (!rows.length) {
			table_html = '<div class="ib-ps-empty">No production started yet.</div>';
		} else {
			const rows_html = pageRows.map((os) => {
				const pm = IB_PRIORITY_META[os.priority] || IB_PRIORITY_META["Normal"];
				const pct = os.progress_pct || 0;
				// Sales Order is the only identifier shown — the underlying Order
				// Sheet id (os.name) still drives the detail-view click via the row
				// and View button's data-os, it's just never displayed as its own
				// column so it can't be confused with a Work Order number.
				const so_cell = os.sales_order
					? `<a class="ib-ps-os-link" data-so="${frappe.utils.escape_html(os.sales_order)}">${frappe.utils.escape_html(os.sales_order)}</a>`
					: `<span style="color:var(--text-muted)">—</span>`;
				return `
					<tr class="ib-ps-os-row" data-os="${frappe.utils.escape_html(os.name)}">
						<td>${so_cell}</td>
						<td>${frappe.utils.escape_html(os.customer_name || os.customer || "")}</td>
						<td style="text-align:center">${os.item_count || 0}</td>
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
								<th>Sales Order</th><th>Customer</th><th style="text-align:center">Items</th><th>Progress</th><th>Priority</th><th>Status</th><th>Actions</th>
							</tr>
						</thead>
						<tbody>${rows_html}</tbody>
					</table>
				</div>`;

			pager_html = totalPages > 1 ? `
				<div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:12px">
					<button class="btn btn-default btn-xs ib-os-prev" ${this._os_list_page <= 1 ? "disabled" : ""}>Prev</button>
					<span style="font-size:12px;color:var(--text-muted)">Page ${this._os_list_page} of ${totalPages} (${rows.length} order sheets)</span>
					<button class="btn btn-default btn-xs ib-os-next" ${this._os_list_page >= totalPages ? "disabled" : ""}>Next</button>
				</div>` : "";
		}

		$c.html(toolbar + table_html + pager_html);
		$c.off();

		$c.on("click", ".ib-os-prev", () => this._render_os_list(this._os_list_all, this._os_list_page - 1));
		$c.on("click", ".ib-os-next", () => this._render_os_list(this._os_list_all, this._os_list_page + 1));

		// Filter changes
		$c.on("change", "#ib-os-status-filter", (e) => {
			this.os_status_filter = $(e.target).val();
			this._os_list_page = 1;
			this._load_order_sheets();
		});
		$c.on("change", "#ib-os-priority-filter", (e) => {
			this.os_priority_filter = $(e.target).val();
			this._os_list_page = 1;
			this._load_order_sheets();
		});

		// Sales Order link → open SO form
		$c.on("click", "[data-so]", (e) => {
			e.stopPropagation();
			const so = $(e.currentTarget).data("so");
			if (so) frappe.set_route("Form", "Sales Order", so);
		});

		// View / row click
		$c.on("click", ".ib-ps-os-view-btn, .ib-ps-os-link", (e) => {
			e.stopPropagation();
			const os_name = $(e.currentTarget).data("os");
			if (!os_name) return;
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

		const so_link = os.sales_order
			? `<a class="ib-ps-os-link" style="cursor:pointer" data-so-nav="${frappe.utils.escape_html(os.sales_order)}">${frappe.utils.escape_html(os.sales_order)}</a>`
			: `<span style="color:var(--text-muted)">No SO</span>`;
		const date_fmt = (d) => d ? frappe.datetime.str_to_user(d) : "—";
		const header = `
			<div class="ib-ps-detail-header">
				<button class="ib-ps-back-btn" id="ib-os-back">← Back</button>
				<div class="ib-ps-detail-meta">
					<span class="ib-ps-detail-name">${so_link}</span>
					<span class="ib-ps-detail-customer">${frappe.utils.escape_html(os.customer || "")}</span>
					<span style="font-size:11px;color:var(--text-muted)">Order: ${date_fmt(os.order_date)}</span>
					${os.delivery_date ? `<span style="font-size:11px;color:#dc2626">Deliver: ${date_fmt(os.delivery_date)}</span>` : ""}
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

		// Sales Order nav link in detail header
		$c.on("click", "[data-so-nav]", (e) => {
			e.stopPropagation();
			const so = $(e.currentTarget).data("so-nav");
			if (so) frappe.set_route("Form", "Sales Order", so);
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
	// Start Production dialog
	// -----------------------------------------------------------------------
	_show_new_os_dialog() {
		const d = new frappe.ui.Dialog({
			title: "Start Production",
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
							frappe.show_alert({ message: "Failed to start production.", indicator: "red" });
							return;
						}
						frappe.show_alert({ message: `Production started for ${values.sales_order}.`, indicator: "green" });
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
		this._machine_data = new Map();
		machines.forEach(m => this._machine_data.set(m.name || m.machine_code, m));

		const TYPE_COLOR = {
			Coating: "#7c3aed", Slitting: "#2563eb", Rewinding: "#0891b2",
			Cutting: "#059669", Packing: "#d97706",
		};

		const toolbar = `
			<div class="ib-ps-os-toolbar" style="margin-bottom:16px">
				<div style="display:flex;align-items:center;gap:8px">
					<iconify-icon icon="lucide:settings-2" width="14" height="14"></iconify-icon>
					<span class="ib-ps-stat-pill">${machines.length} active machine${machines.length !== 1 ? "s" : ""}</span>
				</div>
				<button class="ib-ps-btn-primary btn btn-primary btn-sm" id="ib-new-machine-btn" style="margin-left:auto;display:flex;align-items:center;gap:5px">
					<iconify-icon icon="lucide:plus" width="11" height="11"></iconify-icon> New Machine
				</button>
			</div>`;

		if (!machines.length) {
			$c.html(toolbar + '<div class="ib-ps-empty">No active machines configured.</div>');
			$c.on("click", "#ib-new-machine-btn", () => this._show_machine_dialog(null));
			return;
		}

		const cards = machines.map((m) => {
			const type_color = TYPE_COLOR[m.machine_type] || "#888";
			const load_pct = m.load_pct || 0;
			const load_color = load_pct > 90 ? "#dc2626" : load_pct > 60 ? "#d97706" : "#16a34a";
			const waste_norm = m.wastage_norm_pct || 3;
			const waste_color = m.today_avg_wastage > waste_norm ? "#dc2626" : "#16a34a";

			// Load bar
			const load_bar_html = `
				<div class="ib-mw-load-section">
					<div class="ib-mw-load-header">
						<span style="font-size:11px;color:var(--text-muted)">Machine Load</span>
						<span style="font-size:12px;font-weight:700;color:${load_color}">${load_pct}%</span>
					</div>
					<div class="ib-mw-load-bar-wrap">
						<div class="ib-mw-load-bar" style="width:${Math.min(100, load_pct)}%;background:${load_color}"></div>
					</div>
					<div style="font-size:10px;color:var(--text-muted);margin-top:2px">
						${m.active_load || 0} active · ${(m.current_wos || []).length} queued
					</div>
				</div>`;

			// Today stats row
			const stats_html = `
				<div class="ib-mw-stats-row">
					<div class="ib-mw-stat">
						<div class="ib-mw-stat-val">${m.today_output || 0}</div>
						<div class="ib-mw-stat-label">Output</div>
					</div>
					<div class="ib-mw-stat">
						<div class="ib-mw-stat-val" style="color:${waste_color}">${m.today_avg_wastage || 0}%</div>
						<div class="ib-mw-stat-label">Wastage</div>
					</div>
					<div class="ib-mw-stat">
						<div class="ib-mw-stat-val">${m.today_entry_count || 0}</div>
						<div class="ib-mw-stat-label">Entries</div>
					</div>
					<div class="ib-mw-stat">
						<div class="ib-mw-stat-val">${m.capacity || "—"}</div>
						<div class="ib-mw-stat-label">${m.capacity_uom || "cap"}</div>
					</div>
				</div>`;

			// WO list
			const wo_rows = (m.current_wos || []).slice(0, 4).map((wo) => {
				const stg = IB_STAGES.find((x) => x.label === wo.stage);
				const color = stg ? stg.color : "#888";
				const pct = wo.target_qty > 0 ? Math.min(100, Math.round((wo.completed_qty / wo.target_qty) * 100)) : 0;
				const status_cls = wo.status === "In Progress" ? "ib-ps-status--in_progress" : "ib-ps-status--pending";
				return `<div class="ib-mw-wo-row">
					<span class="ib-mw-stage-dot" style="background:${color}" title="${frappe.utils.escape_html(wo.stage || "")}"></span>
					<span class="ib-mw-wo-item" title="${frappe.utils.escape_html(wo.item_code || "")}">${frappe.utils.escape_html((wo.item_code || "").substring(0, 22))}</span>
					<div class="ib-mw-wo-right">
						<span class="ib-ps-status-chip ${status_cls}">${frappe.utils.escape_html(wo.status || "")}</span>
						<div class="ib-mw-wo-bar-wrap">
							<div class="ib-mw-wo-bar" style="width:${pct}%;background:${color}"></div>
						</div>
					</div>
				</div>`;
			}).join("") || `<div class="ib-mw-no-wos"><iconify-icon icon="lucide:inbox" width="11" height="11"></iconify-icon> No active WOs</div>`;

			const overflow = (m.current_wos || []).length > 4
				? `<div style="font-size:10px;color:var(--text-muted);text-align:center;padding:3px 0">+${(m.current_wos || []).length - 4} more</div>` : "";

			return `
				<div class="ib-mw-card" style="border-top:3px solid ${type_color}">
					<div class="ib-mw-card-header">
						<div class="ib-mw-code-row">
							<code class="ib-ps-machine-code" style="color:${type_color}">${frappe.utils.escape_html(m.machine_code || "")}</code>
							<span class="ib-ps-type-chip" style="background:${type_color}18;color:${type_color};border:1px solid ${type_color}30">${frappe.utils.escape_html(m.machine_type || "")}</span>
							<span class="ib-ps-status-dot ib-ps-status-dot--active" style="margin-left:auto" title="Active"></span>
						</div>
						<div class="ib-mw-name-row">
							<span class="ib-ps-machine-name">${frappe.utils.escape_html(m.machine_name || "")}</span>
							<span class="ib-ps-location-badge">${frappe.utils.escape_html((m.location || "").charAt(0).toUpperCase() + (m.location || "").slice(1))}</span>
						</div>
					</div>
					${load_bar_html}
					${stats_html}
					<div class="ib-mw-wo-list">${wo_rows}${overflow}</div>
					<div class="ib-mw-card-footer">
						<button class="ib-mw-edit-btn ib-ps-machine-edit-btn" data-machineid="${frappe.utils.escape_html(m.name || m.machine_code)}" title="Edit Machine">
							<iconify-icon icon="lucide:settings" width="11" height="11"></iconify-icon> Edit
						</button>
					</div>
				</div>`;
		}).join("");

		$c.html(toolbar + `<div class="ib-mw-grid">${cards}</div>`);

		$c.on("click", "#ib-new-machine-btn", () => this._show_machine_dialog(null));
		$c.on("click", ".ib-ps-machine-edit-btn", (e) => {
			const mid = $(e.currentTarget).data("machineid");
			const machine = this._machine_data.get(mid);
			this._show_machine_dialog(machine || null);
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
			? `<button class="ib-ps-btn-primary ib-ps-panel-btn btn btn-primary btn-sm" id="ib-wo-assign-machine">Assign Machine</button>`
			: "";
		const start_btn = wo.status === "Pending" || wo.status === "Draft"
			? `<button class="ib-ps-btn-success ib-ps-panel-btn btn btn-success btn-sm" id="ib-wo-start">Start</button>`
			: "";
		const hold_btn = wo.status === "In Progress"
			? `<button class="ib-ps-btn-warn ib-ps-panel-btn btn btn-warning btn-sm" id="ib-wo-hold">On Hold</button>`
			: "";
		const complete_btn = wo.status === "In Progress"
			? `<button class="ib-ps-btn-success ib-ps-panel-btn btn btn-success btn-sm" id="ib-wo-complete">Complete</button>`
			: "";
		const link_jr_btn = (stage_key === "coating" || stage_key === "slitting") && !wo.jumbo_roll
			? `<button class="ib-ps-btn-primary ib-ps-panel-btn btn btn-primary btn-sm" id="ib-wo-link-jr">
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
					<button class="ib-ps-btn-primary ib-ps-panel-btn btn btn-primary btn-sm" id="ib-wo-new-entry">+ New Entry</button>
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
	// TAB 5 — Job Bundles
	// -----------------------------------------------------------------------
	_load_job_bundles() {
		const $c = this._content();
		$c.html(`<div style="padding:24px;text-align:center;color:var(--text-muted)">
			<iconify-icon icon="lucide:loader" width="16" height="16"
				style="vertical-align:middle;margin-right:6px"></iconify-icon>
			Loading job bundles...
		</div>`);
		frappe.call({
			method: "instabiz.overrides.production.get_job_bundles",
			callback: (r) => { this._render_job_bundles(r.message || []); },
			error: () => { $c.html('<div style="padding:24px;color:var(--text-muted)">Failed to load bundles.</div>'); },
		});
	}

	_render_job_bundles(bundles, page) {
		const $c = this._content();
		this._job_bundles_all = bundles = bundles || this._job_bundles_all || [];
		if (!bundles.length) {
			$c.html(`<div style="padding:40px;text-align:center;color:var(--text-muted);font-size:13px">
				<iconify-icon icon="lucide:layers" width="24" height="24"
					style="display:block;margin:0 auto 10px;opacity:.4"></iconify-icon>
				No bundleable jobs found. Bundles form when 2+ Pending Work Orders
				share the same item and stage.
			</div>`);
			return;
		}

		const PAGE_SIZE = 15;
		this._job_bundle_page = page || this._job_bundle_page || 1;
		const totalPages = Math.max(1, Math.ceil(bundles.length / PAGE_SIZE));
		if (this._job_bundle_page > totalPages) this._job_bundle_page = totalPages;
		const start = (this._job_bundle_page - 1) * PAGE_SIZE;
		const pageBundles = bundles.slice(start, start + PAGE_SIZE);

		const stageColorMap = {};
		IB_STAGES.forEach(s => { stageColorMap[s.label] = s.color; stageColorMap[s.key] = s.color; });

		const PRIORITY_COLOR = { Urgent:"#dc2626", High:"#ea580c", Normal:"#2563eb", Low:"#6b7280" };

		const cards = pageBundles.map(bundle => {
			const stageColor = stageColorMap[bundle.stage] || "#7c3aed";
			const woRows = (bundle.wos || []).map(wo => `
				<tr>
					<td style="padding:4px 8px;font-size:11px;font-family:monospace">${frappe.utils.escape_html(wo.name)}</td>
					<td style="padding:4px 8px;font-size:11px">${frappe.utils.escape_html(wo.sales_order || "")}</td>
					<td style="padding:4px 8px;font-size:11px">${frappe.utils.escape_html(wo.customer_name || "")}</td>
					<td style="padding:4px 8px;font-size:11px;text-align:right">${(wo.target_qty||0).toLocaleString()}</td>
					<td style="padding:4px 8px;font-size:11px">
						<span style="background:${PRIORITY_COLOR[wo.priority]||"#6b7280"}18;
							color:${PRIORITY_COLOR[wo.priority]||"#6b7280"};
							border-radius:8px;padding:1px 6px;font-size:10px;font-weight:700">
							${frappe.utils.escape_html(wo.priority||"Normal")}
						</span>
					</td>
					<td style="padding:4px 8px;font-size:11px">
						${wo.batch_group
							? `<span style="background:#d1fae5;color:#065f46;border-radius:6px;
									padding:1px 6px;font-size:10px">${frappe.utils.escape_html(wo.batch_group)}</span>`
							: '<span style="color:var(--text-muted);font-size:10px">none</span>'}
					</td>
				</tr>`).join("");

			const suggested = bundle.suggested_machine || "";
			const bundleKey = `${bundle.item_code}___${bundle.stage}`;

			return `
			<div class="ib-ps-bundle-card" style="
				background:var(--card-bg);border:1px solid var(--border-color);
				border-radius:8px;margin-bottom:14px;overflow:hidden;
				border-left:4px solid ${stageColor}">
				<div class="ib-ps-bundle-header" data-bundle="${frappe.utils.escape_html(bundleKey)}" style="padding:10px 14px;background:var(--subtle-fg,#f8fafc);
					border-bottom:1px solid var(--border-color);cursor:pointer;
					display:flex;align-items:center;gap:10px;flex-wrap:wrap">
					<iconify-icon icon="lucide:chevron-right" width="14" height="14"
						class="ib-ps-bundle-chevron" data-bundle="${frappe.utils.escape_html(bundleKey)}"
						style="flex-shrink:0;transition:transform .15s"></iconify-icon>
					<iconify-icon icon="lucide:layers" width="14" height="14"
						style="color:${stageColor};flex-shrink:0"></iconify-icon>
					<strong style="font-size:13px;color:${stageColor}">
						${frappe.utils.escape_html(bundle.item_code)}
					</strong>
					<span style="font-size:12px;color:var(--text-muted)">
						${frappe.utils.escape_html(bundle.stage)}
					</span>
					<span style="background:${stageColor}18;color:${stageColor};
						border-radius:10px;padding:1px 8px;font-size:11px;font-weight:700">
						${bundle.wos.length} WOs
					</span>
					<span style="font-size:11px;color:var(--text-muted)">
						${bundle.total_qty.toLocaleString()} ${bundle.uom || "units"} total
					</span>
					<div style="margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
						${suggested ? `<span style="font-size:11px;color:var(--text-muted)">
							<iconify-icon icon="lucide:settings-2" width="11" height="11"
								style="vertical-align:middle;margin-right:3px"></iconify-icon>
							Suggested: <strong>${frappe.utils.escape_html(suggested)}</strong>
						</span>` : ""}
						<button class="ib-ps-bundle-assign-btn"
							data-bundle="${frappe.utils.escape_html(bundleKey)}"
							data-wos='${JSON.stringify((bundle.wos||[]).map(w=>w.name))}'
							data-machine="${frappe.utils.escape_html(suggested)}"
							style="background:${stageColor};color:#fff;border:none;
							border-radius:5px;padding:4px 12px;font-size:11px;
							font-weight:600;cursor:pointer">
							<iconify-icon icon="lucide:zap" width="11" height="11"
								style="vertical-align:middle;margin-right:3px"></iconify-icon>
							Batch Assign
						</button>
					</div>
				</div>
				<div class="ib-ps-bundle-body" data-bundle="${frappe.utils.escape_html(bundleKey)}" style="display:none;overflow-x:auto">
					<table class="table table-bordered">
						<thead><tr style="border-bottom:1px solid var(--border-color)">
							<th style="padding:5px 8px;text-align:left;font-size:10px;font-weight:700;
								text-transform:uppercase;color:var(--text-muted)">Work Order</th>
							<th style="padding:5px 8px;text-align:left;font-size:10px;font-weight:700;
								text-transform:uppercase;color:var(--text-muted)">Sales Order</th>
							<th style="padding:5px 8px;text-align:left;font-size:10px;font-weight:700;
								text-transform:uppercase;color:var(--text-muted)">Customer</th>
							<th style="padding:5px 8px;text-align:right;font-size:10px;font-weight:700;
								text-transform:uppercase;color:var(--text-muted)">Qty</th>
							<th style="padding:5px 8px;text-align:left;font-size:10px;font-weight:700;
								text-transform:uppercase;color:var(--text-muted)">Priority</th>
							<th style="padding:5px 8px;text-align:left;font-size:10px;font-weight:700;
								text-transform:uppercase;color:var(--text-muted)">Batch</th>
						</tr></thead>
						<tbody>${woRows}</tbody>
					</table>
				</div>
			</div>`;
		}).join("");

		const pager = totalPages > 1 ? `
			<div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:16px">
				<button class="btn btn-default btn-xs ib-ps-bundle-prev" ${this._job_bundle_page <= 1 ? "disabled" : ""}>Prev</button>
				<span style="font-size:12px;color:var(--text-muted)">Page ${this._job_bundle_page} of ${totalPages}</span>
				<button class="btn btn-default btn-xs ib-ps-bundle-next" ${this._job_bundle_page >= totalPages ? "disabled" : ""}>Next</button>
			</div>` : "";

		$c.html(`
			<div style="padding:16px">
				<div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">
					${bundles.length} bundle${bundles.length!==1?"s":""} found
					(showing ${start + 1}-${start + pageBundles.length}).
					Select "Batch Assign" to assign all WOs in a bundle to the same machine in one click.
				</div>
				${cards}
				${pager}
			</div>`);
		$c.off("click", ".ib-ps-bundle-assign-btn");
		$c.off("click", ".ib-ps-bundle-header");

		$c.on("click", ".ib-ps-bundle-assign-btn", (e) => {
			e.stopPropagation();
			const $btn   = $(e.currentTarget);
			// jQuery auto-parses data-* that look like JSON, so handle both array and string
			const raw    = $btn.data("wos");
			const woList = Array.isArray(raw) ? raw : (raw ? JSON.parse(raw) : []);
			const sugg   = $btn.data("machine") || "";
			this._show_batch_assign_dialog(woList, sugg, $btn);
		});

		$c.on("click", ".ib-ps-bundle-header", (e) => {
			const key = $(e.currentTarget).data("bundle");
			const $body = $c.find(`.ib-ps-bundle-body[data-bundle="${key}"]`);
			const $chevron = $c.find(`.ib-ps-bundle-chevron[data-bundle="${key}"]`);
			const opening = $body.css("display") === "none";
			$body.css("display", opening ? "" : "none");
			$chevron.css("transform", opening ? "rotate(90deg)" : "");
		});

		$c.off("click", ".ib-ps-bundle-prev").on("click", ".ib-ps-bundle-prev", () => {
			this._render_job_bundles(null, this._job_bundle_page - 1);
		});
		$c.off("click", ".ib-ps-bundle-next").on("click", ".ib-ps-bundle-next", () => {
			this._render_job_bundles(null, this._job_bundle_page + 1);
		});
	}

	_show_batch_assign_dialog(woList, suggestedMachine, $btn) {
		const d = new frappe.ui.Dialog({
			title: `Batch Assign ${woList.length} Work Orders`,
			fields: [
				{
					fieldname: "machine",
					label: "Machine",
					fieldtype: "Link",
					options: "IB Machine",
					default: suggestedMachine,
					reqd: 1,
				},
				{
					fieldname: "batch_group",
					label: "Batch Group (auto-generated if blank)",
					fieldtype: "Data",
				},
			],
			primary_action_label: `Assign ${woList.length} WOs`,
			primary_action: (values) => {
				frappe.call({
					method: "instabiz.overrides.production.batch_assign_machine",
					args: {
						work_orders: woList,
						machine: values.machine,
						batch_group: values.batch_group || "",
					},
					callback: (r) => {
						const updated = r.message?.updated?.length || 0;
						frappe.show_alert({
							message: `${updated} Work Orders assigned to ${values.machine}`,
							indicator: "green",
						});
						d.hide();
						this._load_job_bundles();
					},
				});
			},
		});
		d.show();
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
	min-width: 250px;
	flex: 0 0 250px;
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
.ib-ps-col-title { font-size: 12px; font-weight: 600; color: var(--text-color); display: flex; align-items: center; gap: 5px; }
.ib-ps-col-icon { display: flex; align-items: center; flex-shrink: 0; }
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
	border-radius: 8px;
	padding: 10px 10px 8px;
	cursor: pointer;
	transition: transform 0.1s, box-shadow 0.15s, border-color 0.15s;
}
.ib-ps-wo-card:hover {
	transform: translateY(-2px);
	box-shadow: 0 4px 14px rgba(0,0,0,0.10);
	border-color: var(--ib-primary);
}
.ib-ps-wo-card--loading {
	opacity: 0.5;
	pointer-events: none;
}
.ib-ps-card-top {
	display: flex;
	justify-content: space-between;
	align-items: flex-start;
	gap: 6px;
	margin-bottom: 3px;
}
.ib-ps-item-code { font-size: 11px; font-weight: 700; color: var(--text-color); word-break: break-all; line-height: 1.3; }
.ib-ps-card-customer {
	font-size: 11px; color: var(--text-muted);
	margin-bottom: 5px;
	white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ib-ps-card-chips { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
.ib-ps-card-meta { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
.ib-ps-qty-chip {
	font-size: 10px; font-weight: 600;
	background: var(--fg-color, #f3f4f6); color: var(--text-color);
	border-radius: 4px; padding: 1px 6px;
}
.ib-ps-machine-chip--unset { background: #fef9c3; color: #78350f; }

/* Card action buttons */
.ib-ps-card-actions {
	display: flex; gap: 4px;
	margin-top: 7px; padding-top: 7px;
	border-top: 1px solid var(--border-color);
}
.ib-ps-action-btn {
	flex: 1; padding: 4px 6px;
	border-radius: 5px; border: 1px solid transparent;
	font-size: 11px; font-family: inherit; font-weight: 600;
	cursor: pointer; white-space: nowrap;
	transition: opacity 0.12s, transform 0.1s;
}
.ib-ps-action-btn:hover  { opacity: 0.82; transform: translateY(-1px); }
.ib-ps-action-btn:active { transform: translateY(0); opacity: 1; }
.ib-ps-action-start   { background: #dcfce7; color: #15803d; border-color: #bbf7d0; }
.ib-ps-action-start:hover { background: #bbf7d0; }
.ib-ps-action-advance { background: #dbeafe; color: #1d4ed8; border-color: #bfdbfe; }
.ib-ps-action-advance:hover { background: #bfdbfe; }
.ib-ps-action-hold-btn { flex: 0 0 auto; background: #fffbeb; color: #92400e; border-color: #fde68a; padding: 4px 8px; }
.ib-ps-action-hold-btn:hover { background: #fde68a; }

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
	font-size: 12px;
}
.ib-ps-table thead th {
	background: var(--fg-color, #f9fafb);
	padding: 6px 10px;
	text-align: left;
	border-bottom: 1px solid var(--border-color);
	font-weight: 600;
	font-size: 11px;
	color: var(--text-muted);
}
.ib-ps-table tbody tr {
	border-bottom: 1px solid var(--border-color);
	cursor: pointer;
	transition: background 0.1s;
}
.ib-ps-table tbody tr:hover { background: var(--fg-color, #f9fafb); }
.ib-ps-table td { padding: 6px 10px; vertical-align: middle; }
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
	gap: 14px;
}
.ib-mw-card {
	background: var(--card-bg);
	border: 1px solid var(--border-color);
	border-radius: 10px;
	padding: 14px;
	display: flex; flex-direction: column; gap: 11px;
	transition: box-shadow .15s, transform .12s;
}
.ib-mw-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,.09); transform: translateY(-1px); }
.ib-mw-card-header { display: flex; flex-direction: column; gap: 5px; }
.ib-mw-code-row { display: flex; align-items: center; gap: 6px; }
.ib-mw-name-row { display: flex; align-items: center; gap: 6px; margin-top: 1px; }

/* Load bar */
.ib-mw-load-section { background: var(--fg-color, #f9fafb); border-radius: 7px; padding: 8px 10px; border: 1px solid var(--border-color); }
.ib-mw-load-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
.ib-mw-load-bar-wrap { height: 6px; background: var(--border-color); border-radius: 3px; overflow: hidden; }
.ib-mw-load-bar { height: 100%; border-radius: 3px; transition: width .4s; }

/* Stats */
.ib-mw-stats-row {
	display: grid; grid-template-columns: repeat(4, 1fr);
	gap: 4px;
	background: var(--fg-color, #f9fafb);
	border-radius: 7px; padding: 8px 6px;
	border: 1px solid var(--border-color);
}
.ib-mw-stat { text-align: center; }
.ib-mw-stat-val { font-size: 15px; font-weight: 700; color: var(--text-color); line-height: 1.2; }
.ib-mw-stat-label { font-size: 9px; color: var(--text-muted); margin-top: 2px; text-transform: uppercase; letter-spacing: .04em; }

/* WO list */
.ib-mw-wo-list { display: flex; flex-direction: column; gap: 4px; }
.ib-mw-wo-row { display: flex; align-items: center; gap: 7px; padding: 5px 7px; background: var(--fg-color,#f9fafb); border-radius: 5px; border: 1px solid var(--border-color); }
.ib-mw-stage-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ib-mw-wo-item { font-size: 11px; flex: 1; font-family: monospace; color: var(--text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ib-mw-wo-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex-shrink: 0; }
.ib-mw-wo-bar-wrap { width: 48px; height: 3px; background: var(--border-color); border-radius: 2px; overflow: hidden; }
.ib-mw-wo-bar { height: 100%; border-radius: 2px; }
.ib-mw-no-wos { font-size: 11px; color: var(--text-muted); padding: 6px 0; display: flex; align-items: center; gap: 5px; }

/* Footer */
.ib-mw-card-footer { margin-top: auto; padding-top: 2px; }
.ib-mw-edit-btn {
	display: inline-flex; align-items: center; gap: 4px;
	padding: 4px 10px; border-radius: 5px;
	border: 1px solid var(--border-color);
	background: var(--card-bg); color: var(--text-muted);
	font-size: 11px; font-family: inherit; cursor: pointer;
	transition: border-color .12s, color .12s;
}
.ib-mw-edit-btn:hover { border-color: var(--ib-primary); color: var(--ib-primary); }
`;
		const $style = $(`<style id="ib-ps-styles">${css}</style>`);
		$("head").append($style);
	}
}
