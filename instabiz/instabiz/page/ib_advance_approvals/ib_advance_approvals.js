frappe.pages["ib-advance-approvals"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Advance Approvals",
		single_column: true,
	});
	wrapper._ib_aa = new IBAdvanceApprovals(wrapper, page);
};

frappe.pages["ib-advance-approvals"].on_page_show = function (wrapper) {
	if (wrapper._ib_aa) wrapper._ib_aa.refresh();
};

class IBAdvanceApprovals {
	constructor(wrapper, page) {
		this.wrapper = wrapper;
		this.page = page;
		this._inject_styles();
		this._build_layout();
		page.add_inner_button(__("Refresh"), () => this.refresh());
		this.refresh();
	}

	_inject_styles() {
		if (document.getElementById("ib-aa-page-styles")) return;
		const s = document.createElement("style");
		s.id = "ib-aa-page-styles";
		s.textContent = `
.ib-aap-wrap { padding: 4px 2px; max-width: 1200px; }

.ib-aap-top-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
.ib-aap-ts { font-size: 11px; color: var(--text-muted); margin-left: auto; }

.ib-aap-kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
.ib-aap-kpi { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px;
  padding: 14px; border-top: 4px solid; position: relative; overflow: hidden; }
.ib-aap-kpi-icon { position: absolute; right: 10px; top: 10px; opacity: .25; }
.ib-aap-kpi-val { font-size: 26px; font-weight: 800; color: var(--heading-color); margin-bottom: 2px; }
.ib-aap-kpi-lbl { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .5px; }
@media(max-width:900px){ .ib-aap-kpi-row{grid-template-columns:repeat(2,1fr);} }
@media(max-width:540px){ .ib-aap-kpi-row{grid-template-columns:1fr;} }

.ib-aap-section-title { font-size: 13px; font-weight: 700; color: var(--heading-color);
  margin: 0 0 8px; display: flex; align-items: center; gap: 6px; }
.ib-aap-section-title .count { font-weight: 500; color: var(--text-muted); }
.ib-aap-card { background: var(--card-bg); border: 1px solid var(--border-color);
  border-radius: 8px; overflow: hidden; margin-bottom: 22px; }
.ib-aap-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.ib-aap-table th { text-align: left; padding: 9px 12px; font-size: 10.5px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .3px; color: var(--text-muted);
  border-bottom: 1px solid var(--border-color); background: var(--bg-color); }
.ib-aap-table td { padding: 10px 12px; border-bottom: 1px solid var(--border-color); vertical-align: middle; }
.ib-aap-table tr:last-child td { border-bottom: none; }
.ib-aap-table tr:hover td { background: var(--bg-color); }
.ib-aap-amount { font-weight: 700; color: #d97757; }
.ib-aap-empty { padding: 30px; text-align: center; color: var(--text-muted); font-size: 12px; }
.ib-aap-chip { display: inline-block; padding: 2px 9px; border-radius: 10px; font-size: 10.5px; font-weight: 700; }
.ib-aap-chip--approved { background:#d1fae5; color:#065f46; }
.ib-aap-chip--rejected { background:#fee2e2; color:#991b1b; }
.ib-aap-chip--pending  { background:#fef3c7; color:#92400e; }
.ib-aap-age { font-size: 10.5px; color: var(--text-muted); }
`;
		document.head.appendChild(s);
	}

	_build_layout() {
		const $pc = $(this.wrapper).find(".page-content");
		this.$wrap = $(`<div class="ib-aap-wrap"></div>`).appendTo($pc);
		this.$wrap.html(`
			<div class="ib-aap-top-bar">
				<span class="ib-aap-ts" id="ib-aap-ts"></span>
			</div>
			<div class="ib-aap-kpi-row" id="ib-aap-kpis"></div>
			<div class="ib-aap-section-title">
				<iconify-icon icon="lucide:clock" width="14" height="14"></iconify-icon>
				Pending Approval <span class="count" id="ib-aap-pending-count"></span>
			</div>
			<div class="ib-aap-card"><div id="ib-aap-pending"></div></div>
			<div class="ib-aap-section-title">
				<iconify-icon icon="lucide:history" width="14" height="14"></iconify-icon>
				Recent Decisions
			</div>
			<div class="ib-aap-card"><div id="ib-aap-history"></div></div>
		`);
	}

	refresh() {
		this.$wrap.find("#ib-aap-kpis").html(window.ib_skel_kpis ? ib_skel_kpis(4) : "");
		this.$wrap.find("#ib-aap-ts").text("Loading…");
		frappe.call({
			method: "instabiz.overrides.advance_approval.get_advance_approval_queue",
			callback: (r) => {
				const d = r.message || { pending: [], history: [] };
				this._render_kpis(d.pending, d.history);
				this._render_pending(d.pending);
				this._render_history(d.history);
				this.$wrap.find("#ib-aap-ts").text("Updated " + frappe.datetime.now_time());
				window.ib_countup_all && ib_countup_all(this.$wrap);
			},
			error: () => this.$wrap.find("#ib-aap-ts").text("Error — click Refresh"),
		});
	}

	_fmt(v, ccy) {
		return "₹" + Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 }) + (ccy && ccy !== "INR" ? ` ${ccy}` : "");
	}

	_render_kpis(pending, history) {
		const today = frappe.datetime.get_today();
		const total_pending_amt = pending.reduce((s, r) => s + (parseFloat(r.advance_paid) || 0), 0);
		const approved_today = history.filter(r => r.status === "Approved" && (r.modified || "").slice(0, 10) === today).length;
		const rejected_today = history.filter(r => r.status === "Rejected" && (r.modified || "").slice(0, 10) === today).length;

		const kpis = [
			{ label: "Pending Requests", val: pending.length, rawNum: pending.length, color: "#d97706", icon: "lucide:clock" },
			{ label: "Pending Amount", val: this._fmt(total_pending_amt), rawNum: total_pending_amt, color: "#d97757", icon: "lucide:indian-rupee", inr: true },
			{ label: "Approved Today", val: approved_today, rawNum: approved_today, color: "#15803d", icon: "lucide:check-circle" },
			{ label: "Rejected Today", val: rejected_today, rawNum: rejected_today, color: "#b91c1c", icon: "lucide:x-circle" },
		];
		this.$wrap.find("#ib-aap-kpis").html(kpis.map(k => `
			<div class="ib-aap-kpi" style="border-top-color:${k.color}">
				<iconify-icon class="ib-aap-kpi-icon" icon="${k.icon}" width="34" height="34" style="color:${k.color}"></iconify-icon>
				<div class="ib-aap-kpi-val" data-countup="${k.rawNum}" ${k.inr ? 'data-cu-inr="1"' : ""}>${k.val}</div>
				<div class="ib-aap-kpi-lbl">${k.label}</div>
			</div>`).join(""));
	}

	_days_ago(dt) {
		const d = frappe.datetime.get_diff(frappe.datetime.get_today(), (dt || "").slice(0, 10));
		if (d <= 0) return "today";
		if (d === 1) return "1 day ago";
		return `${d} days ago`;
	}

	_render_pending(rows) {
		this.$wrap.find("#ib-aap-pending-count").text(rows.length ? `(${rows.length})` : "");
		if (!rows.length) {
			this.$wrap.find("#ib-aap-pending").html(`
				<div class="ib-aap-empty">
					<iconify-icon icon="lucide:inbox" width="22" height="22" style="opacity:.4;display:block;margin:0 auto 8px"></iconify-icon>
					Nothing waiting on you right now.
				</div>`);
			return;
		}
		const rows_html = rows.map((r) => `
			<tr data-so="${frappe.utils.escape_html(r.name)}">
				<td><a href="/app/sales-order/${encodeURIComponent(r.name)}">${frappe.utils.escape_html(r.name)}</a></td>
				<td>${frappe.utils.escape_html(r.customer_name || "")}</td>
				<td>${frappe.utils.escape_html(r.sales_person_name || "—")}</td>
				<td class="ib-aap-amount">${this._fmt(r.advance_paid, r.currency)}</td>
				<td><span class="ib-aap-chip ib-aap-chip--pending">Pending</span><br><span class="ib-aap-age">${this._days_ago(r.creation)}</span></td>
				<td style="white-space:nowrap">
					<button class="btn btn-xs btn-primary ib-aap-approve">
						<iconify-icon icon="lucide:check" width="11" height="11" style="vertical-align:middle"></iconify-icon> Approve
					</button>
					<button class="btn btn-xs btn-danger ib-aap-reject">
						<iconify-icon icon="lucide:x" width="11" height="11" style="vertical-align:middle"></iconify-icon> Reject
					</button>
				</td>
			</tr>`).join("");
		this.$wrap.find("#ib-aap-pending").html(`
			<table class="ib-aap-table">
				<thead><tr><th>Sales Order</th><th>Customer</th><th>Sales Person</th><th>Advance</th><th>Status</th><th>Decide</th></tr></thead>
				<tbody>${rows_html}</tbody>
			</table>`);

		const self = this;
		this.$wrap.find(".ib-aap-approve").on("click", function () {
			self._decide($(this).closest("tr").data("so"), "Approved");
		});
		this.$wrap.find(".ib-aap-reject").on("click", function () {
			self._decide($(this).closest("tr").data("so"), "Rejected");
		});
	}

	_decide(sales_order, status) {
		const self = this;
		frappe.prompt(
			[{ fieldname: "remarks", label: __("Remarks"), fieldtype: "Small Text" }],
			(values) => {
				frappe.call({
					method: "instabiz.overrides.advance_approval.set_advance_approval",
					args: { sales_order, status, remarks: values.remarks },
					callback: () => {
						frappe.show_alert({ message: `${sales_order} ${status.toLowerCase()}`, indicator: status === "Approved" ? "green" : "orange" });
						self.refresh();
					},
				});
			},
			__(status === "Approved" ? "Approve Advance Payment" : "Reject Advance Payment"),
			__(status)
		);
	}

	_render_history(rows) {
		if (!rows.length) {
			this.$wrap.find("#ib-aap-history").html(`
				<div class="ib-aap-empty">
					<iconify-icon icon="lucide:history" width="22" height="22" style="opacity:.4;display:block;margin:0 auto 8px"></iconify-icon>
					No decisions yet.
				</div>`);
			return;
		}
		const rows_html = rows.map((r) => {
			const chip_cls = r.status === "Approved" ? "ib-aap-chip--approved" : "ib-aap-chip--rejected";
			return `
			<tr>
				<td><a href="/app/sales-order/${encodeURIComponent(r.name)}">${frappe.utils.escape_html(r.name)}</a></td>
				<td>${frappe.utils.escape_html(r.customer_name || "")}</td>
				<td>${frappe.utils.escape_html(r.sales_person_name || "—")}</td>
				<td class="ib-aap-amount">${this._fmt(r.advance_paid, r.currency)}</td>
				<td><span class="ib-aap-chip ${chip_cls}">${frappe.utils.escape_html(r.status)}</span></td>
				<td style="color:var(--text-muted)">${frappe.utils.escape_html(r.remarks || "—")}</td>
				<td class="ib-aap-age">${frappe.datetime.str_to_user(r.modified)}</td>
			</tr>`;
		}).join("");
		this.$wrap.find("#ib-aap-history").html(`
			<table class="ib-aap-table">
				<thead><tr><th>Sales Order</th><th>Customer</th><th>Sales Person</th><th>Advance</th><th>Decision</th><th>Remarks</th><th>When</th></tr></thead>
				<tbody>${rows_html}</tbody>
			</table>`);
	}
}
