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
		wrapper.ib_production_dashboard._plan_keep_open = null;
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

function _etd_badge(dateStr) {
	if (!dateStr) return "";
	const days = frappe.datetime.get_diff(dateStr, frappe.datetime.get_today());
	let color = "#059669"; // on track
	if (days < 0) color = "#dc2626";       // overdue
	else if (days <= 2) color = "#ea580c"; // at risk
	return `<span class="ib-pd-etd-badge" style="background:${color}15;color:${color};border:1px solid ${color}40">
		<iconify-icon icon="lucide:calendar-clock" width="11" height="11" style="vertical-align:middle;margin-right:3px"></iconify-icon>
		ETD ${frappe.datetime.str_to_user(dateStr)}
	</span>`;
}

const PLAN_PAGE_SIZE = 25;

// An Order Sheet Item counts as "done" using the exact same criterion the
// existing "✓ Done" Actions-column badge already used (see _render_plan):
// every stage the item actually has (stage_map entries with a status) is
// Completed. NOT the same as the RTD-shortcut 100% used for the progress
// bar — an item sitting at Ready to Deliver but not yet marked Completed
// still shows a primary action there, so it isn't "done" by this measure.
function _item_is_done(item) {
	const stageMap = item.stage_map || {};
	const completedStages = Object.values(stageMap).filter(v => v.status === "Completed").length;
	const totalStages = Object.values(stageMap).filter(v => v.status).length;
	return totalStages > 0 && completedStages === totalStages;
}

class IBProductionDashboard {
	constructor(wrapper) {
		this.wrapper   = wrapper;
		this.page      = wrapper.page;
		this._fetching = false;
		// Shared with Production Stages (same localStorage key) so picking a
		// location on either page carries over to the other.
		this.location_filter = localStorage.getItem("ib_prod_location") || "";
		this.plan_search = "";
		this.plan_priority = "";
		// "Do not show done WO" toggle — hides item rows that have nothing left
		// to advance (same criterion as the "✓ Done" badge in the Actions
		// column). Session-only like plan_search/plan_priority, not persisted
		// to localStorage (unlike location_filter, which is shared with the
		// Production Stages page — this toggle has no such cross-page need).
		// Defaults ON per the "do not show done WO" request.
		this.hide_completed_items = true;
		// Full set of Order Sheets loaded so far (accumulated across infinite
		// scroll pages) — kept so toggling hide_completed_items can re-render
		// the whole list instantly without a re-fetch.
		this._plan_all_rows = [];
		this._plan_offset = 0;
		this._plan_has_more = true;
		this._plan_loading_more = false;
		// Order Sheet name (os.name) to force-expand on the next _render_plan()
		// call — set right before a row action (Start/Next Stage/Move) or a
		// manual chevron-open triggers a reload, so the card the user was just
		// looking at doesn't snap back to collapsed. Cleared on any explicit
		// reload (Refresh button, location/search/priority filter change).
		this._plan_keep_open = null;
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
		this._plan_offset = 0;
		this._plan_has_more = true;

		let _done = 0;
		const _total = 3;
		const _check_done = () => {
			if (++_done >= _total) {
				this._fetching = false;
				this._set_refresh_label("Updated " + frappe.datetime.now_time());
				ib_countup_all && ib_countup_all(this.$container);
			}
		};

		frappe.call({
			method: "instabiz.overrides.production.get_production_dashboard",
			args: { location: this.location_filter || "" },
			callback: (r) => {
				if (r.message) this._render(r.message);
				else this._set_refresh_label("No data");
				_check_done();
			},
			error: () => { this._set_refresh_label("Error loading data"); _check_done(); },
		});
		frappe.call({
			method: "instabiz.overrides.production.get_production_plan",
			args: {
				limit: PLAN_PAGE_SIZE, start: 0,
				location: this.location_filter || "",
				search: this.plan_search || "",
				priority: this.plan_priority || "",
			},
			callback: (r) => {
				const rows = (r.message && r.message.order_wise) || [];
				this._plan_offset = rows.length;
				this._plan_has_more = rows.length === PLAN_PAGE_SIZE;
				this._plan_all_rows = rows;
				this._render_plan(rows);
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
	}

	_load_more_plan() {
		if (this._plan_loading_more || !this._plan_has_more) return;
		this._plan_loading_more = true;
		this.$container.find("#ib-pd-plan-more").text("Loading more…");
		frappe.call({
			method: "instabiz.overrides.production.get_production_plan",
			args: {
				limit: PLAN_PAGE_SIZE, start: this._plan_offset,
				location: this.location_filter || "",
				search: this.plan_search || "",
				priority: this.plan_priority || "",
			},
			callback: (r) => {
				const rows = (r.message && r.message.order_wise) || [];
				this._plan_offset += rows.length;
				this._plan_has_more = rows.length === PLAN_PAGE_SIZE;
				this._plan_loading_more = false;
				this._plan_all_rows = this._plan_all_rows.concat(rows);
				this._render_plan(rows, true);
			},
			error: () => { this._plan_loading_more = false; },
		});
	}

	// ── Layout ────────────────────────────────────────────────────────────────
	_build_layout() {
		this.$container = $(`
			<div class="ib-pd-page container">
				<div class="ib-pd-top-bar">
					<div class="ib-pd-loc-group">
						<iconify-icon icon="lucide:map-pin" width="13" height="13" style="color:var(--text-muted)"></iconify-icon>
						<select id="ib-pd-location" class="ib-pd-select">
							<option value="">All Locations</option>
							<option value="gujarat">Gujarat (Factory)</option>
							<option value="maharashtra">Maharashtra (Warehouse)</option>
							<option value="chennai">Chennai (Warehouse)</option>
						</select>
					</div>
					<span id="ib-pd-refresh-ts" class="ib-pd-refresh-time"></span>
				</div>
				<div class="ib-pd-kpi-row" id="ib-pd-kpis"></div>
				<div id="ib-pd-pipeline-section" style="display:none">
					<div class="ib-pd-section-title">Pipeline</div>
					<div class="ib-pd-pipeline" id="ib-pd-pipeline"></div>
				</div>
				<div id="ib-pd-pipeline-hint" class="ib-pd-empty" style="display:none">
					<iconify-icon icon="lucide:map-pin" width="15" height="15" style="vertical-align:middle;margin-right:5px;opacity:.6"></iconify-icon>
					Pick a location above to see its stage pipeline — Maharashtra and Chennai are
					warehouse-only (Packing → Ready to Deliver), Gujarat runs the full factory chain.
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
				<div class="ib-pd-plan-toolbar">
					<div class="ib-pd-filter-group ib-pd-filter-group--search">
						<iconify-icon icon="lucide:search" width="13" height="13" style="color:var(--text-muted)"></iconify-icon>
						<input type="text" id="ib-pd-plan-search" class="ib-pd-search-input" placeholder="Search Sales Order or customer…">
					</div>
					<div class="ib-pd-filter-group ib-pd-filter-group--priority">
						<iconify-icon icon="lucide:flag" width="13" height="13" style="color:var(--text-muted)"></iconify-icon>
						<select id="ib-pd-plan-priority" class="ib-pd-priority-select">
							<option value="">All Priorities</option>
							<option value="Urgent">Urgent</option>
							<option value="High">High</option>
							<option value="Normal">Normal</option>
							<option value="Low">Low</option>
						</select>
					</div>
					<label class="ib-pd-filter-group ib-pd-filter-group--hide-done" for="ib-pd-hide-done" title="Hide item rows that have finished every stage — declutters orders that are still active but partly done">
						<input type="checkbox" id="ib-pd-hide-done">
						<span>Hide completed items</span>
					</label>
				</div>
				<div id="ib-pd-plan"></div>
				<div id="ib-pd-plan-more" class="ib-pd-empty" style="padding:14px;font-size:12px"></div>
				<div class="ib-pd-quick-actions" id="ib-pd-actions"></div>
			</div>
		`).appendTo($(this.wrapper).find(".layout-main-section"));

		this.$container.find("#ib-pd-location").val(this.location_filter);
		this.$container.find("#ib-pd-location").on("change", (e) => {
			this.location_filter = $(e.target).val();
			localStorage.setItem("ib_prod_location", this.location_filter);
			this._plan_keep_open = null;
			this.refresh();
		});

		let plan_search_timer = null;
		this.$container.find("#ib-pd-plan-search").on("input", (e) => {
			clearTimeout(plan_search_timer);
			const val = $(e.target).val();
			plan_search_timer = setTimeout(() => {
				this.plan_search = val;
				this._plan_keep_open = null;
				this.refresh();
			}, 300);
		});

		this.$container.find("#ib-pd-plan-priority").val(this.plan_priority);
		this.$container.find("#ib-pd-plan-priority").on("change", (e) => {
			this.plan_priority = $(e.target).val();
			this._plan_keep_open = null;
			this.refresh();
		});

		// "Hide completed items" toggle — purely client-side re-filter of
		// already-loaded Order Sheets (this._plan_all_rows), no re-fetch and
		// no server round-trip needed.
		this.$container.find("#ib-pd-hide-done").prop("checked", this.hide_completed_items);
		this.$container.find("#ib-pd-hide-done").on("change", (e) => {
			this.hide_completed_items = $(e.target).is(":checked");
			this._render_plan(this._plan_all_rows, false);
		});

		// Infinite scroll — the Desk layout scrolls the whole page, not this
		// container, so listen on window and check how close #ib-pd-plan-more is.
		this._scroll_handler = () => {
			const $sentinel = this.$container.find("#ib-pd-plan-more");
			if (!$sentinel.length || !$sentinel.is(":visible")) return;
			const rect = $sentinel[0].getBoundingClientRect();
			if (rect.top < window.innerHeight + 300) this._load_more_plan();
		};
		$(window).on("scroll.ib-pd-plan", this._scroll_handler);

		// Close any open manual-move panel when clicking outside it.
		$(document).on("click.ib-pd-move-panel", (e) => {
			if (!$(e.target).closest(".ib-pd-row-move-wrap").length) {
				this.$container.find(".ib-pd-row-move-panel").hide();
			}
		});
	}

	_add_toolbar_buttons() {
		// Standard page toolbar (top of page, always visible without scrolling) —
		// the only prior link to Production Stages was a quick-action button near
		// the bottom of the page, past the whole Active Production Plan list.
		this.page.set_primary_action(__("Production Stages"), () => {
			frappe.set_route("ib-production-stages");
		}, "arrow-right");
		this.page.add_button(__("Refresh"), () => {
			this._plan_keep_open = null;
			this.refresh();
		}, { icon: "refresh" });
	}

	_set_refresh_label(text) {
		this.$container.find("#ib-pd-refresh-ts").text(text);
	}

	// ── Render ────────────────────────────────────────────────────────────────
	_render(data) {
		this._render_kpis(data.summary || {});
		if (this.location_filter) {
			this.$container.find("#ib-pd-pipeline-section").show();
			this.$container.find("#ib-pd-pipeline-hint").hide();
			this._render_pipeline(data.pipeline || []);
		} else {
			this.$container.find("#ib-pd-pipeline-section").hide();
			this.$container.find("#ib-pd-pipeline-hint").show();
		}
		this._render_actions();
	}

	_render_kpis(s) {
		const today = frappe.datetime.get_today();
		// Routes into Production Stages (its polished Item-wise/Machine-wise
		// views) instead of the raw IB Work Order doctype list. These 4 KPIs
		// are computed from IB Work Order.status directly (see
		// get_production_dashboard in production.py) — a different grain from
		// IB Order Sheet.status (Draft/In Progress/Completed), which is one
		// row per Sales Order and stays "In Progress" for the order's entire
		// multi-week run regardless of how many of its Work Orders are done.
		// Routing these into Order-wise's status filter (as an earlier version
		// of this code did) showed the wrong list — an Order-Sheet-grain count
		// that has nothing to do with the WO-grain number on the card.
		// "Active Work Orders" / "Pending" now route into Item-wise instead —
		// grouped by item_code across ALL Order Sheets (see get_item_wise_view),
		// already WO-grain and already spans everything, same shape as these
		// KPIs. Item-wise's `status` route option (consumed in
		// ib_production_stages.js _consume_route_options/_render_item_wise)
		// keeps only items with at least one Work Order matching the given
		// status — exact-value match for "Pending", any-of match for "Active"
		// (mirrors the backend's own `status NOT IN ('Completed','Cancelled')`).
		// "Completed Today" is a date-scoped historical count (status=Completed
		// AND completed *today* specifically), not a "what's active right now"
		// view — none of the 4 Stages tabs are built for that. The DPR (Daily
		// Production Report) page already computes and renders this exact same
		// value (`wo_completed` in get_dpr(), shown as its "WOs Completed" KPI
		// card) via an identical WHERE clause, defaulting to today on load — a
		// genuine exact grain+date match, so route there instead.
		const kpis = [
			{
				label: "Active Work Orders", value: s.active_work_orders ?? 0, color: "#2563eb", icon: "layers",
				sub: "Pending + In Progress",
				click() {
					frappe.route_options = { tab: "item_wise", status: ["Pending", "In Progress", "On Hold"] };
					frappe.set_route("ib-production-stages");
				},
			},
			{
				label: "Pending", value: s.pending ?? 0, color: "#d97706", icon: "clock",
				sub: "Awaiting start",
				click() {
					frappe.route_options = { tab: "item_wise", status: "Pending" };
					frappe.set_route("ib-production-stages");
				},
			},
			{
				label: "Completed Today", value: s.completed_today ?? 0, color: "#059669", icon: "check-circle",
				sub: frappe.datetime.str_to_user(today),
				click() { frappe.set_route("ib-dpr"); },
			},
			{
				label: "Machines Active", value: s.machines_active ?? 0, color: "#0891b2", icon: "settings-2",
				sub: "Production floor",
				click() { frappe.route_options = { tab: "machine_wise" }; frappe.set_route("ib-production-stages"); },
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
		// Exact real stage labels, keyed by the lowercase_underscore key the
		// backend sends — the naive "capitalize every word" transform used for
		// the card's display text turns "Ready to Deliver" into "Ready To
		// Deliver", which would silently match zero real records if used as a
		// list filter (IB Work Order.stage stores the exact-cased label).
		const STAGE_KEY_TO_LABEL = {
			coating: "Coating", slitting: "Slitting", rewinding: "Rewinding",
			cutting: "Cutting", packing: "Packing",
			ready_to_deliver: "Ready to Deliver", delivered: "Delivered",
		};
		const $pipeline = this.$container.find("#ib-pd-pipeline").html(html);
		$pipeline.find(".ib-pd-pipeline-card").on("click", (e) => {
			const stageKey = $(e.currentTarget).data("stage");
			const stageLabel = STAGE_KEY_TO_LABEL[stageKey] || String(stageKey);
			// Item-wise is the polished view for "what's at this stage right
			// now" — Production Stages reads the stage filter client-side
			// (IB Work Order.stage stores this exact label already).
			frappe.route_options = { tab: "item_wise", stage: stageLabel, location: this.location_filter || undefined };
			frappe.set_route("ib-production-stages");
		});
	}

	_render_actions() {
		this.$container.find("#ib-pd-actions").html(`
			<button class="ib-pd-quick-btn" onclick="frappe.set_route('ib-production-stages')">
				Production Stages →
			</button>
			<button class="ib-pd-quick-btn ib-pd-quick-btn--minor" onclick="frappe.route_options = {tab: 'order_wise'}; frappe.set_route('ib-production-stages')"
				title="Work Orders grouped by order, in the Production Stages view.">
				Work Orders →
			</button>
			<button class="ib-pd-quick-btn" onclick="frappe.set_route('ib-dpr')">
				DPR Report →
			</button>
		`);
	}

	_render_plan(order_sheets, append) {
		const $el = this.$container.find("#ib-pd-plan");
		const $more = this.$container.find("#ib-pd-plan-more");
		if (!append && !order_sheets.length) {
			$el.html(`<div class="ib-pd-empty">No active production orders. Submit a Sales Order to auto-generate production.</div>`);
			$more.text("");
			return;
		}
		if (append && !order_sheets.length) {
			$more.text(this._plan_has_more ? "" : "— end of list —");
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
			const allItems = os.items || [];
			// "Do not show done WO" toggle — filters out item rows with nothing
			// left to advance (same criterion as the "✓ Done" badge below).
			// Filtering happens on the item list itself, not just visually
			// hiding rendered rows, so a fully-done card can fall through to
			// the "all items complete" empty state below instead of an empty
			// <table>.
			const visibleItems = this.hide_completed_items
				? allItems.filter(item => !_item_is_done(item))
				: allItems;
			const itemRows = visibleItems.map(item => {
				const currentStage = item.current_stage || "";
				const stageMap = item.stage_map || {};
				const stagePills = Object.entries(stageMap).map(([stage, info]) => {
					if (!info.status) return "";
					const cls = stageStatusCls[info.status] || "ib-pd-stg--pending";
					const abbr = stageAbbr[stage] || stage.substring(0, 3).toUpperCase();
					const title = `${stage}: ${info.status} (${info.completed_qty}/${info.target_qty})`;
					return `<span class="ib-pd-stg-chip ${cls}" title="${title}">${abbr}</span>`;
				}).join("");

				const completedStages = Object.values(stageMap).filter(v => v.status === "Completed").length;
				const totalStages = Object.values(stageMap).filter(v => v.status).length;
				// Reaching Ready to Deliver means production work is effectively
				// done — only dispatch/DN creation remains — so treat it as 100%
				// even if that RTD Work Order itself hasn't been marked Completed
				// yet (its own status may still be Pending/In Progress).
				const pct = currentStage === "Ready to Deliver"
					? 100
					: (totalStages ? Math.round(completedStages / totalStages * 100) : 0);

				// Primary action acts on the Work Order behind the item's current
				// stage — Start when Pending, Next Stage when In Progress. This is
				// the everyday action and gets full visual weight. The stage-picker
				// + Move button is a rare escape hatch (manually jumping a WO out
				// of normal sequence, e.g. correcting a mis-routed item) — tucked
				// behind a small toggle icon so it never competes visually with the
				// primary action. Items with nothing left to do (100% complete) get
				// an explicit done indicator instead of an empty cell.
				const curInfo = stageMap[currentStage] || {};
				const woName = curInfo.wo_name || "";
				const isFullyDone = totalStages > 0 && completedStages === totalStages;

				let primaryBtn = "";
				if (woName && curInfo.status === "Pending") {
					primaryBtn = `<button class="ib-pd-row-btn ib-pd-row-btn--primary ib-pd-row-start" data-wo="${frappe.utils.escape_html(woName)}" title="Begin work on this stage">Start</button>`;
				} else if (woName && curInfo.status === "In Progress") {
					primaryBtn = `<button class="ib-pd-row-btn ib-pd-row-btn--primary ib-pd-row-advance" data-wo="${frappe.utils.escape_html(woName)}" title="Complete this stage and move to the next">Next Stage →</button>`;
				}

				const doneBadge = (!primaryBtn && isFullyDone)
					? `<span class="ib-pd-row-done" title="All stages complete for this item">
							<iconify-icon icon="lucide:check-circle-2" width="12" height="12"></iconify-icon> Done
						</span>`
					: "";

				const canMove = woName && curInfo.status !== "Completed";
				const moveHtml = canMove
					? `<span class="ib-pd-row-move-wrap">
							<button type="button" class="ib-pd-row-move-toggle" data-wo="${frappe.utils.escape_html(woName)}"
								title="Manually move to a different stage, out of the normal sequence — for correcting a mis-routed item. Not the everyday action.">
								<iconify-icon icon="lucide:shuffle" width="12" height="12"></iconify-icon>
							</button>
							<span class="ib-pd-row-move-panel" style="display:none">
								<span class="ib-pd-row-move-label">or move to:</span>
								<select class="ib-pd-row-stage-select" data-wo="${frappe.utils.escape_html(woName)}">
									${Object.keys(stageAbbr).filter(s => s !== currentStage).map(s => `<option value="${s}">${s}</option>`).join("")}
								</select>
								<button class="ib-pd-row-btn ib-pd-row-move" data-wo="${frappe.utils.escape_html(woName)}">Move</button>
							</span>
						</span>`
					: "";

				return `
					<tr>
						<td>
							<div class="ib-pd-plan-item">${frappe.utils.escape_html(item.item_code || "")}</div>
							${item.item_name ? `<div class="ib-pd-plan-item-name">${frappe.utils.escape_html(item.item_name)}</div>` : ""}
						</td>
						<td>${item.qty || 0} ${item.uom || ""}</td>
						<td>${currentStage || "—"}</td>
						<td><div class="ib-pd-stg-pills">${stagePills}</div></td>
						<td>
							<div class="ib-pd-prog-bar-wrap">
								<div class="ib-pd-prog-bar" style="width:${pct}%"></div>
							</div>
							<span class="ib-pd-prog-pct">${pct}%</span>
						</td>
						<td class="ib-pd-row-actions">${primaryBtn}${doneBadge}${moveHtml}</td>
					</tr>`;
			}).join("");

			// Subline still reports the order's real item count regardless of
			// the toggle — it describes the order, not the current filtered
			// view.
			const itemCount = allItems.length;
			// Collapse threshold is based on what's actually rendered
			// (visibleItems), not the order's total item count — a 3-item
			// order with 2 already hidden as done shouldn't collapse just
			// because it "has 3 items" on paper. Overridden open for whichever
			// card was in view when an in-card action (Start/Next Stage/Move)
			// or a manual expand triggered this re-render — see
			// this._plan_keep_open.
			const collapsedByDefault = visibleItems.length > 2 && os.name !== this._plan_keep_open;
			const customerName = os.customer_name || os.customer || "—";
			const commentCount = os.comment_count || 0;
			const bodyHtml = visibleItems.length
				? `<table class="ib-pd-table ib-pd-plan-table">
						<thead>
							<tr><th>Item</th><th>Qty</th><th>Current Stage</th><th>Stages</th><th>Progress</th><th>Actions</th></tr>
						</thead>
						<tbody>${itemRows}</tbody>
					</table>`
				: `<div class="ib-pd-plan-all-done">
						<iconify-icon icon="lucide:check-circle-2" width="14" height="14"></iconify-icon>
						All items in this order are complete
					</div>`;

			return `
				<div class="ib-pd-plan-card">
					<div class="ib-pd-plan-header ib-pd-plan-toggle" data-os="${os.name}">
						<div class="ib-pd-plan-start">
							<iconify-icon icon="lucide:chevron-right" width="14" height="14" class="ib-pd-plan-chevron"
								style="${collapsedByDefault ? "" : "transform:rotate(90deg)"}"></iconify-icon>
							<div class="ib-pd-plan-main">
								<div class="ib-pd-plan-title">
									<span class="ib-pd-tag ib-pd-tag--so" title="Sales Order">SO</span>
									<a class="ib-pd-plan-so-link" href="/app/sales-order/${os.sales_order || ""}" target="_blank" onclick="event.stopPropagation()">${os.sales_order || os.name}</a>
									<span class="ib-pd-plan-customer">${customerName}</span>
								</div>
								<div class="ib-pd-plan-subline">${itemCount} item${itemCount !== 1 ? "s" : ""}${os.creation ? ` · Created ${frappe.datetime.str_to_user(os.creation)}` : ""}</div>
							</div>
						</div>
						<div class="ib-pd-plan-meta">
							<span class="ib-pd-priority-badge ib-pd-plan-priority" style="background:${pColor}">${os.priority}</span>
							${_etd_badge(os.delivery_date)}
							<span class="ib-pd-plan-comment-wrap">
								<button class="ib-pd-plan-comment-btn" data-so="${frappe.utils.escape_html(os.sales_order || "")}"
									title="${os.sales_order ? "Add comment" : "No linked Sales Order"}"
									${os.sales_order ? "" : "disabled"}>
									<iconify-icon icon="lucide:message-square" width="12" height="12"></iconify-icon>
								</button>
								${commentCount > 0 ? `<span class="ib-pd-plan-comment-count">${commentCount}</span>` : ""}
							</span>
						</div>
					</div>
					<div class="ib-pd-plan-body" data-os-body="${os.name}" style="${collapsedByDefault ? "display:none" : ""}">
						${bodyHtml}
					</div>
				</div>`;
		}).join("");

		if (append) $el.append(rows); else $el.html(rows);
		$more.text(this._plan_has_more ? "" : (this._plan_offset ? "— end of list —" : ""));
		$el.off("click", ".ib-pd-plan-toggle").on("click", ".ib-pd-plan-toggle", (e) => {
			const os = $(e.currentTarget).data("os");
			const $body = $el.find(`[data-os-body="${os}"]`);
			const $chevron = $(e.currentTarget).find(".ib-pd-plan-chevron");
			const opening = $body.css("display") === "none";
			$body.css("display", opening ? "" : "none");
			$chevron.css("transform", opening ? "rotate(90deg)" : "");
			// Manually opening a card marks it as the one to keep open through
			// the next automatic (row-action-triggered) refresh; manually
			// closing it clears that if it was the one being tracked.
			if (opening) this._plan_keep_open = os;
			else if (this._plan_keep_open === os) this._plan_keep_open = null;
		});

		$el.off("click", ".ib-pd-row-start").on("click", ".ib-pd-row-start", (e) => {
			e.stopPropagation();
			this._plan_keep_open = $(e.currentTarget).closest("[data-os-body]").data("osBody") || null;
			this._plan_row_call("instabiz.overrides.production.start_work_order",
				{ work_order: $(e.currentTarget).data("wo") }, "Started");
		});
		$el.off("click", ".ib-pd-row-advance").on("click", ".ib-pd-row-advance", (e) => {
			e.stopPropagation();
			const wo = $(e.currentTarget).data("wo");
			this._plan_keep_open = $(e.currentTarget).closest("[data-os-body]").data("osBody") || null;
			frappe.call({
				method: "instabiz.overrides.production.advance_to_next_stage",
				args: { work_order: wo },
				callback: (r) => {
					if (r.exc || !r.message || r.message.status !== "ok") {
						frappe.show_alert({ message: r.message?.message || "Failed to advance.", indicator: "red" });
						return;
					}
					frappe.show_alert({ message: r.message.message || "Advanced.", indicator: "green" }, 3);
					this.refresh();
				},
			});
		});
		$el.off("click", ".ib-pd-row-move").on("click", ".ib-pd-row-move", (e) => {
			e.stopPropagation();
			const wo = $(e.currentTarget).data("wo");
			const new_stage = $el.find(`.ib-pd-row-stage-select[data-wo="${wo}"]`).val();
			if (!new_stage) return;
			this._plan_keep_open = $(e.currentTarget).closest("[data-os-body]").data("osBody") || null;
			frappe.call({
				method: "instabiz.overrides.production.move_work_order_stage",
				args: { work_order: wo, new_stage },
				callback: (r) => {
					if (r.exc) {
						frappe.show_alert({ message: "Failed to move Work Order.", indicator: "red" });
						return;
					}
					const machine_msg = r.message?.machine ? ` — machine ${r.message.machine} assigned` : "";
					frappe.show_alert({ message: `Moved to ${new_stage}${machine_msg}`, indicator: "green" }, 3);
					this.refresh();
				},
			});
		});
		// Stage-select and its Move button share a row — clicking either
		// shouldn't collapse/expand the card underneath.
		$el.off("click", ".ib-pd-row-stage-select").on("click", ".ib-pd-row-stage-select", (e) => e.stopPropagation());

		// Manual-move escape hatch is hidden behind a small toggle icon —
		// reveal/hide its picker+Move panel on click, closing any other open
		// panel first so at most one is visible at a time.
		$el.off("click", ".ib-pd-row-move-toggle").on("click", ".ib-pd-row-move-toggle", (e) => {
			e.stopPropagation();
			const $panel = $(e.currentTarget).siblings(".ib-pd-row-move-panel");
			const opening = $panel.css("display") === "none";
			$el.find(".ib-pd-row-move-panel").css("display", "none");
			$panel.css("display", opening ? "inline-flex" : "none");
		});

		$el.off("click", ".ib-pd-plan-comment-btn").on("click", ".ib-pd-plan-comment-btn", (e) => {
			e.stopPropagation();
			const sales_order = $(e.currentTarget).data("so");
			if (!sales_order) return;
			this._show_comment_popover(sales_order, $(e.currentTarget));
		});
	}

	// ── Comment popover ──────────────────────────────────────────────────────
	// Reuses the app's existing floating comment popover (public/js/comment_popover.js,
	// loaded globally on every page via app_include_js) rather than a fresh
	// frappe.ui.Dialog modal — same markup/CSS classes (.ib-cp-*, already in
	// instabiz.bundle.css), same anchor-positioned/backdrop-closed mechanics,
	// same posting call (frappe.desk.form.utils.add_comment). That file's own
	// click handler only fires for list-view ".comment-count" badges, so it
	// can't be called directly from this page — replicated here instead of
	// editing that shared file, since this page is scoped to a single file.
	_close_comment_popover() {
		if (this._cp_backdrop) { this._cp_backdrop.remove(); this._cp_backdrop = null; }
		if (this._cp_popover) { this._cp_popover.remove(); this._cp_popover = null; }
		$(document).off("keydown.ib-pd-cp");
	}

	_show_comment_popover(sales_order, $anchor) {
		this._close_comment_popover();
		// Kept so _submit_comment can bump the count badge next to this exact
		// button after a successful post, without a full plan refresh.
		this._cp_anchor = $anchor;

		this._cp_backdrop = $('<div class="ib-cp-backdrop"></div>').appendTo("body");
		this._cp_backdrop.on("click", () => this._close_comment_popover());

		this._cp_popover = $(`
			<div class="ib-cp-popover">
				<div class="ib-cp-header">
					<div class="ib-cp-title">
						<iconify-icon icon="mdi:comment-text-outline" width="14"></iconify-icon>
						<span>Comments</span>
						<span class="ib-cp-docref">${frappe.utils.escape_html(sales_order)}</span>
					</div>
					<button class="ib-cp-close" title="${__("Close")}">×</button>
				</div>
				<div class="ib-cp-list">
					<div class="ib-cp-loading">${__("Loading…")}</div>
				</div>
				<div class="ib-cp-footer">
					<textarea class="ib-cp-input" placeholder="${__("Write a comment… (Ctrl+Enter to post)")}" rows="2"></textarea>
					<button class="btn btn-primary btn-sm ib-cp-submit">${__("Post")}</button>
				</div>
			</div>
		`).appendTo("body");

		this._position_comment_popover($anchor);

		this._cp_popover.find(".ib-cp-close").on("click", () => this._close_comment_popover());
		this._cp_popover.find(".ib-cp-submit").on("click", () => this._submit_comment(sales_order));
		this._cp_popover.find(".ib-cp-input").on("keydown", (e) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) this._submit_comment(sales_order);
		});
		$(document).on("keydown.ib-pd-cp", (e) => {
			if (e.key === "Escape") this._close_comment_popover();
		});

		this._fetch_comments(sales_order);
	}

	// Same absolute-position-relative-to-document approach as comment_popover.js's
	// position() — flips to the left edge of the anchor if it would overflow the
	// viewport's right edge. Absolute positioning (not fixed) means the popover
	// naturally scrolls with the page alongside its anchor, no scroll listener needed.
	_position_comment_popover($anchor) {
		const rect = $anchor[0].getBoundingClientRect();
		const pw = 340;
		const gap = 6;
		const scrollY = window.scrollY || document.documentElement.scrollTop;
		const scrollX = window.scrollX || document.documentElement.scrollLeft;

		let left = rect.left + scrollX;
		let top = rect.bottom + scrollY + gap;
		if (left + pw > window.innerWidth - 12) left = rect.right + scrollX - pw;

		this._cp_popover.css({ top, left, width: pw });
	}

	_fetch_comments(sales_order) {
		frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "Comment",
				filters: {
					reference_doctype: "Sales Order",
					reference_name: sales_order,
					comment_type: "Comment",
				},
				fields: ["name", "comment_by", "comment_email", "content", "creation"],
				order_by: "creation asc",
				limit: 50,
			},
			callback: (r) => {
				if (!this._cp_popover) return;
				const comments = (r && r.message) || [];
				const $list = this._cp_popover.find(".ib-cp-list");
				if (!comments.length) {
					$list.html(`<div class="ib-cp-empty">${__("No comments yet.")}</div>`);
				} else {
					$list.html(comments.map(this._render_comment_row).join(""));
					$list.scrollTop($list[0].scrollHeight);
				}
			},
		});
	}

	_render_comment_row(c) {
		const initials = (c.comment_by || c.comment_email || "?")
			.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
		const when = frappe.datetime.comment_when
			? frappe.datetime.comment_when(c.creation)
			: c.creation;
		return `
			<div class="ib-cp-comment">
				<div class="ib-cp-avatar">${initials}</div>
				<div class="ib-cp-body">
					<div class="ib-cp-meta">
						<span class="ib-cp-author">${frappe.utils.escape_html(c.comment_by || c.comment_email || "")}</span>
						<span class="ib-cp-time">${when}</span>
					</div>
					<div class="ib-cp-content">${c.content || ""}</div>
				</div>
			</div>`;
	}

	_submit_comment(sales_order) {
		if (!this._cp_popover) return;
		const $input = this._cp_popover.find(".ib-cp-input");
		const text = $input.val().trim();
		if (!text) return;

		const $btn = this._cp_popover.find(".ib-cp-submit").prop("disabled", true).text(__("Posting…"));
		frappe.call({
			method: "frappe.desk.form.utils.add_comment",
			args: {
				reference_doctype: "Sales Order",
				reference_name: sales_order,
				content: `<p>${frappe.utils.escape_html(text).replace(/\n/g, "<br>")}</p>`,
				comment_email: frappe.session.user,
				comment_by: frappe.boot.user.full_name || frappe.session.user,
			},
			callback: (r) => {
				if (!this._cp_popover) return;
				$btn.prop("disabled", false).text(__("Post"));
				if (!r || !r.message) return;

				$input.val("");
				const $list = this._cp_popover.find(".ib-cp-list");
				$list.find(".ib-cp-empty").remove();
				$list.append(this._render_comment_row(r.message));
				$list.scrollTop($list[0].scrollHeight);
				frappe.show_alert({ message: __("Comment posted"), indicator: "green" }, 3);
				this._bump_comment_count(sales_order);
			},
		});
	}

	// Increments the count badge next to the comment icon for this Sales
	// Order's card, without a full plan refresh. Also updates the in-memory
	// _plan_all_rows so a later toggle-triggered re-render doesn't revert it.
	_bump_comment_count(sales_order) {
		if (this._cp_anchor && this._cp_anchor.length) {
			const $wrap = this._cp_anchor.closest(".ib-pd-plan-comment-wrap");
			let $badge = $wrap.find(".ib-pd-plan-comment-count");
			const next = (parseInt($badge.text(), 10) || 0) + 1;
			if (!$badge.length) {
				$badge = $(`<span class="ib-pd-plan-comment-count"></span>`).appendTo($wrap);
			}
			$badge.text(next);
		}
		(this._plan_all_rows || []).forEach(os => {
			if (os.sales_order === sales_order) os.comment_count = (os.comment_count || 0) + 1;
		});
	}

	_plan_row_call(method, args, successLabel) {
		frappe.call({
			method,
			args,
			callback: (r) => {
				if (r.exc || (r.message && r.message.status && r.message.status !== "ok")) {
					frappe.show_alert({ message: `Failed — ${successLabel.toLowerCase()} did not apply.`, indicator: "red" });
					return;
				}
				frappe.show_alert({ message: successLabel, indicator: "green" }, 2);
				this.refresh();
			},
		});
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
					<button class="ib-pd-ai-btn ib-pd-ai-approve btn btn-xs btn-success" data-name="${frappe.utils.escape_html(a.name)}"
						style="background:#059669;color:#fff;border:none;border-radius:5px;
						padding:4px 12px;font-size:11px;font-weight:600;cursor:pointer">
						<iconify-icon icon="lucide:check" width="11" height="11"
							style="vertical-align:middle;margin-right:3px"></iconify-icon>
						Approve
					</button>
					<button class="ib-pd-ai-btn ib-pd-ai-reject btn btn-xs btn-danger" data-name="${frappe.utils.escape_html(a.name)}"
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
			.ib-pd-top-bar {
				display: flex;
				align-items: center;
				justify-content: space-between;
				margin-bottom: 14px;
				flex-wrap: wrap;
				gap: 8px;
			}
			.ib-pd-loc-group {
				display: flex;
				align-items: center;
				gap: 7px;
			}
			.ib-pd-select {
				padding: 6px 12px;
				border: 1px solid var(--border-color, #e2e8f0);
				border-radius: 7px;
				background: var(--card-bg, #fff);
				color: var(--text-color, #1e293b);
				font-size: 12.5px;
				font-weight: 600;
				min-width: 190px;
				cursor: pointer;
			}
			.ib-pd-select:focus { outline: none; border-color: var(--ib-primary, #d97757); }
			.ib-pd-plan-toolbar {
				display: flex;
				align-items: center;
				gap: 10px;
				flex-wrap: wrap;
				margin-bottom: 12px;
			}
			.ib-pd-filter-group--search {
				display: flex;
				align-items: center;
				gap: 8px;
				background: var(--card-bg, #fff);
				border: 1px solid var(--border-color, #e2e8f0);
				border-radius: 8px;
				padding: 7px 12px;
				flex: 1 1 280px;
				max-width: 360px;
				margin-bottom: 0;
			}
			.ib-pd-filter-group--priority {
				display: flex;
				align-items: center;
				gap: 8px;
				background: var(--card-bg, #fff);
				border: 1px solid var(--border-color, #e2e8f0);
				border-radius: 8px;
				padding: 7px 12px;
				flex: 0 0 auto;
			}
			.ib-pd-priority-select {
				border: none;
				outline: none;
				background: none;
				font-size: 12.5px;
				font-weight: 600;
				color: var(--text-color, #1e293b);
				cursor: pointer;
				padding: 0 2px;
			}
			.ib-pd-filter-group--hide-done {
				display: flex;
				align-items: center;
				gap: 7px;
				background: var(--card-bg, #fff);
				border: 1px solid var(--border-color, #e2e8f0);
				border-radius: 8px;
				padding: 7px 12px;
				flex: 0 0 auto;
				cursor: pointer;
				font-size: 12.5px;
				font-weight: 600;
				color: var(--text-color, #1e293b);
				user-select: none;
			}
			.ib-pd-filter-group--hide-done input[type="checkbox"] {
				cursor: pointer;
				accent-color: var(--ib-primary, #d97757);
			}
			.ib-pd-search-input {
				border: none;
				outline: none;
				background: none;
				flex: 1;
				font-size: 13px;
				color: var(--text-color, #1e293b);
				padding: 0;
			}
			.ib-pd-search-input::placeholder { color: var(--text-muted, #6b7280); }
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
			.ib-pd-priority-badge {
				color: #fff;
				font-size: 12px;
				border-radius: 14px;
				padding: 4px 12px;
				font-weight: 500;
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
			/* Power-user/export escape hatch (raw doctype list), not the
			   everyday path — visually secondary next to the primary orange
			   quick actions. */
			.ib-pd-quick-btn--minor {
				background: var(--card-bg, #fff);
				color: var(--text-muted, #6b7280);
				border: 1px solid var(--border-color, #e2e8f0);
				font-weight: 500;
				padding: 8px 16px;
			}
			.ib-pd-quick-btn--minor:hover {
				background: var(--subtle-fg, #f8fafc);
				color: var(--text-color, #1e293b);
			}
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
				margin-bottom: 10px;
				overflow: hidden;
				box-shadow: 0 1px 3px rgba(0,0,0,.04);
				transition: box-shadow .15s;
			}
			.ib-pd-plan-card:hover { box-shadow: 0 3px 10px rgba(0,0,0,.07); }
			.ib-pd-plan-header {
				display: flex;
				align-items: flex-start;
				padding: 13px 16px;
				background: var(--subtle-fg, #f8fafc);
				border-bottom: 1px solid var(--border-color, #e2e8f0);
				flex-wrap: wrap;
				row-gap: 8px;
				column-gap: 12px;
				cursor: pointer;
				transition: background .12s;
			}
			.ib-pd-plan-header:hover { background: var(--border-color, #e2e8f0); }
			.ib-pd-plan-start {
				display: flex;
				align-items: flex-start;
				gap: 10px;
				flex: 1 1 260px;
				min-width: 0;
				text-align: left;
			}
			.ib-pd-plan-chevron {
				flex-shrink: 0;
				margin-top: 2px;
				color: var(--text-muted, #6b7280);
				transition: transform .15s;
			}
			.ib-pd-plan-main {
				flex: 1 1 auto;
				min-width: 0;
				text-align: left;
			}
			.ib-pd-plan-title {
				display: flex;
				align-items: baseline;
				flex-wrap: wrap;
				gap: 6px;
				font-size: 13.5px;
				line-height: 1.4;
			}
			.ib-pd-plan-so-link {
				font-weight: 700;
				color: var(--ib-primary, #d97757);
				text-decoration: none;
				white-space: nowrap;
			}
			.ib-pd-plan-so-link:hover { text-decoration: underline; }
			.ib-pd-plan-customer {
				font-weight: 600;
				color: var(--text-color, #1e293b);
				overflow-wrap: anywhere;
			}
			.ib-pd-plan-subline {
				font-size: 11px;
				color: var(--text-muted, #6b7280);
				margin-top: 3px;
			}
			.ib-pd-plan-meta {
				display: flex;
				align-items: center;
				gap: 8px;
				flex-shrink: 0;
				margin-left: auto;
				padding-top: 1px;
			}
			.ib-pd-plan-priority {
				font-size: 11px;
				padding: 3px 11px;
			}
			.ib-pd-tag {
				display: inline-block;
				font-size: 9.5px;
				font-weight: 800;
				letter-spacing: .03em;
				border-radius: 4px;
				padding: 1px 5px;
				margin-right: 4px;
				vertical-align: middle;
			}
			.ib-pd-tag--so { background: #dbeafe; color: #1e3a8a; }
			.ib-pd-etd-badge {
				display: inline-flex;
				align-items: center;
				font-size: 11px;
				font-weight: 600;
				border-radius: 12px;
				padding: 2px 10px;
			}
			.ib-pd-plan-comment-btn {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 22px;
				height: 22px;
				background: var(--card-bg, #fff);
				border: 1px solid var(--border-color, #e2e8f0);
				border-radius: 999px;
				color: var(--text-muted, #6b7280);
				cursor: pointer;
				transition: background .12s, border-color .12s, color .12s;
			}
			.ib-pd-plan-comment-btn:hover {
				background: var(--subtle-fg, #f8fafc);
				border-color: var(--ib-primary, #d97757);
				color: var(--ib-primary, #d97757);
			}
			.ib-pd-plan-comment-btn:disabled {
				opacity: .4;
				cursor: not-allowed;
			}
			.ib-pd-plan-comment-wrap {
				position: relative;
				display: inline-flex;
			}
			.ib-pd-plan-comment-count {
				position: absolute;
				top: -5px;
				right: -5px;
				min-width: 15px;
				height: 15px;
				line-height: 15px;
				padding: 0 3px;
				border-radius: 999px;
				background: var(--ib-primary, #d97757);
				color: #fff;
				font-size: 9.5px;
				font-weight: 700;
				text-align: center;
			}
			.ib-pd-plan-item { font-size: 12px; font-family: monospace; color: #1e293b; }
			.ib-pd-plan-item-name { font-size: 11px; color: var(--text-muted, #6b7280); margin-top: 2px; }
			.ib-pd-plan-table { margin-bottom: 0; border-radius: 0; border: none; }
			.ib-pd-plan-all-done {
				display: flex;
				align-items: center;
				gap: 6px;
				padding: 14px 16px;
				font-size: 12.5px;
				font-weight: 600;
				color: #059669;
				background: var(--card-bg, #fff);
			}
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
			.ib-pd-row-actions {
				display: flex;
				align-items: center;
				gap: 5px;
				white-space: nowrap;
			}
			.ib-pd-row-btn {
				background: var(--card-bg, #fff);
				border: 1px solid var(--border-color, #e2e8f0);
				border-radius: 5px;
				padding: 3px 9px;
				font-size: 11px;
				font-weight: 600;
				color: var(--text-color, #1e293b);
				cursor: pointer;
				transition: background .12s, border-color .12s;
			}
			.ib-pd-row-btn:hover { background: var(--subtle-fg, #f8fafc); border-color: var(--ib-primary, #d97757); }
			.ib-pd-row-btn--primary {
				background: var(--ib-primary, #d97757);
				border-color: var(--ib-primary, #d97757);
				color: #fff;
			}
			.ib-pd-row-btn--primary:hover { background: #c4623e; }
			.ib-pd-row-stage-select {
				font-size: 11px;
				padding: 3px 6px;
				border-radius: 5px;
				border: 1px solid var(--border-color, #e2e8f0);
				background: var(--card-bg, #fff);
				color: var(--text-color, #1e293b);
				max-width: 130px;
			}
			.ib-pd-row-done {
				display: inline-flex;
				align-items: center;
				gap: 3px;
				font-size: 11px;
				font-weight: 600;
				color: #059669;
			}
			.ib-pd-row-move-wrap {
				display: inline-flex;
				align-items: center;
				gap: 5px;
			}
			.ib-pd-row-move-toggle {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 22px;
				height: 22px;
				flex-shrink: 0;
				background: none;
				border: 1px solid transparent;
				border-radius: 5px;
				color: var(--text-muted, #6b7280);
				cursor: pointer;
				opacity: .7;
				transition: opacity .12s, background .12s, border-color .12s;
			}
			.ib-pd-row-move-toggle:hover {
				opacity: 1;
				background: var(--subtle-fg, #f8fafc);
				border-color: var(--border-color, #e2e8f0);
			}
			/* Revealed inline (not an overlay) — the parent .ib-pd-table has
			   overflow:hidden for its rounded corners, which would clip a
			   popout dropdown; growing the row slightly when opened is safer. */
			.ib-pd-row-move-panel {
				display: inline-flex;
				align-items: center;
				gap: 5px;
				white-space: nowrap;
			}
			.ib-pd-row-move-label {
				font-size: 10.5px;
				color: var(--text-muted, #6b7280);
			}
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
			@media (max-width: 640px) {
				.ib-pd-plan-header { flex-direction: column; align-items: stretch; }
				.ib-pd-plan-meta { margin-left: 0; }
				.ib-pd-filter-group--search { max-width: none; flex-basis: 100%; }
			}
		`;
		document.head.appendChild(style);
	}
}
