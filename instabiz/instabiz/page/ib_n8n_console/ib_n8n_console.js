frappe.pages["ib-n8n-console"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent:    wrapper,
		title:     "n8n Console",
		single_column: true,
	});
	wrapper._page_instance = new IbN8nConsole(page, wrapper);
};

frappe.pages["ib-n8n-console"].on_page_hide = function (wrapper) {
	const inst = wrapper._page_instance;
	if (inst && inst._refresh_timer) {
		clearInterval(inst._refresh_timer);
		inst._refresh_timer = null;
	}
};

class IbN8nConsole {
	constructor(page, wrapper) {
		this.page    = page;
		this.wrapper = wrapper;
		this.$body   = $(wrapper).find(".page-content");
		this._data   = null;
		this._wf_map = new Map();
		this._init();
	}

	_init() {
		this._build_shell();
		this._attach_actions();
		this.refresh();
		// Auto-refresh every 30 s
		this._refresh_timer = setInterval(() => this.refresh(), 30000);
	}

	_build_shell() {
		this.$body.html(`
<div class="ib-n8n" style="max-width:1100px;margin:0 auto;padding:18px 0 40px;">

  <!-- Status bar -->
  <div class="ib-n8n-statusbar" style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding:12px 16px;border-radius:10px;background:var(--card-bg);border:1px solid var(--border-color);">
    <span class="ib-n8n-dot" style="width:12px;height:12px;border-radius:50%;background:#aaa;flex-shrink:0;"></span>
    <span class="ib-n8n-status-text" style="font-weight:600;">Connecting…</span>
    <span class="ib-n8n-url" style="color:var(--text-muted);font-size:12px;margin-left:4px;"></span>
    <span style="flex:1;"></span>
    <a class="ib-n8n-open-link btn btn-xs btn-default" href="#" target="_blank" style="display:none;">Open n8n ↗</a>
    <button class="ib-n8n-refresh btn btn-xs btn-default">↻ Refresh</button>
  </div>

  <!-- Config warning -->
  <div class="ib-n8n-warn" style="display:none;margin-bottom:16px;padding:12px 16px;border-radius:8px;background:#fff3cd;border:1px solid #ffc107;color:#856404;font-size:13px;"></div>

  <!-- Tabs -->
  <div class="ib-n8n-tabs" style="display:flex;gap:0;border-bottom:2px solid var(--border-color);margin-bottom:20px;">
    <button class="ib-n8n-tab active" data-tab="workflows" style="padding:8px 20px;border:none;background:none;cursor:pointer;font-weight:600;border-bottom:3px solid var(--primary);margin-bottom:-2px;color:var(--primary);">Workflows</button>
    <button class="ib-n8n-tab" data-tab="executions" style="padding:8px 20px;border:none;background:none;cursor:pointer;color:var(--text-muted);">Executions</button>
    <button class="ib-n8n-tab" data-tab="errors" style="padding:8px 20px;border:none;background:none;cursor:pointer;color:var(--text-muted);">Webhook Errors</button>
  </div>

  <!-- Workflows panel -->
  <div class="ib-n8n-panel" data-panel="workflows">
    <div class="ib-n8n-wf-list"></div>
  </div>

  <!-- Executions panel -->
  <div class="ib-n8n-panel" data-panel="executions" style="display:none;">
    <div class="ib-n8n-exec-list"></div>
  </div>

  <!-- Webhook errors panel -->
  <div class="ib-n8n-panel" data-panel="errors" style="display:none;">
    <div class="ib-n8n-err-list"></div>
  </div>

</div>`);
	}

	_attach_actions() {
		this.$body.on("click", ".ib-n8n-tab", (e) => {
			const tab = $(e.currentTarget).data("tab");
			this.$body.find(".ib-n8n-tab").css({ fontWeight: "", color: "var(--text-muted)", borderBottom: "none" });
			$(e.currentTarget).css({ fontWeight: "600", color: "var(--primary)", borderBottom: "3px solid var(--primary)", marginBottom: "-2px" });
			this.$body.find(".ib-n8n-panel").hide();
			this.$body.find(`.ib-n8n-panel[data-panel="${tab}"]`).show();
		});

		this.$body.on("click", ".ib-n8n-refresh", () => this.refresh());

		this.$body.on("change", ".ib-wf-toggle", async (e) => {
			const $cb = $(e.currentTarget);
			const wf_id = $cb.data("wfid");
			const active = $cb.prop("checked");
			$cb.prop("disabled", true);
			const res = await frappe.xcall("instabiz.instabiz.page.ib_n8n_console.ib_n8n_console.toggle_workflow", {
				workflow_id: wf_id,
				active:      active,
			});
			if (!res.ok) {
				frappe.msgprint(__("Toggle failed: {0}", [res.error || `HTTP ${res.status_code}`]));
				$cb.prop("checked", !active); // revert
			}
			$cb.prop("disabled", false);
			setTimeout(() => this.refresh(), 800);
		});

		this.$body.on("click", ".ib-exec-row", async (e) => {
			const exec_id = $(e.currentTarget).data("execid");
			if (!exec_id) return;
			const res = await frappe.xcall("instabiz.instabiz.page.ib_n8n_console.ib_n8n_console.get_execution_detail", {
				execution_id: exec_id,
			});
			if (!res.ok) {
				frappe.msgprint(__("Could not load execution detail."));
				return;
			}
			this._show_exec_detail(res.data);
		});
	}

	async refresh() {
		const $dot  = this.$body.find(".ib-n8n-dot");
		const $txt  = this.$body.find(".ib-n8n-status-text");
		const $warn = this.$body.find(".ib-n8n-warn");
		$dot.css("background", "#aaa");
		$txt.text("Connecting…");

		let d;
		try {
			d = await frappe.xcall("instabiz.instabiz.page.ib_n8n_console.ib_n8n_console.get_n8n_status");
		} catch (e) {
			$txt.text("Failed to reach backend");
			return;
		}
		this._data = d;

		// Status bar
		const colors = { online: "#22c55e", degraded: "#f59e0b", offline: "#ef4444" };
		$dot.css("background", colors[d.status] || "#aaa");
		$txt.text(d.status === "online" ? "Online" : d.status === "degraded" ? "Degraded" : "Offline");
		this.$body.find(".ib-n8n-url").text(d.n8n_url);

		const $link = this.$body.find(".ib-n8n-open-link");
		$link.attr("href", d.n8n_url).show();

		// Config warning
		if (!d.api_key_set) {
			$warn.html(`<b>API key not set.</b> Add <code>n8n_api_key</code> to <code>sites/frontend/site_config.json</code>, then restart bench. Generate a key in n8n → Settings → API Keys.`).show();
		} else if (d.error) {
			$warn.html(`<b>Error:</b> ${frappe.utils.escape_html(d.error)}`).show();
		} else {
			$warn.hide();
		}

		this._render_workflows(d.workflows);
		this._render_executions(d.executions, d.workflows);
		this._render_errors(d.webhook_errors || []);
	}

	_render_workflows(workflows) {
		this._wf_map = new Map((workflows || []).map(w => [w.id, w]));
		const $el = this.$body.find(".ib-n8n-wf-list");
		if (!workflows || !workflows.length) {
			$el.html(`<div style="padding:40px;text-align:center;color:var(--text-muted);">${this._data && this._data.status !== "online" ? "n8n offline — no workflows to show." : "No workflows found."}</div>`);
			return;
		}

		const trigger_icons = { Webhook: "🔗", Schedule: "⏰", Manual: "👆", Email: "📧", Unknown: "⚙️" };

		const rows = workflows.map(w => {
			const updated = w.updatedAt ? frappe.datetime.str_to_user(w.updatedAt.slice(0, 19).replace("T", " ")) : "";
			const tags    = (w.tags || []).map(t => `<span style="padding:2px 7px;border-radius:10px;font-size:11px;background:#e2e8f0;color:#4a5568;">${frappe.utils.escape_html(t)}</span>`).join(" ");
			const icon    = trigger_icons[w.trigger_type] || "⚙️";
			return `
<div class="ib-wf-row" style="display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:8px;background:var(--card-bg);border:1px solid var(--border-color);margin-bottom:8px;">
  <span style="font-size:20px;">${icon}</span>
  <div style="flex:1;min-width:0;">
    <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${frappe.utils.escape_html(w.name)}</div>
    <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${w.trigger_type} · ${w.node_count} nodes · Updated ${updated} ${tags ? `&nbsp;${tags}` : ""}</div>
  </div>
  <span style="font-size:12px;padding:3px 10px;border-radius:12px;background:${w.active ? "#dcfce7" : "#f3f4f6"};color:${w.active ? "#166534" : "#6b7280"};">${w.active ? "Active" : "Inactive"}</span>
  <label style="position:relative;display:inline-block;width:38px;height:22px;flex-shrink:0;" title="${w.active ? "Deactivate" : "Activate"}">
    <input type="checkbox" class="ib-wf-toggle" data-wfid="${frappe.utils.escape_html(w.id)}" ${w.active ? "checked" : ""} style="opacity:0;width:0;height:0;">
    <span style="position:absolute;inset:0;background:${w.active ? "var(--primary)" : "#ccc"};border-radius:11px;transition:.3s;cursor:pointer;"></span>
    <span style="position:absolute;top:3px;left:${w.active ? "19px" : "3px"};width:16px;height:16px;border-radius:50%;background:#fff;transition:.3s;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.2);"></span>
  </label>
</div>`;
		}).join("");
		$el.html(rows);
	}

	_render_executions(executions, workflows) {
		const $el = this.$body.find(".ib-n8n-exec-list");
		if (!executions || !executions.length) {
			$el.html(`<div style="padding:40px;text-align:center;color:var(--text-muted);">No recent executions found.</div>`);
			return;
		}

		const wf_lookup = new Map((workflows || []).map(w => [w.id, w.name]));

		const status_style = {
			success:  "background:#dcfce7;color:#166534;",
			error:    "background:#fee2e2;color:#991b1b;",
			running:  "background:#dbeafe;color:#1e40af;",
			waiting:  "background:#fef9c3;color:#854d0e;",
			canceled: "background:#f3f4f6;color:#4b5563;",
		};

		const rows = executions.map(e => {
			const wf_name = e.workflowName || wf_lookup.get(String(e.workflowId)) || e.workflowId || "—";
			const started = e.startedAt ? frappe.datetime.str_to_user(e.startedAt.slice(0, 19).replace("T", " ")) : "—";
			const st_key  = (e.status || "").toLowerCase();
			const st_css  = status_style[st_key] || "background:#f3f4f6;color:#6b7280;";
			const dur     = (e.startedAt && e.stoppedAt) ? this._duration(e.startedAt, e.stoppedAt) : "";
			return `
<div class="ib-exec-row" data-execid="${e.id}" style="display:flex;align-items:center;gap:14px;padding:12px 16px;border-radius:8px;background:var(--card-bg);border:1px solid var(--border-color);margin-bottom:6px;cursor:pointer;">
  <span style="font-size:12px;padding:3px 10px;border-radius:12px;flex-shrink:0;${st_css}">${frappe.utils.escape_html(e.status || "unknown")}</span>
  <div style="flex:1;min-width:0;">
    <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${frappe.utils.escape_html(wf_name)}</div>
    <div style="font-size:12px;color:var(--text-muted);">Started ${started}${dur ? ` · ${dur}` : ""} · Mode: ${frappe.utils.escape_html(e.mode || "—")}</div>
  </div>
  <span style="font-size:12px;color:var(--text-muted);">#${e.id}</span>
</div>`;
		}).join("");
		$el.html(rows);
	}

	_render_errors(errors) {
		const $el = this.$body.find(".ib-n8n-err-list");
		if (!errors.length) {
			$el.html(`<div style="padding:40px;text-align:center;color:var(--text-muted);">No webhook errors logged.</div>`);
			return;
		}
		const rows = errors.map(e => `
<div style="padding:12px 16px;border-radius:8px;background:var(--card-bg);border:1px solid var(--border-color);margin-bottom:8px;">
  <div style="font-weight:500;margin-bottom:4px;font-size:12px;color:var(--text-muted);">${frappe.utils.escape_html(e.creation || "")} — ${frappe.utils.escape_html(e.method || "")}</div>
  <pre style="margin:0;white-space:pre-wrap;font-size:11px;color:#991b1b;background:#fee2e2;padding:8px 10px;border-radius:6px;">${frappe.utils.escape_html((e.error || "").slice(0, 800))}</pre>
</div>`).join("");
		$el.html(rows);
	}

	_show_exec_detail(data) {
		const e = data || {};
		const error_msg = (e.data && e.data.resultData && e.data.resultData.error && e.data.resultData.error.message) || "";
		const nodes_run = (e.data && e.data.resultData && e.data.resultData.runData) ? Object.keys(e.data.resultData.runData).join(", ") : "";
		frappe.msgprint({
			title:   `Execution #${e.id}`,
			message: `
<b>Workflow:</b> ${frappe.utils.escape_html((e.workflowData || {}).name || "—")}<br>
<b>Status:</b> ${frappe.utils.escape_html(e.status || "—")}<br>
<b>Mode:</b> ${frappe.utils.escape_html(e.mode || "—")}<br>
<b>Started:</b> ${frappe.utils.escape_html(e.startedAt || "—")}<br>
<b>Stopped:</b> ${frappe.utils.escape_html(e.stoppedAt || "—")}<br>
${nodes_run ? `<b>Nodes run:</b> ${frappe.utils.escape_html(nodes_run)}<br>` : ""}
${error_msg ? `<br><b style="color:#dc2626;">Error:</b><br><pre style="background:#fee2e2;padding:8px;border-radius:6px;font-size:11px;white-space:pre-wrap;">${frappe.utils.escape_html(error_msg.slice(0, 1200))}</pre>` : ""}
`.trim(),
			indicator: e.status === "success" ? "green" : "red",
		});
	}

	_duration(start, end) {
		try {
			const ms = new Date(end) - new Date(start);
			if (ms < 0) return "";
			if (ms < 1000) return `${ms}ms`;
			if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
			return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
		} catch { return ""; }
	}
}
