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
		this._dropdown_users_cache = [];
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
		const _is_full_manager = frappe.user.has_role("Sales Manager") || frappe.user.has_role("System Manager");
		if (_is_full_manager) {
			this.page.add_inner_button("+ Create New Team", () => self._show_create_team_modal());
			this.page.add_inner_button("Config", () => self._show_config_modal());
			this.page.add_inner_button("Fix Excess Assignments", () => self._run_cleanup());
		}
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
				if (!r.message) return;
				const { roster, team_territories, is_manager, leader_team } = r.message;
				self._is_manager = !!is_manager;
				self._leader_team = leader_team || null;
				self._apply_role_visibility();
				self._render_roster(roster, team_territories || {});
			},
		});
		this._fetch_users_cache();
		if (this._view_as_user) this._reload_va_board();
	}

	_apply_role_visibility() {
		const isLeader = !this._is_manager && !!this._leader_team;
		// Hide manager-only controls for team leaders
		this.page.inner_toolbar.find("button").filter((_, el) =>
			["+ Create New Team", "Config"].includes($(el).text().trim())
		).toggle(!isLeader);
		this.page.fields_dict?.admin_territory?.$wrapper?.toggle(!isLeader);
	}

	_fetch_users_cache() {
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
				<div class="ib-aa-rth ib-aa-rth--target">Sales Target</div>
				<div class="ib-aa-rth ib-aa-rth--actions"></div>
			</div>
		`);

		const render_group = (team_key, users) => {
			const av_color = self._avatar_color(users[0].user, users[0].team);
			const team_label = team_key === "__none__" ? "Unassigned" : team_key;
			const avg_pct = Math.round(users.reduce((s, u) => s + (u.target_pct || 0), 0) / users.length);
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
						${team_key !== "__none__" && this._is_manager ? `<button class="ib-aa-btn-team-kebab" title="Manage team">⋮</button>` : ""}
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
				const initials = (u.full_name || u.user).split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
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
				const tbar_color = tpct >= 80 ? "#22c55e" : tpct >= 40 ? "var(--ib-primary)" : "#cbd5e1";
				const target_html = u.target ? `<div class="ib-aa-row-target-wrap">
					<div class="ib-aa-row-target-text">
						<span class="ib-aa-target-actual ib-aa-pct--${tpct_cls}">${fmt_short(u.actual || 0)}</span>
						<span class="ib-aa-target-sep">/</span>
						<span class="ib-aa-target-goal">${fmt_short(u.target || 0)}</span>
						<span class="ib-aa-target-pct ib-aa-pct--${tpct_cls}">${tpct}%</span>
					</div>
					<div class="ib-aa-target-bar-track">
						<div class="ib-aa-target-bar-fill" style="width:${Math.min(tpct,100)}%;background:${tbar_color}"></div>
					</div>
				</div>` : `<div class="ib-aa-row-target-wrap"><span class="ib-aa-target-goal" style="padding-left:8px">—</span></div>`;

				const $row = $(`
					<div class="ib-aa-user-row">
						<div class="ib-aa-row-identity">
							<div class="ib-aa-row-avatar" style="background:${av}">${initials}</div>
							<div class="ib-aa-row-name-wrap">
								<span class="ib-aa-row-name">${frappe.utils.escape_html(u.full_name || u.user)}</span>
								${u.is_leader ? `<svg class="ib-aa-tl-badge" viewBox="0 0 24 24" width="26" height="26" title="Team Leader" xmlns="http://www.w3.org/2000/svg"><polygon points="12,1 13.6,6.2 17.5,2.5 16.2,7.8 21.5,6.5 17.8,10.5 23,12 17.8,13.6 21.5,17.5 16.2,16.2 17.5,21.5 13.6,17.8 12,23 10.4,17.8 6.5,21.5 7.8,16.2 2.5,17.5 6.2,13.6 1,12 6.2,10.4 2.5,6.5 7.8,7.8 6.5,2.5 10.4,6.2" fill="#f59e0b"/><text x="12" y="14.5" text-anchor="middle" font-size="6.5" font-weight="900" fill="white" font-family="Inter,sans-serif">TL</text></svg>` : ""}
								${no_tmrw ? `<span class="ib-aa-no-tmrw-dot" title="No assignments queued for tomorrow">⚠</span>` : ""}
							</div>
						</div>
						<div class="ib-aa-row-stat ib-aa-row-stat--done">${u.done}</div>
						<div class="ib-aa-row-stat ib-aa-row-stat--pending">${u.pending}</div>
						<div class="ib-aa-row-stat ib-aa-row-stat--tmrw">${u.tomorrow_count}</div>
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

		const _mgr_only = this._is_manager;
		$d.html(`
			<div class="ib-aa-kdrop-header">
				<div class="ib-aa-kdrop-name">${frappe.utils.escape_html(u.full_name || u.user)}</div>
				${u.target ? `<div class="ib-aa-kdrop-target">${fmt_inr(u.actual)} / ${fmt_inr(u.target)} &mdash; ${u.target_pct || 0}%</div>` : ""}
			</div>
			<button class="ib-aa-kdrop-item ib-aa-kdrop-view">View board</button>
			${_mgr_only ? `
			<button class="ib-aa-kdrop-item ib-aa-kdrop-auto">Auto-fill</button>
			<button class="ib-aa-kdrop-item ib-aa-kdrop-transfer">Transfer</button>
			<button class="ib-aa-kdrop-item ib-aa-kdrop-set-target">Set target</button>
			<div class="ib-aa-kdrop-sep"></div>
			<button class="ib-aa-kdrop-item ib-aa-kdrop-hide">Hide user</button>
			` : ""}
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
			size: "large",
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

		// Build territory → team map from _last_team_territories (team → [territories])
		const territory_team_map = {};
		Object.entries(self._last_team_territories || {}).forEach(([team, territories]) => {
			territories.forEach(t => { if (team !== team_name) territory_team_map[t] = team; });
		});

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
			<div class="ib-tm-picker-row" data-user="${frappe.utils.escape_html(u.name)}" data-search="${frappe.utils.escape_html((u.full_name || "") + " " + u.name).toLowerCase()}"${other_team ? ` data-other-team="${frappe.utils.escape_html(other_team)}"` : ""}>
				<div class="ib-tm-row-av" style="background:${color}">${initials}</div>
				<div class="ib-tm-row-info">
					<span class="ib-tm-row-name">${frappe.utils.escape_html(u.full_name || u.name)}</span>
					<span class="ib-tm-row-sub">${frappe.utils.escape_html(u.name)} ${team_badge}</span>
				</div>
				<button class="ib-tm-picker-add-btn${other_team ? " ib-tm-picker-add-btn--blocked" : ""}" data-user="${frappe.utils.escape_html(u.name)}"${other_team ? ' title="Already in another team"' : ""}>+ Add</button>
			</div>`;
		}).join("") || `<div class="ib-tm-empty">All users already in this team</div>`;

		const PIN_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1C5.24 1 3 3.24 3 6c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5zm0 6.5A1.5 1.5 0 1 1 8 4a1.5 1.5 0 0 1 0 3.5z" fill="currentColor"/></svg>`;

		// Territory rows — assigned (with Remove)
		const territory_rows = team.territories.length
			? team.territories.map(t => `
				<div class="ib-tm-row">
					<div class="ib-tm-territory-icon">${PIN_SVG}</div>
					<div class="ib-tm-row-info">
						<span class="ib-tm-row-name">${frappe.utils.escape_html(t.territory)}</span>
					</div>
					<button class="ib-tm-remove-btn" data-territory="${frappe.utils.escape_html(t.territory)}">Remove</button>
				</div>`).join("")
			: `<div class="ib-tm-empty">No territories assigned yet</div>`;

		// Territory picker rows — available to add (with + Add), filtered by search
		const territory_picker_rows = available_territories.map(t => {
			const other_team_t = territory_team_map[t] || null;
			return `
			<div class="ib-tm-picker-row" data-territory="${frappe.utils.escape_html(t)}" data-tsearch="${frappe.utils.escape_html(t).toLowerCase()}"${other_team_t ? ` data-other-team="${frappe.utils.escape_html(other_team_t)}"` : ""}>
				<div class="ib-tm-territory-icon">${PIN_SVG}</div>
				<div class="ib-tm-row-info">
					<span class="ib-tm-row-name">${frappe.utils.escape_html(t)}</span>
					${other_team_t ? `<span class="ib-tm-row-sub"><span class="ib-tm-team-badge" style="--badge-color:${self._avatar_color("", other_team_t)}">${frappe.utils.escape_html(other_team_t)}</span></span>` : ""}
				</div>
				<button class="ib-tm-picker-add-btn ib-tm-territory-picker-add-btn${other_team_t ? " ib-tm-picker-add-btn--blocked" : ""}" data-territory="${frappe.utils.escape_html(t)}"${other_team_t ? ` title="Already in ${frappe.utils.escape_html(other_team_t)}"` : ""}>+ Add</button>
			</div>`;
		}).join("") || `<div class="ib-tm-empty">All territories already assigned</div>`;

		$body.html(`
			<div class="ib-tm-cols">

				<!-- ── Members column ── -->
				<div class="ib-tm-col">
					<div class="ib-tm-section">
						<div class="ib-tm-section-label">Add Member</div>
						<div class="ib-tm-picker-head">
							<input class="ib-tm-picker-search" id="ib-tm-member-search" placeholder="Search users…" autocomplete="off">
						</div>
						<div class="ib-tm-picker-list" id="ib-tm-picker-list">${picker_rows}</div>
						<div class="ib-tm-section-label ib-tm-section-label--sub">In Team <span class="ib-tm-count">${team.members.length}</span></div>
						<div class="ib-tm-list">${member_rows}</div>
					</div>
				</div>

				<!-- ── Territories column ── -->
				<div class="ib-tm-col">
					<div class="ib-tm-section">
						<div class="ib-tm-section-label">Add Territory</div>
						<div class="ib-tm-picker-head">
							<input class="ib-tm-picker-search" id="ib-tm-territory-search" placeholder="Search territories…" autocomplete="off">
						</div>
						<div class="ib-tm-picker-list" id="ib-tm-territory-picker-list">${territory_picker_rows}</div>
						<div class="ib-tm-section-label ib-tm-section-label--sub">Assigned <span class="ib-tm-count">${team.territories.length}</span></div>
						<div class="ib-tm-list">${territory_rows}</div>
					</div>
				</div>

			</div>
		`);

		// Member search filter
		$body.find("#ib-tm-member-search").on("input", function() {
			const q = this.value.trim().toLowerCase();
			$body.find("#ib-tm-picker-list .ib-tm-picker-row").each(function() {
				const hay = $(this).data("search") || "";
				$(this).toggle(!q || hay.includes(q));
			});
		});

		// Territory search filter
		$body.find("#ib-tm-territory-search").on("input", function() {
			const q = this.value.trim().toLowerCase();
			$body.find("#ib-tm-territory-picker-list .ib-tm-picker-row").each(function() {
				const hay = $(this).data("tsearch") || "";
				$(this).toggle(!q || hay.includes(q));
			});
		});

		// Per-row add member — exclude territory add buttons which share the base class
		$body.find(".ib-tm-picker-row .ib-tm-picker-add-btn:not(.ib-tm-territory-picker-add-btn)").on("click", function() {
			const other_team = $(this).closest(".ib-tm-picker-row").data("other-team");
			if (other_team) {
				frappe.show_alert({
					message: __("User is already in team \"{0}\". Remove them from that team first.", [other_team]),
					indicator: "red",
				});
				return;
			}
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

		// Add territory (per-row)
		$body.find(".ib-tm-territory-picker-add-btn").on("click", function() {
			const other_team_t = $(this).closest(".ib-tm-picker-row").data("other-team");
			if (other_team_t) {
				frappe.show_alert({
					message: __("Territory is already assigned to team \"{0}\". Remove it from that team first.", [other_team_t]),
					indicator: "red",
				});
				return;
			}
			const territory = $(this).data("territory");
			const $btn = $(this).prop("disabled", true).text("…");
			frappe.call({
				method: "instabiz.overrides.customer_assignment.add_team_territory",
				args: { team_name, territory },
				callback(r) {
					if (r.message && r.message.status === "ok") {
						frappe.show_alert({ message: `${territory} added`, indicator: "green" });
						self._load_team_modal(d, $body, team_name);
					} else {
						$btn.prop("disabled", false).text("+ Add");
					}
				},
				error() { $btn.prop("disabled", false).text("+ Add"); },
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
							${IB_ICONS.svg("user", 13)}<span class="ib-va-col-title">My Accounts</span>
							<span class="ib-va-badge" id="ib-va-dormant-count">0</span>
						</div>
						<input class="ib-va-col-search" id="ib-va-dormant-search" placeholder="Search…" autocomplete="off">
						<div class="ib-va-cards" id="ib-va-dormant-cards"></div>
					</div>
					<div class="ib-va-col">
						<div class="ib-va-col-header">
							${IB_ICONS.svg("map_pin", 13)}<span class="ib-va-col-title">Territory</span>
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
							${this._is_manager ? `<button class="ib-va-remove-all-btn" id="ib-va-remove-all" title="Remove all pending">${IB_ICONS.svg("trash", 11)}</button>` : ""}
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
				${this._is_manager ? `<div class="ib-va-card-btns">
					<button class="ib-va-add-btn" data-customer="${frappe.utils.escape_html(r.customer)}">${IB_ICONS.svg("plus", 11)} Today</button>
					<button class="ib-va-tmrw-btn" data-customer="${frappe.utils.escape_html(r.customer)}">${IB_ICONS.svg("plus", 11)} Tomorrow</button>
				</div>` : ""}
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
				${is_pending && this._is_manager ? `<button class="ib-va-remove-btn" data-id="${frappe.utils.escape_html(r.name)}">${IB_ICONS.svg("trash", 11)} Remove</button>` : ""}
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
					get_query: () => {
						const base = { query: "frappe.core.doctype.user.user.user_query", filters: { ignore_user_type: 1 } };
						if (!this._is_manager && this._leader_team) {
							const members = (this._dropdown_users_cache || []).map(u => u.name);
							if (members.length) base.filters.name = ["in", members];
						}
						return base;
					},
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

	// ── Create Team ───────────────────────────────────────────────────────────

	_show_create_team_modal() {
		frappe.new_doc("Lead Sales Team");
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

	_run_cleanup() {
		const self = this;
		frappe.confirm(
			"This will trim Pending assignments exceeding the daily quota for today and tomorrow. Continue?",
			() => {
				frappe.call({
					method: "instabiz.overrides.customer_assignment.cleanup_excess_assignments",
					freeze: true,
					freeze_message: "Cleaning up excess assignments…",
					callback(r) {
						if (r.message != null) {
							const { removed_excess, total_removed } = r.message;
							frappe.show_alert({
								message: `Cleanup done: ${removed_excess} excess assignment${removed_excess !== 1 ? "s" : ""} removed`,
								indicator: total_removed > 0 ? "green" : "blue",
							});
							self.refresh();
						}
					},
				});
			}
		);
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
			.ib-aa-rth--target  { width: 220px; padding-left: 8px; border-left: 1px solid var(--border-color); }

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
			.ib-aa-tl-badge { flex-shrink: 0; display: inline-block; vertical-align: middle; }

			/* Stat cells */
			.ib-aa-row-stat {
				width: 72px; text-align: center;
				font-size: 15px; font-weight: 700;
				border-left: 1px solid var(--border-color);
			}
			.ib-aa-row-stat--done    { color: #15803d; }
			.ib-aa-row-stat--pending { color: #b45309; }
			.ib-aa-row-stat--tmrw    { color: #1d4ed8; }

			.ib-aa-row-target-wrap {
				width: 220px; flex-shrink: 0;
				display: flex; flex-direction: column; gap: 3px; padding-left: 8px;
				border-left: 1px solid var(--border-color);
				justify-content: center;
			}
			.ib-aa-row-target-text {
				display: flex; align-items: center; gap: 4px;
				font-size: 12px; font-variant-numeric: tabular-nums;
			}
			.ib-aa-target-actual { font-weight: 700; }
			.ib-aa-target-sep { color: var(--text-muted); font-size: 11px; }
			.ib-aa-target-goal { color: var(--text-muted); }
			.ib-aa-target-pct { font-size: 10px; font-weight: 700; margin-left: auto; }
			.ib-aa-target-bar-track {
				height: 4px; background: var(--border-color);
				border-radius: 3px; overflow: hidden;
			}
			.ib-aa-target-bar-fill {
				height: 100%; border-radius: 3px;
				transition: width 0.5s cubic-bezier(0.4,0,0.2,1);
			}
			.ib-aa-row-bar-track {
				flex: 1; height: 6px; background: var(--border-color);
				border-radius: 4px; overflow: hidden;
			}
			.ib-aa-row-bar-fill {
				height: 100%; border-radius: 4px;
				transition: width 0.5s cubic-bezier(0.4,0,0.2,1);
			}
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
			.ib-tm-body { padding: 4px 0; }
			.ib-tm-loading { text-align: center; color: var(--text-muted); padding: 20px; font-size: 13px; }
			.ib-tm-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
			.ib-tm-col { display: flex; flex-direction: column; min-width: 0; }
			.ib-tm-col .ib-tm-section { display: flex; flex-direction: column; }
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
			.ib-tm-list { display: flex; flex-direction: column; max-height: 200px; overflow-y: auto; }
			.ib-tm-section-label--sub {
				border-top: 2px solid var(--border-color);
				background: var(--bg-color);
				font-size: 9px; letter-spacing: 0.8px;
			}
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
				display: inline-flex; align-items: center; gap: 3px;
				padding: 1px 5px; border-radius: 10px;
				font-size: 9px; font-weight: 700; white-space: nowrap;
				background: color-mix(in srgb, var(--badge-color) 12%, transparent);
				color: var(--badge-color);
				border: 1px solid color-mix(in srgb, var(--badge-color) 25%, transparent);
				vertical-align: middle; line-height: 1.4;
			}
			.ib-tm-team-badge::before { content: "●"; font-size: 6px; }
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
			.ib-tm-picker-add-btn--blocked {
				border-color: var(--border-color); background: var(--subtle-bg);
				color: var(--text-muted); cursor: not-allowed;
			}
			.ib-tm-picker-add-btn--blocked:hover { background: var(--subtle-bg); color: var(--text-muted); }

			/* Territory icon — mirrors member avatar circle */
			.ib-tm-territory-icon {
				width: 28px; height: 28px; border-radius: 50%;
				border: 1px solid var(--border-color);
				display: flex; align-items: center; justify-content: center;
				flex-shrink: 0; color: var(--text-muted); background: var(--subtle-bg);
			}

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

			/* ── Manager Queue table ── */
			.ib-aa-queue-thead {
				display: flex; align-items: center;
				padding: 6px 20px;
				background: var(--subtle-bg);
				border-bottom: 1px solid var(--border-color);
			}
			.ib-aa-qth {
				font-size: 10px; font-weight: 700; text-transform: uppercase;
				letter-spacing: 0.5px; color: var(--text-muted);
			}
			.ib-aa-qth--customer { flex: 1; min-width: 0; }
			.ib-aa-qth--territory, .ib-aa-qth--last, .ib-aa-qth--claimed, .ib-aa-qth--action {
				flex-shrink: 0; border-left: 1px solid var(--border-color); padding-left: 12px;
			}
			.ib-aa-qth--territory { width: 140px; }
			.ib-aa-qth--last      { width: 110px; }
			.ib-aa-qth--claimed   { width: 160px; }
			.ib-aa-qth--action    { width: 52px; }

			.ib-aa-queue-row {
				display: flex; align-items: center;
				padding: 10px 20px;
				border-bottom: 1px solid var(--border-color);
				border-left: 3px solid transparent;
				transition: background 0.12s, border-left-color 0.12s;
			}
			.ib-aa-queue-row:last-child { border-bottom: none; }
			.ib-aa-queue-row:hover { background: var(--subtle-bg); border-left-color: var(--ib-primary); }

			.ib-aa-qcol--customer { flex: 1; min-width: 0; }
			.ib-aa-qcol-name {
				font-size: 13px; font-weight: 600;
				white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
			}
			.ib-aa-qcol-code {
				font-size: 11px; color: var(--text-muted); margin-top: 1px;
				white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
			}
			.ib-aa-qcol--territory {
				width: 140px; flex-shrink: 0;
				border-left: 1px solid var(--border-color); padding-left: 12px;
				font-size: 12px; color: var(--text-muted);
				white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
			}
			.ib-aa-qcol--last {
				width: 110px; flex-shrink: 0;
				border-left: 1px solid var(--border-color); padding-left: 12px;
				font-size: 12px; color: var(--text-muted); white-space: nowrap;
			}
			.ib-aa-qcol--claimed {
				width: 160px; flex-shrink: 0;
				border-left: 1px solid var(--border-color); padding-left: 12px;
			}
			.ib-aa-qcol--action {
				width: 52px; flex-shrink: 0;
				border-left: 1px solid var(--border-color); padding-left: 12px;
				display: flex; align-items: center; justify-content: center;
			}
			.ib-aa-queue-claimer-filter {
				padding: 5px 8px; border: 1px solid var(--border-color);
				border-radius: 6px; font-size: 12px;
				background: var(--card-bg); color: var(--text-color);
				cursor: pointer; transition: border-color 0.15s;
			}
			.ib-aa-queue-claimer-filter:focus { outline: none; border-color: var(--ib-primary); }
			.ib-aa-queue-dot-btn {
				width: 28px; height: 28px; border-radius: 6px;
				border: 1px solid var(--border-color); background: var(--card-bg);
				cursor: pointer; color: var(--text-muted);
				display: flex; align-items: center; justify-content: center; padding: 0;
				transition: all 0.15s;
			}
			.ib-aa-queue-dot-btn:hover { border-color: var(--ib-primary); color: var(--ib-primary); background: #fdf6f3; }
			.ib-aa-queue-dot-btn:disabled { opacity: 0.4; cursor: not-allowed; }

			@media (max-width: 900px) {
				.ib-va-columns { grid-template-columns: repeat(2, 1fr); }
				.ib-aa-rth--target { width: 140px; }
				.ib-aa-row-target-wrap { width: 140px; }
				.ib-aa-btn-transfer { display: none; }
				.ib-aa-qth--territory, .ib-aa-qcol--territory { display: none; }
				.ib-aa-qth--last, .ib-aa-qcol--last { display: none; }
			}
		`;
		document.head.appendChild(s);
	}
}
