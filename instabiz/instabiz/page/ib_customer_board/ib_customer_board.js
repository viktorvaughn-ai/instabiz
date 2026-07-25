
frappe.pages["ib-customer-board"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Customer Board",
		single_column: true,
	});
	wrapper.page_obj = new IBCustomerBoard(page, wrapper);
};

frappe.pages["ib-customer-board"].on_page_show = function (wrapper) {
	if (wrapper.page_obj) wrapper.page_obj.refresh();
};

frappe.pages["ib-customer-board"].on_page_hide = function (wrapper) {
	if (wrapper.page_obj) wrapper.page_obj._stop_live();
};

const IB_CB_COLOR_SUCCESS = "#22c55e"; // green — positive/new highlight
const IB_CB_COLOR_SUCCESS_RGB = "34,197,94";
const IB_CB_COLOR_DANGER  = "#ef4444"; // red — skipped/urgent highlight
const IB_CB_COLOR_DANGER_RGB  = "239,68,68";
const IB_CB_COLOR_ACTIVITY = "#25d366"; // activity-logged highlight
const IB_CB_COLOR_WARNING = "#f59e0b"; // amber — mid-progress bar

class IBCustomerBoard {
	constructor(page, wrapper) {
		this.page = page;
		this.wrapper = wrapper;
		this.$main = $(wrapper).find(".page-content");
		this._selected_date = frappe.datetime.get_today();
		this._tomorrow_date = null;
		this._undo_timer = null;
		this._sortables = [];
		this._highlight_customer = null;
		this._highlight_color = IB_CB_COLOR_SUCCESS;
		this._pending_on_timeout = null;
		this._is_manager = frappe.user.has_role("Sales Manager") || frappe.user.has_role("System Manager");
		this._last_data = null;
		this._search_timers = {};

		this._init();
	}

	_init() {
		this._gsap_ready = new Promise((resolve) => {
			if (window.gsap) { resolve(); return; }
			const s = document.createElement("script");
			s.src = "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js";
			s.onload = resolve;
			document.head.appendChild(s);
		});
		this._sortable_ready = new Promise((resolve) => {
			if (window.Sortable) { resolve(); return; }
			const s = document.createElement("script");
			s.src = "https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js";
			s.onload = resolve;
			document.head.appendChild(s);
		});
		this._build_toolbar();
		this._build_skeleton();
		this.refresh();
		this._start_live();
	}

	_start_live() {
		// Territory column removed — no live handler needed
	}

	_stop_live() {
		if (this._live_handler) {
			frappe.realtime.off("ib_territory_taken", this._live_handler);
			this._live_handler = null;
		}
	}

	// ── Toolbar ──────────────────────────────────────────────────────────────

	_build_toolbar() {
		const self = this;
		this.page.add_field({
			fieldname: "board_date",
			fieldtype: "Date",
			label: "Date",
			default: frappe.datetime.get_today(),
			change() {
				self._selected_date = this.get_value() || frappe.datetime.get_today();
				self.refresh();
			},
		});
		this.page.add_inner_button("Refresh", () => this.refresh());
	}

	// ── Skeleton ─────────────────────────────────────────────────────────────

	_build_skeleton() {
		this.$main.html(`
			<div class="ib-cb-board">
				<div class="ib-cb-stats-row">
					<div class="ib-cb-stat-card ib-cb-stat-card--completed">
						<span class="ib-cb-stat-num" id="ib-cb-stat-completed-val">0</span>
						<span class="ib-cb-stat-lbl">Completed</span>
					</div>
					<div class="ib-cb-stat-card ib-cb-stat-card--skipped">
						<span class="ib-cb-stat-num" id="ib-cb-stat-skipped-val">0</span>
						<span class="ib-cb-stat-lbl">Skipped</span>
					</div>
					<div class="ib-cb-target-card" id="ib-cb-target-card" style="display:none">
						<div class="ib-cb-target-hdr">
							<span class="ib-cb-target-lbl">Monthly Target</span>
							<span class="ib-cb-target-month" id="ib-cb-target-month"></span>
						</div>
						<div class="ib-cb-target-amounts">
							<span class="ib-cb-target-actual" id="ib-cb-target-actual">₹0</span>
							<span class="ib-cb-target-sep">/</span>
							<span class="ib-cb-target-goal" id="ib-cb-target-goal">₹0</span>
						</div>
						<div class="ib-cb-target-bar-wrap">
							<div class="ib-cb-target-bar-track">
								<div class="ib-cb-target-bar-fill" id="ib-cb-target-bar-fill"></div>
							</div>
							<span class="ib-cb-target-pct" id="ib-cb-target-pct">0%</span>
						</div>
						<div class="ib-cb-target-source" id="ib-cb-target-source"></div>
					</div>
				</div>
				<div class="ib-cb-columns">
					<div class="ib-cb-col" id="ib-cb-dormant">
						<div class="ib-cb-col-header">
							${IB_ICONS.svg("user", 13)}<span class="ib-cb-col-title">My Accounts</span>
							<span class="ib-cb-col-badge" id="ib-cb-dormant-count">0</span>
						</div>
						<div class="ib-cb-col-search">
							<input class="ib-cb-pool-search" id="ib-cb-dormant-search" placeholder="Search…" autocomplete="off">
						</div>
						<div class="ib-cb-cards" id="ib-cb-dormant-cards"></div>
					</div>
					<div class="ib-cb-col ib-cb-col--today" id="ib-cb-today">
						<div class="ib-cb-col-header">
							${IB_ICONS.svg("calendar", 13)}<span class="ib-cb-col-title">Today</span>
							<span class="ib-cb-col-date" id="ib-cb-today-date"></span>
							<span class="ib-cb-col-badge ib-cb-col-badge--today" id="ib-cb-today-count">0</span>
						</div>

						<div class="ib-cb-today-prog-wrap">
							<div class="ib-cb-today-prog-fill" id="ib-cb-today-prog-fill"></div>
						</div>
						<div class="ib-cb-col-search">
							<input class="ib-cb-pool-search" id="ib-cb-today-search" placeholder="Search…" autocomplete="off">
						</div>
						<div class="ib-cb-cards" id="ib-cb-today-cards"></div>
					</div>
					<div class="ib-cb-col ib-cb-col--tomorrow" id="ib-cb-tomorrow">
						<div class="ib-cb-col-header">
							${IB_ICONS.svg("sunrise", 13)}<span class="ib-cb-col-title">Tomorrow</span>
							<span class="ib-cb-col-date" id="ib-cb-tomorrow-date"></span>
							<span class="ib-cb-col-badge" id="ib-cb-tomorrow-count">0</span>
						</div>
						<div class="ib-cb-col-search">
							<input class="ib-cb-pool-search" id="ib-cb-tomorrow-search" placeholder="Search…" autocomplete="off">
						</div>
						<div class="ib-cb-cards" id="ib-cb-tomorrow-cards"></div>
					</div>
				</div>
			</div>
			<div id="ib-cb-undo-toast" class="ib-cb-undo-toast">
				<div class="ib-cb-undo-toast-row">
					<span class="ib-cb-undo-msg" id="ib-cb-undo-msg"></span>
					<button class="ib-cb-undo-btn" id="ib-cb-undo-btn">Undo</button>
				</div>
				<div class="ib-cb-undo-bar"><div class="ib-cb-undo-bar-fill" id="ib-cb-undo-bar-fill"></div></div>
			</div>
		`);
	}

	// ── Data load ─────────────────────────────────────────────────────────────

	refresh() {
		const self = this;
		$(".ib-cb-board").css("opacity", "0.6");
		frappe.call({
			method: "instabiz.overrides.customer_assignment.get_customer_board_data",
			args: { date: this._selected_date },
			callback(r) {
				$(".ib-cb-board").css("opacity", "");
				if (r.message) self._render(r.message);
			},
			error() {
				$(".ib-cb-board").css("opacity", "");
				frappe.show_alert({ message: "Failed to load board data", indicator: "red" });
			},
		});
		frappe.call({
			method: "instabiz.overrides.sales_target.get_my_target",
			args: { month: this._selected_date },
			callback(r) { if (r.message) self._render_target(r.message); },
		});
	}

	_render_target(t) {
		if (!t.has_target) { $("#ib-cb-target-card").hide(); return; }
		const fmt = (v) => "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
		const pct = t.pct || 0;
		const bar_color = pct >= 100 ? IB_CB_COLOR_SUCCESS : pct >= 60 ? "var(--ib-primary)" : IB_CB_COLOR_WARNING;
		const d = frappe.datetime.str_to_user(t.month);
		const month_label = d ? d.slice(3) : t.month;  // "May 2026" from "01-05-2026"
		$("#ib-cb-target-month").text(month_label);
		$("#ib-cb-target-actual").text(fmt(t.actual));
		$("#ib-cb-target-goal").text(fmt(t.target));
		$("#ib-cb-target-pct").text(pct + "%");
		$("#ib-cb-target-bar-fill").css({ width: pct + "%", background: bar_color });
		const cnt = t.order_count || 0;
		const src_text = cnt === 1 ? "1 sales order" : `${cnt} sales orders`;
		// Month date range for SO filter deep-link (must match _get_actuals basis: creation,
		// per user decision 2026-07-25 — same field the SO list view defaults to)
		const _mp = (t.month || "").split("-").map(Number);
		const _last_day = _mp.length === 3 ? new Date(_mp[0], _mp[1], 0).getDate() : 28;
		const month_end = t.month ? `${t.month.slice(0, 7)}-${String(_last_day).padStart(2, "0")}` : "";
		const view_user = frappe.session.user;
		$("#ib-cb-target-source").html(
			`From <a class="ib-cb-inv-link" href="#" title="View these sales orders">${src_text}</a> · ${frappe.utils.escape_html(month_label)}`
		);
		$("#ib-cb-target-source .ib-cb-inv-link").off("click").on("click", function (e) {
			e.preventDefault();
			frappe.route_options = {
				docstatus: 1,
				custom_sales_person_user: view_user,
				creation: ["between", [t.month, month_end]],
			};
			frappe.set_route("List", "Sales Order");
		});
		$("#ib-cb-target-card").show();
	}

	// ── Render ────────────────────────────────────────────────────────────────

	_render(data) {
		this._last_data = data;
		this._tomorrow_date = data.tomorrow_date;
		if (data.is_manager !== undefined) this._is_manager = data.is_manager;
		// Track which customers already have active assignments so pool cards show status badges
		this._today_customer_set    = new Set((data.today    || []).map(r => r.customer));
		this._tomorrow_customer_set = new Set((data.tomorrow || []).map(r => r.customer));
		$("#ib-cb-today-date").text(frappe.datetime.str_to_user(data.date));
		$("#ib-cb-tomorrow-date").text(frappe.datetime.str_to_user(data.tomorrow_date));
		this._render_pool("dormant", data.dormant, data.dormant_total);
		this._render_today(data.today);
		this._render_tomorrow(data.tomorrow);
		this._init_sortable();
		if (this._highlight_customer) {
			this._flash_new_card(this._highlight_customer, this._highlight_color);
			this._highlight_customer = null;
			this._highlight_color = IB_CB_COLOR_SUCCESS;
		}
	}

	_render_pool(col, rows, total) {
		$(`#ib-cb-${col}-search`).val("");
		const $cards = $(`#ib-cb-${col}-cards`).empty();
		const badge = total !== undefined && total > rows.length ? `${rows.length} / ${total}` : rows.length;
		$(`#ib-cb-${col}-count`).text(badge);
		if (!rows.length) {
			const empty_msg = col === "dormant"
				? "No accounts assigned to you yet"
				: "No unassigned customers in your territory";
			$cards.append(`<div class="ib-cb-empty">${empty_msg}</div>`);
		} else {
			rows.forEach((r) => $cards.append(this._make_card(r, "pool")));
		}
		this._bind_search(col, "backend");
	}

	// ── Unified search binding ────────────────────────────────────────────────

	_bind_search(col, mode) {
		// mode: "backend" → hits search_customer_pool API
		//       "local"   → filters this._last_data[col] client-side
		const self = this;
		$(`#ib-cb-${col}-search`).off("input").on("input", function () {
			const q = $(this).val().trim();
			clearTimeout(self._search_timers[col]);
			if (!q) {
				self._restore_col(col);
				return;
			}
			self._search_timers[col] = setTimeout(() => {
				if (mode === "backend") {
					frappe.call({
						method: "instabiz.overrides.customer_assignment.search_customer_pool",
						args: { pool_type: col, search: q },
						callback(r) { self._apply_search_results(col, r.message || [], "pool"); },
					});
				} else {
					const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
					const rows = (self._last_data?.[col] || []).filter((r) => {
						const hay = [r.customer_name, r.customer, r.territory, r.custom_contact_person_name]
							.join(" ").toLowerCase();
						return tokens.every((t) => hay.includes(t));
					});
					const ctx = col === "today" ? "today"
						: col === "claimed" ? "claimed"
						: "tomorrow";
					self._apply_search_results(col, rows, ctx);
				}
			}, 250);
		});
	}

	_restore_col(col) {
		const data = this._last_data;
		if (!data) return;
		if (col === "dormant") this._render_pool("dormant", data.dormant, data.dormant_total);
		else if (col === "today") this._render_today(data.today);
		else if (col === "tomorrow") this._render_tomorrow(data.tomorrow);
	}

	_apply_search_results(col, rows, ctx) {
		const $cards = $(`#ib-cb-${col}-cards`).empty();
		$(`#ib-cb-${col}-count`).text(rows.length);
		if (!rows.length) {
			$cards.append(`<div class="ib-cb-empty">No results</div>`);
			return;
		}
		if (col === "today") {
			rows.filter((r) => r.status === "Pending").forEach((r) => $cards.prepend(this._make_card(r, "today")));
			rows.filter((r) => r.status !== "Pending").forEach((r) => $cards.append(this._make_card(r, "today_done")));
		} else {
			rows.forEach((r) => $cards.append(this._make_card(r, ctx)));
		}
	}

	_render_today(rows) {
		const self = this;
		$("#ib-cb-today-search").val("");
		const $cards = $("#ib-cb-today-cards").empty();
		const pending = rows.filter((r) => r.status === "Pending");
		const done    = rows.filter((r) => r.status !== "Pending");
		const total   = rows.length;
		const done_ct = done.length;

		// Badge: done / total
		$("#ib-cb-today-count").text(total ? `${done_ct}/${total}` : "0");

		// Stat counters
		$("#ib-cb-stat-completed-val").text(done.filter((r) => r.status !== "Skipped").length);
		$("#ib-cb-stat-skipped-val").text(done.filter((r) => r.status === "Skipped").length);

		// Progress bar via GSAP
		const pct = total ? Math.round((done_ct / total) * 100) : 0;
		this._gsap_ready.then(() => {
			gsap.to("#ib-cb-today-prog-fill", {
				width: pct + "%",
				duration: 0.55,
				ease: "power2.out",
			});
		});

		if (!total) {
			$cards.append(`<div class="ib-cb-empty">No assignments today</div>`);
		} else {
			// Build cards with opacity:0 so GSAP animates them in without flash
			const make_hidden = (r, ctx) => {
				const $c = self._make_card(r, ctx);
				$c.css("opacity", "0");
				return $c;
			};
			// Most-recent assignment first so drag-dropped cards surface at top
			[...pending].reverse().forEach((r) => $cards.prepend(make_hidden(r, "today")));
			done.forEach((r) => $cards.append(make_hidden(r, "today_done")));
		}

		// Stagger cards in — opacity already 0, no flash
		this._gsap_ready.then(() => {
			gsap.to("#ib-cb-today-cards .ib-cb-card",
				{ opacity: 1, y: 0, stagger: 0.035, duration: 0.22, ease: "power2.out", clearProps: "transform" }
			);
		});
		this._bind_search("today", "local");
	}

	_render_tomorrow(rows) {
		$("#ib-cb-tomorrow-search").val("");
		const $cards = $("#ib-cb-tomorrow-cards").empty();
		$("#ib-cb-tomorrow-count").text(rows.length);
		if (!rows.length) {
			$cards.append(`<div class="ib-cb-empty">No assignments yet — scheduler runs at midnight</div>`);
		} else {
			[...rows].reverse().forEach((r) => $cards.prepend(this._make_card(r, "tomorrow")));
		}
		this._bind_search("tomorrow", "local");
	}

	// ── Unified card builder ──────────────────────────────────────────────────

	_make_card(r, ctx) {
		const self = this;
		const name_html = frappe.utils.escape_html(r.customer_name || r.customer);
		const phone = r.mobile_no || r.custom_primary_contact_person;
		const is_done = ctx === "today_done";

		// Meta lines
		const territory_line = r.territory
			? `<div class="ib-cb-card-meta">${IB_ICONS.svg("map_pin", 10)} ${frappe.utils.escape_html(r.territory)}</div>`
			: "";
		const contact_line = r.custom_contact_person_name
			? `<div class="ib-cb-card-contact">${IB_ICONS.svg("user", 10)} ${frappe.utils.escape_html(r.custom_contact_person_name)}</div>`
			: "";
		const last_label = r.last_so_date
			? frappe.datetime.str_to_user(r.last_so_date)
			: "No orders yet";
		const last_line = `<div class="ib-cb-card-last">${IB_ICONS.svg("clock", 10)} ${last_label}</div>`;

		// Prior contact context (done today cards only)
		const prior_line = (is_done && r.last_outcome)
			? `<div class="ib-cb-card-prior">
				<span class="ib-cb-prior-chip ib-cb-prior--${r.last_outcome.toLowerCase().replace(/ /g, "-")}">
					${frappe.utils.escape_html(r.last_outcome)}
				</span>
				<span class="ib-cb-prior-date">${IB_ICONS.svg("clock", 9)} ${frappe.datetime.str_to_user(r.last_contacted_at)}</span>
			   </div>`
			: "";

		let inner_html = "";

		if (ctx === "pool") {
			const esc_cust = frappe.utils.escape_html(r.customer);
			const in_today    = !!(this._today_customer_set    && this._today_customer_set.has(r.customer));
			const in_tomorrow = !!(this._tomorrow_customer_set && this._tomorrow_customer_set.has(r.customer));
			const today_btn = in_today
				? `<span class="ib-cb-pill ib-cb-pill--in-today">${IB_ICONS.svg("check", 10)} In Today</span>`
				: `<button class="ib-cb-pill ib-cb-pill--add ib-cb-btn-add-today" data-customer="${esc_cust}">${IB_ICONS.svg("plus", 10)} Add to Today</button>`;
			const tmrw_btn = in_tomorrow
				? `<span class="ib-cb-pill ib-cb-pill--in-tomorrow">${IB_ICONS.svg("check", 10)} Tomorrow</span>`
				: `<button class="ib-cb-pill ib-cb-pill--tomorrow ib-cb-btn-add-tomorrow" data-customer="${esc_cust}">${IB_ICONS.svg("plus", 10)} Tomorrow</button>`;

			// Share controls — only on Currently Handling column
			// Owned customers show Share button; shared ones show "Shared" badge + self-unshare
			const is_owned = r.share_relation === "owned" || !r.share_relation;
			const is_shared_with_me = r.share_relation === "shared";
			const shared_badge = is_shared_with_me
				? `<span class="ib-cb-pill ib-cb-pill--shared-badge" title="Shared with you">${IB_ICONS.svg("users", 10)} Shared</span>`
				: "";
			const share_btn = is_owned && !this._is_manager
				? `<button class="ib-cb-pill ib-cb-pill--share ib-cb-btn-share" data-customer="${esc_cust}" title="Share with another user">${IB_ICONS.svg("users", 10)} Share</button>`
				: (this._is_manager && is_owned)
					? `<button class="ib-cb-pill ib-cb-pill--share ib-cb-btn-share" data-customer="${esc_cust}" title="Manage sharing">${IB_ICONS.svg("users", 10)} Share</button>`
					: "";
			const unshare_btn = is_shared_with_me
				? `<button class="ib-cb-pill ib-cb-pill--unshare ib-cb-btn-unshare" data-customer="${esc_cust}" title="Remove from my board">✕ Unshare</button>`
				: "";

			inner_html = `
				<div class="ib-cb-card-top">
					<div class="ib-cb-card-name">${name_html}</div>
					${shared_badge}
				</div>
				${territory_line}
				${contact_line}
				${last_line}
				<div class="ib-cb-card-actions">
					${today_btn}
					${tmrw_btn}
					${share_btn}
					${unshare_btn}
				</div>
			`;
		} else if (ctx === "today" || ctx === "today_done") {
			const skip_btn = !is_done
				? `<button class="ib-cb-skip-btn ib-cb-btn-skip" title="Skip">&#x2715;</button>`
				: "";

			// Done label (replaces status badge on completed/skipped cards)
			let done_label_text = "";
			if (is_done) {
				done_label_text = r.status === "Skipped" ? "Skipped"
					: r.status === "Order Placed" ? "Order Placed"
					: r.outcome ? `Contacted · ${r.outcome}` : "Contacted";
			}
			const done_label = is_done
				? `<div class="ib-cb-done-label">${frappe.utils.escape_html(done_label_text)}</div>`
				: "";

			// Small done/skip badge for completed cards
			const done_badge = is_done
				? `<span class="ib-cb-done-badge ib-cb-done-badge--${r.status === "Skipped" ? "skip" : "done"}">${r.status === "Skipped" ? "SKIP" : "DONE"}</span>`
				: `<span class="ib-cb-status ib-cb-status--pending">${r.status}</span>`;

			// Claim button: show when customer has no owner or is owned by someone else
			// (source_pool indicates this came from territory, not from My Accounts)
			const is_unowned = !r.custom_sales_person_user || r.custom_sales_person_user !== frappe.session.user;
			const from_territory = r.source_pool === "Dormant" || r.source_pool === "Regular";
			const claim_btn = (!is_done && is_unowned && from_territory && this._is_manager)
				? `<button class="ib-cb-pill ib-cb-pill--claim ib-cb-btn-claim" data-customer="${frappe.utils.escape_html(r.customer)}" title="Add to My Accounts">
						${IB_ICONS.svg("user", 10)} Claim Account
					</button>`
				: "";

			let actions = "";
			if (!is_done) {
				actions = `
					<div class="ib-cb-card-actions">
						<button class="ib-cb-pill ib-cb-pill--log ib-cb-btn-log">
							${IB_ICONS.svg("clock", 10)} Log Activity
						</button>
						<button class="ib-cb-pill ib-cb-pill--quote ib-cb-btn-q" data-customer="${frappe.utils.escape_html(r.customer)}">
							${IB_ICONS.svg("file", 10)} Quote
						</button>
						${claim_btn}
					</div>`;
			}

			inner_html = `
				<div class="ib-cb-card-top">
					<div class="ib-cb-card-name">${name_html}</div>
					${done_badge}
					${skip_btn}
				</div>
				${done_label}
				${territory_line}
				${contact_line}
				${last_line}
				${prior_line}
				${actions}
			`;
		} else if (ctx === "tomorrow") {
			inner_html = `
				<div class="ib-cb-card-top">
					<div class="ib-cb-card-name">${name_html}</div>
				</div>
				${territory_line}
				${contact_line}
				${last_line}
				<span class="ib-cb-pool-badge">${r.source_pool || ""}</span>
			`;
		}

		// Outcome-based border color for done cards
		const outcome_cls = is_done && r.outcome
			? `ib-cb-card--outcome-${r.outcome.toLowerCase().replace(/ /g, "-")}`
			: "";

		const card_cls = ctx === "pool" ? "ib-cb-card--pool"
			: (ctx === "today" || ctx === "today_done")
				? `ib-cb-card--today${is_done ? " ib-cb-card--done" : ""} ${outcome_cls}`.trim()
			: "ib-cb-card--tomorrow";

		const data_attr = `data-customer="${frappe.utils.escape_html(r.customer)}"${r.name && ctx !== "pool" ? ` data-assignment="${frappe.utils.escape_html(r.name)}"` : ""}`;

		const $card = $(`<div class="ib-cb-card ${card_cls}" ${data_attr}>${inner_html}</div>`);

		// Event bindings
		if (ctx === "pool") {
			$card.find(".ib-cb-btn-add-today").on("click", function () {
				self._add_to_today($(this).data("customer"), $(this));
			});
			$card.find(".ib-cb-btn-add-tomorrow").on("click", function () {
				self._add_to_tomorrow($(this).data("customer"), $(this));
			});
			$card.find(".ib-cb-btn-share").on("click", function () {
				self._show_share_dialog(r.customer, r.customer_name || r.customer);
			});
			$card.find(".ib-cb-btn-unshare").on("click", function () {
				frappe.confirm(
					`Remove ${frappe.utils.escape_html(r.customer_name || r.customer)} from your board?`,
					() => {
						frappe.call({
							method: "instabiz.overrides.customer_assignment.unshare_customer",
							args: { customer: r.customer, share_with: frappe.session.user },
							callback(res) {
								if (!res.exc) {
									frappe.show_alert({ message: "Removed from your board", indicator: "orange" });
									self.refresh();
								}
							},
						});
					}
				);
			});
		} else if (ctx === "today") {
			$card.find(".ib-cb-btn-q").on("click", () =>
				frappe.new_doc("Quotation", { party_name: r.customer, quotation_to: "Customer" })
			);
			$card.find(".ib-cb-btn-log").on("click", () => self._show_log_activity_dialog(r.customer, r.customer_name, r.name));
			$card.find(".ib-cb-btn-skip").on("click", () => self._skip_with_undo(r.name, r.customer_name || r.customer, $card));
			$card.find(".ib-cb-btn-claim").on("click", function () {
				const cust = $(this).data("customer");
				const cust_name = r.customer_name || cust;
				frappe.confirm(
					`Add <b>${frappe.utils.escape_html(cust_name)}</b> to your My Accounts?<br>` +
					`This permanently assigns the customer to you.`,
					() => {
						frappe.call({
							method: "instabiz.overrides.customer_assignment.self_assign_customer",
							args: { customer: cust },
							callback(res) {
								if (res.exc) return;
								frappe.show_alert({ message: `${cust_name} added to My Accounts`, indicator: "green" });
								self.refresh();
							},
						});
					}
				);
			});
		}

		return $card;
	}

	// ── Drag & Drop (SortableJS) ──────────────────────────────────────────────

	_init_sortable() {
		const self = this;

		// Destroy previous instances to avoid duplicate listeners after re-render
		this._sortables.forEach((s) => s.destroy());
		this._sortables = [];

		this._sortable_ready.then(() => {
			const pool_opts = {
				group: { name: "ib-pool", pull: "clone", put: false },
				sort: false,
				animation: 0,
				ghostClass: "ib-cb-drag-ghost",
				chosenClass: "ib-cb-drag-chosen",
				forceFallback: false,
			};

			const dormantEl = document.getElementById("ib-cb-dormant-cards");
			if (dormantEl) self._sortables.push(new Sortable(dormantEl, pool_opts));

			const make_board_opts = (date, col_id, accept_group) => ({
				group: { name: col_id, pull: true, put: ["ib-pool", accept_group] },
				sort: false,
				animation: 150,
				ghostClass: "ib-cb-drag-ghost",
				filter: ".ib-cb-card--done",
				onAdd(evt) {
					const customer = evt.item.dataset.customer;
					const assignment = evt.item.dataset.assignment;
					evt.item.remove();
					if (!customer) return;
					if (assignment) {
						self._move_assignment(assignment, customer, date, col_id);
					} else {
						self._drop_to_date(customer, date, col_id);
					}
				},
			});

			const today_el = document.getElementById("ib-cb-today-cards");
			if (today_el) self._sortables.push(new Sortable(today_el, make_board_opts(self._selected_date, "ib-cb-today", "ib-cb-tomorrow")));

			const tmrw_el = document.getElementById("ib-cb-tomorrow-cards");
			if (tmrw_el) self._sortables.push(new Sortable(tmrw_el, make_board_opts(self._tomorrow_date, "ib-cb-tomorrow", "ib-cb-today")));
		});
	}

	_drop_to_date(customer, date, col_id) {
		const self = this;
		const is_today = date === self._selected_date;
		frappe.call({
			method: "instabiz.overrides.customer_assignment.add_customer_to_today",
			args: { customer, date },
			callback(r) {
				if (r.message && r.message.status === "ok") {
					self._gsap_ready.then(() => {
						gsap.fromTo(`#${col_id}`,
							{ boxShadow: `inset 0 0 0 2px ${IB_CB_COLOR_SUCCESS}` },
							{ boxShadow: `inset 0 0 0 0px ${IB_CB_COLOR_SUCCESS}`, duration: 0.7, ease: "power2.out", clearProps: "boxShadow" }
						);
					});
					if (is_today) {
						self._show_undo_toast(customer, r.message.assignment);
					} else {
						frappe.show_alert({ message: `${customer} added to Tomorrow`, indicator: "blue" });
					}
					self._highlight_customer = customer;
					self.refresh();
				} else {
					frappe.show_alert({ message: `Could not add ${customer}`, indicator: "red" });
				}
			},
			error() {
				frappe.show_alert({ message: `Error adding ${customer}`, indicator: "red" });
			},
		});
	}

	_move_assignment(assignment_id, customer, date, col_id) {
		const self = this;
		frappe.call({
			method: "instabiz.overrides.customer_assignment.move_assignment",
			args: { assignment_id, new_date: date },
			callback(r) {
				if (r.message && r.message.status === "ok") {
					self._flush_pending();
					self._gsap_ready.then(() => {
						gsap.fromTo(`#${col_id}`,
							{ boxShadow: `inset 0 0 0 2px ${IB_CB_COLOR_SUCCESS}` },
							{ boxShadow: `inset 0 0 0 0px ${IB_CB_COLOR_SUCCESS}`, duration: 0.7, ease: "power2.out", clearProps: "boxShadow" }
						);
					});
					self._highlight_customer = customer;
					self.refresh();
				} else {
					frappe.show_alert({ message: `Could not move ${customer}`, indicator: "red" });
					self.refresh();
				}
			},
			error() {
				frappe.show_alert({ message: `Error moving ${customer}`, indicator: "red" });
				self.refresh();
			},
		});
	}

	// ── Add to Today / Tomorrow (button path) ────────────────────────────────

	_add_to_today(customer, $btn) {
		const self = this;
		const $card = $btn.closest(".ib-cb-card");
		$btn.prop("disabled", true);

		this._gsap_ready.then(() => {
			const srcRect = $card[0].getBoundingClientRect();
			const $todayCards = $("#ib-cb-today-cards");
			const targetRect = $todayCards[0].getBoundingClientRect();

			const clone = document.createElement("div");
			clone.className = "ib-cb-card ib-cb-card--today";
			clone.innerHTML = $card.html();
			clone.querySelector(".ib-cb-btn-add-today")?.remove();
			Object.assign(clone.style, {
				position: "fixed",
				top: srcRect.top + "px",
				left: srcRect.left + "px",
				width: srcRect.width + "px",
				margin: "0",
				zIndex: "9000",
				pointerEvents: "none",
			});
			document.body.appendChild(clone);

			gsap.set($card[0], { opacity: 0.35 });

			gsap.to(clone, {
				top: targetRect.top + 8,
				left: targetRect.left + 8,
				width: targetRect.width - 16,
				opacity: 0,
				scale: 0.94,
				duration: 0.52,
				ease: "power3.inOut",
				onComplete: () => clone.remove(),
			});

			frappe.call({
				method: "instabiz.overrides.customer_assignment.add_customer_to_today",
				args: { customer, date: self._selected_date },
				callback(r) {
					if (r.message && r.message.status === "ok") {
						gsap.to($card[0], {
							opacity: 0, scale: 0.92, duration: 0.22, ease: "power2.in",
							onComplete: () => { self._show_undo_toast(customer, r.message.assignment); self._highlight_customer = customer; self.refresh(); },
						});
					} else {
						gsap.to($card[0], { opacity: 1, duration: 0.2 });
						$btn.prop("disabled", false);
					}
				},
				error() {
					gsap.to($card[0], { opacity: 1, duration: 0.2 });
					$btn.prop("disabled", false);
				},
			});
		});
	}

	_add_to_tomorrow(customer, $btn) {
		const self = this;
		$btn.prop("disabled", true);
		frappe.call({
			method: "instabiz.overrides.customer_assignment.add_customer_to_today",
			args: { customer, date: self._tomorrow_date },
			callback(r) {
				if (r.message && r.message.status === "ok") {
					self._flush_pending();
					self._highlight_customer = customer;
					self.refresh();
				} else {
					$btn.prop("disabled", false);
				}
			},
			error() { $btn.prop("disabled", false); },
		});
	}

	// ── Timed toast (generic) ─────────────────────────────────────────────────

	_show_timed_toast(msg, on_timeout, on_undo) {
		const self = this;

		// Previous toast still pending — commit it immediately before showing new one
		if (this._undo_timer) {
			clearInterval(this._undo_timer);
			this._undo_timer = null;
			if (this._pending_on_timeout) {
				this._pending_on_timeout();
				this._pending_on_timeout = null;
			}
		}

		this._pending_on_timeout = on_timeout;

		const $toast = $("#ib-cb-undo-toast");
		const $fill  = $("#ib-cb-undo-bar-fill");
		const $btn   = $("#ib-cb-undo-btn");

		$("#ib-cb-undo-msg").text(msg);
		$fill.css({ width: "100%", transition: "none" });
		$toast.addClass("ib-cb-undo-toast--visible");

		requestAnimationFrame(() => {
			$fill.css({ transition: "width 5s linear", width: "0%" });
		});

		let elapsed = 0;
		this._undo_timer = setInterval(() => {
			elapsed += 100;
			if (elapsed >= 5000) {
				clearInterval(self._undo_timer);
				self._undo_timer = null;
				self._pending_on_timeout = null;
				$toast.removeClass("ib-cb-undo-toast--visible");
				if (on_timeout) on_timeout();
			}
		}, 100);

		$btn.off("click").on("click", () => {
			clearInterval(self._undo_timer);
			self._undo_timer = null;
			self._pending_on_timeout = null;
			$toast.removeClass("ib-cb-undo-toast--visible");
			if (on_undo) on_undo();
		});
	}

	_show_undo_toast(customer, assignment_id) {
		const self = this;
		this._show_timed_toast(
			`${customer} added to Today`,
			null,
			() => {
				frappe.call({
					method: "instabiz.overrides.customer_assignment.remove_assignment",
					args: { assignment_id },
					callback(r) {
						if (r.message && r.message.status === "ok") {
							frappe.show_alert({ message: `${customer} removed from Today`, indicator: "orange" });
							self.refresh();
						}
					},
				});
			}
		);
	}

	// ── Actions ───────────────────────────────────────────────────────────────

	_flush_pending() {
		if (this._undo_timer) {
			clearInterval(this._undo_timer);
			this._undo_timer = null;
		}
		if (this._pending_on_timeout) {
			const cb = this._pending_on_timeout;
			this._pending_on_timeout = null;
			$("#ib-cb-undo-toast").removeClass("ib-cb-undo-toast--visible");
			cb();
		}
	}

	_show_log_activity_dialog(customer, customer_name, assignment_id) {
		const self = this;
		const d = new frappe.ui.Dialog({
			title: `Log Activity — ${customer_name || customer}`,
			fields: [
				{
					fieldname: "activity_type",
					label: "Activity Type",
					fieldtype: "Select",
					options: "Call\nMeeting\nWhatsApp\nEmail\nVisit",
					reqd: 1,
				},
				{
					fieldname: "outcome",
					label: "Outcome",
					fieldtype: "Select",
					options: "Interested\nNot Interested\nFollow Up\nNo Response",
					reqd: 1,
				},
				{
					fieldname: "notes",
					label: "Notes",
					fieldtype: "Small Text",
					reqd: 1,
				},
			],
			primary_action_label: "Log",
			primary_action(values) {
				// Log comment on Customer timeline
				frappe.call({
					method: "instabiz.overrides.customer.log_customer_activity",
					args: {
						customer,
						activity_type: values.activity_type,
						outcome: values.outcome,
						notes: values.notes,
					},
					callback(r) {
						if (r.exc) return;
						d.hide();
						// If called from a Today assignment card, also mark it done
						if (assignment_id) {
							frappe.call({
								method: "instabiz.overrides.customer_assignment.mark_customer_contacted",
								args: {
									assignment_id,
									notes: values.notes,
									outcome: values.outcome,
								},
								callback(r2) {
									if (!r2.exc) {
										frappe.show_alert({ message: "Activity logged", indicator: "green" });
										self._flush_pending();
										self._highlight_customer = customer;
										self._highlight_color = IB_CB_COLOR_ACTIVITY;
										self.refresh();
									}
								},
							});
						} else {
							frappe.show_alert({ message: "Activity logged", indicator: "green" });
						}
					},
				});
			},
		});
		d.show();
	}

	_skip_with_undo(assignment_id, customer_name, $card) {
		const self = this;
		const customer_id = $card.data("customer");
		frappe.confirm(`Skip ${customer_name} for today?`, () => {
			// Optimistic: visually mark skipped
			$card.addClass("ib-cb-card--done ib-cb-card--outcome-skipped");
			$card.find(".ib-cb-skip-btn").remove();
			$card.find(".ib-cb-card-actions").remove();
			$card.find(".ib-cb-status").remove();
			const $top = $card.find(".ib-cb-card-top");
			if (!$top.find(".ib-cb-done-badge").length) {
				$top.find(".ib-cb-status").remove();
				$top.find(".ib-cb-card-name").after(`<span class="ib-cb-done-badge ib-cb-done-badge--skip">SKIP</span>`);
			}

			self._show_timed_toast(
				`${customer_name} skipped`,
				() => {
					frappe.call({
						method: "instabiz.overrides.customer_assignment.skip_assignment",
						args: { assignment_id },
						callback(r) {
							if (r.message && r.message.status === "ok") {
								self._highlight_customer = customer_id;
								self._highlight_color = IB_CB_COLOR_DANGER;
								self.refresh();
							} else {
								frappe.show_alert({ message: "Skip failed", indicator: "red" });
								self.refresh();
							}
						},
					});
				},
				() => {
					frappe.show_alert({ message: `${customer_name} restored`, indicator: "blue" });
					self.refresh();
				}
			);
		});
	}

	_flash_new_card(customer, color = IB_CB_COLOR_SUCCESS) {
		const self = this;
		const esc = customer.replace(/["\\]/g, "\\$&");
		const $card = $(`.ib-cb-card[data-customer="${esc}"]`).first();
		if (!$card.length) return;
		$card[0].scrollIntoView({ behavior: "smooth", block: "nearest" });
		const rgb = color === IB_CB_COLOR_DANGER ? IB_CB_COLOR_DANGER_RGB : IB_CB_COLOR_SUCCESS_RGB;
		self._gsap_ready.then(() => {
			gsap.fromTo($card[0],
				{ boxShadow: `0 0 0 2px ${color}, 0 0 18px rgba(${rgb},0.45)` },
				{ boxShadow: `0 0 0 0px ${color}, 0 0 0px rgba(${rgb},0)`, duration: 1.6, ease: "power3.out", clearProps: "boxShadow" }
			);
		});
	}

	// ── Customer Sharing ─────────────────────────────────────────────────────

	_show_share_dialog(customer, customer_name) {
		const self = this;

		frappe.call({
			method: "instabiz.overrides.customer_assignment.get_customer_shares",
			args: { customer },
			callback(r) {
				if (r.exc) return;
				const current_shares = r.message || [];

				frappe.call({
					method: "frappe.client.get_list",
					args: {
						doctype: "User",
						filters: [
							["Has Role", "role", "=", "Sales User"],
							["enabled", "=", 1],
							["name", "!=", frappe.session.user],
						],
						fields: ["name", "full_name"],
						limit: 200,
					},
					callback(r2) {
						if (r2.exc) return;
						const all_users = r2.message || [];
						const shared_with_set = new Set(current_shares.map((s) => s.shared_with));

						// Build current shares table HTML
						const shares_html = current_shares.length
							? `<div class="ib-share-current">
								<div class="ib-share-section-lbl">Currently shared with:</div>
								${current_shares.map((s) => `
									<div class="ib-share-row" data-user="${frappe.utils.escape_html(s.shared_with)}">
										<span class="ib-share-user">${frappe.utils.escape_html(s.shared_with_name || s.shared_with)}</span>
										<button class="ib-share-remove btn btn-xs btn-danger" data-user="${frappe.utils.escape_html(s.shared_with)}">Remove</button>
									</div>
								`).join("")}
							</div>`
							: `<div class="ib-share-empty">Not shared with anyone yet.</div>`;

						// Available users to share with (exclude already-shared + owner)
						const owner = frappe.session.user;
						const available = all_users.filter((u) => !shared_with_set.has(u.name) && u.name !== owner);

						const d = new frappe.ui.Dialog({
							title: `Share — ${customer_name}`,
							fields: [
								{
									fieldname: "current_shares_html",
									fieldtype: "HTML",
									options: shares_html,
								},
								{
									fieldname: "share_with_section",
									fieldtype: "Section Break",
									label: available.length ? "Add Share" : "",
								},
								...(available.length ? [{
									fieldname: "share_with",
									label: "Share With",
									fieldtype: "Select",
									options: available.map((u) => `${u.name}|${u.full_name || u.name}`).join("\n"),
									reqd: 0,
								}] : [{
									fieldname: "_no_users_html",
									fieldtype: "HTML",
									options: `<div class="text-muted">All available users already have access.</div>`,
								}]),
							],
							primary_action_label: available.length ? "Share" : "Close",
							primary_action(values) {
								if (!available.length) { d.hide(); return; }
								const target = (values.share_with || "").split("|")[0];
								if (!target) { frappe.show_alert({ message: "Select a user", indicator: "orange" }); return; }
								frappe.call({
									method: "instabiz.overrides.customer_assignment.share_customer",
									args: { customer, share_with: target },
									callback(res) {
										if (!res.exc) {
											const uname = available.find((u) => u.name === target);
											frappe.show_alert({ message: `Shared with ${uname ? uname.full_name : target}`, indicator: "green" });
											d.hide();
											self.refresh();
										}
									},
								});
							},
						});

						d.show();

						// Bind remove buttons in the current-shares section
						d.$wrapper.find(".ib-share-remove").on("click", function () {
							const target = $(this).data("user");
							const $row = $(this).closest(".ib-share-row");
							frappe.call({
								method: "instabiz.overrides.customer_assignment.unshare_customer",
								args: { customer, share_with: target },
								callback(res) {
									if (!res.exc) {
										$row.fadeOut(200, function () { $(this).remove(); });
										frappe.show_alert({ message: "Access removed", indicator: "orange" });
										self.refresh();
									}
								},
							});
						});
					},
				});
			},
		});
	}

}
