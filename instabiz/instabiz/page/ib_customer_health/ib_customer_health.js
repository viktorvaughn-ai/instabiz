frappe.pages["ib-customer-health"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({ parent: wrapper, title: "Customer Health", single_column: true });
	wrapper._ib_ch = new IBCustomerHealth(wrapper);
};

frappe.pages["ib-customer-health"].on_page_show = function (wrapper) {
	if (wrapper._ib_ch) wrapper._ib_ch.load();
};

class IBCustomerHealth {
	constructor(wrapper) {
		this.$wrap = $(wrapper).find(".layout-main-section");
		this._page = 0;
		this._limit = 50;
		this._search = "";
		this._territory = "";
		this._data = null;
		this._inject_styles();
		this._build_layout();
		// load() started by on_page_show — no double call on first visit
	}

	_inject_styles() {
		if (document.getElementById("ib-ch-css")) return;
		const s = document.createElement("style");
		s.id = "ib-ch-css";
		s.textContent = `
:root { --ib-p:#d97757; }
.ib-ch-wrap { padding:16px; max-width:1400px; }
.ib-ch-toolbar { display:flex; align-items:center; gap:10px; margin-bottom:16px; flex-wrap:wrap; }
.ib-ch-toolbar h2 { font-size:1.2rem; font-weight:700; color:var(--heading-color); margin:0; flex:1; }
.ib-ch-input { padding:6px 12px; border:1px solid var(--border-color); border-radius:6px;
  font-size:12px; background:var(--card-bg,#fff); color:var(--text-color); min-width:200px; }
.ib-ch-input:focus { outline:none; border-color:var(--ib-p); }
.ib-ch-select { padding:6px 12px; border:1px solid var(--border-color); border-radius:6px;
  font-size:12px; background:var(--card-bg,#fff); color:var(--text-color); }
.ib-ch-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-bottom:16px; }
.ib-ch-kpi { background:var(--card-bg,#fff); border:1px solid var(--border-color); border-radius:8px;
  padding:14px 16px; }
.ib-ch-kpi-l { font-size:10px; color:var(--text-muted); text-transform:uppercase; letter-spacing:.06em; }
.ib-ch-kpi-v { font-size:1.4rem; font-weight:700; color:var(--heading-color); margin-top:4px; }
.ib-ch-tbl-wrap { background:var(--card-bg,#fff); border:1px solid var(--border-color); border-radius:10px; overflow:auto; }
.ib-ch-tbl { width:100%; border-collapse:collapse; font-size:12px; min-width:900px; }
.ib-ch-tbl th { text-align:left; padding:10px 12px; color:var(--text-muted); font-weight:500;
  border-bottom:1px solid var(--border-color); position:sticky; top:0; background:var(--card-bg,#fff); z-index:1; }
.ib-ch-tbl td { padding:10px 12px; border-bottom:1px solid var(--border-color); vertical-align:middle; }
.ib-ch-tbl tr:last-child td { border-bottom:none; }
.ib-ch-tbl tbody tr { cursor:pointer; }
.ib-ch-tbl tbody tr:hover td { background:var(--control-bg,#f8fafc); }
.ib-ch-score { display:inline-flex; align-items:center; justify-content:center;
  width:36px; height:36px; border-radius:50%; font-size:11px; font-weight:700; }
.ib-ch-score.hi { background:#d1fae5; color:#065f46; }
.ib-ch-score.md { background:#fef3c7; color:#92400e; }
.ib-ch-score.lo { background:#fee2e2; color:#991b1b; }
.ib-ch-pagination { display:flex; align-items:center; gap:8px; padding:12px 16px;
  justify-content:space-between; font-size:12px; color:var(--text-muted); }
.ib-ch-pg-btn { padding:5px 12px; border:1px solid var(--border-color); border-radius:5px;
  background:var(--card-bg,#fff); cursor:pointer; font-size:12px; }
.ib-ch-pg-btn:disabled { opacity:.4; cursor:not-allowed; }
.ib-ch-pg-btn:hover:not(:disabled) { border-color:var(--ib-p); color:var(--ib-p); }
.ib-ch-badge { display:inline-block; padding:2px 7px; border-radius:99px; font-size:10px; font-weight:600; }
.ib-ch-badge.warn { background:#fef3c7; color:#b45309; }
`;
		document.head.appendChild(s);
	}

	_build_layout() {
		this.$wrap.html(`
		<div class="ib-ch-wrap">
			<div class="ib-ch-toolbar">
				<h2>Customer Health</h2>
				<input class="ib-ch-input form-control" id="ib-ch-search" placeholder="Search customer…" />
				<select class="ib-ch-select form-control" id="ib-ch-territory"><option value="">All Territories</option></select>
				<button class="ib-ch-pg-btn btn btn-default btn-sm" id="ib-ch-refresh">↻ Refresh</button>
			</div>
			<div id="ib-ch-kpis" class="ib-ch-kpis"></div>
			<div class="ib-ch-tbl-wrap">
				<table class="ib-ch-tbl">
					<thead><tr>
						<th>Health</th><th>Customer</th><th>Territory</th>
						<th>Sales Person</th><th>Last Order</th>
						<th style="text-align:right">MTD Revenue</th>
						<th style="text-align:right">Outstanding</th>
						<th style="text-align:right">Open Quotes</th>
					</tr></thead>
					<tbody id="ib-ch-body"></tbody>
				</table>
				<div class="ib-ch-pagination" id="ib-ch-pagination"></div>
			</div>
		</div>`);

		let searchTimeout;
		this.$wrap.find("#ib-ch-search").on("input", (e) => {
			clearTimeout(searchTimeout);
			searchTimeout = setTimeout(() => { this._search = e.target.value; this._page = 0; this.load(); }, 350);
		});
		this.$wrap.find("#ib-ch-territory").on("change", (e) => { this._territory = e.target.value; this._page = 0; this.load(); });
		this.$wrap.find("#ib-ch-refresh").on("click", () => this.load());
	}

	load() {
		frappe.call({
			method: "instabiz.instabiz.page.ib_customer_health.ib_customer_health.get_customer_health",
			args: { search: this._search, territory: this._territory, limit: this._limit, offset: this._page * this._limit },
			callback: (r) => {
				if (!r.message) return;
				this._data = r.message;
				this._render(r.message);
				this._populate_territories(r.message.territories);
			}
		});
	}

	_populate_territories(list) {
		const $sel = this.$wrap.find("#ib-ch-territory");
		const cur = $sel.val();
		$sel.html('<option value="">All Territories</option>' + list.map(t => `<option value="${frappe.utils.escape_html(t)}">${frappe.utils.escape_html(t)}</option>`).join(""));
		$sel.val(cur);
	}

	_fmt(v) { return "₹" + Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 }); }

	_render(d) {
		const customers = d.customers || [];
		// KPI totals come from server (full dataset, not just current page)
		const total_outstanding = d.agg_outstanding || 0;
		const total_mtd = d.agg_mtd || 0;
		const at_risk = d.agg_at_risk || 0;
		const healthy = d.agg_healthy || 0;

		this.$wrap.find("#ib-ch-kpis").html(`
			<div class="ib-ch-kpi"><div class="ib-ch-kpi-l">Total Customers</div><div class="ib-ch-kpi-v">${d.total}</div></div>
			<div class="ib-ch-kpi"><div class="ib-ch-kpi-l">Healthy (≥80)</div><div class="ib-ch-kpi-v" style="color:#059669">${healthy}</div></div>
			<div class="ib-ch-kpi"><div class="ib-ch-kpi-l">At Risk (&lt;50)</div><div class="ib-ch-kpi-v" style="color:#dc2626">${at_risk}</div></div>
			<div class="ib-ch-kpi"><div class="ib-ch-kpi-l">MTD Revenue</div><div class="ib-ch-kpi-v">${this._fmt(total_mtd)}</div></div>
			<div class="ib-ch-kpi"><div class="ib-ch-kpi-l">Total Outstanding</div><div class="ib-ch-kpi-v" style="color:#d97706">${this._fmt(total_outstanding)}</div></div>
		`);

		const rows = customers.map(c => {
			const score = c.health_score || 0;
			const cls = score >= 80 ? "hi" : score >= 50 ? "md" : "lo";
			const days_lbl = c.days_since_order != null
				? (c.days_since_order > 90 ? `<span class="ib-ch-badge warn">${c.days_since_order}d ago</span>` : `${c.days_since_order}d ago`)
				: `<span class="ib-ch-badge warn">Never</span>`;
			return `<tr data-customer="${frappe.utils.escape_html(c.customer)}">
				<td><span class="ib-ch-score ${cls}">${score}</span></td>
				<td><b>${frappe.utils.escape_html(c.customer_name || c.customer)}</b></td>
				<td>${frappe.utils.escape_html(c.territory || "")}</td>
				<td>${frappe.utils.escape_html(c.sales_person || "—")}</td>
				<td>${days_lbl}</td>
				<td style="text-align:right">${this._fmt(c.mtd_revenue)}</td>
				<td style="text-align:right;${Number(c.outstanding) > 0 ? 'color:#d97706;font-weight:600' : ''}">${this._fmt(c.outstanding)}</td>
				<td style="text-align:right">${c.open_quotes > 0 ? `<span class="ib-ch-badge warn">${c.open_quotes}</span>` : "—"}</td>
			</tr>`;
		}).join("");

		this.$wrap.find("#ib-ch-body").html(rows || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:20px">No customers</td></tr>');

		this.$wrap.find("#ib-ch-body tr").on("click", function () {
			frappe.set_route("Form", "Customer", $(this).data("customer"));
		});

		const total = d.total || 0;
		const pages = Math.ceil(total / this._limit);
		const pg = this._page;
		const from = total === 0 ? 0 : pg * this._limit + 1;
		const to = Math.min((pg + 1) * this._limit, total);
		this.$wrap.find("#ib-ch-pagination").html(`
			<span>${total === 0 ? "No customers" : `Showing ${from}–${to} of ${total}`}</span>
			<div style="display:flex;gap:6px">
				<button class="ib-ch-pg-btn btn btn-default btn-sm" id="ib-ch-prev" ${pg === 0 || total === 0 ? "disabled" : ""}>← Prev</button>
				<button class="ib-ch-pg-btn btn btn-default btn-sm" id="ib-ch-next" ${pg >= pages - 1 || total === 0 ? "disabled" : ""}>Next →</button>
			</div>`);

		this.$wrap.find("#ib-ch-prev").on("click", () => { if (this._page > 0) { this._page--; this.load(); } });
		this.$wrap.find("#ib-ch-next").on("click", () => { if ((this._page + 1) * this._limit < total) { this._page++; this.load(); } });
	}
}
