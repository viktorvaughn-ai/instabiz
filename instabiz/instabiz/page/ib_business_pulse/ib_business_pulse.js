frappe.pages["ib-business-pulse"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: "Business Pulse",
		single_column: true,
	});
	wrapper._ib_pulse = new IBBusinessPulse(wrapper);
};

frappe.pages["ib-business-pulse"].on_page_show = function (wrapper) {
	if (!wrapper._ib_pulse) return;
	wrapper._ib_pulse.refresh();
	wrapper._ib_pulse._start_auto();
};

frappe.pages["ib-business-pulse"].on_page_hide = function (wrapper) {
	if (wrapper._ib_pulse) wrapper._ib_pulse._stop_auto();
};

// ─────────────────────────────────────────────────────────────────────────────

const IB_PULSE_DOMAINS = [
	{ key: "Revenue",     icon: "lucide:indian-rupee", color: "#d97757", route: "ib-main-dashboard" },
	{ key: "Sales",       icon: "lucide:file-text",    color: "#3b82f6", route: "ib-customer-board" },
	{ key: "Inventory",   icon: "lucide:package",      color: "#8b5cf6", route: "ib-stock-dashboard" },
	{ key: "Procurement", icon: "lucide:shopping-cart",color: "#f59e0b", route: "List/Purchase Order" },
	{ key: "HR",          icon: "lucide:users",         color: "#06b6d4", route: "ib-hrms-dashboard" },
	{ key: "Production",  icon: "lucide:factory",       color: "#10b981", route: "ib-production-dashboard" },
];

class IBBusinessPulse {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = wrapper.page;
		this._data = null;
		this._trend_chart = null;
		this._auto_timer = null;
		this._inject_styles();
		this._build_layout();
		this._bind_toolbar();
		// refresh + timer started by on_page_show to avoid double call on first load
	}

	_inject_styles() {
		if (document.getElementById("ib-bp-styles")) return;
		const s = document.createElement("style");
		s.id = "ib-bp-styles";
		s.textContent = `
.ib-bp-wrap { padding: 16px; max-width: 1400px; }
.ib-bp-header { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
.ib-bp-score-ring { width: 100px; height: 100px; flex-shrink: 0; }
.ib-bp-score-info { flex: 1; }
.ib-bp-score-num { font-size: 36px; font-weight: 800; line-height: 1; }
.ib-bp-score-lbl { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .5px; margin-top: 4px; }
.ib-bp-score-status { display: inline-block; margin-top: 6px; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
.ib-bp-score-status.good { background:#d1fae5; color:#065f46; }
.ib-bp-score-status.warn { background:#fef3c7; color:#92400e; }
.ib-bp-score-status.bad  { background:#fee2e2; color:#991b1b; }
.ib-bp-progress-bar { height: 10px; border-radius: 5px; background: var(--border-color); overflow: hidden; margin-top: 8px; max-width: 300px; }
.ib-bp-progress-fill { height: 100%; border-radius: 5px; transition: width .6s; }
.ib-bp-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
.ib-bp-card { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; }
.ib-bp-card-title { font-size: 12px; font-weight: 600; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: .5px; margin-bottom: 14px; }
.ib-bp-domain-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px; }
.ib-bp-domain { background: var(--card-bg); border: 1px solid var(--border-color);
  border-radius: 8px; padding: 14px; cursor: pointer; transition: border-color .15s, box-shadow .15s; }
.ib-bp-domain:hover { border-color: var(--ib-primary); box-shadow: 0 2px 8px rgba(0,0,0,.08); }
.ib-bp-domain-top { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.ib-bp-domain-icon { display: inline-flex; }
.ib-bp-domain-name { font-size: 12px; font-weight: 600; color: var(--heading-color); }
.ib-bp-domain-score { font-size: 22px; font-weight: 800; }
.ib-bp-domain-bar { height: 6px; border-radius: 3px; background: var(--border-color); overflow: hidden; margin-top: 6px; }
.ib-bp-domain-fill { height: 100%; border-radius: 3px; transition: width .5s; }
.ib-bp-radar-wrap { display: flex; justify-content: center; align-items: center; }
.ib-bp-trend-wrap { height: 180px; }
.ib-bp-stat-row { display: flex; flex-wrap: wrap; gap: 16px; }
.ib-bp-stat { flex: 1; min-width: 120px; }
.ib-bp-stat-val { font-size: 20px; font-weight: 700; color: var(--heading-color); }
.ib-bp-stat-lbl { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.ib-bp-ts { font-size: 11px; color: var(--text-muted); text-align: right; margin-bottom: 12px; }
@media(max-width:900px){
  .ib-bp-domain-grid{grid-template-columns:1fr 1fr;}
  .ib-bp-row2{grid-template-columns:1fr;}
}
@media(max-width:540px){ .ib-bp-domain-grid{grid-template-columns:1fr;} }
		`;
		document.head.appendChild(s);
	}

	_build_layout() {
		const $pc = $(this.wrapper).find(".page-content");
		this.$wrap = $(`<div class="ib-bp-wrap"></div>`).appendTo($pc);
		this.$wrap.html(`
			<div class="ib-bp-ts" id="ib-bp-ts">Loading…</div>
			<div class="ib-bp-header" id="ib-bp-header">
				<svg class="ib-bp-score-ring" viewBox="0 0 100 100" id="ib-bp-ring">
					<circle cx="50" cy="50" r="42" fill="none" stroke="var(--border-color)" stroke-width="10"/>
					<circle cx="50" cy="50" r="42" fill="none" stroke="#d97757" stroke-width="10"
						stroke-dasharray="264" stroke-dashoffset="264"
						stroke-linecap="round" transform="rotate(-90 50 50)"
						id="ib-bp-ring-fill" style="transition:stroke-dashoffset .8s"/>
				</svg>
				<div class="ib-bp-score-info">
					<div class="ib-bp-score-num" id="ib-bp-score-num">—</div>
					<div class="ib-bp-score-lbl">Overall Business Health</div>
					<div class="ib-bp-score-status" id="ib-bp-status">—</div>
					<div class="ib-bp-progress-bar">
						<div class="ib-bp-progress-fill" id="ib-bp-prog" style="width:0%"></div>
					</div>
				</div>
			</div>
			<div class="ib-bp-domain-grid" id="ib-bp-domains"></div>
			<div class="ib-bp-row2">
				<div class="ib-bp-card">
					<div class="ib-bp-card-title">Health Radar</div>
					<div class="ib-bp-radar-wrap" id="ib-bp-radar"></div>
				</div>
				<div class="ib-bp-card">
					<div class="ib-bp-card-title">14-Day Revenue Trend</div>
					<div class="ib-bp-trend-wrap" id="ib-bp-trend"></div>
				</div>
			</div>
			<div class="ib-bp-card" style="margin-bottom:16px">
				<div class="ib-bp-card-title">Snapshot</div>
				<div class="ib-bp-stat-row" id="ib-bp-stats"></div>
			</div>
		`);
	}

	_bind_toolbar() {
		this.page.add_button(__("Dashboard"), () => frappe.set_route("ib-main-dashboard"));
		this.page.add_button(__("Analytics Hub"), () => frappe.set_route("ib-analytics-hub"));
		this.page.add_inner_button(__("Refresh"), () => this.refresh());
	}

	refresh() {
		this.$wrap.find("#ib-bp-ts").text("Loading…");
		frappe.call({
			method: "instabiz.instabiz.page.ib_business_pulse.ib_business_pulse.get_pulse_data",
			callback: (r) => {
				if (r.message) {
					this._data = r.message;
					this._render(r.message);
					this.$wrap.find("#ib-bp-ts").text("Updated " + frappe.datetime.now_time() + " · Auto-refresh every 2 min");
				}
			},
			error: () => this.$wrap.find("#ib-bp-ts").text("Error loading data"),
		});
	}

	_start_auto() {
		if (this._auto_timer) return;
		this._auto_timer = setInterval(() => this.refresh(), 120000);
	}

	_stop_auto() {
		if (this._auto_timer) { clearInterval(this._auto_timer); this._auto_timer = null; }
	}

	_render(d) {
		this._render_header(d);
		this._render_domains(d.scores || {});
		this._render_radar(d.scores || {});
		this._render_trend(d.trend_14 || []);
		this._render_stats(d);
	}

	_render_header(d) {
		const score = d.overall || 0;
		const circ = 2 * Math.PI * 42;
		const offset = circ - (score / 100 * circ);
		const color = score >= 75 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
		const status_text = score >= 75 ? "Healthy" : score >= 50 ? "Needs Attention" : "Critical Issues";
		const status_cls = score >= 75 ? "good" : score >= 50 ? "warn" : "bad";

		document.getElementById("ib-bp-ring-fill").setAttribute("stroke-dashoffset", offset);
		document.getElementById("ib-bp-ring-fill").setAttribute("stroke", color);
		document.getElementById("ib-bp-score-num").textContent = score;
		document.getElementById("ib-bp-score-num").style.color = color;
		const $st = document.getElementById("ib-bp-status");
		$st.textContent = status_text;
		$st.className = "ib-bp-score-status " + status_cls;
		document.getElementById("ib-bp-prog").style.width = score + "%";
		document.getElementById("ib-bp-prog").style.background = color;
	}

	_render_domains(scores) {
		const html = IB_PULSE_DOMAINS.map(d => {
			const score = scores[d.key] ?? 0;
			const pct = Math.round(score);
			const color = pct >= 70 ? d.color : pct >= 40 ? "#f59e0b" : "#ef4444";
			return `
				<div class="ib-bp-domain" data-route="${d.route}">
					<div class="ib-bp-domain-top">
						<iconify-icon icon="${d.icon}" width="20" height="20" class="ib-bp-domain-icon"></iconify-icon>
						<span class="ib-bp-domain-name">${d.key}</span>
					</div>
					<div class="ib-bp-domain-score" style="color:${color}">${pct}</div>
					<div class="ib-bp-domain-bar">
						<div class="ib-bp-domain-fill" style="width:${pct}%;background:${color}"></div>
					</div>
				</div>
			`;
		}).join("");
		const $el = this.$wrap.find("#ib-bp-domains").html(html);
		$el.find(".ib-bp-domain").on("click", (e) => {
			frappe.set_route($(e.currentTarget).data("route"));
		});
	}

	_render_radar(scores) {
		const keys = IB_PULSE_DOMAINS.map(d => d.key);
		const vals = keys.map(k => (scores[k] ?? 0) / 100);
		const n = keys.length;
		const cx = 120, cy = 120, r = 90;
		const angle = (i) => (i / n) * 2 * Math.PI - Math.PI / 2;
		const pt = (i, scale) => {
			const a = angle(i);
			return [cx + r * scale * Math.cos(a), cy + r * scale * Math.sin(a)];
		};

		// Grid rings
		const rings = [0.25, 0.5, 0.75, 1.0].map(scale => {
			const pts = keys.map((_, i) => pt(i, scale).join(",")).join(" ");
			return `<polygon points="${pts}" fill="none" stroke="var(--border-color)" stroke-width="1"/>`;
		}).join("");

		// Axes
		const axes = keys.map((k, i) => {
			const [x, y] = pt(i, 1.0);
			const [lx, ly] = pt(i, 1.18);
			return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--border-color)" stroke-width="1"/>
				<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle"
					font-size="9" fill="var(--text-muted)">${k}</text>`;
		}).join("");

		// Data polygon
		const data_pts = vals.map((v, i) => pt(i, v).join(",")).join(" ");
		const d_color = "#d97757";

		const svg = `<svg width="240" height="240" viewBox="0 0 240 240">
			${rings}${axes}
			<polygon points="${data_pts}" fill="${d_color}" fill-opacity=".25" stroke="${d_color}" stroke-width="2"/>
			${vals.map((v, i) => {
				const [x, y] = pt(i, v);
				return `<circle cx="${x}" cy="${y}" r="3.5" fill="${d_color}"/>`;
			}).join("")}
		</svg>`;
		this.$wrap.find("#ib-bp-radar").html(svg);
	}

	_render_trend(trend) {
		const $el = this.$wrap.find("#ib-bp-trend")[0];
		if (!$el) return;
		if (!trend.length) {
			$($el).html(`<div style="padding:30px;text-align:center;color:var(--text-muted);font-size:12px">No trend data</div>`);
			return;
		}
		if (this._trend_chart) { this._trend_chart.destroy && this._trend_chart.destroy(); this._trend_chart = null; }
		$($el).empty();
		this._trend_chart = new frappe.Chart($el, {
			type: "line",
			data: {
				labels: trend.map(r => r.label),
				datasets: [{ name: "Revenue", values: trend.map(r => parseFloat(r.amount || 0)) }],
			},
			colors: ["#d97757"],
			height: 165,
			lineOptions: { regionFill: 1, hideDots: 1, spline: 1 },
			axisOptions: { xIsSeries: 1 },
			tooltipOptions: {
				formatTooltipY: (v) => "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 }),
			},
		});
	}

	_render_stats(d) {
		const fmt = (v) => "₹" + Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
		const stats = [
			{ val: fmt(d.rev_mtd),      lbl: "Revenue MTD" },
			{ val: d.collection_rate + "%", lbl: "Collection Rate" },
			{ val: fmt(d.ar),           lbl: "Outstanding AR" },
			{ val: d.open_leads,        lbl: "Open Leads" },
			{ val: d.open_quotes,       lbl: "Open Quotations" },
			{ val: d.total_emp,         lbl: "Active Employees" },
			{ val: d.present_today,     lbl: "Present Today" },
			{ val: d.wo_active,         lbl: "Active Work Orders" },
		];
		this.$wrap.find("#ib-bp-stats").html(stats.map(s => `
			<div class="ib-bp-stat">
				<div class="ib-bp-stat-val">${s.val}</div>
				<div class="ib-bp-stat-lbl">${s.lbl}</div>
			</div>
		`).join(""));
	}
}
