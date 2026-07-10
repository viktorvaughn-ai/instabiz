frappe.pages["ib-system-health"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({ parent: wrapper, title: "System Health", single_column: true });
	wrapper._ib_health = new IBSystemHealth(wrapper);
};

frappe.pages["ib-system-health"].on_page_show = function (wrapper) {
	if (wrapper._ib_health) wrapper._ib_health.refresh();
};

const IB_HEALTH_COLOR = {
	online: "#10b981",
	offline: "#ef4444",
	degraded: "#f59e0b",
	unknown: "#94a3b8",
};

class IBSystemHealth {
	constructor(wrapper) {
		this.$wrap = $(wrapper).find(".layout-main-section");
		this._fetching = false;
		this._inject_styles();
		this._build_layout();
	}

	_inject_styles() {
		if (document.getElementById("ib-health-css")) return;
		const s = document.createElement("style");
		s.id = "ib-health-css";
		s.textContent = `
.ib-health-wrap { padding:16px; max-width:1200px; }
.ib-health-toolbar { display:flex; align-items:center; gap:10px; margin-bottom:18px; flex-wrap:wrap; }
.ib-health-toolbar h2 { font-size:1.15rem; font-weight:700; color:var(--heading-color); margin:0; flex:1; }
.ib-health-ts { font-size:11px; color:var(--text-muted); }
.ib-health-btn { padding:5px 13px; border:1px solid var(--border-color,#e2e8f0); border-radius:6px;
  background:var(--card-bg,#fff); color:var(--text-color); cursor:pointer; font-size:12px; transition:all .15s; }
.ib-health-btn:hover { border-color:#d97757; color:#d97757; }
.ib-health-summary { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600;
  padding:4px 12px; border-radius:99px; margin-left:8px; }
.ib-health-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:12px; }
.ib-health-card { background:var(--card-bg,#fff); border:1px solid var(--border-color,#e2e8f0);
  border-radius:10px; padding:16px 18px; display:flex; flex-direction:column; gap:6px; }
.ib-health-card-top { display:flex; align-items:center; gap:8px; }
.ib-health-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
.ib-health-name { font-size:13px; font-weight:700; color:var(--heading-color); flex:1; }
.ib-health-status { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
.ib-health-detail { font-size:12px; color:var(--text-muted); word-break:break-word; line-height:1.4; }
.ib-health-empty { color:var(--text-muted); font-size:13px; padding:20px; text-align:center; }
.ib-health-restart { align-self:flex-start; margin-top:2px; padding:3px 10px; border:1px solid var(--border-color,#e2e8f0);
  border-radius:6px; background:var(--card-bg,#fff); color:var(--text-color); cursor:pointer; font-size:11px; }
.ib-health-restart:hover { border-color:#ef4444; color:#ef4444; }
.ib-health-restart:disabled { opacity:.5; cursor:not-allowed; }
`;
		document.head.appendChild(s);
	}

	_build_layout() {
		this.$wrap.html(`
			<div class="ib-health-wrap">
				<div class="ib-health-toolbar">
					<h2>System Health</h2>
					<span class="ib-health-ts"></span>
					<span class="ib-health-summary" style="display:none"></span>
					<button class="ib-health-btn ib-health-refresh">Refresh</button>
				</div>
				<div class="ib-health-grid"><div class="ib-health-empty">Loading…</div></div>
			</div>
		`);
		this.$wrap.find(".ib-health-refresh").on("click", () => this.refresh());
	}

	refresh() {
		if (this._fetching) return;
		this._fetching = true;
		const $btn = this.$wrap.find(".ib-health-refresh");
		$btn.prop("disabled", true).text("Checking…");

		frappe.call({
			method: "instabiz.instabiz.page.ib_system_health.ib_system_health.get_health_status",
			callback: (r) => {
				this._fetching = false;
				$btn.prop("disabled", false).text("Refresh");
				if (!r.message) return;
				this._render(r.message);
			},
			error: () => {
				this._fetching = false;
				$btn.prop("disabled", false).text("Refresh");
			},
		});
	}

	_render(data) {
		const checks = data.checks || [];
		this.$wrap.find(".ib-health-ts").text(
			"Last checked: " + frappe.datetime.str_to_user(data.checked_at)
		);

		const online = checks.filter((c) => c.status === "online").length;
		const $summary = this.$wrap.find(".ib-health-summary");
		const allOnline = online === checks.length;
		$summary
			.show()
			.css({
				background: allOnline ? "#d1fae5" : "#fef3c7",
				color: allOnline ? "#059669" : "#d97706",
			})
			.text(`${online}/${checks.length} online`);

		const $grid = this.$wrap.find(".ib-health-grid");
		if (!checks.length) {
			$grid.html('<div class="ib-health-empty">No checks configured.</div>');
			return;
		}

		$grid.html(
			checks
				.map((c) => {
					const color = IB_HEALTH_COLOR[c.status] || IB_HEALTH_COLOR.unknown;
					const restart_btn = c.key
						? `<button class="ib-health-restart" data-key="${c.key}" data-label="${frappe.utils.escape_html(c.label || "")}">Restart</button>`
						: "";
					return `
					<div class="ib-health-card">
						<div class="ib-health-card-top">
							<span class="ib-health-dot" style="background:${color}"></span>
							<span class="ib-health-name">${frappe.utils.escape_html(c.label || "")}</span>
							<span class="ib-health-status" style="color:${color}">${frappe.utils.escape_html(c.status || "")}</span>
						</div>
						<div class="ib-health-detail">${frappe.utils.escape_html(c.detail || "")}</div>
						${restart_btn}
					</div>`;
				})
				.join("")
		);

		$grid.find(".ib-health-restart").on("click", (e) => this._restart(e));
	}

	_restart(e) {
		const $btn = $(e.currentTarget);
		const key = $btn.data("key");
		const label = $btn.data("label");

		frappe.confirm(
			`Restart <b>${frappe.utils.escape_html(label)}</b>? It will be briefly unavailable.`,
			() => {
				$btn.prop("disabled", true).text("Restarting…");
				frappe.call({
					method: "instabiz.instabiz.page.ib_system_health.ib_system_health.restart_component",
					args: { component: key },
					callback: (r) => {
						const res = r.message || {};
						if (res.ok) {
							frappe.show_alert({ message: `${label} restarted`, indicator: "green" });
						} else {
							frappe.show_alert({ message: `${label} restart failed: ${res.error || res.output || ""}`, indicator: "red" });
						}
						setTimeout(() => this.refresh(), 3000);
					},
					error: () => {
						$btn.prop("disabled", false).text("Restart");
					},
				});
			}
		);
	}
}
