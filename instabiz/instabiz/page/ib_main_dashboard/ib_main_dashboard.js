frappe.pages["ib-main-dashboard"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: "Dashboard",
		single_column: true,
	});
	wrapper._ib_dash = new IBMainDashboard(wrapper);
};

frappe.pages["ib-main-dashboard"].on_page_show = function (wrapper) {
	if (!wrapper._ib_dash) return;
	wrapper._ib_dash.refresh();
	if (!wrapper._ib_dash._auto_refresh) {
		wrapper._ib_dash._auto_refresh = setInterval(() => wrapper._ib_dash.refresh(), 5 * 60 * 1000);
	}
};

frappe.pages["ib-main-dashboard"].on_page_hide = function (wrapper) {
	if (wrapper._ib_dash) {
		clearInterval(wrapper._ib_dash._auto_refresh);
		wrapper._ib_dash._auto_refresh = null;
	}
};

// ─────────────────────────────────────────────────────────────────────────────

class IBMainDashboard {
	constructor(wrapper) {
		this.wrapper     = wrapper;
		this.page        = wrapper.page;
		this._chart      = null;
		this._data       = null;
		this._active_tab = "revenue";
		this._fetching   = false;
		this._inject_styles();
		this._build_layout();
		this._bind_toolbar();
	}

	_inject_styles() {
		if (document.getElementById("ib-md-styles")) return;
		const s = document.createElement("style");
		s.id = "ib-md-styles";
		s.textContent = `
.ib-md-wrap { padding: 20px; max-width: 1440px; }
.ib-md-top-bar { display:flex; align-items:center; gap:8px; margin-bottom:18px; }
.ib-md-ts { margin-left:auto; font-size:11px; color:var(--text-muted);
  background:var(--bg-color); border:1px solid var(--border-color);
  padding:3px 8px; border-radius:20px; }
.ib-md-kpi-row { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:20px; }
.ib-md-kpi {
  background:var(--card-bg); border:1px solid var(--border-color);
  border-radius:10px; padding:18px 20px; position:relative; overflow:hidden;
  cursor:pointer; transition:box-shadow .2s,transform .2s;
  border-left:4px solid var(--ib-md-kc,var(--ib-primary));
}
.ib-md-kpi:hover { box-shadow:0 6px 24px rgba(0,0,0,.09); transform:translateY(-2px); }
.ib-md-kpi-icon { position:absolute; top:12px; right:14px; opacity:.12; font-style:normal; display:flex; }
.ib-md-kpi-lbl { font-size:10px; color:var(--text-muted); text-transform:uppercase; letter-spacing:.6px; font-weight:600; margin-bottom:6px; }
.ib-md-kpi-val { font-size:26px; font-weight:700; color:var(--heading-color); line-height:1.1; min-height:1.4em; }
.ib-md-kpi-delta { font-size:11px; margin-top:6px; font-weight:500; }
.ib-md-kpi-arrow { position:absolute; bottom:8px; right:10px; font-size:10px; opacity:.3; transition:opacity .15s; }
.ib-md-kpi:hover .ib-md-kpi-arrow { opacity:.8; }
.ib-md-row2 { display:grid; grid-template-columns:2fr 1fr; gap:12px; margin-bottom:20px; }
.ib-md-card { background:var(--card-bg); border:1px solid var(--border-color); border-radius:10px; padding:18px 20px; }
.ib-md-card-title { font-size:11px; font-weight:700; color:var(--text-muted);
  text-transform:uppercase; letter-spacing:.6px; margin-bottom:14px; }
.ib-md-tabs { display:flex; gap:4px; margin-bottom:14px; }
.ib-md-tab { padding:5px 14px; border-radius:20px; font-size:12px; font-weight:500;
  cursor:pointer; border:1px solid var(--border-color);
  background:transparent; color:var(--text-muted); transition:all .15s; }
.ib-md-tab.active { background:var(--ib-primary); color:#fff; border-color:var(--ib-primary); }
.ib-md-chart-wrap { height:200px; }
.ib-md-quick-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.ib-md-qbtn { padding:10px 12px; border-radius:8px; font-size:12px; font-weight:500;
  cursor:pointer; border:1px solid var(--border-color); background:var(--card-bg);
  color:var(--text-color); text-align:left; transition:all .15s; }
.ib-md-qbtn:hover { background:#fef6f2; border-color:var(--ib-primary); color:var(--ib-primary); }
.ib-md-qbtn-icon { display:block; margin-bottom:4px; }
.ib-md-section { margin-bottom:20px; }
.ib-md-section-title { font-size:11px; font-weight:700; color:var(--text-muted);
  text-transform:uppercase; letter-spacing:.6px;
  margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid var(--border-color); }
.ib-md-table { width:100%; border-collapse:collapse; font-size:12px; }
.ib-md-table th { text-align:left; padding:8px 10px; font-size:10px; font-weight:700;
  color:var(--text-muted); text-transform:uppercase; letter-spacing:.5px;
  border-bottom:2px solid var(--border-color); background:var(--bg-color); }
.ib-md-table td { padding:8px 10px; border-bottom:1px solid var(--border-color); vertical-align:middle; }
.ib-md-table tr:last-child td { border-bottom:none; }
.ib-md-table tbody tr { cursor:pointer; }
.ib-md-table tbody tr:hover td { background:var(--bg-color); }
.ib-md-badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:600; }
.ib-md-badge-paid    { background:#dcfce7; color:#15803d; }
.ib-md-badge-unpaid  { background:#fef9c3; color:#854d0e; }
.ib-md-badge-overdue { background:#fee2e2; color:#991b1b; }
.ib-md-bar-row { display:flex; align-items:center; gap:8px; padding:5px 0; }
.ib-md-bar-lbl { width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-muted); font-size:11px; }
.ib-md-bar-track { flex:1; height:7px; background:var(--bg-color); border-radius:4px; overflow:hidden; border:1px solid var(--border-color); }
.ib-md-bar-fill { height:100%; border-radius:4px; background:var(--ib-primary); transition:width .6s cubic-bezier(.4,0,.2,1); }
.ib-md-bar-val { width:90px; text-align:right; font-size:11px; font-weight:600; color:var(--heading-color); }
@media(max-width:1000px){ .ib-md-kpi-row{grid-template-columns:1fr 1fr;} .ib-md-row2{grid-template-columns:1fr;} }
@media(max-width:540px){ .ib-md-kpi-row{grid-template-columns:1fr;} }
		`;
		document.head.appendChild(s);
	}

	_build_layout() {
		const $pc = $(this.wrapper).find(".page-content");
		this.$wrap = $(`<div class="ib-md-wrap"></div>`).appendTo($pc);

		this.$wrap.html(`
			<div class="ib-md-top-bar">
				<button class="btn btn-xs btn-default" id="ib-md-refresh-btn" style="display:inline-flex;align-items:center;gap:5px">
					<iconify-icon icon="lucide:refresh-cw" width="11" height="11"></iconify-icon>Refresh
				</button>
				<span class="ib-md-ts" id="ib-md-ts">Loading…</span>
			</div>
			<div class="ib-md-kpi-row" id="ib-md-kpis">
				${window.ib_skel_kpis ? ib_skel_kpis(4) : ""}
			</div>
			<div class="ib-md-row2">
				<div class="ib-md-card">
					<div class="ib-md-card-title">Revenue Trend</div>
					<div class="ib-md-tabs" id="ib-md-tabs">
						<button class="ib-md-tab active" data-tab="revenue">Revenue</button>
						<button class="ib-md-tab" data-tab="customers">Top Customers</button>
					</div>
					<div class="ib-md-chart-wrap" id="ib-md-chart"></div>
				</div>
				<div class="ib-md-card">
					<div class="ib-md-card-title">Quick Actions</div>
					<div class="ib-md-quick-grid">
						<button class="ib-md-qbtn" data-route="new-Quotation-1">
							<iconify-icon icon="lucide:file-text" width="18" height="18" class="ib-md-qbtn-icon"></iconify-icon>New Quotation
						</button>
						<button class="ib-md-qbtn" data-route="new-Sales Invoice-1">
							<iconify-icon icon="lucide:receipt" width="18" height="18" class="ib-md-qbtn-icon"></iconify-icon>New Invoice
						</button>
						<button class="ib-md-qbtn" data-route="new-Delivery Note-1">
							<iconify-icon icon="lucide:truck" width="18" height="18" class="ib-md-qbtn-icon"></iconify-icon>New Delivery Note
						</button>
						<button class="ib-md-qbtn" data-route="ib-customer-board">
							<iconify-icon icon="lucide:users" width="18" height="18" class="ib-md-qbtn-icon"></iconify-icon>Customer Board
						</button>
						<button class="ib-md-qbtn" data-route="ib-production-dashboard">
							<iconify-icon icon="lucide:factory" width="18" height="18" class="ib-md-qbtn-icon"></iconify-icon>Production
						</button>
						<button class="ib-md-qbtn" data-route="ib-business-pulse">
							<iconify-icon icon="lucide:bar-chart-2" width="18" height="18" class="ib-md-qbtn-icon"></iconify-icon>Business Pulse
						</button>
					</div>
				</div>
			</div>
			<div class="ib-md-section">
				<div class="ib-md-section-title">Recent Invoices</div>
				<div id="ib-md-recent-si"></div>
			</div>
		`);

		this.$wrap.find(".ib-md-tab").on("click", (e) => {
			const tab = $(e.currentTarget).data("tab");
			this._active_tab = tab;
			this.$wrap.find(".ib-md-tab").removeClass("active");
			$(e.currentTarget).addClass("active");
			this._render_chart(tab);
		});

		this.$wrap.find(".ib-md-qbtn[data-route]").on("click", (e) => {
			const route = $(e.currentTarget).data("route");
			if (route.startsWith("new-")) {
				frappe.new_doc(route.replace(/^new-/, "").replace(/-\d+$/, ""));
			} else {
				frappe.set_route(route);
			}
		});

		this.$wrap.find("#ib-md-refresh-btn").on("click", () => this.refresh());
	}

	_bind_toolbar() {
		this.page.add_button(__("Business Pulse"), () => frappe.set_route("ib-business-pulse"));
		this.page.add_button(__("Analytics Hub"),  () => frappe.set_route("ib-analytics-hub"));
	}

	refresh() {
		const opts = ib_guarded_call(this, {
			method: "instabiz.instabiz.page.ib_main_dashboard.ib_main_dashboard.get_dashboard_data",
			callback: (r) => {
				if (r.message) {
					this._data = r.message;
					this._render(r.message);
					this.$wrap.find("#ib-md-ts").text("Updated " + frappe.datetime.now_time());
				}
			},
			error: () => this.$wrap.find("#ib-md-ts").text("Error — click Refresh"),
		});
		if (opts) {
			this.$wrap.find("#ib-md-ts").text("Loading…");
			frappe.call(opts);
		}
	}

	_render(d) {
		this._render_kpis(d);
		this._render_chart(this._active_tab);
		this._render_recent(d.recent_si || []);
		ib_countup_all && ib_countup_all(this.$wrap);
	}

	_render_kpis(d) {
		const today = frappe.datetime.get_today();
		const ms    = today.slice(0, 7) + "-01";
		const ICON = {
			rev:    `<iconify-icon icon="lucide:indian-rupee" width="22" height="22"></iconify-icon>`,
			ar:     `<iconify-icon icon="lucide:alert-circle" width="22" height="22"></iconify-icon>`,
			quotes: `<iconify-icon icon="lucide:file-text"    width="22" height="22"></iconify-icon>`,
			stock:  `<iconify-icon icon="lucide:package"      width="22" height="22"></iconify-icon>`,
		};
		const kpis  = [
			{
				label: "Revenue MTD", raw: d.rev_mtd, icon: ICON.rev, color: "#d97757",
				delta: ib_delta_html(d.rev_delta),
				click() {
					frappe.route_options = { docstatus: 1, is_return: 0, posting_date: ["between", [ms, today]] };
					frappe.set_route("List", "Sales Invoice");
				},
			},
			{
				label: "Outstanding AR", raw: d.ar, icon: ICON.ar, color: "#f59e0b",
				delta: `<span class="ib-delta neu">${d.open_so} open orders</span>`,
				click() {
					frappe.route_options = { docstatus: 1, outstanding_amount: [">", 0] };
					frappe.set_route("List", "Sales Invoice");
				},
			},
			{
				label: "Open Quotations", raw: d.quotes, icon: ICON.quotes, color: "#3b82f6",
				delta: `<span class="ib-delta neu ib-md-dn-link" style="cursor:pointer">${d.pending_dn} pending DC ↗</span>`,
				click() {
					frappe.route_options = { docstatus: 1, status: ["not in", ["Ordered", "Lost", "Cancelled", "Expired"]] };
					frappe.set_route("List", "Quotation");
				},
			},
			{
				label: "Low / Zero Stock", raw: d.low_stock, icon: ICON.stock,
				color: d.low_stock > 5 ? "#dc2626" : "#10b981",
				delta: `<span class="ib-delta ${d.low_stock > 5 ? "neg" : "pos"}">SKUs need restock</span>`,
				click() { frappe.set_route("ib-stock-dashboard"); },
			},
		];

		const fmt_val = (k) => {
			if (k.label === "Revenue MTD" || k.label === "Outstanding AR") {
				return "₹" + Number(k.raw || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
			}
			return k.raw;
		};

		const html = kpis.map((k, i) => `
			<div class="ib-md-kpi" data-kpi="${i}" style="--ib-md-kc:${k.color}">
				<span class="ib-md-kpi-icon">${k.icon}</span>
				<div class="ib-md-kpi-lbl">${k.label}</div>
				<div class="ib-md-kpi-val"
					${(k.label === "Revenue MTD" || k.label === "Outstanding AR")
						? `data-countup="${k.raw}" data-cu-inr="1"`
						: `data-countup="${k.raw}"`}
				>${fmt_val(k)}</div>
				<div class="ib-md-kpi-delta">${k.delta}</div>
				<span class="ib-md-kpi-arrow">→</span>
			</div>
		`).join("");

		const $row = this.$wrap.find("#ib-md-kpis").html(html);
		$row.find(".ib-md-kpi").on("click", (e) => {
			kpis[parseInt($(e.currentTarget).data("kpi"), 10)].click();
		});
		$row.find(".ib-md-dn-link").on("click", (e) => {
			e.stopPropagation();
			frappe.route_options = { docstatus: 0 };
			frappe.set_route("List", "Delivery Note");
		});
	}

	_render_chart(tab) {
		if (!this._data) return;
		const $el = this.$wrap.find("#ib-md-chart")[0];
		if (!$el) return;

		if (this._chart) { this._chart.destroy && this._chart.destroy(); this._chart = null; }
		$($el).empty();

		if (tab === "revenue") {
			const trend = this._data.trend || [];
			if (!trend.length) { $($el).html(`<div style="padding:40px;text-align:center;color:var(--text-muted)">No data</div>`); return; }
			this._chart = new frappe.Chart($el, {
				type: "line",
				data: {
					labels: trend.map(r => r.label),
					datasets: [{ name: "Revenue", values: trend.map(r => parseFloat(r.amount || 0)) }],
				},
				colors: ["#d97757"],
				height: 190,
				lineOptions: { regionFill: 1, hideDots: 0, spline: 1 },
				tooltipOptions: {
					formatTooltipY: (v) => "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 }),
				},
				axisOptions: { xIsSeries: 1 },
			});
		} else {
			const customers = this._data.top_customers || [];
			if (!customers.length) { $($el).html(`<div style="padding:40px;text-align:center;color:var(--text-muted)">No data</div>`); return; }
			const max_val = Math.max(...customers.map(c => parseFloat(c.total || 0)));
			$($el).html(customers.map(c => {
				const pct = max_val ? Math.round(parseFloat(c.total || 0) / max_val * 100) : 0;
				const fmt = "₹" + Number(c.total || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
				return `<div class="ib-md-bar-row">
					<div class="ib-md-bar-lbl" title="${frappe.utils.escape_html(c.customer_name || "")}">${frappe.utils.escape_html(c.customer_name || "")}</div>
					<div class="ib-md-bar-track"><div class="ib-md-bar-fill" style="width:${pct}%"></div></div>
					<div class="ib-md-bar-val">${fmt}</div>
				</div>`;
			}).join(""));
		}
	}

	_render_recent(rows) {
		const $el = this.$wrap.find("#ib-md-recent-si");
		if (!rows.length) {
			$el.html(`<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">No recent invoices</div>`);
			return;
		}
		const badge = (si) => {
			if (si.outstanding_amount <= 0) return `<span class="ib-md-badge ib-md-badge-paid">Paid</span>`;
			if (si.due_date && frappe.datetime.get_diff(frappe.datetime.get_today(), si.due_date) > 0)
				return `<span class="ib-md-badge ib-md-badge-overdue">Overdue</span>`;
			return `<span class="ib-md-badge ib-md-badge-unpaid">Unpaid</span>`;
		};
		const fmt = (v) => "₹" + Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
		$el.html(`
			<table class="ib-md-table">
				<thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th style="text-align:right">Amount</th><th>Status</th></tr></thead>
				<tbody>${rows.map(si => `
					<tr data-name="${frappe.utils.escape_html(si.name)}">
						<td><a style="color:var(--ib-primary)">${frappe.utils.escape_html(si.name)}</a></td>
						<td>${frappe.utils.escape_html(si.customer_name || "")}</td>
						<td>${frappe.datetime.str_to_user(si.posting_date) || si.posting_date}</td>
						<td style="text-align:right;font-weight:600">${fmt(si.grand_total)}</td>
						<td>${badge(si)}</td>
					</tr>
				`).join("")}</tbody>
			</table>
		`);
		$el.find("tbody tr[data-name]").on("click", function () {
			frappe.set_route("Form", "Sales Invoice", $(this).data("name"));
		});
	}
}
