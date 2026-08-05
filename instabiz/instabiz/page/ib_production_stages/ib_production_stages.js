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
	const inst = wrapper._page_instance;
	if (inst) {
		// A KPI/Pipeline card click after the first visit sets frappe.route_options
		// again — the constructor only consumes it once, so re-consume here on
		// every show or a second/third deep-link click would be silently ignored.
		inst._consume_route_options();
		inst._sync_route_ui();
		inst.refresh();
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

// Same abbreviations as the Production Dashboard's stagePills (_render_plan in
// ib_production_dashboard.js) — kept identical across both pages so a chip
// means the same thing wherever it's seen.
const STAGE_ABBR = {
	"Coating": "CT", "Slitting": "SL", "Rewinding": "RW", "Cutting": "CU",
	"Packing": "PK", "Ready to Deliver": "RTD", "Delivered": "DL",
};

// Frappe's own indicator-pill color words (frappe/public/scss/common/indicator.scss)
// — theme-aware via --bg-{color}/--text-on-{color} CSS vars, unlike the hardcoded
// hex this page used to carry in 3 separate places (JS meta, a dead :root block,
// and ~15 CSS blocks). Priority and Work Order status both reuse this single
// mapping so the same word always means the same color everywhere on this page.
const IB_PRIORITY_META = {
	Urgent: { color: "red", label: "Urgent" },
	High: { color: "orange", label: "High" },
	Normal: { color: "blue", label: "Normal" },
	Low: { color: "gray", label: "Low" },
};

const IB_STATUS_COLOR = {
	"Pending": "gray",
	"In Progress": "blue",
	"Completed": "green",
	"On Hold": "orange",
	"Cancelled": "red",
	// Product-wise stage-cell states aren't real IB Work Order statuses but
	// map onto the same visual vocabulary (done=green, active=blue, etc.).
	"done": "green",
	"active": "blue",
	"none": "gray",
};

function _ib_status_color(text) {
	return IB_STATUS_COLOR[text] || IB_PRIORITY_META[text]?.color || "gray";
}

/* Renders a Frappe-native indicator-pill for any status/priority word above.
   `size` "sm" applies this page's own compact density override (Frappe's
   default pill is roomy — 20px tall — too large for a table cell packed with
   several per row); omit for the default Frappe size. */
function _ib_status_pill(text, size) {
	const cls = size === "sm" ? "indicator-pill ib-ps-pill-sm" : "indicator-pill";
	return `<span class="${cls} ${_ib_status_color(text)}">${frappe.utils.escape_html(text || "")}</span>`;
}

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
		this.active_tab = "order_wise";
		this.os_status_filter = "All";
		this.os_priority_filter = "All";
		this.os_search = "";
		this.bundle_search = "";
		this.location_filter = localStorage.getItem("ib_prod_location") || "";
		this.current_os = null;
		this.current_os_tab = "order_wise";
		this.active_wo = null;
		this.machines_cache = null;
		this.item_wise_search = "";
		this.stage_wise_search = "";
		// Selected stage pill for the Stage-wise tab — defaults to Coating,
		// overridden by a route deep-link's ?stage= (see _route_stage_filter
		// below, shared with Item-wise's existing stage highlight).
		this.stage_wise_pill = "coating";
		this.stage_wise_cache = null;
		// Client-side stage highlight for the Item-wise tab, set via
		// frappe.route_options.stage (e.g. a Dashboard pipeline card deep-link).
		this._route_stage_filter = null;
		// Client-side WO-status filter for the Item-wise tab, set via
		// frappe.route_options.status when landing here from a Dashboard KPI
		// card (Active Work Orders / Pending) — Item-wise is WO-grain and spans
		// every Order Sheet, unlike Order-wise's Order-Sheet-grain status. Value
		// is either a single status string ("Pending") or an array of statuses
		// to match any-of (["Pending","In Progress","On Hold"] for "Active").
		this._route_status_filter = null;

		// Data stores — avoids JSON.stringify in data attributes
		this._wo_data = new Map();
		this._machine_data = new Map();
		this._sortables = [];

		// Consume frappe.route_options (standard Frappe convention — a caller
		// sets it right before frappe.set_route(), we read + clear it here so a
		// later plain navigation to this page doesn't replay stale filters).
		this._consume_route_options();

		this._inject_styles();
		this._build_shell();
		this._add_toolbar_buttons();
		// _build_shell() hardcodes "Order-wise" as the active toolbar tab and
		// sets the location select from whatever _consume_route_options() just
		// applied — re-sync here in case route options picked something else.
		this._sync_route_ui();
		this.refresh();
		this._start_live_updates();
	}

	// Re-applies active_tab/location_filter to the toolbar DOM. Needed both
	// right after the constructor's _build_shell() and on every later
	// on_page_show — the page instance persists across navigations (only the
	// constructor calls _build_shell()), so a second/third click on a
	// Dashboard KPI/Pipeline card was setting frappe.route_options correctly
	// but the already-existing page silently ignored it: _consume_route_options()
	// only ran once, in the constructor, so it never fired again on repeat visits.
	_sync_route_ui() {
		this.$body.find(".ib-ps-tab").removeClass("active");
		this.$body.find(`.ib-ps-tab[data-tab="${this.active_tab}"]`).addClass("active");
		this.$body.find("#ib-ps-location").val(this.location_filter);
	}

	_consume_route_options() {
		const ro = frappe.route_options;
		if (!ro) return;

		const VALID_TABS = ["order_wise", "item_wise", "job_bundles", "machine_wise", "stage_wise"];
		if (ro.tab && VALID_TABS.includes(ro.tab)) {
			this.active_tab = ro.tab;
			delete ro.tab;
		}
		if (ro.location !== undefined) {
			this.location_filter = ro.location || "";
			localStorage.setItem("ib_prod_location", this.location_filter);
			delete ro.location;
		}
		if (ro.status !== undefined && this.active_tab === "order_wise") {
			this.os_status_filter = ro.status;
			delete ro.status;
		} else if (ro.status !== undefined && this.active_tab === "item_wise") {
			// WO-grain status filter — see this._route_status_filter above.
			this._route_status_filter = ro.status;
			delete ro.status;
		}
		if (ro.stage) {
			this._route_stage_filter = ro.stage;
			delete ro.stage;
		}

		// Anything left unconsumed here isn't ours — leave it for whoever set
		// it. Only null out the whole object once we've taken everything.
		if (Object.keys(ro).length === 0) frappe.route_options = null;
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
	// Standard page toolbar (top of page, always visible) — mirrors the
	// reverse link Production Dashboard already has back to this page
	// (ib_production_dashboard.js `_add_toolbar_buttons()`), so navigation
	// works both directions without digging into page content.
	_add_toolbar_buttons() {
		this.page.set_primary_action(__("Production Dashboard"), () => {
			frappe.set_route("ib-production-dashboard");
		}, "arrow-right");
	}

	_build_shell() {
		// Toolbar tabs
		const tabs_html = `
			<div class="ib-ps-tabs">
				<button class="ib-ps-tab active" data-tab="order_wise">
					<iconify-icon icon="lucide:clipboard-list" width="12" height="12" style="vertical-align:middle;margin-right:4px"></iconify-icon>
					Order-wise
				</button>
				<button class="ib-ps-tab" data-tab="item_wise">
					<iconify-icon icon="lucide:box" width="12" height="12" style="vertical-align:middle;margin-right:4px"></iconify-icon>
					Item-wise
				</button>
				<button class="ib-ps-tab" data-tab="stage_wise">
					<iconify-icon icon="lucide:git-branch" width="12" height="12" style="vertical-align:middle;margin-right:4px"></iconify-icon>
					Stage-wise
				</button>
				<button class="ib-ps-tab" data-tab="machine_wise">
					<iconify-icon icon="lucide:settings-2" width="12" height="12" style="vertical-align:middle;margin-right:4px"></iconify-icon>
					Machine-wise
				</button>
				<button class="ib-ps-tab" data-tab="job_bundles">
					<iconify-icon icon="lucide:layers" width="12" height="12" style="vertical-align:middle;margin-right:4px"></iconify-icon>
					Job Bundles
				</button>
				<span style="flex:1"></span>
				<div class="ib-ps-loc-group">
					<iconify-icon icon="lucide:map-pin" width="12" height="12" style="color:var(--text-muted)"></iconify-icon>
					<select id="ib-ps-location" class="ib-ps-select form-control">
						<option value="">All Locations</option>
						<option value="gujarat">Gujarat (Factory)</option>
						<option value="maharashtra">Maharashtra (Warehouse)</option>
						<option value="chennai">Chennai (Warehouse)</option>
					</select>
				</div>
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

		this.$body.find("#ib-ps-location").val(this.location_filter);

		// Tab clicks
		this.$body.on("click", ".ib-ps-tab", (e) => {
			const tab = $(e.currentTarget).data("tab");
			this._switch_tab(tab);
		});

		this.$body.on("change", "#ib-ps-location", (e) => {
			this.location_filter = $(e.target).val();
			localStorage.setItem("ib_prod_location", this.location_filter);
			this.current_os = null;
			this.refresh();
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
		// A stage/status deep-link only makes sense on the tab it landed on — a
		// manual switch away means the user is done with that scoped view.
		if (tab !== "item_wise") {
			this._route_stage_filter = null;
			this._route_status_filter = null;
		}
		this.$body.find(".ib-ps-tab").removeClass("active");
		this.$body.find(`.ib-ps-tab[data-tab="${tab}"]`).addClass("active");
		this._close_side_panel();
		this.refresh();
	}

	refresh() {
		if (this.active_tab === "item_wise") {
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
		} else if (this.active_tab === "stage_wise") {
			this._load_stage_wise();
		}
	}

	_content() {
		return this.$body.find("#ib-ps-content");
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

		// Deep-link stage highlight (e.g. from a Dashboard pipeline card) — an
		// item matches if it has a not-yet-completed Work Order at that stage.
		let stage_scoped = items;
		if (this._route_stage_filter) {
			stage_scoped = items.filter((it) => (it.work_orders || []).some(
				(wo) => wo.stage === this._route_stage_filter && wo.status !== "Completed" && wo.status !== "Cancelled"
			));
		}

		// Deep-link WO-status filter (e.g. Dashboard "Active Work Orders" /
		// "Pending" KPI cards) — an item matches if it has at least one Work
		// Order whose status is in the requested set. This is the WO-grain
		// counterpart to the stage filter above; unlike Order-wise's status
		// filter (which is Order-Sheet-grain), this reads IB Work Order.status
		// directly, matching what the KPI cards themselves count.
		if (this._route_status_filter) {
			const wanted = this._route_status_filter;
			const matches_status = (s) => Array.isArray(wanted) ? wanted.includes(s) : s === wanted;
			stage_scoped = stage_scoped.filter((it) => (it.work_orders || []).some((wo) => matches_status(wo.status)));
		}

		const filtered = window.ib_multi_token_filter(stage_scoped, ["item_code"], this.item_wise_search);

		const PAGE_SIZE = 24;
		const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
		this._item_wise_page = page || this._item_wise_page || 1;
		if (this._item_wise_page > totalPages) this._item_wise_page = totalPages;
		const start = (this._item_wise_page - 1) * PAGE_SIZE;
		const pageItems = filtered.slice(start, start + PAGE_SIZE);

		const stage_pill = this._route_stage_filter ? `
			<span class="ib-ps-stat-pill ib-ps-stage-filter-pill">
				Stage: ${frappe.utils.escape_html(this._route_stage_filter)}
				<button type="button" class="ib-ps-stage-filter-clear" title="Clear stage filter">×</button>
			</span>` : "";

		const status_pill = this._route_status_filter ? `
			<span class="ib-ps-stat-pill ib-ps-stage-filter-pill">
				Status: ${frappe.utils.escape_html(Array.isArray(this._route_status_filter) ? this._route_status_filter.join(" / ") : this._route_status_filter)}
				<button type="button" class="ib-ps-status-filter-clear" title="Clear status filter">×</button>
			</span>` : "";

		const toolbar = `
			<div class="ib-ps-os-toolbar" style="margin-bottom:12px">
				<input class="ib-ps-search-input form-control" id="ib-iw-search" placeholder="Search item code…" value="${frappe.utils.escape_html(this.item_wise_search || "")}">
				<span class="ib-ps-stat-pill">${filtered.length} items</span>
				${stage_pill}
				${status_pill}
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

		$c.on("click", ".ib-ps-stage-filter-clear", () => {
			this._route_stage_filter = null;
			this._render_item_wise(this._item_wise_all, 1);
		});

		$c.on("click", ".ib-ps-status-filter-clear", () => {
			this._route_status_filter = null;
			this._render_item_wise(this._item_wise_all, 1);
		});

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

	}

	_item_wise_card(item) {
		const pct = item.completion_pct || 0;
		const active_stages = (item.stages_active || []).map((s) => {
			const stg = IB_STAGES.find((x) => x.label === s || x.key === s.toLowerCase().replace(/ /g, "_"));
			const color = stg ? stg.color : "#888";
			return `<span class="ib-ps-stage-chip" style="background:${color}">${frappe.utils.escape_html(s)}</span>`;
		}).join("");

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
				: "—";

			return `<tr>
				<td><span class="ib-ps-stage-chip" style="background:${color};color:#fff">${frappe.utils.escape_html(wo.stage || "")}</span></td>
				<td><code style="font-size:11px">${frappe.utils.escape_html(wo.name)}</code></td>
				<td>${_ib_status_pill(wo.status, "sm")}</td>
				<td>${wo.machine ? frappe.utils.escape_html(wo.machine) : "—"}</td>
				<td>
					<div class="ib-ps-progress-wrap" style="min-width:60px"><div class="ib-ps-progress-bar" style="width:${pct}%;background:${color}"></div></div>
					<small>${wo.completed_qty || 0}/${wo.target_qty || 0}</small>
				</td>
				<td>${jr_cell}</td>
				<td style="font-size:10px;color:var(--text-muted)">${wo.creation ? frappe.datetime.str_to_user(wo.creation) : "—"}</td>
				<td style="font-size:10px;color:var(--text-muted)">${wo.delivery_date ? frappe.datetime.str_to_user(wo.delivery_date) : "—"}</td>
			</tr>`;
		}).join("");

		const batch_section = (item.batch_chains || []).length
			? item.batch_chains.map((chain) => {
				const jr = chain.jumbo_roll || {};
				return `
					<div class="ib-iw-batch-block">
						<div class="ib-iw-batch-header">
							<iconify-icon icon="lucide:circle" width="12" height="12"></iconify-icon>
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
						<thead><tr><th>Stage</th><th>Work Order</th><th>Status</th><th>Machine</th><th>Progress</th><th>Jumbo Roll</th><th>Created</th><th>ETD</th></tr></thead>
						<tbody>${stage_rows}</tbody>
					</table>
				</div>

				<div class="ib-iw-section-title" style="margin-top:16px">Batch Lineage (Jumbo Rolls)</div>
				<div class="ib-iw-batches">${batch_section}</div>
			</div>`);

		// $c (#ib-ps-content) is a persistent node reused across calls — without
		// unbinding first, re-rendering this view would stack duplicate handlers
		// on every call, same bug class as the WO side panel fix.
		$c.off();
		$c.on("click", "#ib-iw-back", () => this._load_item_wise());
	}

	// -----------------------------------------------------------------------
	// TAB — Stage-wise view (stage picker + flat WO table, not the old
	// drag-and-drop Kanban removed 2026-07-30 — see get_stage_pipeline()'s
	// own docstring). "What's sitting at MY station right now, across every
	// order" — the one question Order-wise/Item-wise/Machine-wise don't
	// answer directly.
	// -----------------------------------------------------------------------
	_load_stage_wise() {
		const $c = this._content();
		$c.html('<div class="ib-ps-loading">Loading stage view…</div>');
		// Deep-link stage (Dashboard pipeline card etc.) picks which pill opens
		// first — consumed once, same pattern Item-wise's _route_stage_filter
		// already uses, then cleared so a later manual pill click isn't
		// fighting a stale route value on every re-render.
		if (this._route_stage_filter) {
			const key = IB_STAGES.find((s) => s.label === this._route_stage_filter)?.key;
			if (key) this.stage_wise_pill = key;
			this._route_stage_filter = null;
		}
		frappe.call({
			method: "instabiz.overrides.production.get_stage_pipeline",
			args: { location: this.location_filter || null },
			callback: (r) => {
				if (r.exc) {
					$c.html('<div class="ib-ps-empty">Failed to load stage view.</div>');
					return;
				}
				this.stage_wise_cache = r.message || {};
				this._render_stage_wise();
			},
		});
	}

	_render_stage_wise() {
		const $c = this._content();
		const pipeline = this.stage_wise_cache || {};

		const pills = IB_STAGES.map((s) => {
			const count = (pipeline[s.key] || []).length;
			const active = s.key === this.stage_wise_pill;
			return `<button type="button" class="ib-ps-tab ib-sw-pill${active ? " active" : ""}" data-stage="${s.key}"
					style="${active ? `background:${s.color};border-color:${s.color}` : ""}">
					${frappe.utils.escape_html(s.label)} <span class="ib-ps-tab-badge">${count}</span>
				</button>`;
		}).join("");

		const rows = pipeline[this.stage_wise_pill] || [];
		const filtered = window.ib_multi_token_filter(rows, ["item_code", "item_name", "sales_order", "customer_name", "machine"], this.stage_wise_search);

		const toolbar = `
			<div class="ib-ps-os-toolbar" style="margin:14px 0 12px">
				<input class="ib-ps-search-input form-control" id="ib-sw-search" placeholder="Search item, order, customer, machine…" value="${frappe.utils.escape_html(this.stage_wise_search || "")}">
				<span class="ib-ps-stat-pill">${filtered.length} of ${rows.length}</span>
			</div>`;

		const table_rows = filtered.length
			? filtered.map((row) => {
				this._wo_data.set(row.name, row);
				const pct = row.target_qty > 0 ? Math.min(100, Math.round((row.completed_qty / row.target_qty) * 100)) : 0;
				return `<tr class="ib-ps-wo-sub-item--clickable" data-woid="${frappe.utils.escape_html(row.name)}">
					<td>${frappe.utils.escape_html(row.item_code || "")}</td>
					<td>${row.sales_order ? `<a class="ib-ps-os-link" data-so-nav="${frappe.utils.escape_html(row.sales_order)}">${frappe.utils.escape_html(row.sales_order)}</a>` : "—"}</td>
					<td>${frappe.utils.escape_html(row.customer_name || "")}</td>
					<td>${row.machine ? frappe.utils.escape_html(row.machine) : `<span style="color:var(--text-muted)">Unassigned</span>`}</td>
					<td>${_ib_status_pill(row.priority || "Normal", "sm")}</td>
					<td>${_ib_status_pill(row.status, "sm")}</td>
					<td>
						<div class="ib-ps-progress-wrap" style="min-width:70px">
							<div class="ib-ps-progress-bar" style="width:${pct}%;background:var(--ib-primary)"></div>
						</div>
						<small>${row.completed_qty || 0}/${row.target_qty || 0} ${frappe.utils.escape_html(row.target_uom || "")}</small>
					</td>
					<td>${row.delivery_date ? frappe.datetime.str_to_user(row.delivery_date) : "—"}</td>
				</tr>`;
			}).join("")
			: `<tr><td colspan="8"><div class="ib-ps-empty">Nothing at this stage${this.stage_wise_search ? " matching your search" : ""}.</div></td></tr>`;

		$c.html(`
			<div class="ib-sw-pills">${pills}</div>
			${toolbar}
			<div class="ib-ps-table-wrap">
				<table class="ib-ps-table">
					<thead><tr>
						<th>Item Code</th><th>Sales Order</th><th>Customer</th><th>Machine</th>
						<th>Priority</th><th>Status</th><th>Progress</th><th>ETD</th>
					</tr></thead>
					<tbody>${table_rows}</tbody>
				</table>
			</div>`);

		$c.off();
		$c.on("click", ".ib-sw-pill", (e) => {
			this.stage_wise_pill = $(e.currentTarget).data("stage");
			this._render_stage_wise();
		});
		$c.on("input", "#ib-sw-search", (e) => {
			this.stage_wise_search = e.target.value;
			this._render_stage_wise();
		});
		$c.on("click", "[data-so-nav]", (e) => {
			e.stopPropagation();
			frappe.set_route("Form", "Sales Order", $(e.currentTarget).data("so-nav"));
		});
		$c.on("click", "tr[data-woid]", (e) => {
			const wo = this._wo_data.get($(e.currentTarget).data("woid"));
			if (wo) this._open_wo_panel(wo, IB_STAGES.find((s) => s.label === wo.stage)?.key || this.stage_wise_pill);
		});
	}

	// -----------------------------------------------------------------------
	// TAB 3 — Order-wise (Order Sheets list + detail)
	// -----------------------------------------------------------------------
	_load_order_sheets() {
		const $c = this._content();
		$c.html('<div class="ib-ps-loading">Loading orders…</div>');
		frappe.call({
			method: "instabiz.overrides.production.get_order_sheets",
			args: {
				status: this.os_status_filter === "All" ? "" : this.os_status_filter,
				priority: this.os_priority_filter === "All" ? "" : this.os_priority_filter,
				location: this.location_filter || "",
				search: this.os_search || "",
			},
			callback: (r) => {
				if (r.exc) {
					$c.html('<div class="ib-ps-empty">Failed to load orders.</div>');
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
				<div class="ib-ps-filter-group ib-ps-filter-group--search">
					<iconify-icon icon="lucide:search" width="13" height="13" style="color:var(--text-muted)"></iconify-icon>
					<input type="text" id="ib-os-search" class="ib-ps-search-input form-control"
						placeholder="Search Sales Order or customer…" value="${frappe.utils.escape_html(this.os_search || "")}">
				</div>
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
						<td>${_ib_status_pill(os.priority || "Normal", "sm")}</td>
						<td>${_ib_status_pill(os.status, "sm")}</td>
						<td>
							<div style="display:flex;gap:6px">
								<button class="ib-ps-btn-sm ib-ps-os-view-btn" data-os="${frappe.utils.escape_html(os.name)}">View</button>
								<button class="ib-ps-btn-sm ib-ps-os-print-btn" data-os="${frappe.utils.escape_html(os.name)}" title="Print Job Order for every item on this order">
									<iconify-icon icon="lucide:printer" width="12" height="12" style="vertical-align:middle"></iconify-icon>
								</button>
							</div>
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
					<span style="font-size:12px;color:var(--text-muted)">Page ${this._os_list_page} of ${totalPages} (${rows.length} orders)</span>
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
		let os_search_timer = null;
		$c.on("input", "#ib-os-search", (e) => {
			clearTimeout(os_search_timer);
			const val = $(e.target).val();
			os_search_timer = setTimeout(() => {
				this.os_search = val;
				this._os_list_page = 1;
				this._load_order_sheets();
			}, 300);
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

		// Print Job Order — every active Work Order under this order, one PDF
		$c.on("click", ".ib-ps-os-print-btn", (e) => {
			e.stopPropagation();
			const os_name = $(e.currentTarget).data("os");
			if (os_name) this._print_job_orders_for_os(os_name);
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
		$c.html('<div class="ib-ps-loading">Loading order…</div>');
		frappe.call({
			method: "instabiz.overrides.production.get_order_sheet_detail",
			args: { order_sheet: os_name },
			callback: (r) => {
				if (r.exc) {
					$c.html('<div class="ib-ps-empty">Failed to load order.</div>');
					return;
				}
				this._render_os_detail(r.message || {});
			},
		});
	}

	_render_os_detail(detail) {
		const $c = this._content();
		const os = detail.order_sheet || {};

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
					${_ib_status_pill(os.priority || "Normal", "sm")}
					${_ib_status_pill(os.status, "sm")}
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

		// $c (#ib-ps-content) is a persistent node — this function re-runs on
		// every refresh() while an order is open (realtime floor updates,
		// Refresh button, on_page_show) without going through _render_os_list's
		// own $c.off(), so unbind first or repeated refreshes stack duplicate
		// subtab/nav/back handlers (same bug class as the WO side panel fix).
		$c.off();

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

		// Left-to-right chip order always follows the production route, not
		// creation order (Move/manual stage jumps can otherwise reorder them).
		const stageOrder = IB_STAGES.map((s) => s.label);

		const rows = items.map((item) => {
			const pct = item.qty > 0 ? Math.min(100, Math.round((item.completed_qty / item.qty) * 100)) : 0;

			const wos = [...(item.work_orders || [])].sort(
				(a, b) => stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage)
			);
			const doneCount = wos.filter((wo) => wo.status === "Completed").length;
			const stagePct = wos.length ? Math.round((doneCount / wos.length) * 100) : 0;

			// Compact stage-pill row — same visual language as the Production
			// Dashboard's per-item stagePills (_render_plan in
			// ib_production_dashboard.js): one small colored chip per Work
			// Order, abbreviated + colored by status. Full WO name/qty/date
			// (previously always-visible as a wall of <li> text) now lives in
			// the hover tooltip; clicking a chip still opens the same WO side
			// panel a click on the old list row used to.
			const chips = wos.map((wo) => {
				this._wo_data.set(wo.name, { ...wo, delivery_date: (detail.order_sheet || {}).delivery_date });
				const abbr = STAGE_ABBR[wo.stage] || (wo.stage || "").substring(0, 2).toUpperCase();
				const created = wo.creation ? frappe.datetime.str_to_user(wo.creation) : "—";
				const title = `${wo.stage || ""}: ${wo.name || ""} — ${wo.status || ""} `
					+ `(${wo.completed_qty || 0}/${wo.target_qty || 0}) — Created: ${created}`;
				const cancelled_cls = wo.status === "Cancelled" ? " ib-ps-wo-chip--cancelled" : "";
				return `<span class="ib-ps-wo-chip indicator-pill ib-ps-pill-sm ${_ib_status_color(wo.status)}${cancelled_cls}"
					data-woid="${frappe.utils.escape_html(wo.name)}"
					title="${frappe.utils.escape_html(title)}">${abbr}</span>`;
			}).join("");

			const wo_cell = wos.length
				? `<div class="ib-ps-wo-chip-row">${chips}</div>
					<div class="ib-ps-wo-chip-progress">
						<div class="ib-ps-wo-chip-progress-wrap">
							<div class="ib-ps-progress-bar" style="width:${stagePct}%;background:var(--ib-primary)"></div>
						</div>
						<small>${doneCount}/${wos.length} stages (${stagePct}%)</small>
					</div>`
				: `<span style="color:var(--text-muted);font-size:11px">No Work Orders</span>`;

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
					<td>${wo_cell}</td>
				</tr>`;
		}).join("");

		$body.html(`
			<div class="ib-ps-table-wrap">
				<table class="ib-ps-table">
					<thead><tr><th>Item Code</th><th>Item Name</th><th>Qty</th><th>Progress</th><th>Work Orders</th></tr></thead>
					<tbody>${rows}</tbody>
				</table>
			</div>`);

		$body.off("click", ".ib-ps-wo-chip").on("click", ".ib-ps-wo-chip", (e) => {
			const woid = $(e.currentTarget).data("woid");
			const wo = this._wo_data.get(woid);
			if (wo) this._open_wo_panel(wo, IB_STAGES.find(s => s.label === wo.stage)?.key || "");
		});
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
							<iconify-icon icon="lucide:plus" width="12" height="12"></iconify-icon>
						</div>`;
				} else if (wo.status === "Completed") {
					cell_html = `
						<div class="ib-ps-stage-cell ib-ps-stage-cell--done" title="${s.label}: Completed">
							<iconify-icon icon="lucide:check" width="12" height="12"></iconify-icon>
						</div>`;
				} else if (wo.status === "In Progress") {
					cell_html = `
						<div class="ib-ps-stage-cell ib-ps-stage-cell--active ib-ps-pulse" title="${s.label}: In Progress">
							<iconify-icon icon="lucide:play" width="12" height="12"></iconify-icon>
						</div>`;
				} else {
					// Pending WO
					cell_html = `
						<div class="ib-ps-stage-cell ib-ps-stage-cell--pending" title="${s.label}: ${wo.status || 'Pending'}">
							<iconify-icon icon="lucide:clock" width="12" height="12"></iconify-icon>
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
		// $body is a persistent node reused across subtab switches (sibling
		// _render_os_order_wise/_render_os_machine_wise already unbind before
		// re-binding) — this one was missing it, so re-visiting this subtab
		// stacked a duplicate handler per visit.
		$body.off("click", ".ib-ps-stage-cell--none[data-action='create_wo']").on("click", ".ib-ps-stage-cell--none[data-action='create_wo']", (e) => {
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
				this._wo_data.set(wo.name, { ...wo, delivery_date: (detail.order_sheet || {}).delivery_date });
				return `<li class="ib-ps-wo-sub-item ib-ps-wo-sub-item--clickable" data-woid="${frappe.utils.escape_html(wo.name)}" title="Click to open this Work Order">
					<span class="ib-ps-stage-chip" style="background:${this._stage_color(wo.stage)}">${frappe.utils.escape_html(wo.stage || "")}</span>
					<span>${frappe.utils.escape_html(wo.name || "")}</span>
					${_ib_status_pill(wo.status, "sm")}
					<span style="font-size:10px;color:var(--text-muted)">Created: ${wo.creation ? frappe.datetime.str_to_user(wo.creation) : "—"}</span>
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

		$body.off("click", ".ib-ps-wo-sub-item--clickable").on("click", ".ib-ps-wo-sub-item--clickable", (e) => {
			const woid = $(e.currentTarget).data("woid");
			const wo = this._wo_data.get(woid);
			if (wo) this._open_wo_panel(wo, IB_STAGES.find(s => s.label === wo.stage)?.key || "");
		});
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
			args: { location: this.location_filter || "" },
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
			// $c (#ib-ps-content) persists across refresh() calls (realtime floor
			// updates, tab re-switch, Refresh button) — unbind before rebinding,
			// same bug class as the WO side panel fix.
			$c.off();
			$c.on("click", "#ib-new-machine-btn", () => this._show_machine_dialog(null));
			return;
		}

		const cards = machines.map((m) => {
			const type_color = TYPE_COLOR[m.machine_type] || "#888";
			const load_pct = m.load_pct || 0;
			const load_color = load_pct > 90 ? "#dc2626" : load_pct > 60 ? "#d97706" : "#16a34a";
			const waste_norm = m.wastage_norm_pct || 3;
			const waste_color = m.today_avg_wastage > waste_norm ? "#dc2626" : "#16a34a";
			// Yield moves opposite to wastage — same threshold, inverted.
			const yield_pct = m.today_yield_pct != null ? m.today_yield_pct : (100 - waste_norm);
			const yield_color = (100 - yield_pct) > waste_norm ? "#dc2626" : "#16a34a";

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
						<div class="ib-mw-stat-val" style="color:${yield_color}">${yield_pct}%</div>
						<div class="ib-mw-stat-label">Yield</div>
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
				const created_str = wo.creation ? frappe.datetime.str_to_user(wo.creation) : "—";
				const etd_str = wo.delivery_date ? frappe.datetime.str_to_user(wo.delivery_date) : "—";
				return `<div class="ib-mw-wo-row">
					<span class="ib-mw-stage-dot" style="background:${color}" title="${frappe.utils.escape_html(wo.stage || "")}"></span>
					<span class="ib-mw-wo-item" title="${frappe.utils.escape_html(wo.item_code || "")}">${frappe.utils.escape_html((wo.item_code || "").substring(0, 22))}</span>
					<div class="ib-mw-wo-right">
						${_ib_status_pill(wo.status, "sm")}
						<div class="ib-mw-wo-bar-wrap">
							<div class="ib-mw-wo-bar" style="width:${pct}%;background:${color}"></div>
						</div>
					</div>
					<div class="ib-mw-wo-meta">Created ${created_str} · ETD ${etd_str}</div>
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
							<span class="indicator green" style="margin-left:auto" title="Active"></span>
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

		// $c (#ib-ps-content) persists across refresh() calls (realtime floor
		// updates, tab re-switch, Refresh button) — unbind before rebinding,
		// same bug class as the WO side panel fix.
		$c.off();
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
					// Matches IB Machine.machine_type's real Select options exactly
					// (instabiz/instabiz/doctype/ib_machine/ib_machine.json) — this
					// dialog previously hardcoded only 5 of the 7 real values,
					// missing Despatch and Quality Control entirely. Root cause of
					// a live bug: DS-01 ("Despatch Station 1") could never actually
					// be typed Despatch through this dialog, so it was mislabeled
					// Packing — batch-assign to any Ready-to-Deliver/Delivered WO
					// then correctly rejected it server-side, since 0 machines
					// system-wide had machine_type="Despatch" until fixed 2026-08-05.
					options: ["Coating", "Slitting", "Rewinding", "Cutting", "Packing", "Quality Control", "Despatch"],
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
					options: ["", "sqm/hour", "rolls/hour", "pcs/hour", "kg/hour", "ctn/shift"],
					default: machine?.capacity_uom || "",
				},
				{ fieldname: "wastage_norm_pct", label: "Wastage Norm %", fieldtype: "Float", default: machine?.wastage_norm_pct || 2.0 },
				{
					fieldname: "status",
					label: "Status",
					fieldtype: "Select",
					options: ["Active", "Inactive", "Under Maintenance"],
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

		// One primary action per state — the single next thing a floor worker
		// actually needs to do, instead of the old row of 5+ equal-weight
		// buttons. "Resume" (On Hold -> In Progress) is new: start_work_order()
		// has handled this transition correctly since the native-workflow
		// migration (picks "Resume" vs "Start" based on current status — see
		// its own docstring) but no button ever called it for an On Hold WO,
		// a real dead-end this redesign also fixes.
		let primary_btn = "";
		if (!wo.machine && wo.status === "Pending") {
			primary_btn = `<button class="ib-ps-btn-primary ib-ps-panel-primary btn btn-primary" id="ib-wo-assign-machine">Assign Machine</button>`;
		} else if (wo.status === "Pending") {
			primary_btn = `<button class="ib-ps-btn-success ib-ps-panel-primary btn btn-success" id="ib-wo-start">
					<iconify-icon icon="lucide:play" width="13" height="13" style="vertical-align:middle;margin-right:4px"></iconify-icon>Start</button>`;
		} else if (wo.status === "On Hold") {
			primary_btn = `<button class="ib-ps-btn-success ib-ps-panel-primary btn btn-success" id="ib-wo-start">
					<iconify-icon icon="lucide:play" width="13" height="13" style="vertical-align:middle;margin-right:4px"></iconify-icon>Resume</button>`;
		} else if (wo.status === "In Progress" && stage_key === "ready_to_deliver") {
			primary_btn = `<button class="ib-ps-btn-success ib-ps-panel-primary btn btn-success" id="ib-wo-complete">Complete</button>`;
		} else if (wo.status === "In Progress") {
			primary_btn = `<button class="ib-ps-btn-success ib-ps-panel-primary btn btn-success" id="ib-wo-advance">Next Stage →</button>`;
		} else if (wo.status === "Completed" && stage_key === "ready_to_deliver" && wo.sales_order) {
			// Whether this item's own WO is Completed at RTD is necessary but not
			// sufficient — other items on the same Sales Order might still be
			// mid-production. Placeholder now, resolved async right after this
			// panel renders — see _hydrate_dn_slot().
			primary_btn = `<span id="ib-wo-dn-slot"></span>`;
		}

		// Everything else lives behind one "More actions" menu instead of
		// competing with the primary button for attention. Print is always
		// offered; Hold matches the real workflow (valid from Pending AND In
		// Progress, not just In Progress as the old single hold_btn assumed);
		// Adjust Qty / Move Stage keep their existing conditions.
		const can_hold = wo.status === "Pending" || wo.status === "In Progress";
		const can_move = wo.status !== "Completed";
		const menu_items = [
			can_hold ? `<a class="dropdown-item" href="#" id="ib-wo-hold"><iconify-icon icon="lucide:pause" width="12" height="12" style="vertical-align:middle;margin-right:6px"></iconify-icon>Put On Hold</a>` : "",
			`<a class="dropdown-item" href="#" id="ib-wo-print-job-order"><iconify-icon icon="lucide:printer" width="12" height="12" style="vertical-align:middle;margin-right:6px"></iconify-icon>Print Job Order</a>`,
			(wo.target_uom === "PCS" || wo.target_uom === "SQMT")
				? `<a class="dropdown-item" href="#" id="ib-wo-adjust-qty"><iconify-icon icon="lucide:sliders-horizontal" width="12" height="12" style="vertical-align:middle;margin-right:6px"></iconify-icon>Adjust Qty</a>`
				: "",
			can_move ? `<a class="dropdown-item" href="#" id="ib-wo-move-toggle" title="Escape hatch for out-of-sequence corrections only"><iconify-icon icon="lucide:move-right" width="12" height="12" style="vertical-align:middle;margin-right:6px"></iconify-icon>Move to Different Stage</a>` : "",
		].filter(Boolean).join("");
		const more_menu = menu_items
			? `<div class="dropdown ib-ps-panel-more">
					<button class="btn btn-default btn-sm dropdown-toggle" data-toggle="dropdown" aria-expanded="false" title="More actions">
						<iconify-icon icon="lucide:more-vertical" width="14" height="14"></iconify-icon>
					</button>
					<div class="dropdown-menu dropdown-menu-right">${menu_items}</div>
				</div>`
			: "";

		// Manual stage-picker — jump this WO to any stage, bypassing the linear
		// route order (e.g. correcting a mis-routed item). Backend blocks moving
		// a completed WO. Row stays hidden until "Move to Different Stage" is
		// clicked in the More menu — out-of-sequence escape hatch, not an
		// everyday action.
		const stage_picker = can_move
			? `<div class="ib-ps-panel-move-row" id="ib-wo-move-row" style="display:none">
					<select id="ib-wo-move-stage" class="ib-ps-select form-control">
						${IB_STAGES.filter(s => s.key !== stage_key).map(s => `<option value="${s.label}">${s.label}</option>`).join("")}
					</select>
					<button class="btn btn-default btn-sm" id="ib-wo-move-btn">
						<iconify-icon icon="lucide:move-right" width="11" height="11" style="vertical-align:middle;margin-right:3px"></iconify-icon>
						Move
					</button>
				</div>`
			: "";

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
						${_ib_status_pill(wo.priority || "Normal", "sm")}
						${_ib_status_pill(wo.status, "sm")}
					</div>
					<div class="ib-ps-panel-meta" style="margin-top:4px">
						<span style="font-size:10px;color:var(--text-muted)">Created: ${wo.creation ? frappe.datetime.str_to_user(wo.creation) : "—"}</span>
						<span style="font-size:10px;color:var(--text-muted)">ETD: ${wo.delivery_date ? frappe.datetime.str_to_user(wo.delivery_date) : "—"}</span>
					</div>
					${wo.machine ? `<div class="ib-ps-panel-machine">Machine: <strong>${frappe.utils.escape_html(wo.machine)}</strong></div>` : ""}
				</div>

				<div class="ib-ps-panel-actions">
					${primary_btn}${more_menu}
				</div>
				${(wo.pcs_to_make || wo.logs_to_make) ? `<div class="ib-ps-panel-machine" style="padding:0 16px 8px">
					${wo.target_uom === "PCS" ? `Pieces to Make: <strong>${wo.pcs_to_make || 0}</strong>` : ""}
					${wo.target_uom === "SQMT" ? `Logs to Make: <strong>${wo.logs_to_make || 0}</strong>` : ""}
				</div>` : ""}
				${wo.jumbo_roll ? `<div class="ib-ps-panel-machine" style="padding:0 16px 8px">Jumbo Roll: <strong>${frappe.utils.escape_html(wo.jumbo_roll)}</strong></div>` : ""}
				${stage_picker}
			</div>`);

		// $panel is a persistent DOM node reused across every re-render (only its
		// .html() content is swapped) — binding with .on() every call without
		// .off() first stacks up one extra delegated listener per prior render.
		// This was the cause of "Create Delivery Note" firing multiple times and
		// creating duplicate DNs: by the time the button was clicked, the panel
		// had already re-rendered several times (Assign Machine, Start, etc.),
		// each leaving its own live click handler behind.
		$panel.off("click");
		$panel.on("click", "#ib-panel-close", () => this._close_side_panel());
		$panel.on("click", "#ib-wo-assign-machine", () => this._assign_machine_to_wo(wo, stage_key));
		$panel.on("click", "#ib-wo-start", () => this._update_wo_status(wo, "In Progress", stage_key));
		$panel.on("click", "#ib-wo-hold", (e) => { e.preventDefault(); this._update_wo_status(wo, "On Hold", stage_key); });
		$panel.on("click", "#ib-wo-advance", () => this._advance_wo(wo, stage_key));
		$panel.on("click", "#ib-wo-create-dn", (e) => {
			// Belt-and-braces guard against any future double-bind: disable
			// immediately so a second click (or a stray duplicate handler)
			// can't fire a second Delivery Note while the call is in flight.
			const $btn = $(e.currentTarget);
			if ($btn.prop("disabled")) return;
			$btn.prop("disabled", true);
			this._create_dn_for_wo(wo);
		});
		$panel.on("click", "#ib-wo-move-btn", () => {
			const new_stage = $panel.find("#ib-wo-move-stage").val();
			this._move_wo_manual(wo, new_stage, stage_key);
		});
		$panel.on("click", "#ib-wo-move-toggle", (e) => {
			e.preventDefault();
			$panel.find("#ib-wo-move-row").toggle();
		});
		$panel.on("click", "#ib-wo-complete", () => this._update_wo_status(wo, "Completed", stage_key));
		$panel.on("click", "#ib-wo-print-job-order", (e) => { e.preventDefault(); this._print_job_order(wo); });
		$panel.on("click", "#ib-wo-adjust-qty", (e) => { e.preventDefault(); this._show_adjust_qty_dialog(wo, stage_key); });

		if ($panel.find("#ib-wo-dn-slot").length) this._hydrate_dn_slot($panel, wo);
	}

	// Resolves whether the WHOLE Sales Order (not just this item) is ready to
	// ship, and swaps the real button (or a waiting note) into the placeholder
	// _render_wo_panel left in the DOM. $panel.off("click") + delegated binding
	// above already covers this node regardless of when it's filled in.
	_hydrate_dn_slot($panel, wo) {
		frappe.call({
			method: "instabiz.overrides.production.get_order_dn_readiness",
			args: { order_sheet: wo.order_sheet },
			callback: (r) => {
				const $slot = $panel.find("#ib-wo-dn-slot");
				if (!$slot.length) return; // panel moved on to a different WO meanwhile
				if (r.message && r.message.ready) {
					$slot.replaceWith(
						`<button class="ib-ps-btn-primary ib-ps-panel-btn btn btn-primary btn-sm" id="ib-wo-create-dn">
							<iconify-icon icon="lucide:truck" width="11" height="11" style="vertical-align:middle;margin-right:3px"></iconify-icon>
							Create Delivery Note
						</button>`
					);
				} else {
					$slot.replaceWith(
						`<span style="font-size:11px;color:var(--text-muted);display:inline-flex;align-items:center"
							title="Every item on this Sales Order needs to reach Ready to Deliver before a Delivery Note can be created">
							<iconify-icon icon="lucide:clock" width="11" height="11" style="vertical-align:middle;margin-right:3px"></iconify-icon>
							Waiting for other items
						</span>`
					);
				}
			},
		});
	}

	// Opens Frappe's own print view for this WO. "IB Job Order" is set as the
	// IB Work Order doctype's default print format (Property Setter, see
	// hooks.py fixtures) so it's auto-selected — no format picker needed for
	// the one format floor staff actually use.
	_print_job_order(wo) {
		frappe.set_route("print", "IB Work Order", wo.name);
	}

	// Bulk Print Job Order — from the Order-wise list's Actions column.
	// Was previously N separate full Job Order pages concatenated via
	// Frappe's core multi-doc endpoint (download_multi_pdf) — structurally
	// can never produce one page, it just loops print() per doc and glues
	// the PDFs together. Replaced with a single-doc print of the Order
	// Sheet itself using the dedicated "IB Job Order Summary" print format
	// (instabiz/instabiz/print_format/ib_job_order_summary/), which renders
	// every item's current actionable Work Order as one compact table on
	// one page. Still checks get_order_sheet_wo_names() first so a fully
	// Completed order shows the same "nothing to print" alert as before,
	// instead of opening a print view with an empty table.
	_print_job_orders_for_os(os_name) {
		frappe.call({
			method: "instabiz.overrides.production.get_order_sheet_wo_names",
			args: { order_sheet: os_name },
			callback: (r) => {
				const names = r.message || [];
				if (!names.length) {
					frappe.show_alert({
						message: "No active Work Orders to print for this order.",
						indicator: "orange",
					});
					return;
				}
				const w = window.open(
					"/api/method/frappe.utils.print_format.download_pdf?" +
						"doctype=" + encodeURIComponent("IB Order Sheet") +
						"&name=" + encodeURIComponent(os_name) +
						"&format=" + encodeURIComponent("IB Job Order Summary") +
						"&no_letterhead=0"
				);
				if (!w) {
					frappe.show_alert({ message: "Please enable pop-ups.", indicator: "orange" });
				}
			},
		});
	}

	// Factory-manager qty reconciliation dialog — lets them set pcs_to_make
	// (UOM=PCS) or logs_to_make (UOM=SQMT) to account for wastage/efficiency.
	// Pre-fills the current value via frappe.client.get_value since the `wo`
	// object here comes from whichever tab's list query opened the panel, and
	// none of those queries select these two new fields.
	_show_adjust_qty_dialog(wo, stage_key) {
		const is_pcs = wo.target_uom === "PCS";
		const fieldname = is_pcs ? "pcs_to_make" : "logs_to_make";
		const label = is_pcs ? "Pieces to Make" : "Logs to Make";
		frappe.call({
			method: "frappe.client.get_value",
			args: { doctype: "IB Work Order", filters: wo.name, fieldname },
			callback: (r) => {
				const current = (r.message && r.message[fieldname]) || 0;
				const d = new frappe.ui.Dialog({
					title: `Adjust ${label}`,
					fields: [
						{
							fieldname,
							label,
							fieldtype: "Int",
							reqd: 1,
							default: current,
							description: "Reconcile for wastage — set the actual quantity to produce from this Work Order's target qty.",
						},
					],
					primary_action_label: "Save",
					primary_action: (vals) => {
						const args = { work_order: wo.name };
						args[fieldname] = vals[fieldname];
						frappe.call({
							method: "instabiz.overrides.production.update_production_qty",
							args,
							callback: (r2) => {
								if (r2.exc) {
									frappe.show_alert({ message: `Failed to update ${label}.`, indicator: "red" });
									return;
								}
								frappe.show_alert({ message: `${label} updated.`, indicator: "green" });
								wo[fieldname] = vals[fieldname];
								d.hide();
								this._render_wo_panel(wo, stage_key);
							},
						});
					},
				});
				d.show();
			},
		});
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
				// Refresh whichever list is behind the panel so counts/rows update
				if (this.active_tab === "order_wise" && this.current_os) {
					this._load_os_detail(this.current_os);
				} else if (this.active_tab === "job_bundles") {
					this._load_job_bundles();
				} else if (this.active_tab === "item_wise") {
					this._load_item_wise();
				}
			},
		});
	}

	// Complete the current WO and auto-create/assign the next stage — the primary
	// "push to next stage" action. Unlike the plain Complete button, this also
	// preps the next Work Order (machine load-balanced) in one click.
	_advance_wo(wo, stage_key) {
		frappe.call({
			method: "instabiz.overrides.production.advance_to_next_stage",
			args: { work_order: wo.name },
			callback: (r) => {
				if (r.exc || !r.message || r.message.status !== "ok") {
					frappe.show_alert({ message: r.message?.message || "Failed to advance.", indicator: "red" });
					return;
				}
				frappe.show_alert({ message: r.message.message || "Advanced.", indicator: "green" }, 3);
				this._close_side_panel();
				if (this.active_tab === "order_wise" && this.current_os) {
					this._load_os_detail(this.current_os);
				} else if (this.active_tab === "job_bundles") {
					this._load_job_bundles();
				} else if (this.active_tab === "item_wise") {
					this._load_item_wise();
				}
			},
		});
	}

	// Manual stage jump (stage-picker) — backend auto-assigns the least-loaded
	// available machine for the target stage.
	_move_wo_manual(wo, new_stage, stage_key) {
		if (!new_stage) return;
		frappe.call({
			method: "instabiz.overrides.production.move_work_order_stage",
			args: { work_order: wo.name, new_stage },
			callback: (r) => {
				if (r.exc) {
					frappe.show_alert({ message: "Failed to move Work Order.", indicator: "red" });
					return;
				}
				const machine_msg = r.message?.machine ? ` — machine ${r.message.machine} assigned` : "";
				frappe.show_alert({ message: `Moved to ${new_stage}${machine_msg}`, indicator: "green" }, 3);
				wo.stage = new_stage;
				wo.machine = r.message?.machine || wo.machine;
				this._close_side_panel();
				if (this.active_tab === "order_wise" && this.current_os) {
					this._load_os_detail(this.current_os);
				} else if (this.active_tab === "job_bundles") {
					this._load_job_bundles();
				} else if (this.active_tab === "item_wise") {
					this._load_item_wise();
				}
			},
		});
	}

	// Reached Ready to Deliver + Completed for this item — jump straight to
	// creating the Delivery Note off the underlying Sales Order.
	_create_dn_for_wo(wo) {
		if (!wo.sales_order) {
			frappe.show_alert({ message: "No Sales Order linked to this Work Order.", indicator: "red" });
			return;
		}
		frappe.call({
			method: "instabiz.overrides.sales_order.custom_make_delivery_note",
			// order_sheet_item scopes the DN to the exact Sales Order Item row
			// this WO is for (resolved server-side via IB Order Sheet Item's
			// sales_order_item field) — item_code alone would incorrectly pull
			// every line sharing that item_code if the SO has the same item on
			// multiple separate rows with different quantities. item_code kept
			// as a fallback for legacy WOs from before this field existed.
			args: { source_name: wo.sales_order, order_sheet_item: wo.order_sheet_item, item_code: wo.item_code },
			callback: (r) => {
				if (!r.message) {
					frappe.show_alert({ message: "Failed to create Delivery Note.", indicator: "red" });
					return;
				}
				frappe.model.sync(r.message);
				frappe.set_route("Form", r.message.doctype, r.message.name);
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
			args: { location: this.location_filter || "", search: this.bundle_search || "" },
			callback: (r) => { this._render_job_bundles(r.message || []); },
			error: () => { $c.html('<div style="padding:24px;color:var(--text-muted)">Failed to load bundles.</div>'); },
		});
	}

	_bundle_search_bar_html() {
		return `
			<div class="ib-ps-filter-group ib-ps-filter-group--search" style="margin-bottom:14px;max-width:340px">
				<iconify-icon icon="lucide:search" width="13" height="13" style="color:var(--text-muted)"></iconify-icon>
				<input type="text" id="ib-bundle-search" class="ib-ps-search-input form-control"
					placeholder="Search item, Sales Order or customer…" value="${frappe.utils.escape_html(this.bundle_search || "")}">
			</div>`;
	}

	_bind_bundle_search($c) {
		let timer = null;
		$c.off("input", "#ib-bundle-search").on("input", "#ib-bundle-search", (e) => {
			clearTimeout(timer);
			const val = $(e.target).val();
			timer = setTimeout(() => {
				this.bundle_search = val;
				this._job_bundle_page = 1;
				this._load_job_bundles();
			}, 300);
		});
	}

	_render_job_bundles(bundles, page) {
		const $c = this._content();
		this._job_bundles_all = bundles = bundles || this._job_bundles_all || [];
		if (!bundles.length) {
			$c.html(`
				${this._bundle_search_bar_html()}
				<div style="padding:40px;text-align:center;color:var(--text-muted);font-size:13px">
				<iconify-icon icon="lucide:layers" width="24" height="24"
					style="display:block;margin:0 auto 10px;opacity:.4"></iconify-icon>
				No bundleable jobs found. Bundles form when 2+ Pending Work Orders
				share the same item and stage.
			</div>`);
			this._bind_bundle_search($c);
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
			const woRows = (bundle.wos || []).map(wo => {
				this._wo_data.set(wo.name, { ...wo, stage: bundle.stage, status: "Pending" });
				return `
				<tr class="ib-ps-wo-sub-item--clickable" data-woid="${frappe.utils.escape_html(wo.name)}" title="Click to open this Work Order">
					<td style="padding:4px 8px;font-size:11px;font-family:monospace">${frappe.utils.escape_html(wo.name)}</td>
					<td style="padding:4px 8px;font-size:11px">${frappe.utils.escape_html(wo.sales_order || "")}</td>
					<td style="padding:4px 8px;font-size:11px">${frappe.utils.escape_html(wo.customer_name || "")}</td>
					<td style="padding:4px 8px;font-size:11px;text-align:right">${(wo.target_qty||0).toLocaleString()}</td>
					<td style="padding:4px 8px;font-size:10px;color:var(--text-muted)">${wo.creation ? frappe.datetime.str_to_user(wo.creation) : "—"}</td>
					<td style="padding:4px 8px;font-size:10px;color:var(--text-muted)">${wo.delivery_date ? frappe.datetime.str_to_user(wo.delivery_date) : "—"}</td>
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
				</tr>`;
			}).join("");

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
								text-transform:uppercase;color:var(--text-muted)">Created</th>
							<th style="padding:5px 8px;text-align:left;font-size:10px;font-weight:700;
								text-transform:uppercase;color:var(--text-muted)">ETD</th>
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
				${this._bundle_search_bar_html()}
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
		$c.off("click", ".ib-ps-wo-sub-item--clickable");

		$c.on("click", ".ib-ps-wo-sub-item--clickable", (e) => {
			e.stopPropagation();
			const woid = $(e.currentTarget).data("woid");
			const wo = this._wo_data.get(woid);
			if (wo) this._open_wo_panel(wo, IB_STAGES.find(s => s.label === wo.stage)?.key || "");
		});

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
		this._bind_bundle_search($c);
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
.ib-ps-tab-badge {
	display: inline-block; margin-left: 4px; padding: 0 6px;
	border-radius: 10px; font-size: 10px; font-weight: 700;
	background: rgba(0,0,0,0.08); vertical-align: middle;
}
.ib-ps-tab.active .ib-ps-tab-badge { background: rgba(255,255,255,0.25); }
.ib-sw-pills { display: flex; gap: 6px; flex-wrap: wrap; }
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

/* Priority badges + Status chips: rendered via _ib_status_pill() as Frappe's
   own .indicator-pill (theme-aware --bg-{color}/--text-on-{color} tokens) —
   no custom color CSS needed here anymore. This is only a density override:
   Frappe's default pill (20px tall, "sm" text style) is roomy for a table
   packed with several per row, so .ib-ps-pill-sm shrinks padding/font while
   keeping every color/theme rule native. */
.ib-ps-pill-sm {
	height: auto; padding: 1px 7px 1px 5px; font-size: 10px; font-weight: 600;
}
.ib-ps-pill-sm::before { height: 5px; width: 5px; margin-right: 4px; }

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

/* Work Order stage-pill chips (Order-wise tab) — same visual language as the
   Production Dashboard's stagePills (_render_plan in ib_production_dashboard.js),
   swapped in for the old always-expanded <li> list of full WO name/status/qty/date. */
.ib-ps-wo-chip-row { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.ib-ps-wo-chip {
	font-weight: 700; letter-spacing: .03em; cursor: pointer;
	transition: transform 0.1s, box-shadow 0.15s;
}
.ib-ps-wo-chip:hover { transform: translateY(-1px); box-shadow: 0 2px 6px rgba(0,0,0,0.12); }
.ib-ps-wo-chip--cancelled { text-decoration: line-through; }
.ib-ps-wo-chip-progress { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.ib-ps-wo-chip-progress-wrap {
	height: 5px; width: 60px; background: var(--border-color);
	border-radius: 3px; overflow: hidden; display: inline-block; vertical-align: middle;
}
.ib-ps-wo-chip-progress small { font-size: 10px; color: var(--text-muted); white-space: nowrap; }

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
.ib-ps-filter-group--search {
	flex: 1;
	min-width: 200px;
	max-width: 320px;
	background: var(--card-bg);
	border: 1px solid var(--border-color);
	border-radius: 6px;
	padding: 5px 10px;
}
.ib-ps-filter-group--search input {
	border: none; background: none; outline: none; flex: 1;
	font-size: 13px; color: var(--text-color); padding: 0;
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
/* Colors reuse Frappe's own theme-aware --bg-{color}/--text-on-{color} tokens
   (frappe/public/scss/common/css_variables.scss) — same source indicator-pill
   itself draws from, so this stays correct in dark mode without a separate
   hardcoded palette. Shape (40x40 icon cell) stays custom — Frappe has no
   native grid-cell/matrix component this maps onto, only text pills. */
.ib-ps-stage-cell--done    { background: var(--bg-green);  color: var(--text-on-green); }
.ib-ps-stage-cell--active  { background: var(--bg-blue);   color: var(--text-on-blue); }
.ib-ps-stage-cell--pending { background: var(--bg-yellow); color: var(--text-on-yellow); }
.ib-ps-stage-cell--none    { background: var(--bg-gray);   color: var(--text-on-gray); cursor: pointer; }
.ib-ps-stage-cell--none:hover { background: var(--border-color); }

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
.ib-ps-wo-sub-item--clickable {
	cursor: pointer; border-radius: 4px; padding: 3px 6px; margin: 0 -6px;
	transition: background .12s;
}
.ib-ps-wo-sub-item--clickable:hover { background: var(--subtle-fg, #f8fafc); }
tr.ib-ps-wo-sub-item--clickable { cursor: pointer; }
tr.ib-ps-wo-sub-item--clickable:hover td { background: var(--subtle-fg, #f8fafc); }

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
	width: 440px;
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
	display: flex; gap: 8px; align-items: stretch;
	border-bottom: 1px solid var(--border-color);
	flex-shrink: 0;
}
.ib-ps-panel-btn { /* inherits from btn classes */ }
/* One prominent primary action, full-width — replaces the old row of 5+
   equal-weight buttons (Assign/Start/Hold/Complete/Advance/DN all competing
   for attention at once). */
.ib-ps-panel-primary { flex: 1; padding: 8px 14px; font-size: 13px; }
.ib-ps-panel-more { flex-shrink: 0; }
.ib-ps-panel-more .dropdown-toggle::after { display: none; }
.ib-ps-panel-more .dropdown-toggle {
	height: 100%; padding: 0 10px;
	display: flex; align-items: center; justify-content: center;
}
.ib-ps-panel-move-row {
	display: flex; gap: 6px; align-items: center;
	padding: 10px 16px; border-bottom: 1px solid var(--border-color);
	flex-shrink: 0;
}
.ib-ps-panel-move-row select { flex: 1; }
.ib-ps-loc-group {
	display: flex; align-items: center; gap: 6px;
	margin-right: 8px;
}
.ib-ps-loc-group select { min-width: 170px; }
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
.ib-ps-stage-filter-pill {
	background: var(--ib-primary, #d97757);
	border-color: var(--ib-primary, #d97757);
	color: #fff;
	display: inline-flex;
	align-items: center;
	gap: 5px;
}
.ib-ps-stage-filter-clear {
	background: none;
	border: none;
	color: #fff;
	opacity: .8;
	font-size: 13px;
	line-height: 1;
	padding: 0;
	cursor: pointer;
}
.ib-ps-stage-filter-clear:hover { opacity: 1; }

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
.ib-mw-wo-row { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; padding: 5px 7px; background: var(--fg-color,#f9fafb); border-radius: 5px; border: 1px solid var(--border-color); }
.ib-mw-wo-meta { width: 100%; font-size: 9px; color: var(--text-muted); margin-top: 1px; }
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
