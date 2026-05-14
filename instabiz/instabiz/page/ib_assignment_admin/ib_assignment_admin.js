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
		this._dropdown_users_cache = [];
		this._pool_page = 0;
		this._pool_page_size = 50;
		this._pool_total = 0;
		this._pool_search = "";
		this._excluded_users = new Set(JSON.parse(localStorage.getItem("ib_aa_excluded_users") || "[]"));
		this._collapsed_teams = new Set(JSON.parse(localStorage.getItem("ib_aa_collapsed_teams") || "[]"));
		this._roster_search = "";
		this._init();
	}

	_next_working_day(dateStr) {
		const d = new Date(dateStr + "T00:00:00");
		do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0);
		return d.toISOString().split("T")[0];
	}

	_terr_abbr(name) {
		const words = name.split(/\s+/).filter(w => w !== "&" && w !== "and");
		if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
		return words.map(w => w[0]).join("").slice(0, 3).toUpperCase();
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
		this._init_kebab();
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
					<div class="ib-aa-roster" id="ib-aa-roster"></div>
				</section>

				<!-- ── View As Banner ── -->
				<div id="ib-aa-view-as-bar" class="ib-aa-view-as-bar" style="display:none;">
					<div class="ib-aa-view-as-inner">
						${IB_ICONS.svg("eye", 14)}
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
						<div class="ib-aa-th" style="flex:1;"></div>
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
				if (r.message) self._render_roster(r.message.roster, r.message.team_territories || {});
			},
		});
		this._load_pool();
		this._refresh_tab_counts();
		this._populate_user_dropdown();
		if (this._view_as_user) this._reload_va_board();
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
				self._dropdown_users_cache = r.message;
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
		if (this._last_roster) this._render_roster(this._last_roster, this._last_team_territories);
	}

	_reload_pool() {
		this._load_pool(this._pool_page);
		this._refresh_tab_counts();
	}

	_reload_roster() {
		const self = this;
		frappe.call({
			method: "instabiz.overrides.customer_assignment.get_admin_overview",
			args: { date: self._date, territory: self._territory },
			callback(r) {
				if (r.message) self._render_roster(r.message.roster, r.message.team_territories || {});
			},
		});
	}

	_render_roster(roster, team_territories) {
		this._last_roster = roster;
		this._last_team_territories = team_territories || this._last_team_territories || {};
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

		const $strip = $("#ib-aa-hidden-strip");
		if (hidden_count > 0) {
			$strip.html(`${IB_ICONS.svg("eye_off", 13)} ${hidden_count} user${hidden_count > 1 ? "s" : ""} hidden &mdash; <a href="#" class="ib-aa-show-all-link">Show all</a>`).show();
			$strip.find(".ib-aa-show-all-link").on("click", (e) => {
				e.preventDefault();
				self._excluded_users.clear();
				self._save_excluded();
				self._render_roster(roster, team_territories);
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
					self._render_roster(roster, team_territories);
				});
			}
			return;
		}

		// Group by team; no team → "Unassigned"
		const groups = {};
		visible.forEach(u => {
			const key = u.team || "__none__";
			if (!groups[key]) groups[key] = [];
			groups[key].push(u);
		});

		// Column header row
		$g.append(`
			<div class="ib-aa-roster-thead">
				<div class="ib-aa-rth ib-aa-rth--name"></div>
				<div class="ib-aa-rth ib-aa-rth--stat">Done</div>
				<div class="ib-aa-rth ib-aa-rth--stat">Pending</div>
				<div class="ib-aa-rth ib-aa-rth--stat">Tomorrow</div>
				<div class="ib-aa-rth ib-aa-rth--bar">Assignments</div>
				<div class="ib-aa-rth ib-aa-rth--target">Sales Target</div>
				<div class="ib-aa-rth ib-aa-rth--actions"></div>
			</div>
		`);

		const render_group = (team_key, users) => {
			const av_color = self._avatar_color(users[0].user, users[0].team);
			const team_label = team_key === "__none__" ? "Unassigned" : team_key;
			const avg_pct = Math.round(users.reduce((s, u) => s + (u.completion_pct || 0), 0) / users.length);
			const is_collapsed = self._collapsed_teams.has(team_key);

			const terr_list = (team_territories || {})[team_key] || [];
			const terr_chips = terr_list.length
				? terr_list.map(t => `<span class="ib-aa-terr-chip">${frappe.utils.escape_html(self._terr_abbr(t))}</span>`).join("")
				: "";

			const $group = $(`
				<div class="ib-aa-team-group">
					<div class="ib-aa-team-hdr" style="--team-color:${av_color}">
						<svg class="ib-aa-team-chevron${is_collapsed ? " ib-aa-team-chevron--collapsed" : ""}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
						<span class="ib-aa-team-dot"></span>
						<span class="ib-aa-team-label">${frappe.utils.escape_html(team_label)}</span>
						${terr_chips ? `<span class="ib-aa-terr-chips">${terr_chips}</span>` : ""}
						<span class="ib-aa-team-meta">${users.length} member${users.length > 1 ? "s" : ""} &middot; avg ${avg_pct}%</span>
						${team_key !== "__none__" ? `<button class="ib-aa-btn-team-kebab" title="Manage team">⋮</button>` : ""}
					</div>
					<div class="ib-aa-team-body${is_collapsed ? " ib-aa-team-body--collapsed" : ""}"></div>
				</div>
			`);

			$group.find(".ib-aa-team-hdr").on("click", (e) => {
				if ($(e.target).closest(".ib-aa-btn-team-kebab").length) return;
				const collapsed = !self._collapsed_teams.has(team_key);
				collapsed ? self._collapsed_teams.add(team_key) : self._collapsed_teams.delete(team_key);
				localStorage.setItem("ib_aa_collapsed_teams", JSON.stringify([...self._collapsed_teams]));
				$group.find(".ib-aa-team-body").toggleClass("ib-aa-team-body--collapsed", collapsed);
				$group.find(".ib-aa-team-chevron").toggleClass("ib-aa-team-chevron--collapsed", collapsed);
			});

			if (team_key !== "__none__") {
				$group.find(".ib-aa-btn-team-kebab").on("click", function(e) {
					e.stopPropagation();
					self._show_team_kebab(this, team_key, team_label);
				});
			}

			users.forEach(u => {
				const pct = u.completion_pct || 0;
				const initials = (u.full_name || u.user).split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
				const bar_color = pct >= 80 ? "#22c55e" : pct >= 40 ? "var(--ib-primary)" : "#cbd5e1";
				const pct_cls = pct >= 80 ? "good" : pct >= 40 ? "mid" : "low";
				const av = self._avatar_color(u.user, u.team);
				const is_today = self._date === frappe.datetime.get_today();
				const no_tmrw = is_today && (u.tomorrow_count || 0) === 0;

				const fmt_short = (v) => {
					if (!v) return "₹0";
					if (v >= 1e7) return "₹" + (v / 1e7).toFixed(1) + "Cr";
					if (v >= 1e5) return "₹" + (v / 1e5).toFixed(1) + "L";
					return "₹" + Math.round(v).toLocaleString("en-IN");
				};
				const tpct = u.target_pct || 0;
				const tpct_cls = tpct >= 80 ? "good" : tpct >= 40 ? "mid" : "low";
				const target_html = `<div class="ib-aa-row-target-text">
					<span class="ib-aa-target-actual ib-aa-pct--${tpct_cls}">${fmt_short(u.actual || 0)}</span>
					<span class="ib-aa-target-sep">/</span>
					<span class="ib-aa-target-goal">${fmt_short(u.target || 0)}</span>
				</div>`;

				const $row = $(`
					<div class="ib-aa-user-row">
						<div class="ib-aa-row-identity">
							<div class="ib-aa-row-avatar" style="background:${av}">${initials}</div>
							<div class="ib-aa-row-name-wrap">
								<span class="ib-aa-row-name">${frappe.utils.escape_html(u.full_name || u.user)}</span>
								${no_tmrw ? `<span class="ib-aa-no-tmrw-dot" title="No assignments queued for tomorrow">⚠</span>` : ""}
							</div>
						</div>
						<div class="ib-aa-row-stat ib-aa-row-stat--done">${u.done}</div>
						<div class="ib-aa-row-stat ib-aa-row-stat--pending">${u.pending}</div>
						<div class="ib-aa-row-stat ib-aa-row-stat--tmrw">${u.tomorrow_count}</div>
						<div class="ib-aa-row-bar-wrap">
							<span class="ib-aa-row-pct ib-aa-pct--${pct_cls}">${pct}%</span>
							<div class="ib-aa-row-bar-track">
								<div class="ib-aa-row-bar-fill" style="width:${pct}%;background:${bar_color}"></div>
							</div>
						</div>
						${target_html}
						<div class="ib-aa-row-actions">
							<button class="ib-aa-btn-kebab" title="Actions">⋮</button>
						</div>
					</div>
				`);

				$row.find(".ib-aa-btn-kebab").on("click", function(e) {
					e.stopPropagation();
					self._show_kebab(this, u);
				});
				$group.find(".ib-aa-team-body").append($row);
			});

			$g.append($group);
		};

		// Named teams first, then unassigned
		Object.keys(groups).filter(k => k !== "__none__").sort().forEach(k => render_group(k, groups[k]));
		if (groups["__none__"]) render_group("__none__", groups["__none__"]);
	}

	// ── Kebab menu ───────────────────────────────────────────────────────────

	_init_kebab() {
		this._$kdrop = $('<div class="ib-aa-kdrop" style="display:none"></div>').appendTo("body");
		$(document).on("click.ib_aa_kebab", (e) => {
			if (!$(e.target).closest(".ib-aa-kdrop, .ib-aa-btn-kebab, .ib-aa-btn-team-kebab").length) {
				this._$kdrop.hide();
			}
		});
	}

	_show_kebab(btn, u) {
		const self = this;
		const $d = this._$kdrop;
		const rect = btn.getBoundingClientRect();
		const fmt_inr = v => v ? "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—";

		$d.html(`
			<div class="ib-aa-kdrop-header">
				<div class="ib-aa-kdrop-name">${frappe.utils.escape_html(u.full_name || u.user)}</div>
				${u.target ? `<div class="ib-aa-kdrop-target">${fmt_inr(u.actual)} / ${fmt_inr(u.target)} &mdash; ${u.target_pct || 0}%</div>` : ""}
			</div>
			<button class="ib-aa-kdrop-item ib-aa-kdrop-view">View board</button>
			<button class="ib-aa-kdrop-item ib-aa-kdrop-auto">Auto-fill</button>
			<button class="ib-aa-kdrop-item ib-aa-kdrop-transfer">Transfer</button>
			<button class="ib-aa-kdrop-item ib-aa-kdrop-set-target">Set target</button>
			<div class="ib-aa-kdrop-sep"></div>
			<button class="ib-aa-kdrop-item ib-aa-kdrop-hide">Hide user</button>
		`);

		const dropW = 210;
		let left = rect.right - dropW + window.scrollX;
		if (left < 8) left = 8;
		$d.css({ top: rect.bottom + window.scrollY + 6, left, width: dropW, display: "block" });

		$d.find(".ib-aa-kdrop-view").on("click", () => { $d.hide(); self._view_as(u.user, u.full_name, u); });
		$d.find(".ib-aa-kdrop-auto").on("click", () => { $d.hide(); self._bulk_auto_assign(u.user, u.full_name); });
		$d.find(".ib-aa-kdrop-transfer").on("click", () => { $d.hide(); self._transfer_assignments(u.user, u.full_name, u.pending); });
		$d.find(".ib-aa-kdrop-set-target").on("click", () => { $d.hide(); self._show_set_target_dialog(u); });
		$d.find(".ib-aa-kdrop-hide").on("click", () => {
			$d.hide();
			self._excluded_users.add(u.user);
			self._save_excluded();
			self._render_roster(self._last_roster, self._last_team_territories);
		});
	}

	// ── Team kebab + manage modal ─────────────────────────────────────────────

	_show_team_kebab(btn, team_key, team_label) {
		const self = this;
		const $d = this._$kdrop;
		const rect = btn.getBoundingClientRect();

		$d.html(`
			<div class="ib-aa-kdrop-header">
				<div class="ib-aa-kdrop-name">${frappe.utils.escape_html(team_label)}</div>
			</div>
			<button class="ib-aa-kdrop-item ib-aa-kdrop-manage-team">Manage Team</button>
		`);

		const dropW = 180;
		let left = rect.right - dropW + window.scrollX;
		if (left < 8) left = 8;
		$d.css({ top: rect.bottom + window.scrollY + 6, left, width: dropW, display: "block" });

		$d.find(".ib-aa-kdrop-manage-team").on("click", () => {
			$d.hide();
			self._show_team_manage_modal(team_key);
		});
	}

	_show_set_target_dialog(u) {
		const self = this;
		const month_first = this._date.slice(0, 7) + "-01";
		const month_label = frappe.datetime.str_to_user(month_first).slice(3); // "MMM YYYY"
		const fmt_inr = v => v ? "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "₹0";

		const d = new frappe.ui.Dialog({
			title: `Sales Target — ${frappe.utils.escape_html(u.full_name || u.user)}`,
			fields: [
				{
					fieldtype: "HTML",
					options: `<div class="ib-st-meta">
						<span class="ib-st-month">${frappe.utils.escape_html(month_label)}</span>
						${u.actual ? `<span class="ib-st-actual">Actual so far: <strong>${fmt_inr(u.actual)}</strong></span>` : ""}
					</div>`,
				},
				{
					fieldname: "target_amount",
					fieldtype: "Currency",
					label: "Target Amount",
					default: u.target || 0,
					reqd: 1,
				},
			],
			primary_action_label: u.target ? "Update" : "Set Target",
			primary_action(values) {
				frappe.call({
					method: "instabiz.overrides.sales_target.set_user_target",
					args: {
						sales_user: u.user,
						month: month_first,
						target_amount: values.target_amount,
					},
					callback(r) {
						if (r.message && r.message.status === "ok") {
							d.hide();
							frappe.show_alert({
								message: `Target set for ${u.full_name || u.user}`,
								indicator: "green",
							});
							// Patch the roster row in-place for instant feedback
							u.target = r.message.target;
							u.actual = r.message.actual;
							u.target_pct = r.message.pct;
							self._reload_roster();
						}
					},
				});
			},
		});
		d.show();
	}

	_show_team_manage_modal(team_name) {
		const self = this;
		const d = new frappe.ui.Dialog({
			title: `Manage Team: ${frappe.utils.escape_html(team_name)}`,
			fields: [{
				fieldtype: "HTML",
				fieldname: "body",
				options: `<div class="ib-tm-body"><div class="ib-tm-loading">Loading…</div></div>`,
			}],
			primary_action_label: "Close",
			primary_action() { d.hide(); },
		});
		d.show();
		const $body = d.get_field("body").$wrapper.find(".ib-tm-body");
		self._load_team_modal(d, $body, team_name);
	}

	_load_team_modal(d, $body, team_name) {
		const self = this;
		$body.html('<div class="ib-tm-loading">Loading…</div>');

		const render_with_team = (team) => {
			if (d._all_territories !== undefined) {
				self._render_team_modal(d, $body, team_name, team, d._all_territories);
				return;
			}
			frappe.call({
				method: "frappe.client.get_list",
				args: { doctype: "Territory", fields: ["name"], limit: 500 },
				callback(r) {
					d._all_territories = (r.message || []).map(t => t.name).sort();
					self._render_team_modal(d, $body, team_name, team, d._all_territories);
				},
			});
		};

		frappe.call({
			method: "instabiz.overrides.customer_assignment.get_team_details",
			args: { team_name },
			callback(r) {
				render_with_team(r.message || { members: [], territories: [] });
			},
		});
	}

	_render_team_modal(d, $body, team_name, team, all_territories) {
		const self = this;
		const existing_users = new Set(team.members.map(m => m.user));
		const existing_territories = new Set(team.territories.map(t => t.territory));

		// Build user→team map from last roster (all sales users' team assignments)
		const user_team_map = {};
		(self._last_roster || []).forEach(u => { if (u.team) user_team_map[u.user] = u.team; });

		const available_users = (self._dropdown_users_cache || []).filter(u => !existing_users.has(u.name));
		const available_territories = all_territories.filter(t => !existing_territories.has(t));

		// Existing member rows (read-only + remove)
		const member_rows = team.members.length
			? team.members.map(m => {
				const color = self._avatar_color(m.user, user_team_map[m.user] || team_name);
				const initials = (m.full_name || m.user).split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
				return `
				<div class="ib-tm-row">
					<div class="ib-tm-row-av" style="background:${color}">${initials}</div>
					<div class="ib-tm-row-info">
						<span class="ib-tm-row-name">${frappe.utils.escape_html(m.full_name || m.user)}</span>
						<span class="ib-tm-row-sub">${frappe.utils.escape_html(m.user)}</span>
					</div>
					<button class="ib-tm-remove-btn" data-user="${frappe.utils.escape_html(m.user)}">Remove</button>
				</div>`;
			}).join("")
			: `<div class="ib-tm-empty">No members yet</div>`;

		// Available user picker rows with team badge
		const picker_rows = available_users.map(u => {
			const other_team = user_team_map[u.name];
			const color = self._avatar_color(u.name, other_team || "");
			const initials = (u.full_name || u.name).split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
			const team_badge = other_team
				? `<span class="ib-tm-team-badge" style="--badge-color:${color}">${frappe.utils.escape_html(other_team)}</span>`
				: `<span class="ib-tm-team-badge ib-tm-team-badge--none">No team</span>`;
			return `
			<div class="ib-tm-picker-row" data-user="${frappe.utils.escape_html(u.name)}" data-search="${frappe.utils.escape_html((u.full_name || "") + " " + u.name).toLowerCase()}">
				<div class="ib-tm-row-av" style="background:${color}">${initials}</div>
				<div class="ib-tm-row-info">
					<span class="ib-tm-row-name">${frappe.utils.escape_html(u.full_name || u.name)}</span>
					<span class="ib-tm-row-sub">${frappe.utils.escape_html(u.name)}</span>
				</div>
				${team_badge}
				<button class="ib-tm-picker-add-btn" data-user="${frappe.utils.escape_html(u.name)}">+ Add</button>
			</div>`;
		}).join("") || `<div class="ib-tm-empty">All users already in this team</div>`;

		// Territory rows
		const territory_rows = team.territories.length
			? team.territories.map(t => `
				<div class="ib-tm-row">
					<div class="ib-tm-row-info">
						<span class="ib-tm-row-name">${frappe.utils.escape_html(t.territory)}</span>
					</div>
					<button class="ib-tm-remove-btn" data-territory="${frappe.utils.escape_html(t.territory)}">Remove</button>
				</div>`).join("")
			: `<div class="ib-tm-empty">No territories yet</div>`;

		$body.html(`
			<div class="ib-tm-section">
				<div class="ib-tm-section-label">Members <span class="ib-tm-count">${team.members.length}</span></div>
				<div class="ib-tm-list">${member_rows}</div>
				<div class="ib-tm-picker-head">
					<span class="ib-tm-picker-title">Add member</span>
					<input class="ib-tm-picker-search" id="ib-tm-member-search" placeholder="Search users…" autocomplete="off">
				</div>
				<div class="ib-tm-picker-list" id="ib-tm-picker-list">${picker_rows}</div>
			</div>
			<div class="ib-tm-section">
				<div class="ib-tm-section-label">Territories <span class="ib-tm-count">${team.territories.length}</span></div>
				<div class="ib-tm-list">${territory_rows}</div>
				<div class="ib-tm-add-row">
					<select class="ib-tm-select" id="ib-tm-territory-sel">
						<option value="">Select territory to add…</option>
						${available_territories.map(t => `<option value="${frappe.utils.escape_html(t)}">${frappe.utils.escape_html(t)}</option>`).join("")}
					</select>
					<button class="ib-tm-add-btn" id="ib-tm-add-territory">Add</button>
				</div>
			</div>
		`);

		// Picker search filter
		$body.find("#ib-tm-member-search").on("input", function() {
			const q = this.value.trim().toLowerCase();
			$body.find(".ib-tm-picker-row").each(function() {
				const hay = $(this).data("search") || "";
				$(this).toggle(!q || hay.includes(q));
			});
		});

		// Per-row add member
		$body.find(".ib-tm-picker-add-btn").on("click", function() {
			const user = $(this).data("user");
			const $btn = $(this).prop("disabled", true).text("…");
			frappe.call({
				method: "instabiz.overrides.customer_assignment.add_team_member",
				args: { team_name, user },
				freeze: true,
				freeze_message: "Saving…",
				callback(r) {
					if (r.message && r.message.status === "ok") {
						frappe.show_alert({ message: `Added to ${team_name}`, indicator: "green" });
						// Reload roster first so _last_roster has fresh team data before modal re-renders
						frappe.call({
							method: "instabiz.overrides.customer_assignment.get_admin_overview",
							args: { date: self._date, territory: self._territory },
							callback(rr) {
								if (rr.message) self._render_roster(rr.message.roster, rr.message.team_territories || {});
								self._load_team_modal(d, $body, team_name);
							},
						});
					} else {
						$btn.prop("disabled", false).text("+ Add");
					}
				},
				error() { $btn.prop("disabled", false).text("+ Add"); },
			});
		});

		// Remove member
		$body.find(".ib-tm-remove-btn[data-user]").on("click", function() {
			const user = $(this).data("user");
			const $btn = $(this).prop("disabled", true).text("…");
			frappe.call({
				method: "instabiz.overrides.customer_assignment.remove_team_member",
				args: { team_name, user },
				freeze: true,
				freeze_message: "Saving…",
				callback(r) {
					if (r.message && r.message.status === "ok") {
						frappe.show_alert({ message: `Removed from ${team_name}`, indicator: "orange" });
						frappe.call({
							method: "instabiz.overrides.customer_assignment.get_admin_overview",
							args: { date: self._date, territory: self._territory },
							callback(rr) {
								if (rr.message) self._render_roster(rr.message.roster, rr.message.team_territories || {});
								self._load_team_modal(d, $body, team_name);
							},
						});
					} else {
						$btn.prop("disabled", false).text("Remove");
					}
				},
				error() { $btn.prop("disabled", false).text("Remove"); },
			});
		});

		// Remove territory
		$body.find(".ib-tm-remove-btn[data-territory]").on("click", function() {
			const territory = $(this).data("territory");
			const $btn = $(this).prop("disabled", true).text("…");
			frappe.call({
				method: "instabiz.overrides.customer_assignment.remove_team_territory",
				args: { team_name, territory },
				callback(r) {
					if (r.message && r.message.status === "ok") {
						frappe.show_alert({ message: `${territory} removed`, indicator: "orange" });
						self._load_team_modal(d, $body, team_name);
					} else {
						$btn.prop("disabled", false).text("Remove");
					}
				},
				error() { $btn.prop("disabled", false).text("Remove"); },
			});
		});

		// Add territory
		$body.find("#ib-tm-add-territory").on("click", function() {
			const territory = $body.find("#ib-tm-territory-sel").val();
			if (!territory) { frappe.show_alert({ message: "Select a territory first", indicator: "orange" }); return; }
			const $btn = $(this).prop("disabled", true).text("Adding…");
			frappe.call({
				method: "instabiz.overrides.customer_assignment.add_team_territory",
				args: { team_name, territory },
				callback(r) {
					if (r.message && r.message.status === "ok") {
						frappe.show_alert({ message: `${territory} added`, indicator: "green" });
						self._load_team_modal(d, $body, team_name);
					} else {
						$btn.prop("disabled", false).text("Add");
					}
				},
				error() { $btn.prop("disabled", false).text("Add"); },
			});
		});
	}

	// ── View As ──────────────────────────────────────────────────────────────

	_view_as(user, full_name, user_data = null) {
		this._view_as_user = user;
		this._view_as_user_data = user_data;
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
				if (!r.message || !r.message.board) {
					$wrap.html(`<div class="ib-va-loading">Failed to load board. <a href="#" id="ib-va-retry-link">Retry</a></div>`);
					$("#ib-va-retry-link").on("click", (e) => { e.preventDefault(); self._reload_va_board(); });
					return;
				}
				self._render_board_view(r.message.board);
			},
			error() {
				$wrap.html(`<div class="ib-va-loading">Error loading board. <a href="#" id="ib-va-retry-link">Retry</a></div>`);
				$("#ib-va-retry-link").on("click", (e) => { e.preventDefault(); self._reload_va_board(); });
			},
		});
	}

	// Render a va column and bind multi-token local search to it.
	// card_fn(row) → jQuery element. empty_msg shown when no data (not when search has no results).
	_va_render_col(col, rows, card_fn, empty_msg) {
		const $cards = $(`#ib-va-${col}-cards`).empty();
		$(`#ib-va-${col}-search`).val("");
		$(`#ib-va-${col}-count`).text(rows.length);

		const render = (filtered, is_search) => {
			$cards.empty();
			$(`#ib-va-${col}-count`).text(
				is_search ? `${filtered.length}/${rows.length}` : rows.length
			);
			if (!filtered.length) {
				$cards.html(`<div class="ib-va-empty">${is_search ? "No results" : empty_msg}</div>`);
			} else {
				filtered.forEach(r => $cards.append(card_fn(r)));
			}
		};

		render(rows, false);

		let _t;
		$(`#ib-va-${col}-search`).off("input").on("input", function () {
			const q = $(this).val().trim();
			clearTimeout(_t);
			if (!q) { render(rows, false); return; }
			_t = setTimeout(() => {
				const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
				const filtered = rows.filter(r => {
					const hay = [r.customer_name, r.customer, r.territory].join(" ").toLowerCase();
					return tokens.every(t => hay.includes(t));
				});
				render(filtered, true);
			}, 200);
		});
	}

	_va_tmrw_card(r) {
		const last = r.last_so_date ? frappe.datetime.str_to_user(r.last_so_date) : "No orders";
		return $(`
			<div class="ib-va-card ib-va-card--tmrw">
				<div class="ib-va-card-name">${frappe.utils.escape_html(r.customer_name || r.customer)}</div>
				<div class="ib-va-card-meta">${frappe.utils.escape_html(r.territory || "")}</div>
				<div class="ib-va-card-last">${last}</div>
			</div>
		`);
	}

	_render_board_view(data) {
		const self = this;
		const user = this._view_as_user;
		const $wrap = $("#ib-aa-board-wrap");
		const ud = this._view_as_user_data;
		const fmt_inr = v => v ? "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—";
		const target_strip = ud && ud.target ? (() => {
			const tpct = Math.min(ud.target_pct || 0, 100);
			const bar_color = tpct >= 100 ? "#22c55e" : tpct >= 60 ? "var(--ib-primary)" : "#f59e0b";
			return `<div class="ib-va-target-strip">
				<span class="ib-va-ts-label">Sales Target</span>
				<div class="ib-va-ts-track">
					<div class="ib-va-ts-fill" style="width:${tpct}%;background:${bar_color}"></div>
				</div>
				<span class="ib-va-ts-amt">${fmt_inr(ud.actual)} <span class="ib-va-ts-sep">/</span> ${fmt_inr(ud.target)}</span>
				<span class="ib-va-ts-pct" style="color:${bar_color}">${ud.target_pct || 0}%</span>
			</div>`;
		})() : "";

		$wrap.html(`
			<div class="ib-va-board">
				${target_strip}
				<div class="ib-va-columns">
					<div class="ib-va-col">
						<div class="ib-va-col-header">
							${IB_ICONS.svg("moon", 13)}<span class="ib-va-col-title">Dormant</span>
							<span class="ib-va-badge" id="ib-va-dormant-count">0</span>
						</div>
						<input class="ib-va-col-search" id="ib-va-dormant-search" placeholder="Search…" autocomplete="off">
						<div class="ib-va-cards" id="ib-va-dormant-cards"></div>
					</div>
					<div class="ib-va-col">
						<div class="ib-va-col-header">
							${IB_ICONS.svg("users", 13)}<span class="ib-va-col-title">Regular</span>
							<span class="ib-va-badge" id="ib-va-regular-count">0</span>
						</div>
						<input class="ib-va-col-search" id="ib-va-regular-search" placeholder="Search…" autocomplete="off">
						<div class="ib-va-cards" id="ib-va-regular-cards"></div>
					</div>
					<div class="ib-va-col ib-va-col--today">
						<div class="ib-va-col-header">
							${IB_ICONS.svg("calendar", 13)}<span class="ib-va-col-title">Today</span>
							<span class="ib-va-col-date">${frappe.datetime.str_to_user(data.date)}</span>
							<span class="ib-va-badge ib-va-badge--today" id="ib-va-today-count">0</span>
							<button class="ib-va-remove-all-btn" id="ib-va-remove-all" title="Remove all pending">${IB_ICONS.svg("trash", 11)}</button>
						</div>
						<input class="ib-va-col-search" id="ib-va-today-search" placeholder="Search…" autocomplete="off">
						<div class="ib-va-cards" id="ib-va-today-cards"></div>
					</div>
					<div class="ib-va-col ib-va-col--tomorrow">
						<div class="ib-va-col-header">
							${IB_ICONS.svg("sunrise", 13)}<span class="ib-va-col-title">Tomorrow</span>
							<span class="ib-va-col-date">${frappe.datetime.str_to_user(data.tomorrow_date)}</span>
							<span class="ib-va-badge ib-va-badge--tmrw" id="ib-va-tomorrow-count">0</span>
						</div>
						<input class="ib-va-col-search" id="ib-va-tomorrow-search" placeholder="Search…" autocomplete="off">
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

		this._va_render_col("dormant", data.dormant || [], r => self._va_pool_card(r, user), "Empty");
		this._va_render_col("regular", data.regular || [], r => self._va_pool_card(r, user), "Empty");
		this._va_render_col("today",   data.today   || [], r => self._va_today_card(r),       "No assignments");
		this._va_render_col("tomorrow",data.tomorrow|| [], r => self._va_tmrw_card(r),        "Scheduler runs at midnight");

		// Remove-all button for today pending
		const pending_count = (data.today || []).filter(r => r.status === "Pending").length;
		const $removeAll = $("#ib-va-remove-all");
		if (!pending_count) {
			$removeAll.hide();
		} else {
			$removeAll.show().off("click").on("click", () => {
				frappe.confirm(
					`Remove all ${pending_count} pending assignment${pending_count > 1 ? "s" : ""} for ${self._view_as_user}?`,
					() => {
						frappe.call({
							method: "instabiz.overrides.customer_assignment.remove_all_pending",
							args: { user: self._view_as_user, date: self._date },
							callback(r) {
								if (r.message != null) {
									frappe.show_alert({
										message: `${r.message.removed} assignment${r.message.removed !== 1 ? "s" : ""} removed`,
										indicator: "orange",
									});
									self._reload_va_board();
									self._reload_pool();
									self._reload_roster();
								}
							},
						});
					}
				);
			});
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
				<div class="ib-va-card-btns">
					<button class="ib-va-add-btn" data-customer="${frappe.utils.escape_html(r.customer)}">${IB_ICONS.svg("plus", 11)} Today</button>
					<button class="ib-va-tmrw-btn" data-customer="${frappe.utils.escape_html(r.customer)}">${IB_ICONS.svg("plus", 11)} Tomorrow</button>
				</div>
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
						self._reload_pool();
					} else {
						$btn.prop("disabled", false).text("Today");
					}
				},
				error() { $btn.prop("disabled", false).text("Today"); },
			});
		});
		$card.find(".ib-va-tmrw-btn").on("click", function () {
			const customer = $(this).data("customer");
			const $btn = $(this);
			const tomorrow = self._next_working_day(self._date);
			$btn.prop("disabled", true).text("Adding…");
			frappe.call({
				method: "instabiz.overrides.customer_assignment.add_customer_to_today",
				args: { customer, date: tomorrow, target_user },
				callback(r) {
					if (r.message && r.message.status === "ok") {
						frappe.show_alert({ message: `${customer} added to Tomorrow`, indicator: "blue" });
						self._reload_va_board();
						self._reload_pool();
					} else {
						$btn.prop("disabled", false).text("Tomorrow");
					}
				},
				error() { $btn.prop("disabled", false).text("Tomorrow"); },
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
				${is_pending ? `<button class="ib-va-remove-btn" data-id="${frappe.utils.escape_html(r.name)}">${IB_ICONS.svg("trash", 11)} Remove</button>` : ""}
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
							self._reload_pool();
							self._reload_roster();
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
						self._reload_pool();
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
					if (this._view_as_user === user) this._reload_va_board();
				}
			},
		});
	}

	_transfer_assignments(from_user, from_name, pending_count) {
		const self = this;
		if (!pending_count) {
			frappe.show_alert({ message: `${from_name || from_user} has no Pending assignments to transfer`, indicator: "orange" });
			return;
		}
		const d = new frappe.ui.Dialog({
			title: `Transfer ${from_name || from_user}'s assignments`,
			fields: [
				{
					fieldname: "to_user",
					fieldtype: "Link",
					label: "Transfer to",
					options: "User",
					reqd: 1,
					get_query: () => ({
						query: "frappe.core.doctype.user.user.user_query",
						filters: { ignore_user_type: 1 },
					}),
				},
			],
			primary_action_label: "Transfer",
			primary_action(values) {
				if (values.to_user === from_user) {
					frappe.show_alert({ message: "Cannot transfer to the same user", indicator: "red" });
					return;
				}
				frappe.call({
					method: "instabiz.overrides.customer_assignment.transfer_assignments",
					args: { from_user, to_user: values.to_user, date: self._date },
					callback(r) {
						if (r.message != null) {
							d.hide();
							frappe.show_alert({
								message: `${r.message.transferred} assignments transferred to ${values.to_user}`,
								indicator: r.message.transferred > 0 ? "green" : "orange",
							});
							self.refresh();
							if (self._view_as_user === from_user || self._view_as_user === values.to_user) {
								self._reload_va_board();
							}
						}
					},
				});
			},
		});
		d.show();
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
			const gstin = r.gstin ? `<span class="ib-aa-pool-cust-gstin">${frappe.utils.escape_html(r.gstin)}</span>` : "";
			$list.append(`
				<label class="ib-aa-pool-row ${checked ? "ib-aa-pool-row--checked" : ""}" data-name="${code}">
					<input type="checkbox" class="ib-aa-pool-chk" value="${code}" ${checked ? "checked" : ""}>
					<span class="ib-aa-pool-cust">
						<span class="ib-aa-pool-cust-name">${display_name}</span>
						<span class="ib-aa-pool-cust-code">${code}</span>
						${gstin}
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
			$("#ib-aa-assign-date").val(this._next_working_day(this._date));
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
				if (self._view_as_user === user) self._reload_va_board();
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

			/* ── Roster grouped table ── */
			.ib-aa-roster { overflow: hidden; }

			.ib-aa-roster-thead {
				display: flex; align-items: center;
				padding: 6px 20px;
				background: var(--subtle-bg);
				border-bottom: 1px solid var(--border-color);
				position: sticky; top: 0; z-index: 2;
			}
			.ib-aa-rth {
				font-size: 10px; font-weight: 700; text-transform: uppercase;
				letter-spacing: 0.5px; color: var(--text-muted);
			}
			.ib-aa-rth--name    { flex: 1; min-width: 0; }
			.ib-aa-rth--stat    { width: 72px; text-align: center; border-left: 1px solid var(--border-color); }
			.ib-aa-rth--bar     { width: 210px; padding-left: 8px; border-left: 1px solid var(--border-color); }
			.ib-aa-rth--target  { width: 150px; padding-left: 8px; border-left: 1px solid var(--border-color); }

			/* Team group */
			.ib-aa-team-group { border-bottom: 2px solid var(--border-color); }
			.ib-aa-team-group:last-child { border-bottom: none; }

			.ib-aa-team-hdr {
				display: flex; align-items: center; gap: 8px;
				padding: 7px 20px;
				background: var(--subtle-bg);
				border-bottom: 1px solid var(--border-color);
				border-left: 3px solid var(--team-color, var(--ib-primary));
				cursor: pointer; user-select: none;
			}
			.ib-aa-team-hdr:hover { filter: brightness(0.97); }
			.ib-aa-team-chevron {
				color: var(--text-muted); flex-shrink: 0;
				transition: transform 0.2s ease;
			}
			.ib-aa-team-chevron--collapsed { transform: rotate(-90deg); }
			.ib-aa-team-dot {
				width: 8px; height: 8px; border-radius: 50%;
				background: var(--team-color, var(--ib-primary));
				flex-shrink: 0;
			}
			.ib-aa-team-label { font-size: 12px; font-weight: 700; }
			.ib-aa-team-meta  { font-size: 11px; color: var(--text-muted); }
			.ib-aa-terr-chips { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; }
			.ib-aa-terr-chip {
				font-size: 9px; font-weight: 700; letter-spacing: 0.3px;
				padding: 1px 5px; border-radius: 3px;
				background: color-mix(in srgb, var(--team-color) 15%, transparent);
				color: var(--team-color);
				border: 1px solid color-mix(in srgb, var(--team-color) 35%, transparent);
				white-space: nowrap;
			}
			.ib-aa-team-body--collapsed { display: none; }

			/* User row */
			.ib-aa-user-row {
				display: flex; align-items: center;
				padding: 9px 20px;
				border-bottom: 1px solid var(--border-color);
				transition: background 0.12s;
				border-left: 3px solid transparent;
			}
			.ib-aa-user-row:last-child { border-bottom: none; }
			.ib-aa-user-row:hover { background: var(--subtle-bg); border-left-color: var(--border-color); }

			/* Identity cell */
			.ib-aa-row-identity {
				flex: 1; min-width: 0;
				display: flex; align-items: center; gap: 10px;
			}
			.ib-aa-row-avatar {
				width: 30px; height: 30px; border-radius: 50%;
				color: #fff; font-size: 11px; font-weight: 700;
				display: flex; align-items: center; justify-content: center;
				flex-shrink: 0; letter-spacing: 0.3px;
			}
			.ib-aa-row-name-wrap { display: flex; align-items: center; gap: 6px; min-width: 0; }
			.ib-aa-row-name {
				font-size: 13px; font-weight: 600;
				white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
			}
			.ib-aa-no-tmrw-dot { font-size: 13px; color: #d97706; flex-shrink: 0; line-height: 1; }

			/* Stat cells */
			.ib-aa-row-stat {
				width: 72px; text-align: center;
				font-size: 15px; font-weight: 700;
				border-left: 1px solid var(--border-color);
			}
			.ib-aa-row-stat--done    { color: #15803d; }
			.ib-aa-row-stat--pending { color: #b45309; }
			.ib-aa-row-stat--tmrw    { color: #1d4ed8; }

			/* Bar cells — each 210px, always visible */
			.ib-aa-row-bar-wrap {
				width: 210px; flex-shrink: 0;
				display: flex; align-items: center; gap: 8px;
				border-left: 1px solid var(--border-color); padding-left: 8px;
			}
			.ib-aa-no-target {
				width: 210px; flex-shrink: 0;
				display: flex; align-items: center; padding-left: 8px;
				font-size: 12px; color: var(--text-muted);
				border-left: 1px solid var(--border-color);
			}
			.ib-aa-row-target-text {
				width: 150px; flex-shrink: 0;
				display: flex; align-items: center; gap: 4px; padding-left: 8px;
				border-left: 1px solid var(--border-color);
				font-size: 12px; font-variant-numeric: tabular-nums;
			}
			.ib-aa-target-actual { font-weight: 700; }
			.ib-aa-target-sep { color: var(--text-muted); font-size: 11px; }
			.ib-aa-target-goal { color: var(--text-muted); }
			.ib-aa-row-bar-track {
				flex: 1; height: 6px; background: var(--border-color);
				border-radius: 4px; overflow: hidden;
			}
			.ib-aa-row-bar-fill {
				height: 100%; border-radius: 4px;
				transition: width 0.5s cubic-bezier(0.4,0,0.2,1);
			}
			.ib-aa-row-pct { font-size: 11px; font-weight: 700; width: 34px; text-align: right; flex-shrink: 0; }
			.ib-aa-pct--good { color: #16a34a; }
			.ib-aa-pct--mid  { color: var(--ib-primary); }
			.ib-aa-pct--low  { color: #94a3b8; }

			/* Actions — absolutely positioned at row right edge, out of flex flow */
			.ib-aa-user-row { position: relative; }
			.ib-aa-row-actions {
				position: absolute; right: 20px; top: 50%; transform: translateY(-50%);
				display: flex; align-items: center; gap: 5px;
				opacity: 0; pointer-events: none; transition: opacity 0.15s;
			}
			.ib-aa-user-row:hover .ib-aa-row-actions { opacity: 1; pointer-events: auto; }
			/* Kebab trigger */
			.ib-aa-btn-kebab {
				width: 28px; height: 28px; border-radius: 6px;
				border: 1px solid var(--border-color); background: var(--card-bg);
				font-size: 16px; line-height: 1; cursor: pointer; color: var(--text-muted);
				display: flex; align-items: center; justify-content: center; padding: 0;
				transition: all 0.15s; letter-spacing: -1px;
			}
			.ib-aa-btn-kebab:hover { border-color: var(--ib-primary); color: var(--ib-primary); background: #fdf6f3; }

			/* Team header kebab button */
			.ib-aa-btn-team-kebab {
				margin-left: auto; flex-shrink: 0;
				width: 22px; height: 22px; border-radius: 4px;
				border: 1px solid transparent; background: transparent;
				font-size: 14px; cursor: pointer; color: var(--text-muted);
				display: flex; align-items: center; justify-content: center; padding: 0;
				transition: all 0.15s; letter-spacing: -1px;
			}
			.ib-aa-btn-team-kebab:hover { border-color: var(--ib-primary); color: var(--ib-primary); background: rgba(217,119,87,0.08); }

			/* Team manage modal */
			.ib-tm-body { display: flex; flex-direction: column; gap: 16px; padding: 4px 0; }
			.ib-tm-loading { text-align: center; color: var(--text-muted); padding: 20px; font-size: 13px; }
			.ib-tm-section { border: 1px solid var(--border-color); border-radius: 7px; overflow: hidden; }
			.ib-tm-section-label {
				display: flex; align-items: center; gap: 6px;
				padding: 7px 14px;
				font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px;
				color: var(--text-muted); background: var(--subtle-bg);
				border-bottom: 1px solid var(--border-color);
			}
			.ib-tm-count {
				background: var(--border-color); color: var(--text-muted);
				border-radius: 10px; padding: 0 6px; font-size: 10px; font-weight: 700;
			}
			.ib-tm-list { display: flex; flex-direction: column; }
			.ib-tm-row {
				display: flex; align-items: center; gap: 10px;
				padding: 8px 14px; border-bottom: 1px solid var(--border-color);
			}
			.ib-tm-row:last-child { border-bottom: none; }
			.ib-tm-row-av {
				width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
				color: #fff; font-size: 10px; font-weight: 700;
				display: flex; align-items: center; justify-content: center; letter-spacing: 0.3px;
			}
			.ib-tm-row-info { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
			.ib-tm-row-name { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.ib-tm-row-sub { font-size: 11px; color: var(--text-muted); }
			.ib-tm-empty { padding: 10px 14px; font-size: 12px; color: var(--text-muted); }
			.ib-tm-remove-btn {
				padding: 3px 10px; border-radius: 4px;
				border: 1px solid #fca5a5; background: #fff1f2; color: #b91c1c;
				font-size: 11px; font-weight: 600; cursor: pointer;
				transition: all 0.15s; white-space: nowrap; flex-shrink: 0;
			}
			.ib-tm-remove-btn:hover { background: #b91c1c; color: #fff; border-color: #b91c1c; }
			.ib-tm-remove-btn:disabled { opacity: 0.5; cursor: not-allowed; }

			/* User picker */
			.ib-tm-picker-head {
				display: flex; align-items: center; gap: 8px;
				padding: 8px 14px; border-top: 1px solid var(--border-color);
				background: var(--subtle-bg);
			}
			.ib-tm-picker-title { font-size: 11px; font-weight: 600; color: var(--text-muted); white-space: nowrap; }
			.ib-tm-picker-search {
				flex: 1; padding: 5px 9px;
				border: 1px solid var(--border-color); border-radius: 5px;
				font-size: 12px; background: var(--card-bg); color: var(--text-color);
				transition: border-color 0.15s;
			}
			.ib-tm-picker-search:focus { outline: none; border-color: var(--ib-primary); }
			.ib-tm-picker-list {
				display: flex; flex-direction: column;
				max-height: 200px; overflow-y: auto;
				border-top: 1px solid var(--border-color);
			}
			.ib-tm-picker-row {
				display: flex; align-items: center; gap: 9px;
				padding: 7px 14px; border-bottom: 1px solid var(--border-color);
				transition: background 0.1s;
			}
			.ib-tm-picker-row:last-child { border-bottom: none; }
			.ib-tm-picker-row:hover { background: var(--subtle-bg); }
			.ib-tm-team-badge {
				display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;
				padding: 2px 8px; border-radius: 20px;
				font-size: 10px; font-weight: 700; white-space: nowrap;
				background: color-mix(in srgb, var(--badge-color) 12%, transparent);
				color: var(--badge-color);
				border: 1px solid color-mix(in srgb, var(--badge-color) 30%, transparent);
			}
			.ib-tm-team-badge::before { content: "●"; font-size: 7px; }
			.ib-tm-team-badge--none {
				background: var(--subtle-bg); color: var(--text-muted);
				border: 1px solid var(--border-color);
				--badge-color: transparent;
			}
			.ib-tm-team-badge--none::before { content: none; }
			.ib-tm-picker-add-btn {
				padding: 3px 10px; border-radius: 4px;
				border: 1px solid var(--ib-primary); background: #fdf6f3; color: var(--ib-primary);
				font-size: 11px; font-weight: 700; cursor: pointer;
				transition: all 0.15s; white-space: nowrap; flex-shrink: 0;
			}
			.ib-tm-picker-add-btn:hover { background: var(--ib-primary); color: #fff; }
			.ib-tm-picker-add-btn:disabled { opacity: 0.5; cursor: not-allowed; }

			.ib-tm-add-row {
				display: flex; align-items: center; gap: 8px;
				padding: 10px 14px; border-top: 1px solid var(--border-color);
				background: var(--subtle-bg);
			}
			.ib-tm-select {
				flex: 1; padding: 6px 10px;
				border: 1px solid var(--border-color); border-radius: 5px;
				font-size: 12px; background: var(--card-bg); color: var(--text-color);
				transition: border-color 0.15s;
			}
			.ib-tm-select:focus { outline: none; border-color: var(--ib-primary); }
			.ib-tm-add-btn {
				padding: 6px 16px; border-radius: 5px;
				border: none; background: var(--ib-primary); color: #fff;
				font-size: 12px; font-weight: 700; cursor: pointer;
				transition: all 0.15s; white-space: nowrap; flex-shrink: 0;
			}
			.ib-tm-add-btn:hover { background: var(--ib-primary-dark, #b45e3e); }
			.ib-tm-add-btn:disabled { opacity: 0.5; cursor: not-allowed; }

			/* Kebab dropdown */
			.ib-aa-kdrop {
				position: absolute; z-index: 9999;
				background: var(--card-bg); border: 1px solid var(--border-color);
				border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.12);
				padding: 4px; min-width: 200px; overflow: hidden;
			}
			.ib-aa-kdrop-header {
				padding: 8px 10px 6px;
				border-bottom: 1px solid var(--border-color);
				margin-bottom: 4px;
			}
			.ib-aa-kdrop-name { font-size: 12px; font-weight: 700; color: var(--text-color); }
			.ib-aa-kdrop-target { font-size: 11px; color: var(--text-muted); margin-top: 2px; font-variant-numeric: tabular-nums; }
			.ib-aa-kdrop-item {
				display: block; width: 100%; text-align: left;
				padding: 7px 10px; border: none; background: transparent;
				font-size: 12px; font-weight: 500; cursor: pointer; border-radius: 5px;
				color: var(--text-color); transition: background 0.1s;
			}
			.ib-aa-kdrop-item:hover { background: var(--subtle-bg); }
			.ib-aa-kdrop-view:hover         { color: #1d4ed8; background: #eff6ff; }
			.ib-aa-kdrop-auto:hover         { color: var(--ib-primary); background: #fdf6f3; }
			.ib-aa-kdrop-transfer:hover     { color: #059669; background: #ecfdf5; }
			.ib-aa-kdrop-hide:hover         { color: #b91c1c; background: #fff1f2; }
			.ib-aa-kdrop-manage-team:hover  { color: #7c3aed; background: #f5f3ff; }
			.ib-aa-kdrop-set-target:hover   { color: #0891b2; background: #ecfeff; }

			/* Set target dialog */
			.ib-st-meta {
				display: flex; align-items: center; gap: 14px;
				padding: 6px 0 10px; font-size: 12px;
			}
			.ib-st-month {
				font-weight: 700; font-size: 13px;
				background: var(--ib-primary); color: #fff;
				padding: 2px 10px; border-radius: 20px;
			}
			.ib-st-actual { color: var(--text-muted); }
			.ib-aa-kdrop-sep {
				height: 1px; background: var(--border-color); margin: 4px 0;
			}


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
			.ib-aa-pool-cust { flex: 1; display: flex; flex-direction: column; gap: 2px; align-items: flex-start; }
			.ib-aa-pool-cust-name { font-weight: 600; font-size: 13px; color: var(--text-color); }
			.ib-aa-pool-cust-code { font-size: 10px; color: var(--text-muted); font-family: monospace; }
			.ib-aa-pool-cust-gstin {
				display: inline-block;
				margin-top: 3px;
				font-size: 11px;
				font-family: monospace;
				font-weight: 600;
				letter-spacing: 0.4px;
				color: #1e40af;
				background: #dbeafe;
				border: 1px solid #93c5fd;
				border-radius: 20px;
				padding: 2px 8px;
				white-space: nowrap;
			}
			.ib-aa-pool-cust-gstin::before { content: "GST  "; color: #3b82f6; }
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

			/* Target strip */
			.ib-va-target-strip {
				display: flex; align-items: center; gap: 12px;
				padding: 10px 16px; margin-bottom: 12px;
				background: var(--card-bg); border: 1px solid var(--border-color);
				border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);
			}
			.ib-va-ts-label {
				font-size: 11px; font-weight: 700; text-transform: uppercase;
				letter-spacing: 0.5px; color: var(--text-muted); flex-shrink: 0; width: 90px;
			}
			.ib-va-ts-track {
				flex: 1; height: 6px; background: var(--border-color);
				border-radius: 4px; overflow: hidden;
			}
			.ib-va-ts-fill { height: 100%; border-radius: 4px; transition: width 0.5s cubic-bezier(0.4,0,0.2,1); }
			.ib-va-ts-amt { font-size: 12px; color: var(--text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
			.ib-va-ts-sep { color: var(--border-color); }
			.ib-va-ts-pct { font-size: 13px; font-weight: 700; white-space: nowrap; flex-shrink: 0; width: 42px; text-align: right; }
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
			.ib-va-remove-all-btn {
				margin-left: auto; padding: 3px 7px; border-radius: 5px;
				border: 1px solid #fca5a5; background: #fff1f2; color: #b91c1c;
				font-size: 11px; cursor: pointer; display: flex; align-items: center;
				transition: all 0.15s;
			}
			.ib-va-remove-all-btn:hover { background: #b91c1c; color: #fff; border-color: #b91c1c; }
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
			.ib-va-col-search {
				margin: 8px 8px 4px; padding: 5px 8px; font-size: 12px; width: calc(100% - 16px);
				border: 1px solid var(--border-color); border-radius: 4px;
				background: var(--fg-color, #fff); color: var(--text-color); outline: none; box-sizing: border-box;
			}
			.ib-va-col-search:focus { border-color: var(--ib-primary); }
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
			.ib-va-card-btns { margin-top: 8px; display: flex; gap: 6px; }
			.ib-va-add-btn, .ib-va-tmrw-btn {
				flex: 1; padding: 5px 0; border-radius: 5px;
				font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.15s;
				display: inline-flex; align-items: center; justify-content: center; gap: 4px;
			}
			.ib-va-add-btn {
				border: 1px solid var(--ib-primary); background: #fdf6f3; color: var(--ib-primary);
			}
			.ib-va-add-btn:hover { background: var(--ib-primary); color: #fff; }
			.ib-va-tmrw-btn {
				border: 1px solid #93c5fd; background: #eff6ff; color: #1d4ed8;
			}
			.ib-va-tmrw-btn:hover { background: #3b82f6; border-color: #3b82f6; color: #fff; }
			.ib-va-add-btn:disabled, .ib-va-tmrw-btn:disabled { opacity: 0.5; cursor: not-allowed; }
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
				.ib-aa-rth--bar { width: 140px; }
				.ib-aa-rth--target { display: none; }
				.ib-aa-row-bar-wrap, .ib-aa-no-target { width: 140px; }
				.ib-aa-row-target-text { display: none; }
				.ib-aa-btn-transfer { display: none; }
				.ib-aa-pool-terr, .ib-aa-pool-last { display: none; }
			}
		`;
		document.head.appendChild(s);
	}
}
