frappe.pages["ib-assignment-admin"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Assignment Admin",
		single_column: true,
	});
	wrapper.page_obj = new IBAssignmentAdmin(page, wrapper);
};

frappe.pages["ib-assignment-admin"].on_page_show = function (wrapper) {
	if (wrapper.page_obj) wrapper.page_obj.refresh();
};

class IBAssignmentAdmin {
	constructor(page, wrapper) {
		this.page = page;
		this.wrapper = wrapper;
		this.$main = $(wrapper).find(".page-content");
		this._date = frappe.datetime.get_today();
		this._territory = null;
		this._view_as_user = null;
		this._pool_type = "Dormant";
		this._selected_pool_customers = new Set();
		this._users_cache = [];
		this._pool_page = 0;
		this._pool_page_size = 50;
		this._pool_total = 0;
		this._pool_search = "";
		this._excluded_users = new Set(JSON.parse(localStorage.getItem("ib_aa_excluded_users") || "[]"));
		this._roster_search = "";
		this._init();
	}

	_avatar_color(_user, team) {
		// Same team → same color; no team → primary brand color
		if (!team) return "var(--ib-primary)";
		const palette = [
			"#2563eb","#7c3aed","#059669","#dc2626",
			"#d97706","#0891b2","#be185d","#4f46e5","#65a30d","#0f766e",
		];
		let h = 0;
		for (let i = 0; i < team.length; i++) h = (h * 31 + team.charCodeAt(i)) >>> 0;
		return palette[h % palette.length];
	}

	_init() {
		this._build_toolbar();
		this._build_layout();
		this._inject_styles();
		this.refresh();
	}

	// ── Toolbar ──────────────────────────────────────────────────────────────

	_build_toolbar() {
		const self = this;
		this.page.add_field({
			fieldname: "admin_date",
			fieldtype: "Date",
			label: "Date",
			default: frappe.datetime.get_today(),
			change() {
				self._date = this.get_value() || frappe.datetime.get_today();
				self._view_as_user = null;
				self.refresh();
			},
		});
		this.page.add_field({
			fieldname: "admin_territory",
			fieldtype: "Link",
			label: "Territory",
			options: "Territory",
			change() {
				self._territory = this.get_value() || null;
				self.refresh();
			},
		});
		this.page.add_inner_button("Config", () => self._show_config_modal());
		this.page.add_inner_button("Refresh", () => self.refresh());
	}

	// ── Layout ────────────────────────────────────────────────────────────────

	_build_layout() {
		this.$main.html(`
			<div class="ib-aa-root">

				<!-- ── Team Overview ── -->
				<section class="ib-aa-section">
					<div class="ib-aa-section-head">
						<span class="ib-aa-section-title">Team Overview</span>
						<input class="ib-aa-roster-search" id="ib-aa-roster-search" type="text" placeholder="Search users…">
						<span class="ib-aa-section-date" id="ib-aa-date-label"></span>
					</div>
					<div id="ib-aa-hidden-strip" style="display:none;" class="ib-aa-hidden-strip"></div>
					<div class="ib-aa-roster-grid" id="ib-aa-roster"></div>
				</section>

				<!-- ── View As Banner ── -->
				<div id="ib-aa-view-as-bar" class="ib-aa-view-as-bar" style="display:none;">
					<div class="ib-aa-view-as-inner">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
						<span id="ib-aa-view-as-label"></span>
					</div>
					<button class="ib-aa-exit-view-btn" id="ib-aa-exit-view">✕ Exit</button>
				</div>

				<!-- ── Board View (view-as) ── -->
				<div id="ib-aa-board-wrap"></div>

				<!-- ── Customer Pool ── -->
				<section class="ib-aa-section ib-aa-pool-section">

					<!-- Header row -->
					<div class="ib-aa-pool-topbar">
						<div class="ib-aa-section-title">Customer Pool</div>
						<div class="ib-aa-pool-tabs">
							<button class="ib-aa-tab active" data-type="Dormant" id="ib-aa-tab-dormant">Dormant</button>
							<button class="ib-aa-tab" data-type="Regular" id="ib-aa-tab-regular">Regular</button>
						</div>
						<input class="ib-aa-search" id="ib-aa-pool-search" type="text" placeholder="Search…">
					</div>

					<!-- Column headers -->
					<div class="ib-aa-pool-thead">
						<div style="width:20px;"></div>
						<div class="ib-aa-th" style="flex:1;">Customer</div>
						<div class="ib-aa-th" style="width:130px;">Territory</div>
						<div class="ib-aa-th" style="width:120px;">Last Order</div>
					</div>

					<div id="ib-aa-pool-list"></div>

				</section>

			</div>

			<!-- ── Sticky assign bar ── -->
			<div class="ib-aa-sticky-bar" id="ib-aa-assign-panel">
				<span class="ib-aa-sel-pill" id="ib-aa-sel-count">0 selected</span>
				<div class="ib-aa-assign-controls">
					<select class="ib-aa-select" id="ib-aa-assign-user">
						<option value="">Assign to user…</option>
					</select>
					<input type="date" class="ib-aa-date-input" id="ib-aa-assign-date" title="Assign date">
					<button class="ib-aa-assign-btn" id="ib-aa-confirm-assign" disabled>Assign</button>
					<button class="ib-aa-clear-btn" id="ib-aa-clear-sel">Clear</button>
				</div>
			</div>
		`);
		this._bind_events();
	}

	_bind_events() {
		const self = this;

		// Roster search
		let _rst;
		this.$main.on("input", "#ib-aa-roster-search", function () {
			clearTimeout(_rst);
			_rst = setTimeout(() => {
				self._roster_search = this.value.trim();
				self._refilter_roster();
			}, 150);
		});

		// Tab switch
		this.$main.on("click", ".ib-aa-tab", function () {
			self.$main.find(".ib-aa-tab").removeClass("active");
			$(this).addClass("active");
			self._pool_type = $(this).data("type");
			self._pool_search = "";
			self.$main.find("#ib-aa-pool-search").val("");
			self._selected_pool_customers.clear();
			self._update_assign_bar();
			self._load_pool(0);
		});

		// Search — reset to page 0, re-query server
		let _st;
		this.$main.on("input", "#ib-aa-pool-search", function () {
			clearTimeout(_st);
			_st = setTimeout(() => {
				self._pool_search = this.value.trim();
				self._load_pool(0);
			}, 300);
		});

		// Checkbox
		this.$main.on("change", ".ib-aa-pool-chk", function () {
			const c = $(this).val();
			const $row = $(this).closest(".ib-aa-pool-row");
			if ($(this).is(":checked")) {
				self._selected_pool_customers.add(c);
				$row.addClass("ib-aa-pool-row--checked");
			} else {
				self._selected_pool_customers.delete(c);
				$row.removeClass("ib-aa-pool-row--checked");
			}
			self._update_assign_bar();
		});

		// Select all via header checkbox
		this.$main.on("change", "#ib-aa-chk-all", function () {
			const checked = $(this).is(":checked");
			self.$main.find(".ib-aa-pool-chk").prop("checked", checked).each(function () {
				checked
					? self._selected_pool_customers.add($(this).val())
					: self._selected_pool_customers.delete($(this).val());
			});
			self._update_assign_bar();
		});

		this.$main.on("click", "#ib-aa-confirm-assign", () => self._do_assign());
		this.$main.on("change", "#ib-aa-assign-user, #ib-aa-assign-date", () => self._refresh_assign_btn());
		this.$main.on("click", "#ib-aa-clear-sel", () => {
			self._selected_pool_customers.clear();
			self.$main.find(".ib-aa-pool-chk, #ib-aa-chk-all").prop("checked", false);
			self._update_assign_bar();
		});
		this.$main.on("click", "#ib-aa-exit-view", () => {
			self._view_as_user = null;
			$("#ib-aa-view-as-bar").hide();
			$("#ib-aa-board-wrap").empty();
		});
	}

	// ── Data ─────────────────────────────────────────────────────────────────

	refresh() {
		const self = this;
		$("#ib-aa-date-label").text(frappe.datetime.str_to_user(this._date));
		frappe.call({
			method: "instabiz.overrides.customer_assignment.get_admin_overview",
			args: { date: this._date, territory: this._territory },
			callback(r) {
				if (r.message) self._render_roster(r.message.roster);
			},
		});
		this._load_pool();
		this._refresh_tab_counts();
		this._populate_user_dropdown();
	}

	_refresh_tab_counts() {
		const base = { territory: this._territory, date: this._date, limit: 1, offset: 0 };
		["Dormant", "Regular"].forEach(type => {
			frappe.call({
				method: "instabiz.overrides.customer_assignment.get_customer_pool",
				args: { ...base, pool_type: type, search: "" },
				callback(r) {
					if (!r.message) return;
					const total = r.message.total || 0;
					const $tab = $(`#ib-aa-tab-${type.toLowerCase()}`);
					const label = total > 0 ? `${type} <span class="ib-aa-tab-count">${total}</span>` : type;
					$tab.html(label);
				},
			});
		});
	}

	_load_pool(page = 0) {
		const self = this;
		this._pool_page = page;
		const offset = page * this._pool_page_size;
		$("#ib-aa-pool-list").html(`<div class="ib-aa-pool-loading">Loading…</div>`);

		frappe.call({
			method: "instabiz.overrides.customer_assignment.get_customer_pool",
			args: {
				territory: this._territory,
				pool_type: this._pool_type,
				date: this._date,
				limit: this._pool_page_size,
				offset,
				search: this._pool_search || "",
			},
			callback(r) {
				if (!r.message) return;
				const { rows, total } = r.message;
				self._pool_total = total || 0;
				self._render_pool(rows || []);
				self._render_pool_pagination();
			},
		});
	}

	_render_pool_pagination() {
		$("#ib-aa-pool-pager").remove();
		const total = this._pool_total || 0;
		const page  = this._pool_page;
		const size  = this._pool_page_size;
		const pages = Math.ceil(total / size);
		if (pages <= 1) return;

		const start = page * size + 1;
		const end   = Math.min((page + 1) * size, total);
		const self  = this;

		const $pager = $(`
			<div id="ib-aa-pool-pager" class="ib-aa-pool-pager">
				<span class="ib-aa-pager-info">${start}–${end} of ${total}</span>
				<div class="ib-aa-pager-btns">
					<button class="ib-aa-pager-btn" id="ib-aa-prev" ${page === 0 ? "disabled" : ""}>← Prev</button>
					<span class="ib-aa-pager-page">Page ${page + 1} of ${pages}</span>
					<button class="ib-aa-pager-btn" id="ib-aa-next" ${page >= pages - 1 ? "disabled" : ""}>Next →</button>
				</div>
			</div>
		`);
		$pager.find("#ib-aa-prev").on("click", () => { self._selected_pool_customers.clear(); self._load_pool(page - 1); });
		$pager.find("#ib-aa-next").on("click", () => { self._selected_pool_customers.clear(); self._load_pool(page + 1); });
		$("#ib-aa-pool-list").after($pager);
	}

	_populate_user_dropdown() {
		const self = this;
		frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "User",
				filters: [["Has Role", "role", "=", "Sales User"], ["enabled", "=", 1]],
				fields: ["name", "full_name"],
				limit: 100,
			},
			callback(r) {
				if (!r.message) return;
				self._users_cache = r.message;
				const $sel = $("#ib-aa-assign-user").empty().append('<option value="">Assign to…</option>');
				r.message.forEach((u) => {
					$sel.append(`<option value="${frappe.utils.escape_html(u.name)}">${frappe.utils.escape_html(u.full_name || u.name)}</option>`);
				});
			},
		});
	}

	// ── Roster ────────────────────────────────────────────────────────────────

	_save_excluded() {
		localStorage.setItem("ib_aa_excluded_users", JSON.stringify([...this._excluded_users]));
	}

	_refilter_roster() {
		if (this._last_roster) this._render_roster(this._last_roster);
	}

	_render_roster(roster) {
		this._last_roster = roster;
		const self = this;
		const $g = $("#ib-aa-roster").empty();
		if (!roster || !roster.length) {
			$g.html('<p class="ib-aa-empty">No sales users found</p>');
			return;
		}

		const tokens = this._roster_search.toLowerCase().split(/\s+/).filter(Boolean);
		const after_exclude = roster.filter(u => !self._excluded_users.has(u.user));
		const visible = tokens.length
			? after_exclude.filter(u => {
				const hay = `${u.full_name || ""} ${u.user} ${u.team || ""}`.toLowerCase();
				return tokens.every(t => hay.includes(t));
			})
			: after_exclude;
		const hidden_count = roster.length - after_exclude.length;

		// Update hidden strip
		const $strip = $("#ib-aa-hidden-strip");
		if (hidden_count > 0) {
			$strip.html(`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> ${hidden_count} user${hidden_count > 1 ? "s" : ""} hidden &mdash; <a href="#" class="ib-aa-show-all-link">Show all</a>`).show();
			$strip.find(".ib-aa-show-all-link").on("click", (e) => {
				e.preventDefault();
				self._excluded_users.clear();
				self._save_excluded();
				self._render_roster(roster);
			});
		} else {
			$strip.hide();
		}

		if (!visible.length) {
			if (tokens.length) {
				$g.html(`<p class="ib-aa-empty">No users match "<strong>${frappe.utils.escape_html(this._roster_search)}</strong>"</p>`);
			} else {
				$g.html('<p class="ib-aa-empty">All users hidden — <a href="#" class="ib-aa-show-all-link">show all</a></p>');
				$g.find(".ib-aa-show-all-link").on("click", (e) => {
					e.preventDefault();
					self._excluded_users.clear();
					self._save_excluded();
					self._render_roster(roster);
				});
			}
			return;
		}

		visible.forEach((u) => {
			const pct = u.completion_pct || 0;
			const initials = (u.full_name || u.user).split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
			const bar_color = pct >= 80 ? "#22c55e" : pct >= 40 ? "var(--ib-primary)" : "#94a3b8";
			const pct_cls   = pct >= 80 ? "good" : pct >= 40 ? "mid" : "low";
			const av_color = self._avatar_color(u.user, u.team);

			const is_today    = self._date === frappe.datetime.get_today();
			const no_tomorrow = is_today && (u.tomorrow_count || 0) === 0;

			const $card = $(`
				<div class="ib-aa-user-card ib-aa-user-card--${pct_cls}">
					<div class="ib-aa-card-top">
						<div class="ib-aa-user-avatar" style="background:${av_color};">${initials}</div>
						<div class="ib-aa-user-info">
							<div class="ib-aa-user-name">${frappe.utils.escape_html(u.full_name || u.user)}</div>
							${u.team ? `<div style="margin-top:4px;"><span class="ib-aa-team-chip" style="background:${av_color}18;color:${av_color};border-color:${av_color}40;">${frappe.utils.escape_html(u.team)}</span></div>` : ""}
						</div>
						<button class="ib-aa-btn-hide" title="Hide from overview"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg></button>
					</div>
					<div class="ib-aa-card-actions">
						${no_tomorrow ? `<span class="ib-aa-no-tmrw-badge" title="No customers queued for tomorrow">⚠ No tomorrow</span>` : ""}
						<button class="ib-aa-btn-view">View</button>
						<button class="ib-aa-btn-auto">Auto-fill</button>
					</div>
					<div class="ib-aa-card-stats">
						<div class="ib-aa-stat-chip ib-aa-stat-done">
							<span class="ib-aa-chip-val">${u.done}</span>
							<span class="ib-aa-chip-label">Done</span>
						</div>
						<div class="ib-aa-stat-chip ib-aa-stat-pending">
							<span class="ib-aa-chip-val">${u.pending}</span>
							<span class="ib-aa-chip-label">Pending</span>
						</div>
						<div class="ib-aa-stat-chip ib-aa-stat-tmrw">
							<span class="ib-aa-chip-val">${u.tomorrow_count}</span>
							<span class="ib-aa-chip-label">Tomorrow</span>
						</div>
					</div>
					<div class="ib-aa-prog-wrap">
						<div class="ib-aa-prog-header">
							<span class="ib-aa-prog-label">Completion</span>
							<span class="ib-aa-prog-pct ib-aa-pct--${pct_cls}">${pct}%</span>
						</div>
						<div class="ib-aa-prog-track">
							<div class="ib-aa-prog-fill" style="width:${pct}%;background:${bar_color};"></div>
						</div>
					</div>
				</div>
			`);

			$card.find(".ib-aa-btn-view").on("click", () => self._view_as(u.user, u.full_name));
			$card.find(".ib-aa-btn-auto").on("click", () => self._bulk_auto_assign(u.user, u.full_name));
			$card.find(".ib-aa-btn-hide").on("click", () => {
				self._excluded_users.add(u.user);
				self._save_excluded();
				self._render_roster(roster);
			});
			$g.append($card);
		});
	}

	// ── View As ──────────────────────────────────────────────────────────────

	_view_as(user, full_name) {
		this._view_as_user = user;
		this._va_undo_timer = null;
		$("#ib-aa-view-as-label").text(`Viewing board as ${full_name || user}`);
		$("#ib-aa-view-as-bar").show();
		this._reload_va_board();

		// Scroll to the board section smoothly
		setTimeout(() => {
			const el = document.getElementById("ib-aa-board-wrap");
			if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
		}, 100);
	}

	_reload_va_board() {
		const self = this;
		const user = this._view_as_user;
		if (!user) return;

		const $wrap = $("#ib-aa-board-wrap");
		$wrap.html(`<div class="ib-va-loading">Loading…</div>`);

		frappe.call({
			method: "instabiz.overrides.customer_assignment.get_admin_overview",
			args: { date: this._date, view_as_user: user },
			callback(r) {
				if (!r.message || !r.message.board) return;
				self._render_board_view(r.message.board);
			},
		});
	}

	_render_board_view(data) {
		const self = this;
		const user = this._view_as_user;
		const $wrap = $("#ib-aa-board-wrap");

		$wrap.html(`
			<div class="ib-va-board">
				<div class="ib-va-columns">
					<div class="ib-va-col">
						<div class="ib-va-col-header">
							<svg class="ib-va-col-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
							<span class="ib-va-col-title">Dormant</span>
							<span class="ib-va-badge" id="ib-va-dormant-count">0</span>
						</div>
						<div class="ib-va-cards" id="ib-va-dormant-cards"></div>
					</div>
					<div class="ib-va-col">
						<div class="ib-va-col-header">
							<svg class="ib-va-col-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
							<span class="ib-va-col-title">Regular</span>
							<span class="ib-va-badge" id="ib-va-regular-count">0</span>
						</div>
						<div class="ib-va-cards" id="ib-va-regular-cards"></div>
					</div>
					<div class="ib-va-col ib-va-col--today">
						<div class="ib-va-col-header">
							<svg class="ib-va-col-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
							<span class="ib-va-col-title">Today</span>
							<span class="ib-va-col-date">${frappe.datetime.str_to_user(data.date)}</span>
							<span class="ib-va-badge ib-va-badge--today" id="ib-va-today-count">0</span>
						</div>
						<div class="ib-va-cards" id="ib-va-today-cards"></div>
					</div>
					<div class="ib-va-col ib-va-col--tomorrow">
						<div class="ib-va-col-header">
							<svg class="ib-va-col-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><polyline points="8 6 12 2 16 6"/></svg>
							<span class="ib-va-col-title">Tomorrow</span>
							<span class="ib-va-col-date">${frappe.datetime.str_to_user(data.tomorrow_date)}</span>
							<span class="ib-va-badge ib-va-badge--tmrw" id="ib-va-tomorrow-count">0</span>
						</div>
						<div class="ib-va-cards" id="ib-va-tomorrow-cards"></div>
					</div>
				</div>
				<div id="ib-va-undo-toast" class="ib-va-undo-toast" style="display:none;">
					<div class="ib-va-undo-row">
						<span id="ib-va-undo-msg"></span>
						<button id="ib-va-undo-btn" class="ib-va-undo-btn">Undo</button>
					</div>
					<div class="ib-va-undo-bar"><div id="ib-va-undo-fill" class="ib-va-undo-fill"></div></div>
				</div>
			</div>
		`);

		// Dormant pool
		const dormant = data.dormant || [];
		$("#ib-va-dormant-count").text(dormant.length);
		if (dormant.length) {
			dormant.forEach(r => $("#ib-va-dormant-cards").append(self._va_pool_card(r, user)));
		} else {
			$("#ib-va-dormant-cards").html('<div class="ib-va-empty">Empty</div>');
		}

		// Regular pool
		const regular = data.regular || [];
		$("#ib-va-regular-count").text(regular.length);
		if (regular.length) {
			regular.forEach(r => $("#ib-va-regular-cards").append(self._va_pool_card(r, user)));
		} else {
			$("#ib-va-regular-cards").html('<div class="ib-va-empty">Empty</div>');
		}

		// Today
		const today_rows = data.today || [];
		$("#ib-va-today-count").text(today_rows.length);
		if (today_rows.length) {
			today_rows.forEach(r => $("#ib-va-today-cards").append(self._va_today_card(r)));
		} else {
			$("#ib-va-today-cards").html('<div class="ib-va-empty">No assignments</div>');
		}

		// Tomorrow
		const tmrw = data.tomorrow || [];
		$("#ib-va-tomorrow-count").text(tmrw.length);
		if (tmrw.length) {
			tmrw.forEach(r => {
				const last = r.last_so_date ? frappe.datetime.str_to_user(r.last_so_date) : "No orders";
				$("#ib-va-tomorrow-cards").append(`
					<div class="ib-va-card ib-va-card--tmrw">
						<div class="ib-va-card-name">${frappe.utils.escape_html(r.customer_name || r.customer)}</div>
						<div class="ib-va-card-meta">${frappe.utils.escape_html(r.territory || "")}</div>
						<div class="ib-va-card-last">${last}</div>
					</div>
				`);
			});
		} else {
			$("#ib-va-tomorrow-cards").html('<div class="ib-va-empty">Scheduler runs at midnight</div>');
		}
	}

	_va_pool_card(r, target_user) {
		const self = this;
		const last = r.last_so_date ? frappe.datetime.str_to_user(r.last_so_date) : "No orders";
		const $card = $(`
			<div class="ib-va-card ib-va-card--pool">
				<div class="ib-va-card-name">${frappe.utils.escape_html(r.customer_name || r.customer)}</div>
				<div class="ib-va-card-code">${frappe.utils.escape_html(r.customer)}</div>
				<div class="ib-va-card-meta">${frappe.utils.escape_html(r.territory || "")}</div>
				<div class="ib-va-card-last">${last}</div>
				<button class="ib-va-add-btn" data-customer="${frappe.utils.escape_html(r.customer)}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add to Today</button>
			</div>
		`);
		$card.find(".ib-va-add-btn").on("click", function () {
			const customer = $(this).data("customer");
			const $btn = $(this);
			$btn.prop("disabled", true).text("Adding…");
			frappe.call({
				method: "instabiz.overrides.customer_assignment.add_customer_to_today",
				args: { customer, date: self._date, target_user },
				callback(r) {
					if (r.message && r.message.status === "ok") {
						self._va_show_undo(customer, r.message.assignment);
						self._reload_va_board();
					} else {
						$btn.prop("disabled", false).text("+ Add to Today");
					}
				},
				error() { $btn.prop("disabled", false).text("+ Add to Today"); },
			});
		});
		return $card;
	}

	_va_today_card(r) {
		const self = this;
		const is_pending = r.status === "Pending";
		const status_cls = {
			"Pending": "pending", "Contacted": "contacted",
			"Order Placed": "ordered", "Skipped": "skipped",
		}[r.status] || "";
		const last = r.last_so_date ? frappe.datetime.str_to_user(r.last_so_date) : "No orders";

		const $card = $(`
			<div class="ib-va-card ib-va-card--today ${!is_pending ? "ib-va-card--done" : ""}">
				<div class="ib-va-card-top">
					<div class="ib-va-card-name">${frappe.utils.escape_html(r.customer_name || r.customer)}</div>
					<span class="ib-va-status ib-va-status--${status_cls}">${r.status}</span>
				</div>
				<div class="ib-va-card-meta">${frappe.utils.escape_html(r.territory || "")}</div>
				<div class="ib-va-card-last">${last}</div>
				${is_pending ? `<button class="ib-va-remove-btn" data-id="${frappe.utils.escape_html(r.name)}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Remove</button>` : ""}
			</div>
		`);

		if (is_pending) {
			$card.find(".ib-va-remove-btn").on("click", function () {
				const id = $(this).data("id");
				frappe.call({
					method: "instabiz.overrides.customer_assignment.remove_assignment",
					args: { assignment_id: id, force: 1 },
					callback(res) {
						if (res.message && res.message.status === "ok") {
							frappe.show_alert({ message: "Assignment removed", indicator: "orange" });
							self._reload_va_board();
						}
					},
				});
			});
		}
		return $card;
	}

	_va_show_undo(customer, assignment_id) {
		const self = this;
		if (this._va_undo_timer) {
			clearInterval(this._va_undo_timer);
			this._va_undo_timer = null;
		}
		const $toast = $("#ib-va-undo-toast");
		const $fill  = $("#ib-va-undo-fill");
		const $btn   = $("#ib-va-undo-btn");

		$("#ib-va-undo-msg").text(`${customer} added to Today`);
		$fill.css({ transition: "none", width: "100%" });
		$toast.show();

		requestAnimationFrame(() => {
			$fill.css({ transition: "width 5s linear", width: "0%" });
		});

		let elapsed = 0;
		this._va_undo_timer = setInterval(() => {
			elapsed += 100;
			if (elapsed >= 5000) {
				clearInterval(self._va_undo_timer);
				self._va_undo_timer = null;
				$toast.hide();
			}
		}, 100);

		$btn.off("click").on("click", () => {
			clearInterval(self._va_undo_timer);
			self._va_undo_timer = null;
			$toast.hide();
			frappe.call({
				method: "instabiz.overrides.customer_assignment.remove_assignment",
				args: { assignment_id, force: 1 },
				callback(r) {
					if (r.message && r.message.status === "ok") {
						frappe.show_alert({ message: `${customer} removed from Today`, indicator: "orange" });
						self._reload_va_board();
					}
				},
			});
		});
	}

	_bulk_auto_assign(user, full_name) {
		frappe.call({
			method: "instabiz.overrides.customer_assignment.bulk_auto_assign",
			args: { user, date: this._date },
			callback: (r) => {
				if (r.message != null) {
					frappe.show_alert({
						message: `${r.message.created} customers assigned to ${full_name || user}`,
						indicator: r.message.created > 0 ? "green" : "orange",
					});
					this.refresh();
				}
			},
		});
	}

	// ── Pool ─────────────────────────────────────────────────────────────────

	_age_chip(last_so_date) {
		if (!last_so_date) return `<span class="ib-aa-age-chip ib-aa-age--never">No orders</span>`;
		const days = Math.floor((new Date() - new Date(last_so_date)) / 86400000);
		if (days > 90) return `<span class="ib-aa-age-chip ib-aa-age--old">${days}d ago</span>`;
		if (days > 30) return `<span class="ib-aa-age-chip ib-aa-age--mid">${days}d ago</span>`;
		return `<span class="ib-aa-age-chip ib-aa-age--recent">${frappe.datetime.str_to_user(last_so_date)}</span>`;
	}

	_render_pool(rows) {
		const $list = $("#ib-aa-pool-list").empty();

		if (!rows.length) {
			$list.html('<p class="ib-aa-empty">No customers in this pool</p>');
			return;
		}

		rows.forEach((r) => {
			const checked = this._selected_pool_customers.has(r.customer);
			const display_name = frappe.utils.escape_html(r.customer_name || r.customer);
			const code = frappe.utils.escape_html(r.customer);
			$list.append(`
				<label class="ib-aa-pool-row ${checked ? "ib-aa-pool-row--checked" : ""}" data-name="${code}">
					<input type="checkbox" class="ib-aa-pool-chk" value="${code}" ${checked ? "checked" : ""}>
					<span class="ib-aa-pool-cust">
						<span class="ib-aa-pool-cust-name">${display_name}</span>
						<span class="ib-aa-pool-cust-code">${code}</span>
					</span>
					<span class="ib-aa-pool-terr">${frappe.utils.escape_html(r.territory || "—")}</span>
					<span class="ib-aa-pool-last">${this._age_chip(r.last_so_date)}</span>
				</label>
			`);
		});
	}

	_update_assign_bar() {
		const count = this._selected_pool_customers.size;
		const has_sel = count > 0;

		$("#ib-aa-sel-count").text(`${count} customer${count > 1 ? "s" : ""} selected`);
		$("#ib-aa-assign-panel").toggleClass("ib-aa-sticky-bar--active", has_sel);

		if (has_sel && !$("#ib-aa-assign-date").val()) {
			$("#ib-aa-assign-date").val(frappe.datetime.add_days(this._date, 1));
		}

		this._refresh_assign_btn();
	}

	_refresh_assign_btn() {
		const ok = this._selected_pool_customers.size > 0
			&& !!$("#ib-aa-assign-user").val()
			&& !!$("#ib-aa-assign-date").val();
		$("#ib-aa-confirm-assign").prop("disabled", !ok);
	}

	_do_assign() {
		const self = this;
		const user = $("#ib-aa-assign-user").val();
		const date = $("#ib-aa-assign-date").val();
		if (!user) { frappe.msgprint("Select a user first."); return; }
		if (!date) { frappe.msgprint("Select a date."); return; }

		const customers = [...this._selected_pool_customers];
		let idx = 0, errors = 0;

		const $btn = $("#ib-aa-confirm-assign").prop("disabled", true).text("Assigning…");

		const next = () => {
			if (idx >= customers.length) {
				$btn.prop("disabled", false).text("Assign");
				frappe.show_alert({
					message: `${customers.length - errors} assigned${errors ? `, ${errors} skipped` : ""}`,
					indicator: errors ? "orange" : "green",
				});
				self._selected_pool_customers.clear();
				self.$main.find(".ib-aa-pool-chk").prop("checked", false);
				self._update_assign_bar();
				self.refresh();
				return;
			}
			frappe.call({
				method: "instabiz.overrides.customer_assignment.add_customer_to_today",
				args: { customer: customers[idx], date, target_user: user },
				callback(r) {
					if (r.exc) errors++;
					idx++;
					next();
				},
			});
		};
		next();
	}

	// ── Config modal ──────────────────────────────────────────────────────────

	_show_config_modal() {
		frappe.call({
			method: "instabiz.overrides.customer_assignment.get_assignment_config",
			callback(r) {
				if (!r.message) return;
				const cfg = r.message;
				const d = new frappe.ui.Dialog({
					title: "Assignment Config",
					fields: [
						{ fieldname: "assignments_per_day", fieldtype: "Int", label: "Assignments Per Day", default: cfg.assignments_per_day, reqd: 1 },
						{ fieldname: "dormant_threshold_days", fieldtype: "Int", label: "Dormant Threshold (Days)", default: cfg.dormant_threshold_days, reqd: 1 },
						{ fieldname: "dormant_ratio", fieldtype: "Percent", label: "Dormant Mix Ratio (%)", default: cfg.dormant_ratio, reqd: 1 },
					],
					primary_action_label: "Save",
					primary_action(values) {
						frappe.call({
							method: "instabiz.overrides.customer_assignment.save_assignment_config",
							args: values,
							callback(r) {
								if (r.message && r.message.status === "ok") {
									d.hide();
									frappe.show_alert({ message: "Config saved", indicator: "green" });
								}
							},
						});
					},
				});
				d.show();
			},
		});
	}

	// ── Styles ────────────────────────────────────────────────────────────────

	_inject_styles() {
		if (document.getElementById("ib-aa-styles")) return;
		const s = document.createElement("style");
		s.id = "ib-aa-styles";
		s.textContent = `
			.ib-aa-root { display: flex; flex-direction: column; gap: 24px; padding: 20px 0 60px; }

			/* ── Section shell ── */
			.ib-aa-section {
				background: var(--card-bg);
				border: 1px solid var(--border-color);
				border-radius: 10px;
				overflow: hidden;
				box-shadow: 0 1px 4px rgba(0,0,0,0.05);
			}
			.ib-aa-section-head {
				display: flex; align-items: center; gap: 10px;
				padding: 14px 20px;
				border-bottom: 1px solid var(--border-color);
				background: var(--subtle-bg);
			}
			.ib-aa-section-title { font-weight: 700; font-size: 13px; flex: 1; letter-spacing: 0.1px; }
			.ib-aa-roster-search {
				padding: 5px 10px; border: 1px solid var(--border-color);
				border-radius: 6px; font-size: 12px;
				background: var(--card-bg); color: var(--text-color);
				width: 180px; transition: border-color 0.15s;
			}
			.ib-aa-roster-search:focus { outline: none; border-color: var(--ib-primary); box-shadow: 0 0 0 2px rgba(217,119,87,0.12); }
			.ib-aa-section-date {
				font-size: 11px; font-weight: 600;
				background: var(--ib-primary); color: #fff;
				padding: 2px 10px; border-radius: 20px;
			}
			.ib-aa-hidden-strip {
				display: flex; align-items: center; gap: 6px;
				padding: 7px 20px;
				font-size: 12px; color: var(--text-muted);
				background: var(--subtle-bg);
				border-bottom: 1px solid var(--border-color);
			}
			.ib-aa-show-all-link {
				color: var(--ib-primary); text-decoration: none; font-weight: 600;
			}
			.ib-aa-show-all-link:hover { text-decoration: underline; }
			.ib-aa-empty { color: var(--text-muted); font-size: 13px; padding: 32px; margin: 0; text-align: center; }

			/* ── Roster grid ── */
			.ib-aa-roster-grid {
				display: grid;
				grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
				gap: 0;
			}

			/* ── User card ── */
			.ib-aa-user-card {
				display: flex; flex-direction: column; gap: 14px;
				padding: 18px 20px;
				border-right: 1px solid var(--border-color);
				border-bottom: 1px solid var(--border-color);
				transition: background 0.15s;
				border-left: 3px solid transparent;
			}
			.ib-aa-user-card--good { border-left-color: #22c55e; }
			.ib-aa-user-card--mid  { border-left-color: var(--ib-primary); }
			.ib-aa-user-card--low  { border-left-color: #cbd5e1; }
			.ib-aa-user-card:hover { background: var(--subtle-bg); }

			.ib-aa-no-tmrw-badge {
				display: inline-flex; align-items: center; gap: 3px;
				background: #fef3c7; color: #92400e;
				border: 1px solid #fde68a;
				border-radius: 4px; padding: 2px 7px;
				font-size: 10px; font-weight: 700; white-space: nowrap;
				flex-shrink: 0;
			}

			.ib-aa-card-top { display: flex; align-items: center; gap: 12px; }

			.ib-aa-user-avatar {
				width: 42px; height: 42px; border-radius: 50%;
				color: #fff; font-size: 14px; font-weight: 700;
				display: flex; align-items: center; justify-content: center;
				flex-shrink: 0; letter-spacing: 0.5px;
			}

			.ib-aa-user-info { flex: 1; min-width: 0; }
			.ib-aa-team-chip {
				display: inline-block;
				padding: 2px 9px; border-radius: 20px; border: 1px solid;
				font-size: 10px; font-weight: 600; white-space: nowrap; letter-spacing: 0.2px;
			}
			.ib-aa-user-name {
				font-weight: 700; font-size: 13.5px;
				white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 3px;
			}
			.ib-aa-user-meta { font-size: 11px; color: var(--text-muted); }

			.ib-aa-card-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
			.ib-aa-btn-view {
				padding: 5px 12px; border-radius: 5px;
				border: 1px solid #93c5fd; background: #eff6ff;
				font-size: 11px; font-weight: 600; cursor: pointer; color: #1d4ed8;
				transition: all 0.15s; white-space: nowrap;
			}
			.ib-aa-btn-view:hover { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
			.ib-aa-btn-auto {
				padding: 5px 12px; border-radius: 5px;
				border: 1px solid var(--ib-primary); background: #fdf6f3;
				font-size: 11px; font-weight: 600; cursor: pointer; color: var(--ib-primary);
				transition: all 0.15s; white-space: nowrap;
			}
			.ib-aa-btn-auto:hover { background: var(--ib-primary); color: #fff; }
			.ib-aa-btn-hide {
				width: 24px; height: 24px; border-radius: 50%;
				border: 1px solid var(--border-color); background: transparent;
				font-size: 12px; line-height: 1; cursor: pointer; color: var(--text-muted);
				transition: all 0.15s; flex-shrink: 0;
				display: flex; align-items: center; justify-content: center;
				padding: 0; margin-left: 4px;
			}
			.ib-aa-btn-hide:hover { border-color: #94a3b8; color: #475569; background: var(--subtle-bg); }

			/* ── Stats chips + progress ── */
			.ib-aa-card-stats { display: flex; align-items: center; gap: 8px; }
			.ib-aa-prog-wrap { display: flex; flex-direction: column; gap: 5px; }
			.ib-aa-prog-header { display: flex; align-items: center; justify-content: space-between; }
			.ib-aa-prog-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); font-weight: 600; }
			.ib-aa-prog-track { height: 7px; background: var(--border-color); border-radius: 4px; overflow: hidden; }
			.ib-aa-prog-fill  { height: 100%; border-radius: 4px; transition: width 0.6s cubic-bezier(0.4,0,0.2,1); }
			.ib-aa-prog-pct   { font-size: 12px; font-weight: 700; }
			.ib-aa-pct--good  { color: #16a34a; }
			.ib-aa-pct--mid   { color: var(--ib-primary); }
			.ib-aa-pct--low   { color: #94a3b8; }
			.ib-aa-stat-chip {
				display: flex; flex-direction: column; align-items: center;
				padding: 6px 12px; border-radius: 7px; min-width: 56px;
				border: 1px solid;
			}
			.ib-aa-stat-done    { background: #f0fdf4; border-color: #bbf7d0; }
			.ib-aa-stat-pending { background: #fffbeb; border-color: #fde68a; }
			.ib-aa-stat-tmrw    { background: #eff6ff; border-color: #bfdbfe; }
			.ib-aa-stat-done    .ib-aa-chip-val { color: #15803d; }
			.ib-aa-stat-pending .ib-aa-chip-val { color: #b45309; }
			.ib-aa-stat-tmrw    .ib-aa-chip-val { color: #1d4ed8; }
			.ib-aa-chip-val   { font-size: 20px; font-weight: 800; line-height: 1; }
			.ib-aa-chip-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-top: 3px; }


			/* ── View as banner ── */
			.ib-aa-view-as-bar {
				display: flex; align-items: center; justify-content: space-between;
				padding: 12px 20px;
				background: linear-gradient(135deg, #fefce8 0%, #fef9c3 100%);
				border: 1px solid #fde047; border-radius: 10px;
				font-size: 13px; font-weight: 600; color: #713f12;
				box-shadow: 0 1px 4px rgba(0,0,0,0.06);
			}
			.ib-aa-view-as-inner { display: flex; align-items: center; gap: 8px; }
			.ib-aa-exit-view-btn {
				padding: 6px 16px; border-radius: 6px;
				border: 1px solid #fcd34d; background: #fff;
				font-size: 12px; font-weight: 700; cursor: pointer; color: #92400e;
				transition: all 0.15s;
			}
			.ib-aa-exit-view-btn:hover { background: #fcd34d; border-color: #fcd34d; }

			/* ── Pool section ── */
			.ib-aa-pool-section { position: relative; }
			.ib-aa-pool-topbar {
				display: flex; align-items: center; gap: 10px;
				padding: 12px 20px;
				border-bottom: 1px solid var(--border-color);
				background: var(--subtle-bg);
			}
			.ib-aa-pool-tabs { display: flex; gap: 4px; }
			.ib-aa-tab {
				padding: 5px 16px; border-radius: 6px;
				border: 1px solid var(--border-color);
				background: var(--card-bg);
				font-size: 12px; font-weight: 600; cursor: pointer;
				color: var(--text-muted); transition: all 0.15s;
			}
			.ib-aa-tab.active { background: var(--ib-primary); border-color: var(--ib-primary); color: #fff; }
			.ib-aa-tab:hover:not(.active) { border-color: var(--text-muted); color: var(--text-color); }
			.ib-aa-tab-count {
				display: inline-block; margin-left: 5px;
				background: rgba(255,255,255,0.25); color: inherit;
				border-radius: 10px; padding: 0 7px;
				font-size: 11px; font-weight: 700;
			}
			.ib-aa-tab:not(.active) .ib-aa-tab-count {
				background: var(--subtle-bg); color: var(--text-muted);
			}
			/* ── Age chips ── */
			.ib-aa-age-chip {
				display: inline-block; padding: 2px 8px; border-radius: 20px;
				font-size: 11px; font-weight: 600; white-space: nowrap;
			}
			.ib-aa-age--never  { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
			.ib-aa-age--old    { background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; }
			.ib-aa-age--mid    { background: #fefce8; color: #a16207; border: 1px solid #fde68a; }
			.ib-aa-age--recent { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
			.ib-aa-search {
				margin-left: auto; padding: 6px 12px;
				border: 1px solid var(--border-color); border-radius: 6px;
				font-size: 12px; background: var(--card-bg); color: var(--text-color);
				width: 220px; transition: border-color 0.15s;
			}
			.ib-aa-search:focus { outline: none; border-color: var(--ib-primary); box-shadow: 0 0 0 2px rgba(217,119,87,0.12); }

			/* ── Sticky assign bar ── */
			.ib-aa-sticky-bar {
				position: fixed; bottom: 0; left: 0; right: 0; z-index: 1000;
				display: flex; align-items: center; gap: 14px;
				padding: 14px 32px;
				background: var(--card-bg);
				border-top: 2px solid var(--ib-primary);
				box-shadow: 0 -4px 24px rgba(0,0,0,0.12);
				transform: translateY(100%);
				transition: transform 0.25s cubic-bezier(0.4,0,0.2,1);
			}
			.ib-aa-sticky-bar--active { transform: translateY(0); }
			.ib-aa-assign-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex: 1; }
			.ib-aa-sel-pill {
				background: var(--ib-primary); color: #fff;
				border-radius: 20px; padding: 5px 16px;
				font-size: 12px; font-weight: 700; white-space: nowrap; flex-shrink: 0;
			}
			.ib-aa-select, .ib-aa-date-input {
				padding: 7px 10px; border: 1px solid var(--border-color);
				border-radius: 6px; font-size: 12px;
				background: var(--card-bg); color: var(--text-color);
				transition: border-color 0.15s;
			}
			.ib-aa-select:focus, .ib-aa-date-input:focus { outline: none; border-color: var(--ib-primary); }
			.ib-aa-select { min-width: 200px; }
			.ib-aa-assign-btn {
				padding: 8px 24px; border-radius: 6px;
				background: var(--ib-primary); color: #fff;
				border: none; font-size: 13px; font-weight: 700; cursor: pointer;
				transition: all 0.15s;
			}
			.ib-aa-assign-btn:hover:not(:disabled) { background: var(--ib-primary-dark, #b45e3e); transform: translateY(-1px); box-shadow: 0 2px 8px rgba(217,119,87,0.3); }
			.ib-aa-assign-btn:disabled { opacity: 0.35; cursor: not-allowed; }
			.ib-aa-clear-btn {
				padding: 8px 14px; border-radius: 6px;
				background: transparent; color: var(--text-muted);
				border: 1px solid var(--border-color); font-size: 12px; cursor: pointer;
				transition: all 0.15s;
			}
			.ib-aa-clear-btn:hover { border-color: var(--text-muted); color: var(--text-color); }

			/* ── Pool table ── */
			.ib-aa-pool-thead {
				display: flex; align-items: center; gap: 12px;
				padding: 8px 20px;
				background: var(--subtle-bg);
				border-bottom: 1px solid var(--border-color);
			}
			.ib-aa-th { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: var(--text-muted); }

			.ib-aa-pool-row {
				display: flex; align-items: center; gap: 12px;
				padding: 10px 20px;
				border-bottom: 1px solid var(--border-color);
				cursor: pointer; margin: 0; transition: background 0.1s;
				border-left: 3px solid transparent;
			}
			.ib-aa-pool-row:hover { background: var(--subtle-bg); }
			.ib-aa-pool-row:last-child { border-bottom: none; }
			.ib-aa-pool-row--checked {
				background: #fdf6f3 !important;
				border-left-color: var(--ib-primary);
			}
			.ib-aa-pool-chk { width: 15px; height: 15px; cursor: pointer; accent-color: var(--ib-primary); flex-shrink: 0; }
			.ib-aa-pool-cust { flex: 1; display: flex; flex-direction: column; gap: 2px; }
			.ib-aa-pool-cust-name { font-weight: 600; font-size: 13px; color: var(--text-color); }
			.ib-aa-pool-cust-code { font-size: 10px; color: var(--text-muted); font-family: monospace; }
			.ib-aa-pool-terr { width: 140px; font-size: 12px; color: var(--text-muted); }
			.ib-aa-pool-last { width: 120px; font-size: 12px; color: var(--text-muted); }

			/* ── Pool loading / pagination ── */
			.ib-aa-pool-loading { padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px; }
			.ib-aa-pool-pager {
				display: flex; align-items: center; justify-content: space-between;
				padding: 10px 20px;
				border-top: 1px solid var(--border-color);
				background: var(--subtle-bg);
			}
			.ib-aa-pager-info { font-size: 12px; color: var(--text-muted); }
			.ib-aa-pager-btns { display: flex; align-items: center; gap: 10px; }
			.ib-aa-pager-page { font-size: 12px; color: var(--text-muted); }
			.ib-aa-pager-btn {
				padding: 5px 14px; border-radius: 6px;
				border: 1px solid var(--border-color);
				background: var(--card-bg); color: var(--text-color);
				font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.15s;
			}
			.ib-aa-pager-btn:hover:not(:disabled) { border-color: var(--ib-primary); color: var(--ib-primary); }
			.ib-aa-pager-btn:disabled { opacity: 0.4; cursor: not-allowed; }

			/* ── View-as kanban ── */
			.ib-va-loading { padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px; }
			.ib-va-board { padding: 4px 0 20px; }
			.ib-va-columns {
				display: grid; grid-template-columns: repeat(4, 1fr);
				gap: 14px; align-items: start;
			}
			.ib-va-col {
				background: var(--card-bg);
				border: 1px solid var(--border-color); border-radius: 8px;
				overflow: hidden; display: flex; flex-direction: column;
				max-height: 520px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);
			}
			.ib-va-col-header {
				display: flex; align-items: center; gap: 8px;
				padding: 10px 14px;
				border-bottom: 1px solid var(--border-color);
				background: var(--subtle-bg); flex-shrink: 0;
			}
			.ib-va-col--today    .ib-va-col-header { border-bottom: 2px solid var(--ib-primary); }
			.ib-va-col--tomorrow .ib-va-col-header { border-bottom: 2px solid #60a5fa; }
			.ib-va-col-icon { opacity: 0.55; flex-shrink: 0; }
			.ib-va-col-title { font-weight: 600; font-size: 13px; flex: 1; }
			.ib-va-col-date { font-size: 10px; color: var(--text-muted); }
			.ib-va-badge {
				background: var(--ib-primary); color: #fff;
				border-radius: 10px; padding: 1px 8px;
				font-size: 11px; font-weight: 600;
			}
			.ib-va-badge--today { background: var(--ib-primary); }
			.ib-va-badge--tmrw  { background: #3b82f6; }
			.ib-va-cards {
				padding: 10px; display: flex; flex-direction: column; gap: 8px;
				overflow-y: auto; flex: 1;
			}
			.ib-va-card {
				background: var(--fg-color, #fff);
				border: 1px solid var(--border-color); border-radius: 6px;
				padding: 10px 12px; font-size: 12px; flex-shrink: 0;
			}
			.ib-va-card--pool  { border-left: 3px solid var(--border-color); }
			.ib-va-card--today { border-left: 3px solid var(--ib-primary); }
			.ib-va-card--tmrw  { border-left: 3px solid #60a5fa; opacity: 0.85; }
			.ib-va-card--done  { opacity: 0.5; }
			.ib-va-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }
			.ib-va-card-name { font-weight: 600; font-size: 12.5px; line-height: 1.3; }
			.ib-va-card-code { font-size: 10px; color: var(--text-muted); font-family: monospace; margin-top: 1px; }
			.ib-va-card-meta { font-size: 11px; color: var(--text-muted); margin-top: 3px; }
			.ib-va-card-last { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
			.ib-va-status {
				font-size: 10px; font-weight: 700; border-radius: 4px;
				padding: 2px 6px; text-transform: uppercase; white-space: nowrap;
			}
			.ib-va-status--pending   { background: #fef3c7; color: #92400e; }
			.ib-va-status--contacted { background: #d1fae5; color: #065f46; }
			.ib-va-status--ordered   { background: #dbeafe; color: #1e40af; }
			.ib-va-status--skipped   { background: #f3f4f6; color: #6b7280; }
			.ib-va-add-btn {
				margin-top: 8px; width: 100%; padding: 5px 0; border-radius: 5px;
				border: 1px solid var(--ib-primary); background: #fdf6f3; color: var(--ib-primary);
				font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.15s;
				display: inline-flex; align-items: center; justify-content: center; gap: 4px;
			}
			.ib-va-add-btn:hover { background: var(--ib-primary); color: #fff; }
			.ib-va-add-btn:disabled { opacity: 0.5; cursor: not-allowed; }
			.ib-va-remove-btn {
				margin-top: 8px; width: 100%; padding: 5px 0; border-radius: 5px;
				border: 1px solid #fca5a5; background: #fff1f2; color: #b91c1c;
				font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.15s;
				display: inline-flex; align-items: center; justify-content: center; gap: 4px;
			}
			.ib-va-remove-btn:hover { background: #b91c1c; color: #fff; border-color: #b91c1c; }
			.ib-va-empty { color: var(--text-muted); font-size: 12px; padding: 16px; text-align: center; }

			/* view-as undo toast */
			.ib-va-undo-toast {
				position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
				background: var(--card-bg); border: 1px solid var(--border-color);
				border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.12);
				padding: 12px 16px 0; min-width: 300px; max-width: 420px;
				z-index: 9999; overflow: hidden;
			}
			.ib-va-undo-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 10px; font-size: 13px; font-weight: 500; }
			.ib-va-undo-btn {
				padding: 4px 14px; border-radius: 5px;
				background: var(--ib-primary); color: #fff;
				border: none; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap;
			}
			.ib-va-undo-bar  { height: 3px; background: var(--border-color); margin: 0 -16px; }
			.ib-va-undo-fill { height: 100%; background: var(--ib-primary); }

			@media (max-width: 900px) {
				.ib-va-columns { grid-template-columns: repeat(2, 1fr); }
				.ib-aa-roster-grid { grid-template-columns: 1fr; }
				.ib-aa-pool-terr, .ib-aa-pool-last { display: none; }
			}
		`;
		document.head.appendChild(s);
	}
}
