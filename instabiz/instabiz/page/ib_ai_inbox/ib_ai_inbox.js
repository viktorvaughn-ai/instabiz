frappe.pages["ib-ai-inbox"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "AI Inbox",
		single_column: true,
	});
	wrapper.page_obj = page;
	frappe.ib_ai_inbox = new IBAIInbox(page, wrapper);
};

// Module order for display
const IB_MODULES = ["All", "Sales", "Production", "Finance", "Operations", "HR", "Procurement", "Custom"];

const STATUS_ICON = {
	pending:  `<iconify-icon icon="lucide:clock"        width="12" height="12" style="color:#f59e0b;vertical-align:middle"></iconify-icon>`,
	approved: `<iconify-icon icon="lucide:check-circle" width="12" height="12" style="color:#16a34a;vertical-align:middle"></iconify-icon>`,
	rejected: `<iconify-icon icon="lucide:x-circle"     width="12" height="12" style="color:#dc2626;vertical-align:middle"></iconify-icon>`,
};

const MODULE_COLORS = {
	Sales: "#4e7fff", Finance: "#ef4444", Operations: "#7c4dff",
	Production: "#059669", HR: "#2563eb", Procurement: "#f59e0b", Custom: "#888888",
};

// ── Main class ────────────────────────────────────────────────────────────────

class IBAIInbox {
	constructor(page, wrapper) {
		this.page          = page;
		this.wrapper       = wrapper;
		this.$root         = $(wrapper).find(".layout-main-section");
		this.status_filter = "pending";
		this.agent_filter  = "";
		this.module_filter = "";
		this.start         = 0;
		this.page_length   = 20;
		this.total         = 0;
		this.agents        = {};  // populated by _load_registry()
		this._show_agents  = false;
		this._build_toolbar();
		this._build_html();
		this._inject_styles();
		// Load registry then render
		this._load_registry(() => this._load());
	}

	// ── Agent registry ────────────────────────────────────────────────────────

	_load_registry(cb) {
		frappe.call({
			method: "instabiz.overrides.ai_agents.get_agent_registry",
			callback: (r) => {
				if (r.message) {
					this.agents = r.message;
					this._populate_agent_dropdown();
				}
				if (cb) cb();
			},
			error: () => { if (cb) cb(); },
		});
	}

	_populate_agent_dropdown() {
		if (!this._agent_ctrl) return;
		const opts = "\n" + Object.keys(this.agents).join("\n");
		this._agent_ctrl.df.options = opts;
		this._agent_ctrl.refresh();
	}

	// ── Toolbar ───────────────────────────────────────────────────────────────

	_build_toolbar() {
		const p = this.page;

		p.add_button(__("Run All Agents"), () => this._run_agents(), { btn_class: "btn-primary" });
		p.add_button(__("Agents"), () => this._toggle_agents_view());
		p.add_button(__("Refresh"), () => this._reload_page());

		this._status_ctrl = p.add_field({
			fieldtype: "Select",
			fieldname: "status",
			label: "Status",
			options: "\npending\napproved\nrejected",
			default: "pending",
			change: () => {
				this.status_filter = this._status_ctrl.get_value() || "pending";
				this._reload_page();
			},
		});
		this._status_ctrl.set_value("pending");

		this._agent_ctrl = p.add_field({
			fieldtype: "Select",
			fieldname: "agent",
			label: "Agent",
			options: "",
			change: () => {
				this.agent_filter = this._agent_ctrl.get_value() || "";
				this._reload_page();
			},
		});

		this._module_ctrl = p.add_field({
			fieldtype: "Select",
			fieldname: "module",
			label: "Module",
			options: IB_MODULES.join("\n"),
			change: () => {
				const v = this._module_ctrl.get_value() || "";
				this.module_filter = (v === "All") ? "" : v;
				this._reload_page();
			},
		});
	}

	// ── Page skeleton ─────────────────────────────────────────────────────────

	_build_html() {
		this.$root.html(`
			<div class="ib-ai-page">
				<div class="ib-ai-status-bar" id="ib-ai-status-bar"></div>
				<div class="ib-ai-agents-view" id="ib-ai-agents-view" style="display:none"></div>
				<div class="ib-ai-inbox-view" id="ib-ai-inbox-view">
					<div class="ib-ai-module-chips" id="ib-ai-module-chips"></div>
					<div class="ib-ai-list" id="ib-ai-list"></div>
					<div class="ib-ai-pagination" id="ib-ai-pagination"></div>
				</div>
			</div>
		`);
		this.$status      = this.$root.find("#ib-ai-status-bar");
		this.$agents_view = this.$root.find("#ib-ai-agents-view");
		this.$inbox_view  = this.$root.find("#ib-ai-inbox-view");
		this.$chips       = this.$root.find("#ib-ai-module-chips");
		this.$list        = this.$root.find("#ib-ai-list");
		this.$pager       = this.$root.find("#ib-ai-pagination");
		this._build_module_chips();
	}

	_toggle_agents_view() {
		this._show_agents = !this._show_agents;
		if (this._show_agents) {
			this.$inbox_view.hide();
			this.$agents_view.show();
			this._render_agents_grid();
		} else {
			this.$agents_view.hide();
			this.$inbox_view.show();
		}
	}

	_render_agents_grid() {
		const MODULE_ORDER = ["Sales", "Production", "Finance", "Operations", "HR", "Procurement", "Custom"];

		frappe.call({
			method: "instabiz.overrides.ai_agents.get_agent_run_stats",
			callback: (r) => {
				const stats = r.message || {};
				const staticCount  = Object.values(this.agents).filter(a => !a.is_dynamic).length;
				const dynamicCount = Object.values(this.agents).filter(a =>  a.is_dynamic).length;
				let html = `<div class="ib-agents-header">
					<span class="ib-agents-title">
						<iconify-icon icon="lucide:cpu" width="16" height="16"
							style="vertical-align:middle;margin-right:6px"></iconify-icon>
						${Object.keys(this.agents).length} Agents
						<span class="ib-agents-badge" style="background:#e0f2fe;color:#0369a1">
							${staticCount} built-in
						</span>
						<span class="ib-agents-badge" style="background:#f0fdf4;color:#16a34a">
							${dynamicCount} custom
						</span>
					</span>
					<div style="display:flex;gap:8px;align-items:center">
						<a href="/app/ib-agent-definition/new-ib-agent-definition-1"
							class="ib-agents-new-btn" title="Create new dynamic agent">
							<iconify-icon icon="lucide:plus" width="12" height="12"></iconify-icon>
							New Agent
						</a>
						<button class="ib-agents-run-all-btn" id="ib-agents-run-all">
							<iconify-icon icon="lucide:play" width="12" height="12"></iconify-icon>
							Run All
						</button>
					</div>
				</div>`;

				MODULE_ORDER.forEach(mod => {
					const agents = Object.entries(this.agents).filter(([, v]) => v.module === mod);
					if (!agents.length) return;
					const mc = MODULE_COLORS[mod] || "#888";
					html += `<div class="ib-agents-module-section">
						<div class="ib-agents-module-label" style="color:${mc}">
							<span class="ib-agents-module-dot" style="background:${mc}"></span>
							${mod}
							<span class="ib-agents-module-count">${agents.length}</span>
						</div>
						<div class="ib-agents-grid">
							${agents.map(([code, meta]) => {
								const st = stats[code] || {};
								const last_run    = st.last_run    ? frappe.datetime.prettyDate(st.last_run) : "never";
								const last_count  = st.last_queued != null ? st.last_queued : "—";
								const total_q     = st.total_queued || 0;
								const last_status = st.last_status || "";
								const status_color = last_status === "success" ? "#16a34a"
									: last_status === "failed" ? "#dc2626" : "#888";
								const is_dynamic = meta.is_dynamic;
								const is_active  = meta.is_active !== false;
								const edit_link  = is_dynamic
									? `<a class="ib-agent-edit-link" href="/app/ib-agent-definition/${encodeURIComponent(code)}" target="_blank" title="Edit agent">
										<iconify-icon icon="lucide:pencil" width="10" height="10"></iconify-icon>
									</a>` : "";
								const dyn_badge  = is_dynamic
									? `<span class="ib-agent-dyn-badge">dynamic</span>` : "";
								const inactive_overlay = !is_active
									? `style="opacity:.45"` : "";
								return `<div class="ib-agent-card" data-agent="${code}" ${inactive_overlay}>
									<div class="ib-agent-card-top" style="border-top:3px solid ${meta.color}">
										<div class="ib-agent-icon-wrap" style="background:${meta.color}18;color:${meta.color}">
											<iconify-icon icon="${meta.icon}" width="16" height="16"></iconify-icon>
										</div>
										<div class="ib-agent-card-info">
											<div class="ib-agent-name">${frappe.utils.escape_html(meta.label)}
												${dyn_badge}${edit_link}
											</div>
											<div class="ib-agent-code">${code}</div>
										</div>
										<button class="ib-agent-run-btn" data-agent="${code}" title="Run ${frappe.utils.escape_html(meta.label)}" aria-label="Run ${frappe.utils.escape_html(meta.label)}">
											<iconify-icon icon="lucide:play" width="11" height="11"></iconify-icon>
										</button>
									</div>
									<div class="ib-agent-card-stats">
										<div class="ib-agent-stat">
											<span class="ib-agent-stat-val">${total_q}</span>
											<span class="ib-agent-stat-lbl">total actions</span>
										</div>
										<div class="ib-agent-stat">
											<span class="ib-agent-stat-val" style="color:${meta.color}">${last_count}</span>
											<span class="ib-agent-stat-lbl">last run</span>
										</div>
									</div>
									<div class="ib-agent-card-footer">
										${last_status ? `<span class="ib-agent-status-dot" style="background:${status_color}" title="${last_status}"></span>` : ""}
										<span class="ib-agent-last-run">${last_run}</span>
										<a class="ib-agent-view-link" href="#" data-agent="${code}">View actions →</a>
									</div>
								</div>`;
							}).join("")}
						</div>
					</div>`;
				});

				this.$agents_view.html(html);
				this.$agents_view.off("click");

				this.$agents_view.on("click", ".ib-agent-run-btn", (e) => {
					e.stopPropagation();
					const code = $(e.currentTarget).data("agent");
					const $btn = $(e.currentTarget);
					$btn.prop("disabled", true).html(`<iconify-icon icon="lucide:loader" width="11" height="11"></iconify-icon>`);
					frappe.call({
						method: "instabiz.overrides.ai_agents.run_agent",
						args: { agent_code: code },
						callback: (r) => {
							const queued = r.message?.queued ?? 0;
							$btn.prop("disabled", false).html(`<iconify-icon icon="lucide:play" width="11" height="11"></iconify-icon>`);
							const label = this.agents[code]?.label || code;
							frappe.show_alert({ message: `${label}: ${queued} queued`, indicator: queued > 0 ? "green" : "blue" }, 3);
							this._render_agents_grid();
						},
						error: () => {
							$btn.prop("disabled", false).html(`<iconify-icon icon="lucide:play" width="11" height="11"></iconify-icon>`);
						},
					});
				});

				this.$agents_view.on("click", ".ib-agent-view-link", (e) => {
					e.preventDefault();
					const code = $(e.currentTarget).data("agent");
					this.agent_filter = code;
					this.module_filter = "";
					this._toggle_agents_view();
					this._reload_page();
				});

				this.$agents_view.on("click", "#ib-agents-run-all", () => this._run_agents());
			},
		});
	}

	_build_module_chips() {
		const chips = IB_MODULES.map(m => {
			const active = (this.module_filter === m || (m === "All" && !this.module_filter));
			return `<button class="ib-ai-chip${active ? " active" : ""}" data-module="${m}">
				${m === "All"
					? `<iconify-icon icon="lucide:layout-grid" width="11" height="11"
						style="vertical-align:middle;margin-right:3px"></iconify-icon>`
					: ""}
				${m}
			</button>`;
		}).join("");
		this.$chips.html(chips);
		this.$chips.find(".ib-ai-chip").on("click", (e) => {
			const m = $(e.currentTarget).data("module");
			this.module_filter = m === "All" ? "" : m;
			this._build_module_chips();
			this._reload_page();
		});
	}

	// ── Load ──────────────────────────────────────────────────────────────────

	_reload_page() {
		this.start = 0;
		this._load();
	}

	_load() {
		this.$list.html(`<div style="text-align:center;padding:40px;color:var(--text-muted)">
			<iconify-icon icon="lucide:loader" width="20" height="20"
				style="display:block;margin:0 auto 10px;opacity:.5;animation:spin 1s linear infinite"></iconify-icon>
			Loading…
		</div>`);

		frappe.call({
			method: "instabiz.overrides.ai_agents.get_ai_status",
			callback: (r) => r.message && this._render_status(r.message),
		});

		frappe.call({
			method: "instabiz.overrides.ai_agents.get_ai_actions",
			args: {
				status:      this.status_filter || "all",
				agent:       this.agent_filter  || "all",
				module:      this.module_filter || "",
				start:       this.start,
				page_length: this.page_length,
			},
			callback: (r) => {
				const data = r.message || {};
				const actions = data.actions || [];
				this.total = data.total || 0;
				this._render_list(actions);
				this._render_pagination(data.total || 0, data.start || 0);
			},
			error: () => {
				this.$list.html(`<div style="padding:40px;text-align:center;color:#ef4444">
					Failed to load actions.</div>`);
			},
		});
	}

	// ── Status bar ────────────────────────────────────────────────────────────

	_render_status(s) {
		const claudeOk = s.claude_enabled;
		const totalAgents = s.total_agents || Object.keys(this.agents).length;
		const dynamicCount = s.dynamic_count || 0;
		this.$status.html(`
			<div class="ib-ai-status-pill" style="background:${claudeOk?"#e6f7ed":"#fdecea"};
				color:${claudeOk?"#1a7f4b":"#c0392b"}">
				<iconify-icon icon="${claudeOk?"lucide:cpu":"lucide:alert-circle"}" width="12" height="12"
					style="vertical-align:middle;margin-right:4px"></iconify-icon>
				${claudeOk ? "Claude Active" : "No API Key"}
			</div>
			<div class="ib-ai-status-pill">
				<iconify-icon icon="lucide:clock" width="12" height="12"
					style="vertical-align:middle;margin-right:4px;color:#f59e0b"></iconify-icon>
				${s.pending_actions} pending
			</div>
			<div class="ib-ai-status-pill">
				<iconify-icon icon="lucide:bot" width="12" height="12"
					style="vertical-align:middle;margin-right:4px;color:var(--primary)"></iconify-icon>
				${totalAgents} agents
				${dynamicCount > 0 ? `<span style="color:#16a34a;margin-left:4px">(+${dynamicCount} custom)</span>` : ""}
			</div>
			<a href="/app/ib-agent-definition/new-ib-agent-definition-1"
				class="ib-ai-status-pill ib-ai-new-agent-pill" title="Create new agent">
				<iconify-icon icon="lucide:plus" width="12" height="12"
					style="vertical-align:middle;margin-right:4px"></iconify-icon>
				New Agent
			</a>
		`);
	}

	// ── Action list ───────────────────────────────────────────────────────────

	_render_list(actions) {
		if (!actions.length) {
			this.$list.html(`
				<div style="text-align:center;padding:60px;color:var(--text-muted)">
					<iconify-icon icon="lucide:inbox" width="40" height="40"
						style="display:block;margin:0 auto 12px;opacity:.25"></iconify-icon>
					<div style="font-size:13px">No ${this.status_filter} actions
						${this.module_filter ? "in " + this.module_filter : ""}
					</div>
				</div>`);
			return;
		}

		const cards = actions.map(a => this._card_html(a)).join("");
		this.$list.html(`<div class="ib-ai-cards">${cards}</div>`);

		this.$list.find(".ib-approve-btn").on("click", (e) => {
			this._approve($(e.currentTarget).data("name"));
		});
		this.$list.find(".ib-reject-btn").on("click", (e) => {
			this._reject($(e.currentTarget).data("name"));
		});
	}

	_card_html(a) {
		const meta  = this.agents[a.agent] || { label: a.agent, icon: "lucide:bot", color: "#888", module: a.module || "Other" };
		const color = meta.color || "#888";
		const moduleName = a.module || meta.module || "";

		let draft_html = "";
		try {
			const d = JSON.parse(a.draft_json || "{}");
			const keys = Object.keys(d).slice(0, 8);
			if (keys.length) {
				draft_html = `<div class="ib-ai-draft">` +
					keys.map(k => {
						const val = String(d[k] || "");
						if (!val || val === "null" || val === "undefined") return "";
						return `<span class="ib-ai-draft-kv">
							<span class="ib-ai-draft-key">${frappe.utils.escape_html(k)}</span>
							<span class="ib-ai-draft-val">${frappe.utils.escape_html(val.slice(0, 80))}</span>
						</span>`;
					}).filter(Boolean).join("") +
					`</div>`;
			}
		} catch (_) {}

		const pendingBtns = a.status === "pending" ? `
			<button class="ib-ai-action-btn ib-ai-btn-approve ib-approve-btn"
				data-name="${frappe.utils.escape_html(a.name)}">
				<iconify-icon icon="lucide:check" width="11" height="11"
					style="vertical-align:middle;margin-right:3px"></iconify-icon>
				Approve &amp; Execute
			</button>
			<button class="ib-ai-action-btn ib-ai-btn-reject ib-reject-btn"
				data-name="${frappe.utils.escape_html(a.name)}">
				<iconify-icon icon="lucide:x" width="11" height="11"
					style="vertical-align:middle;margin-right:3px"></iconify-icon>
				Reject
			</button>` : "";

		const refLink = a.reference_doctype && a.reference_name
			? `<a href="/app/${frappe.router.slug(a.reference_doctype)}/${a.reference_name}"
				target="_blank" style="font-size:11px;color:var(--primary);text-decoration:none">
				<iconify-icon icon="lucide:external-link" width="10" height="10"
					style="vertical-align:middle;margin-right:2px"></iconify-icon>
				${frappe.utils.escape_html(a.reference_name)}
			</a>` : "";

		const decisionMeta = a.decided_by
			? `<span style="font-size:10px;color:var(--text-muted)">
				${STATUS_ICON[a.status] || ""} ${a.decided_by}
				${a.decided_at ? "· " + frappe.datetime.str_to_user(a.decided_at) : ""}
			</span>` : "";

		const claudeBadge = a.ai_generated
			? `<span class="ib-ai-claude-badge">
				<iconify-icon icon="lucide:sparkles" width="9" height="9"
					style="vertical-align:middle;margin-right:2px"></iconify-icon>
				Claude
			</span>` : "";

		const dynBadge = meta.is_dynamic
			? `<span class="ib-ai-dyn-badge">custom</span>` : "";

		return `
		<div class="ib-ai-card" data-name="${frappe.utils.escape_html(a.name)}"
			style="border-left:4px solid ${color}">
			<div class="ib-ai-card-header">
				<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
					<span class="ib-ai-agent-badge" style="background:${color}18;color:${color}">
						<iconify-icon icon="${meta.icon}" width="11" height="11"
							style="vertical-align:middle;margin-right:3px"></iconify-icon>
						${frappe.utils.escape_html(meta.label)}
					</span>
					${moduleName ? `<span class="ib-ai-module-badge">${frappe.utils.escape_html(moduleName)}</span>` : ""}
					${dynBadge}
					${claudeBadge}
					<span style="color:var(--text-muted);font-size:11px">
						${STATUS_ICON[a.status] || ""} ${a.status}
					</span>
				</div>
				<div style="display:flex;align-items:center;gap:8px">
					${refLink}
					<span style="font-size:11px;color:var(--text-muted)">
						${frappe.datetime.str_to_user(a.creation)}
					</span>
				</div>
			</div>
			<div class="ib-ai-card-title">${frappe.utils.escape_html(a.title || "")}</div>
			<div class="ib-ai-card-summary">${frappe.utils.escape_html(a.summary || "")}</div>
			${draft_html}
			<div class="ib-ai-card-footer">
				${pendingBtns}
				${decisionMeta}
			</div>
		</div>`;
	}

	// ── Pagination ────────────────────────────────────────────────────────────

	_render_pagination(total, start) {
		if (total <= this.page_length) { this.$pager.html(""); return; }
		const pages   = Math.ceil(total / this.page_length);
		const current = Math.floor(start / this.page_length) + 1;
		const from    = start + 1;
		const to      = Math.min(start + this.page_length, total);

		this.$pager.html(`
			<div class="ib-ai-pager">
				<button class="ib-ai-page-btn" id="ib-page-prev" ${current <= 1 ? "disabled" : ""}>
					<iconify-icon icon="lucide:chevron-left" width="14" height="14"
						style="vertical-align:middle"></iconify-icon>
					Prev
				</button>
				<span class="ib-ai-page-info">
					${from}–${to} of ${total}
				</span>
				<button class="ib-ai-page-btn" id="ib-page-next" ${current >= pages ? "disabled" : ""}>
					Next
					<iconify-icon icon="lucide:chevron-right" width="14" height="14"
						style="vertical-align:middle"></iconify-icon>
				</button>
			</div>
		`);

		this.$pager.find("#ib-page-prev").on("click", () => {
			this.start = Math.max(0, this.start - this.page_length);
			this._load();
		});
		this.$pager.find("#ib-page-next").on("click", () => {
			this.start = this.start + this.page_length;
			this._load();
		});
	}

	// ── Approve / reject ──────────────────────────────────────────────────────

	_approve(name) {
		frappe.confirm(`Execute action <b>${name}</b>? This will apply the suggested action immediately.`, () => {
			const $card = this.$list.find(`[data-name="${name}"]`);
			$card.find(".ib-approve-btn").prop("disabled", true).text("Executing…");
			frappe.call({
				method: "instabiz.overrides.ai_agents.approve_action",
				args: { name },
				callback: (r) => {
					if (r.message?.success) {
						frappe.show_alert({ message: r.message.result || "Action executed", indicator: "green" });
						this._load();
					}
				},
				error: () => frappe.show_alert({ message: "Execute failed — see error log", indicator: "red" }),
			});
		});
	}

	_reject(name) {
		frappe.call({
			method: "instabiz.overrides.ai_agents.reject_action",
			args: { name },
			callback: (r) => {
				if (r.message?.success) {
					frappe.show_alert({ message: "Rejected", indicator: "orange" });
					this._load();
				}
			},
			error: () => frappe.show_alert({ message: "Reject failed — see error log", indicator: "red" }),
		});
	}

	// ── Run agents ────────────────────────────────────────────────────────────

	_run_agents() {
		const $btn = this.page.$btn_primary || this.page.$primary_action;
		if ($btn) $btn.text("Running…").prop("disabled", true);
		frappe.call({
			method: "instabiz.overrides.ai_agents.run_all_agents",
			callback: (r) => {
				if ($btn) $btn.text("Run All Agents").prop("disabled", false);
				if (r.message?.success) {
					const res   = r.message.results || {};
					const total = Object.values(res).reduce((s, v) => s + (typeof v === "number" ? v : 0), 0);
					const count = Object.keys(res).length;
					frappe.show_alert({
						message: `${count} agents ran. ${total} new actions queued.`,
						indicator: total > 0 ? "green" : "blue",
					});
					this._reload_page();
					this._load_registry(() => {});
				}
			},
		});
	}

	// ── Styles ────────────────────────────────────────────────────────────────

	_inject_styles() {
		if (document.getElementById("ib-ai-inbox-styles")) return;
		const s = document.createElement("style");
		s.id = "ib-ai-inbox-styles";
		s.textContent = `
		@keyframes spin { to { transform: rotate(360deg); } }

		.ib-ai-page {
			padding: 16px;
			max-width: 980px;
			margin: 0 auto;
		}
		.ib-ai-status-bar {
			display: flex;
			gap: 8px;
			margin-bottom: 12px;
			flex-wrap: wrap;
			align-items: center;
		}
		.ib-ai-status-pill {
			background: var(--card-bg);
			border: 1px solid var(--border-color);
			border-radius: 16px;
			padding: 4px 12px;
			font-size: 12px;
			font-weight: 600;
		}
		a.ib-ai-status-pill { text-decoration: none; color: var(--text-color); }
		.ib-ai-new-agent-pill:hover { background: var(--primary); color: #fff; border-color: var(--primary); }
		.ib-ai-module-chips {
			display: flex;
			gap: 6px;
			margin-bottom: 14px;
			flex-wrap: wrap;
		}
		.ib-ai-chip {
			background: var(--card-bg);
			border: 1px solid var(--border-color);
			border-radius: 16px;
			padding: 4px 12px;
			font-size: 12px;
			cursor: pointer;
			transition: background .12s, color .12s;
		}
		.ib-ai-chip.active {
			background: var(--primary, #d97757);
			color: #fff;
			border-color: var(--primary, #d97757);
		}
		.ib-ai-cards {
			display: flex;
			flex-direction: column;
			gap: 10px;
			margin-bottom: 12px;
		}
		.ib-ai-card {
			background: var(--card-bg);
			border: 1px solid var(--border-color);
			border-radius: 8px;
			padding: 14px 16px;
			box-shadow: 0 1px 3px rgba(0,0,0,.05);
		}
		.ib-ai-card-header {
			display: flex;
			justify-content: space-between;
			align-items: flex-start;
			flex-wrap: wrap;
			gap: 6px;
			margin-bottom: 8px;
		}
		.ib-ai-agent-badge {
			display: inline-flex;
			align-items: center;
			padding: 2px 8px;
			border-radius: 12px;
			font-size: 11px;
			font-weight: 700;
			text-transform: uppercase;
			letter-spacing: .03em;
		}
		.ib-ai-module-badge {
			background: #f1f5f9;
			color: #64748b;
			font-size: 10px;
			font-weight: 700;
			padding: 1px 6px;
			border-radius: 8px;
			text-transform: uppercase;
		}
		.ib-ai-claude-badge {
			background: #e8f4fd;
			color: #2980b9;
			font-size: 10px;
			padding: 1px 6px;
			border-radius: 8px;
		}
		.ib-ai-dyn-badge {
			background: #f0fdf4;
			color: #16a34a;
			font-size: 10px;
			padding: 1px 6px;
			border-radius: 8px;
			font-weight: 600;
		}
		.ib-ai-card-title {
			font-weight: 600;
			font-size: 13px;
			color: var(--text-color);
			margin-bottom: 4px;
		}
		.ib-ai-card-summary {
			font-size: 12px;
			color: var(--text-muted);
			line-height: 1.5;
			margin-bottom: 8px;
		}
		.ib-ai-draft {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
			margin-bottom: 10px;
			padding: 8px;
			background: var(--subtle-fg, #f8fafc);
			border-radius: 6px;
		}
		.ib-ai-draft-kv {
			background: var(--card-bg);
			border: 1px solid var(--border-color);
			border-radius: 4px;
			padding: 2px 7px;
			font-size: 11px;
		}
		.ib-ai-draft-key {
			font-weight: 700;
			color: var(--text-muted);
			margin-right: 4px;
		}
		.ib-ai-draft-val { color: var(--text-color); }
		.ib-ai-card-footer {
			display: flex;
			align-items: center;
			gap: 8px;
			flex-wrap: wrap;
		}
		.ib-ai-action-btn {
			border: none;
			border-radius: 5px;
			padding: 4px 12px;
			font-size: 11px;
			font-weight: 600;
			cursor: pointer;
			transition: opacity .15s;
		}
		.ib-ai-action-btn:hover { opacity: .85; }
		.ib-ai-action-btn:disabled { opacity: .5; cursor: default; }
		.ib-ai-btn-approve { background: #059669; color: #fff; }
		.ib-ai-btn-reject  { background: none; border: 1px solid #dc2626; color: #dc2626; }
		.ib-ai-pager {
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 12px;
			padding: 12px 0;
		}
		.ib-ai-page-btn {
			background: var(--card-bg);
			border: 1px solid var(--border-color);
			border-radius: 6px;
			padding: 5px 14px;
			font-size: 12px;
			cursor: pointer;
		}
		.ib-ai-page-btn:disabled { opacity: .4; cursor: default; }
		.ib-ai-page-info { font-size: 12px; color: var(--text-muted); }

		/* ── Agents grid ── */
		.ib-agents-header {
			display: flex; align-items: center; justify-content: space-between;
			margin-bottom: 20px; flex-wrap: wrap; gap: 8px;
		}
		.ib-agents-title {
			font-size: 15px; font-weight: 700; color: var(--text-color);
			display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
		}
		.ib-agents-badge {
			font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px;
		}
		.ib-agents-new-btn {
			display: inline-flex; align-items: center; gap: 5px;
			padding: 6px 14px; border-radius: 6px;
			background: var(--card-bg); color: var(--text-color);
			border: 1px solid var(--border-color); font-size: 12px; font-weight: 600;
			text-decoration: none; transition: background .12s, border-color .12s;
		}
		.ib-agents-new-btn:hover { background: #f0fdf4; border-color: #16a34a; color: #16a34a; }
		.ib-agents-run-all-btn {
			display: inline-flex; align-items: center; gap: 5px;
			padding: 6px 14px; border-radius: 6px;
			background: var(--primary); color: #fff;
			border: none; font-size: 12px; font-weight: 600; cursor: pointer;
			transition: opacity .12s;
		}
		.ib-agents-run-all-btn:hover { opacity: .85; }
		.ib-agents-module-section { margin-bottom: 24px; }
		.ib-agents-module-label {
			display: flex; align-items: center; gap: 6px;
			font-size: 11px; font-weight: 700; text-transform: uppercase;
			letter-spacing: .06em; margin-bottom: 10px;
		}
		.ib-agents-module-dot { width: 8px; height: 8px; border-radius: 50%; }
		.ib-agents-module-count {
			background: var(--border-color); color: var(--text-muted);
			font-size: 10px; padding: 1px 6px; border-radius: 8px;
		}
		.ib-agents-grid {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
			gap: 10px;
		}
		.ib-agent-card {
			background: var(--card-bg); border: 1px solid var(--border-color);
			border-radius: 9px; overflow: hidden;
			transition: box-shadow .15s, transform .12s;
		}
		.ib-agent-card:hover { box-shadow: 0 4px 14px rgba(0,0,0,.09); transform: translateY(-1px); }
		.ib-agent-card-top {
			display: flex; align-items: center; gap: 8px;
			padding: 10px 10px 8px;
		}
		.ib-agent-icon-wrap {
			width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0;
			display: flex; align-items: center; justify-content: center;
		}
		.ib-agent-card-info { flex: 1; min-width: 0; }
		.ib-agent-name {
			font-size: 12px; font-weight: 700; color: var(--text-color);
			white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
			display: flex; align-items: center; gap: 4px;
		}
		.ib-agent-dyn-badge {
			background: #f0fdf4; color: #16a34a; font-size: 9px; font-weight: 600;
			padding: 1px 5px; border-radius: 6px; white-space: nowrap; flex-shrink: 0;
		}
		.ib-agent-edit-link { color: var(--text-muted); text-decoration: none; flex-shrink: 0; }
		.ib-agent-edit-link:hover { color: var(--primary); }
		.ib-agent-code { font-size: 10px; color: var(--text-muted); font-family: monospace; }
		.ib-agent-run-btn {
			flex-shrink: 0; width: 26px; height: 26px; border-radius: 6px;
			border: 1px solid var(--border-color); background: var(--card-bg);
			color: var(--text-muted); cursor: pointer; display: flex;
			align-items: center; justify-content: center;
			transition: border-color .12s, color .12s;
		}
		.ib-agent-run-btn:hover { border-color: var(--primary); color: var(--primary); }
		.ib-agent-run-btn:disabled { opacity: .5; cursor: default; }
		.ib-agent-card-stats {
			display: grid; grid-template-columns: 1fr 1fr;
			padding: 6px 10px; gap: 4px;
			background: var(--fg-color, #f9fafb); border-top: 1px solid var(--border-color);
		}
		.ib-agent-stat { text-align: center; }
		.ib-agent-stat-val { display: block; font-size: 14px; font-weight: 700; line-height: 1.2; }
		.ib-agent-stat-lbl { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); }
		.ib-agent-card-footer {
			display: flex; align-items: center; gap: 6px;
			padding: 5px 10px; border-top: 1px solid var(--border-color);
		}
		.ib-agent-status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
		.ib-agent-last-run { font-size: 10px; color: var(--text-muted); flex: 1; }
		.ib-agent-view-link { font-size: 10px; color: var(--primary); text-decoration: none; white-space: nowrap; }
		.ib-agent-view-link:hover { text-decoration: underline; }
		`;
		document.head.appendChild(s);
	}
}
