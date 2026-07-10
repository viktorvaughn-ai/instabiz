frappe.pages["ib-leads-kanban"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({ parent: wrapper, title: "Leads Pipeline", single_column: true });
	wrapper._ib_lk = new IBLeadsKanban(wrapper);
};

frappe.pages["ib-leads-kanban"].on_page_show = function (wrapper) {
	if (wrapper._ib_lk) wrapper._ib_lk.load();
};

class IBLeadsKanban {
	constructor(wrapper) {
		this.$wrap = $(wrapper).find(".layout-main-section");
		this._search = "";
		this._dragSrc = null;
		this._inject_styles();
		this._build_layout();
		// load() started by on_page_show — no double call on first visit
	}

	_inject_styles() {
		if (document.getElementById("ib-lk-css")) return;
		const s = document.createElement("style");
		s.id = "ib-lk-css";
		s.textContent = `
:root { --ib-p:#d97757; }
.ib-lk-wrap { padding:16px; max-width:1600px; }
.ib-lk-toolbar { display:flex; align-items:center; gap:10px; margin-bottom:14px; flex-wrap:wrap; }
.ib-lk-toolbar h2 { font-size:1.2rem; font-weight:700; color:var(--heading-color); margin:0; flex:1; }
.ib-lk-input { padding:6px 12px; border:1px solid var(--border-color); border-radius:6px;
  font-size:12px; background:var(--card-bg,#fff); color:var(--text-color); min-width:200px; }
.ib-lk-input:focus { outline:none; border-color:var(--ib-p); }
.ib-lk-btn { padding:6px 14px; border:1px solid var(--border-color); border-radius:6px;
  background:var(--card-bg,#fff); color:var(--text-color); cursor:pointer; font-size:12px; transition:all .15s; }
.ib-lk-btn:hover { border-color:var(--ib-p); color:var(--ib-p); }
.ib-lk-stats { display:flex; gap:12px; margin-bottom:14px; flex-wrap:wrap; }
.ib-lk-stat { background:var(--card-bg,#fff); border:1px solid var(--border-color); border-radius:8px;
  padding:10px 16px; display:flex; align-items:center; gap:8px; }
.ib-lk-stat-v { font-size:1.2rem; font-weight:700; color:var(--heading-color); }
.ib-lk-stat-l { font-size:11px; color:var(--text-muted); }
.ib-lk-board { display:flex; gap:12px; overflow-x:auto; padding-bottom:12px; min-height:70vh; }
.ib-lk-col { flex:0 0 220px; display:flex; flex-direction:column; }
.ib-lk-col-head { padding:10px 12px; border-radius:8px 8px 0 0;
  display:flex; align-items:center; justify-content:space-between; }
.ib-lk-col-title { font-size:12px; font-weight:600; color:#fff; }
.ib-lk-col-count { background:rgba(255,255,255,.25); color:#fff; font-size:10px; font-weight:700;
  padding:1px 6px; border-radius:99px; }
.ib-lk-drop-zone { flex:1; padding:8px; background:var(--control-bg,#f8fafc);
  border:1px solid var(--border-color); border-top:none; border-radius:0 0 8px 8px;
  min-height:200px; display:flex; flex-direction:column; gap:8px; transition:background .15s; }
.ib-lk-drop-zone.drag-over { background:rgba(217,119,87,.08); border-color:var(--ib-p); }
.ib-lk-card { background:var(--card-bg,#fff); border:1px solid var(--border-color); border-radius:8px;
  padding:10px 12px; cursor:pointer; transition:box-shadow .15s, transform .1s;
  user-select:none; }
.ib-lk-card:hover { box-shadow:0 2px 8px rgba(0,0,0,.1); }
.ib-lk-card.dragging { opacity:.4; transform:rotate(1deg); }
.ib-lk-card-name { font-size:12px; font-weight:600; color:var(--heading-color); margin-bottom:4px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ib-lk-card-co { font-size:11px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ib-lk-card-meta { display:flex; align-items:center; justify-content:space-between; margin-top:8px; }
.ib-lk-card-src { font-size:9px; color:var(--text-muted); background:var(--control-bg,#f1f5f9);
  padding:2px 5px; border-radius:4px; }
.ib-lk-card-score { font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; }
.ib-lk-card-score.hi { background:#d1fae5; color:#065f46; }
.ib-lk-card-score.md { background:#fef3c7; color:#92400e; }
.ib-lk-card-score.lo { background:#fee2e2; color:#991b1b; }
.ib-lk-empty { font-size:11px; color:var(--text-muted); text-align:center; padding:20px 0; }
`;
		document.head.appendChild(s);
	}

	_build_layout() {
		this.$wrap.html(`
		<div class="ib-lk-wrap">
			<div class="ib-lk-toolbar">
				<h2>Leads Pipeline</h2>
				<input class="ib-lk-input" id="ib-lk-search" placeholder="Search lead…" />
				<button class="ib-lk-btn" id="ib-lk-new">+ New Lead</button>
				<button class="ib-lk-btn" id="ib-lk-refresh">↻ Refresh</button>
				<button class="ib-lk-btn" id="ib-lk-list">List View</button>
			</div>
			<div id="ib-lk-stats" class="ib-lk-stats"></div>
			<div id="ib-lk-board" class="ib-lk-board"></div>
		</div>`);

		let t;
		this.$wrap.find("#ib-lk-search").on("input", (e) => {
			clearTimeout(t);
			t = setTimeout(() => { this._search = e.target.value; this.load(); }, 300);
		});
		this.$wrap.find("#ib-lk-refresh").on("click", () => this.load());
		this.$wrap.find("#ib-lk-new").on("click", () => frappe.new_doc("Lead"));
		this.$wrap.find("#ib-lk-list").on("click", () => frappe.set_route("List", "Lead"));
	}

	load() {
		frappe.call({
			method: "instabiz.instabiz.page.ib_leads_kanban.ib_leads_kanban.get_leads_data",
			args: { search: this._search || null },
			callback: (r) => { if (r.message) this._render(r.message); }
		});
	}

	_render(d) {
		const conv_pct = d.total ? Math.round(d.converted / d.total * 100) : 0;
		this.$wrap.find("#ib-lk-stats").html(`
			<div class="ib-lk-stat"><div class="ib-lk-stat-v">${d.total}</div><div class="ib-lk-stat-l">Total Leads</div></div>
			<div class="ib-lk-stat"><div class="ib-lk-stat-v">${d.active}</div><div class="ib-lk-stat-l">Active</div></div>
			<div class="ib-lk-stat"><div class="ib-lk-stat-v" style="color:#10b981">${d.converted}</div><div class="ib-lk-stat-l">Converted</div></div>
			<div class="ib-lk-stat"><div class="ib-lk-stat-v" style="color:#ef4444">${d.lost}</div><div class="ib-lk-stat-l">Lost</div></div>
			<div class="ib-lk-stat"><div class="ib-lk-stat-v" style="color:var(--ib-p)">${conv_pct}%</div><div class="ib-lk-stat-l">Conv. Rate</div></div>
		`);

		const $board = this.$wrap.find("#ib-lk-board").empty();
		(d.columns || []).forEach(col => {
			const meta = col.meta || {};
			const $col = $(`
				<div class="ib-lk-col">
					<div class="ib-lk-col-head" style="background:${meta.color || '#6b7280'}">
						<span class="ib-lk-col-title">${frappe.utils.escape_html(meta.label || meta.key)}</span>
						<span class="ib-lk-col-count">${col.count || 0}</span>
					</div>
					<div class="ib-lk-drop-zone" data-status="${frappe.utils.escape_html(meta.key)}"></div>
				</div>`);

			const $zone = $col.find(".ib-lk-drop-zone");
			const cards = col.cards || [];

			if (!cards.length) {
				$zone.append('<div class="ib-lk-empty">No leads</div>');
			} else {
				cards.forEach(lead => {
					const score = lead.custom_lead_score || 0;
					const score_cls = score >= 70 ? "hi" : score >= 40 ? "md" : "lo";
					const $card = $(`
						<div class="ib-lk-card" draggable="true" data-lead="${frappe.utils.escape_html(lead.name)}">
							<div class="ib-lk-card-name" title="${frappe.utils.escape_html(lead.lead_name || '')}">${frappe.utils.escape_html(lead.lead_name || "")}</div>
							<div class="ib-lk-card-co">${frappe.utils.escape_html(lead.company_name || lead.email_id || "")}</div>
							<div class="ib-lk-card-meta">
								<span class="ib-lk-card-src">${frappe.utils.escape_html(lead.source || "")}</span>
								${score ? `<span class="ib-lk-card-score ${score_cls}">${score}</span>` : ""}
							</div>
						</div>`);

					$card.on("click", () => frappe.set_route("Form", "Lead", lead.name));
					$card.on("dragstart", (e) => { this._dragSrc = lead.name; this._dragSrcStatus = meta.key; e.originalEvent.dataTransfer.effectAllowed = "move"; $card.addClass("dragging"); });
					$card.on("dragend", () => { $card.removeClass("dragging"); this._dragSrc = null; });
					$zone.append($card);
				});
			}

			$zone.on("dragover", (e) => { e.preventDefault(); $zone.addClass("drag-over"); });
			$zone.on("dragleave", () => $zone.removeClass("drag-over"));
			$zone.on("drop", (e) => {
				e.preventDefault();
				$zone.removeClass("drag-over");
				const newStatus = $zone.data("status");
				if (!this._dragSrc || !newStatus) return;
				this._move_lead(this._dragSrc, newStatus, this._dragSrcStatus);
			});

			$board.append($col);
		});
	}

	_move_lead(lead, new_status, current_status) {
		if (new_status === current_status) return;
		frappe.call({
			method: "instabiz.instabiz.page.ib_leads_kanban.ib_leads_kanban.move_lead",
			args: { lead, status: new_status },
			callback: (r) => { if (r.message && r.message.status === "ok") { frappe.show_alert({ message: `Lead moved to ${new_status}`, indicator: "green" }, 2); this.load(); } },
			error: () => frappe.show_alert({ message: "Failed to move lead", indicator: "red" }, 3),
		});
	}
}
