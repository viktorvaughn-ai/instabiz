frappe.pages["ib-price-list"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Price List",
		single_column: true,
	});
	wrapper.page_obj = new IBPriceListPage(page, wrapper);
};

frappe.pages["ib-price-list"].on_page_show = function (wrapper) {
	if (wrapper.page_obj) wrapper.page_obj._on_show();
};

frappe.pages["ib-price-list"].on_page_hide = function (wrapper) {
	if (wrapper.page_obj) wrapper.page_obj._cleanup();
};

/* ─── Page controller ────────────────────────────────────────────────────── */
class IBPriceListPage {
	constructor(page, wrapper) {
		this.page    = page;
		this.wrapper = wrapper;
		this.$main   = $(wrapper).find(".page-content");
		this._is_admin = frappe.user.has_role("System Manager");
		this._is_mgr   = this._is_admin || frappe.user.has_role("Sales Manager");
		this._tab      = "jumbo";
		this._views    = {};
		this._init();
	}

	_init() {
		this._build_shell();
		this._build_toolbar();
		this._bind_tabs();
		this._restore_state();
		this._bind_realtime();
		this.refresh();
	}

	_bind_realtime() {
		this._rt_handler = (data) => this._on_price_update(data);
		frappe.realtime.on("ib_price_list_updated", this._rt_handler);

		const set_live = (on, label) => {
			const $el = this.$main.find("#ib-pl-live");
			if (!$el.length) return;
			$el.removeClass("ib-pl-live--on ib-pl-live--off")
			   .addClass(on ? "ib-pl-live--on" : "ib-pl-live--off");
			$el.find(".ib-pl-live-lbl").text(label);
		};

		const sock = frappe.realtime.socket;
		if (!sock) { set_live(false, "Offline"); return; }

		/* Ongoing state changes */
		this._rt_connect    = () => set_live(true,  "Live");
		this._rt_disconnect = () => set_live(false, "Offline");
		sock.on("connect",    this._rt_connect);
		sock.on("disconnect", this._rt_disconnect);

		/* socket.connected may already be true (connected at Frappe boot before page loaded).
		   The "connect" event already fired and we missed it — poll to catch initial state. */
		let _n = 0;
		this._rt_poll = setInterval(() => {
			if (sock.connected) {
				clearInterval(this._rt_poll);
				this._rt_poll = null;
				set_live(true, "Live");
			} else if (++_n >= 30) {          /* give up after 3 s */
				clearInterval(this._rt_poll);
				this._rt_poll = null;
				if (!sock.active) set_live(false, "Offline");
			}
		}, 100);
	}

	_on_price_update(data) {
		/* Skip if current user triggered the update (they already have latest) */
		if (data.changed_by === (frappe.boot.user || {}).full_name) return;

		const tab    = data.product_type === "Cut Pack" ? "cutpack" : "jumbo";
		const action = data.action === "add" ? "added" : "updated";
		const icon   = data.action === "add" ? "lucide:plus-circle" : "lucide:refresh-cw";
		const msg    = `<b>${frappe.utils.escape_html(data.item_code)}</b> ${action} by ${frappe.utils.escape_html(data.changed_by)}`;

		/* Show banner above the table in the affected tab's panel */
		const banner_id = `ib-pl-banner-${tab}`;
		this.$main.find(`#${banner_id}`).remove();
		const $banner = $(`
			<div class="ib-pl-update-banner" id="${banner_id}">
				<iconify-icon icon="${icon}" width="16" height="16"></iconify-icon>
				<span class="ib-pl-update-banner-msg">${msg}</span>
				<button class="ib-pl-update-banner-refresh">Refresh now</button>
				<button class="ib-pl-update-banner-dismiss" title="Dismiss">
					<iconify-icon icon="lucide:x" width="13" height="13"></iconify-icon>
				</button>
			</div>
		`);
		$banner.find(".ib-pl-update-banner-refresh").on("click", () => {
			$banner.remove();
			if (this._views[tab]) this._views[tab].refresh();
			else this._load_tab(tab);
		});
		$banner.find(".ib-pl-update-banner-dismiss").on("click", () => $banner.remove());
		this.$main.find(`#ib-rc-panel-${tab}`).prepend($banner);
	}

	/* ── SPA state: persist tab in URL hash ── */
	_restore_state() {
		const hash = (frappe.get_route()[1] || "").replace(/^#/, "");
		if (hash === "cutpack") {
			this._tab = "cutpack";
			this.$main.find(".ib-pl-tab").removeClass("ib-pl-tab--active");
			this.$main.find('[data-tab="cutpack"]').addClass("ib-pl-tab--active");
			this.$main.find("#ib-rc-panel-jumbo").hide();
			this.$main.find("#ib-rc-panel-cutpack").show();
		}
	}

	_set_state(tab) {
		this._tab = tab;
		frappe.set_route("ib-price-list", tab === "jumbo" ? "" : tab);
	}

	_on_show() {
		/* If already loaded, just re-apply state from URL without re-fetching */
		const hash = (frappe.get_route()[1] || "").replace(/^#/, "");
		const tab  = (hash === "cutpack") ? "cutpack" : "jumbo";
		if (tab !== this._tab) {
			this._tab = tab;
			this.$main.find(".ib-pl-tab").removeClass("ib-pl-tab--active");
			this.$main.find(`[data-tab="${tab}"]`).addClass("ib-pl-tab--active");
			this.$main.find(".ib-rc-panel").hide();
			this.$main.find(`#ib-rc-panel-${tab}`).show();
			if (!this._views[tab]) this._load_tab(tab);
		}
	}

	_build_toolbar() {
		if (this._is_mgr) {
			this.page.add_inner_button("Add Entry", () => this._add_entry());
		}
		if (this._is_admin) {
			this.page.add_inner_button("Re-import from Excel", () => this._reimport(), "Manage");
		}
		this.page.add_inner_button("Refresh", () => this.refresh(true));
	}

	_add_entry() {
		const tab   = this._tab;
		const ptype = tab === "jumbo" ? "Jumbo Roll" : "Cut Pack";
		_open_entry_dialog(null, ptype, (saved) => {
			// insert into current view's dataset and re-render
			const view = this._views[tab];
			if (view) {
				view._all.push(saved);
				view._all.sort((a, b) => (a.item_code || "").localeCompare(b.item_code || ""));
				view._filter();
			}
			// update badge
			const badge_id = tab === "jumbo" ? "#badge-jumbo" : "#badge-cutpack";
			const cur = parseInt(this.$main.find(badge_id).text()) || 0;
			this.$main.find(badge_id).text(cur + 1);
		});
	}

	_build_shell() {
		if (!document.getElementById("ib-pl-v2-styles")) {
			const s = document.createElement("style");
			s.id = "ib-pl-v2-styles";
			s.textContent = `
				.ib-pl-tabs { display:flex; gap:0; padding:10px 0 0; border-bottom:2px solid var(--border-color); margin-bottom:14px; }
				button.ib-pl-tab {
					-webkit-appearance:none; appearance:none;
					padding:8px 28px; border:1.5px solid transparent !important; border-bottom:none !important;
					border-radius:8px 8px 0 0; font-size:13px; font-weight:600; cursor:pointer;
					color:var(--text-muted); background:transparent !important; box-shadow:none !important;
					transition:all .15s; margin-bottom:-2px; margin-right:4px; line-height:1.4;
				}
				button.ib-pl-tab:hover { background:var(--bg-color) !important; color:var(--text-color); }
				button.ib-pl-tab.ib-pl-tab--active {
					background:var(--card-bg) !important; color:var(--ib-primary,#d97757);
					border-color:var(--border-color) !important; border-bottom-color:var(--card-bg) !important;
				}
				.ib-pl-tab-badge {
					display:inline-block; margin-left:6px; padding:1px 7px; border-radius:10px;
					font-size:10px; font-weight:700; background:var(--bg-color); color:var(--text-muted);
				}
				button.ib-pl-tab.ib-pl-tab--active .ib-pl-tab-badge { background:var(--ib-primary,#d97757); color:#fff; }
				.ib-pl-acts { display:flex; align-items:center; justify-content:flex-end; gap:2px; }
				button.ib-pl-act {
					-webkit-appearance:none; appearance:none;
					width:28px; height:28px; padding:0; margin:0; line-height:1;
					border:none !important; background:transparent !important; box-shadow:none !important;
					border-radius:6px; cursor:pointer;
					display:inline-flex; align-items:center; justify-content:center;
					color:var(--text-muted); opacity:0;
					transition:background .12s, color .12s, opacity .15s;
				}
				.ib-pl-row:hover button.ib-pl-act,
				.ib-pl-row:focus-within button.ib-pl-act { opacity:1; }
				button.ib-pl-act:focus-visible { opacity:1; outline:2px solid var(--ib-primary); outline-offset:1px; }
				button.ib-pl-act--edit:hover { background:var(--ib-tint-mid,#f7ede7) !important; color:var(--ib-primary,#d97757); }
				button.ib-pl-act--hist:hover { background:var(--ib-tint-mid,#f7ede7) !important; color:var(--ib-primary-dark,#c0622f); }
				button.ib-pl-act--del:hover  { background:#fef2f2 !important; color:#b91c1c; }
				/* ── Live indicator ── */
				.ib-pl-live {
					display:inline-flex; align-items:center; gap:5px;
					font-size:11px; font-weight:600; letter-spacing:.03em;
					padding:3px 9px 3px 6px; border-radius:20px;
					border:1px solid; transition:all .3s; user-select:none;
					margin-left:auto;
				}
				.ib-pl-live--on  { color:#16a34a; border-color:rgba(22,163,74,.25); background:rgba(22,163,74,.07); }
				.ib-pl-live--off { color:var(--text-muted); border-color:var(--border-color); background:transparent; }
				.ib-pl-live--on  .ib-pl-live-dot { background:#16a34a; box-shadow:0 0 0 0 rgba(22,163,74,.5); animation:ib-live-pulse 2s ease infinite; }
				.ib-pl-live--off .ib-pl-live-dot { background:var(--text-muted); animation:none; }
				.ib-pl-live-dot {
					width:7px; height:7px; border-radius:50%; flex-shrink:0;
				}
				@keyframes ib-live-pulse {
					0%   { box-shadow: 0 0 0 0   rgba(22,163,74,.5); }
					60%  { box-shadow: 0 0 0 5px rgba(22,163,74,0);  }
					100% { box-shadow: 0 0 0 0   rgba(22,163,74,0);  }
				}
				/* ── Shimmer skeleton ── */
				@keyframes ib-shimmer {
					0%   { background-position: -300% 0; }
					100% { background-position:  300% 0; }
				}
				.ib-pl-skel-row td { padding: 10px 12px; border-bottom: 1px solid var(--border-color); }
				.ib-pl-skel-cell {
					height: 12px; border-radius: 4px; display: block;
					background: linear-gradient(90deg,
						var(--border-color) 25%,
						color-mix(in srgb, var(--border-color) 40%, var(--card-bg)) 50%,
						var(--border-color) 75%);
					background-size: 300% 100%;
					animation: ib-shimmer 1.5s ease-in-out infinite;
				}
				.ib-pl-skel-row:nth-child(2n) .ib-pl-skel-cell { animation-delay: .1s; }
				.ib-pl-skel-row:nth-child(3n) .ib-pl-skel-cell { animation-delay: .2s; }
				.ib-pl-update-banner {
					display: flex; align-items: center; gap: 10px;
					padding: 9px 14px; margin-bottom: 10px;
					background: var(--ib-tint-mid); border: 1px solid var(--ib-primary);
					border-radius: 7px; font-size: 13px; color: var(--ib-primary-dark);
					animation: ib-page-in .2s ease both;
				}
				.ib-pl-update-banner iconify-icon { flex-shrink: 0; }
				.ib-pl-update-banner-msg { flex: 1; }
				.ib-pl-update-banner-refresh {
					-webkit-appearance:none; appearance:none;
					padding: 4px 12px; border: 1px solid var(--ib-primary) !important;
					background: var(--ib-primary) !important; color: #fff !important;
					border-radius: 5px; font-size: 12px; font-weight: 600;
					cursor: pointer; white-space: nowrap; box-shadow: none !important;
				}
				.ib-pl-update-banner-dismiss {
					-webkit-appearance:none; appearance:none;
					background: none !important; border: none !important;
					box-shadow: none !important; cursor: pointer;
					color: var(--text-muted); padding: 2px; display: flex;
				}
				.ib-pl-filter-sel {
					height:32px; padding:0 8px; border:1px solid var(--border-color);
					border-radius:5px; background:var(--card-bg); color:var(--text-color);
					font-size:12px; cursor:pointer; outline:none;
				}
				.ib-pl-filter-sel:focus { border-color:var(--ib-primary); }
				.ib-pl-filter-sel.ib-active { border-color:var(--ib-primary); background:var(--ib-tint-mid); color:var(--ib-primary); font-weight:600; }
				.ib-pl-pg-btn {
					-webkit-appearance:none; appearance:none;
					min-width:28px; height:28px; padding:0 6px;
					border:1px solid var(--border-color) !important; background:var(--card-bg) !important;
					box-shadow:none !important; border-radius:5px; font-size:12px;
					color:var(--text-color); cursor:pointer; display:inline-flex;
					align-items:center; justify-content:center; transition:background .12s, color .12s;
				}
				.ib-pl-pg-btn:hover:not(:disabled) { background:var(--ib-tint-mid) !important; border-color:var(--ib-primary) !important; color:var(--ib-primary); }
				.ib-pl-pg-btn:disabled { opacity:.35; cursor:default; }
				.ib-pl-pg-size {
					-webkit-appearance:none; appearance:none;
					height:28px; padding:0 8px; border:1px solid var(--border-color);
					border-radius:5px; background:var(--card-bg); color:var(--text-color);
					font-size:12px; cursor:pointer;
				}
			`;
			document.head.appendChild(s);
		}
		this.$main.html(`
			<div style="display:flex;align-items:flex-end;margin-bottom:0">
				<div class="ib-pl-tabs" id="ib-pl-tabs" style="margin-bottom:0;border-bottom:none;flex:1">
					<button class="ib-pl-tab ib-pl-tab--active" data-tab="jumbo">
						Jumbo Rolls <span class="ib-pl-tab-badge" id="badge-jumbo">…</span>
					</button>
					<button class="ib-pl-tab" data-tab="cutpack">
						Cut Pack <span class="ib-pl-tab-badge" id="badge-cutpack">…</span>
					</button>
				</div>
				<div id="ib-pl-live-wrap" style="padding-bottom:12px;display:flex;align-items:center;gap:10px">
					<span class="ib-pl-live ib-pl-live--off" id="ib-pl-live" title="Realtime price update connection status">
						<span class="ib-pl-live-dot"></span>
						<span class="ib-pl-live-lbl">Connecting…</span>
					</span>
					<span class="ib-refresh-time" id="ib-pl-refresh-time" style="display:none">
						<iconify-icon icon="lucide:clock" width="12" height="12"></iconify-icon>
						${__("Updated")} <span id="ib-pl-refresh-time-val"></span>
					</span>
				</div>
			</div>
			<div style="border-bottom:2px solid var(--border-color);margin-bottom:14px"></div>
			<div id="ib-rc-panel-jumbo"  class="ib-rc-panel"></div>
			<div id="ib-rc-panel-cutpack" class="ib-rc-panel" style="display:none"></div>
		`);

		frappe.call({
			method: "instabiz.instabiz.page.ib_price_list.ib_price_list.get_rate_card_meta",
			callback: (r) => {
				if (!r.message) return;
				const meta = r.message;
				const j = meta["Jumbo Roll"]  || {};
				const c = meta["Cut Pack"]    || {};
				this.$main.find("#badge-jumbo").text(j.count   || 0);
				this.$main.find("#badge-cutpack").text(c.count || 0);
				if (j.last_date) this.$main.find("#badge-jumbo").attr("title", `Effective: ${j.last_date}`);
				if (c.last_date) this.$main.find("#badge-cutpack").attr("title", `Effective: ${c.last_date}`);
			},
		});
	}

	_bind_tabs() {
		this.$main.on("click", ".ib-pl-tab", (e) => {
			const tab = $(e.currentTarget).data("tab");
			if (tab === this._tab) return;
			this._set_state(tab);
			this.$main.find(".ib-pl-tab").removeClass("ib-pl-tab--active");
			$(e.currentTarget).addClass("ib-pl-tab--active");
			this.$main.find(".ib-rc-panel").hide();
			this.$main.find(`#ib-rc-panel-${tab}`).show();
			if (!this._views[tab]) this._load_tab(tab);
		});
	}

	_load_tab(tab) {
		const type = tab === "jumbo" ? "Jumbo Roll" : "Cut Pack";
		this._views[tab] = new IBRateCardView(
			this.$main.find(`#ib-rc-panel-${tab}`),
			type, this._is_mgr, this._is_admin
		);
	}

	refresh(force = false) {
		const tab = this._tab;
		if (this._views[tab]) {
			/* Only re-fetch if forced (toolbar Refresh btn) or data empty */
			if (force || !this._views[tab]._all.length) {
				this._views[tab].refresh();
			}
		} else {
			this._load_tab(tab);
		}
	}

	_reimport() {
		frappe.confirm(
			`Re-import <b>PRICE LIST.xlsx</b> from the scripts folder?<br>
			<small style="color:var(--text-muted)">All existing rate card entries will be replaced.</small>`,
			() => {
				frappe.show_alert({ message: "Importing…", indicator: "blue" }, 4);
				frappe.call({
					method: "instabiz.instabiz.page.ib_price_list.ib_price_list.reimport_rate_card",
					callback: (r) => {
						if (!r.message) return;
						const { jumbo, cut_pack, total } = r.message;
						frappe.show_alert({ message: `Imported ${total} entries (${jumbo} jumbo, ${cut_pack} cut pack)`, indicator: "green" }, 6);
						this._views = {};
						this.$main.find("#badge-jumbo").text("…");
						this.$main.find("#badge-cutpack").text("…");
						this._load_tab(this._tab);
						frappe.call({
							method: "instabiz.instabiz.page.ib_price_list.ib_price_list.get_rate_card_meta",
							callback: (r2) => {
								if (!r2.message) return;
								const j = r2.message["Jumbo Roll"] || {}, c = r2.message["Cut Pack"] || {};
								this.$main.find("#badge-jumbo").text(j.count || 0);
								this.$main.find("#badge-cutpack").text(c.count || 0);
							},
						});
					},
					error: () => frappe.show_alert({ message: "Import failed", indicator: "red" }),
				});
			}
		);
	}

	_cleanup() {
		if (this._rt_poll) { clearInterval(this._rt_poll); this._rt_poll = null; }
		if (this._rt_handler) {
			frappe.realtime.off("ib_price_list_updated", this._rt_handler);
			this._rt_handler = null;
		}
		const sock = frappe.realtime.socket;
		if (sock) {
			if (this._rt_connect)    sock.off("connect",    this._rt_connect);
			if (this._rt_disconnect) sock.off("disconnect", this._rt_disconnect);
		}
		Object.values(this._views).forEach(v => v._cleanup && v._cleanup());
	}
}


/* ─── Rate card table (shared for Jumbo / Cut Pack) ─────────────────────── */
class IBRateCardView {
	constructor($container, product_type, is_mgr, is_admin) {
		this.$el          = $container;
		this.product_type = product_type;
		this._is_mgr      = is_mgr;
		this._is_admin    = is_admin;
		this._is_jumbo    = product_type === "Jumbo Roll";
		this._all         = [];
		this._filtered    = [];
		this._tokens      = [];
		this._page        = 1;
		this._page_size   = 50;
		this._f           = { color: "", thickness: "", unit: "" };
		this._build();
	}

	_build() {
		const action_th = this._is_mgr
			? `<th class="ib-pl-th ib-pl-th--actions" style="width:80px"></th>`
			: "";

		const jumbo_heads = `
			<th class="ib-pl-th ib-pl-th--code">Code</th>
			<th class="ib-pl-th ib-pl-th--name">Product Name</th>
			<th class="ib-pl-th ib-pl-th--spec">Spec</th>
			<th class="ib-pl-th" style="min-width:72px;text-align:center">Width</th>
			<th class="ib-pl-th" style="min-width:72px;text-align:center">Length</th>
			<th class="ib-pl-th ib-pl-th--uom">UOM</th>
			<th class="ib-pl-th ib-pl-th--rate ib-pl-th--rate-start" style="color:#0284c7">Face Price</th>
			<th class="ib-pl-th ib-pl-th--rate" style="color:#0d9488">Last Price</th>
			${action_th}`;

		const cut_heads = `
			<th class="ib-pl-th ib-pl-th--code">Code</th>
			<th class="ib-pl-th ib-pl-th--name">Product Name</th>
			<th class="ib-pl-th ib-pl-th--spec">Spec</th>
			<th class="ib-pl-th ib-pl-th--uom">UOM</th>
			<th class="ib-pl-th ib-pl-th--rate ib-pl-th--rate-start" style="color:#0284c7" title="Highest — small qty">Slab 1</th>
			<th class="ib-pl-th ib-pl-th--rate" style="color:#7c3aed">Slab 2</th>
			<th class="ib-pl-th ib-pl-th--rate" style="color:#d97757">Slab 3</th>
			<th class="ib-pl-th ib-pl-th--rate" style="color:#16a34a">Slab 4</th>
			<th class="ib-pl-th ib-pl-th--rate" style="color:#0d9488" title="Lowest — bulk">Slab 5</th>
			<th class="ib-pl-th" style="min-width:140px">Packing</th>
			${action_th}`;

		this.$el.html(`
			<div class="ib-pl-search-bar" style="display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-bottom:10px">
				<div class="ib-pl-search-field" style="flex:1;min-width:200px">
					<label class="ib-pl-search-label">Search</label>
					<input class="form-control ib-pl-search-input ib-rcv-search"
						type="text" placeholder="code, name, colour, thickness…" autocomplete="off">
				</div>
				<div style="display:flex;flex-direction:column;gap:2px">
					<label class="ib-pl-search-label">Colour</label>
					<select class="ib-pl-filter-sel ib-rcv-f-color" style="min-width:110px">
						<option value="">All colours</option>
					</select>
				</div>
				<div style="display:flex;flex-direction:column;gap:2px">
					<label class="ib-pl-search-label">Thickness</label>
					<select class="ib-pl-filter-sel ib-rcv-f-thick" style="min-width:100px">
						<option value="">All thickness</option>
					</select>
				</div>
				<div style="display:flex;flex-direction:column;gap:2px">
					<label class="ib-pl-search-label">UOM</label>
					<select class="ib-pl-filter-sel ib-rcv-f-unit" style="min-width:80px">
						<option value="">All UOM</option>
					</select>
				</div>
				<button class="ib-rcv-clear-filters" style="display:none;margin-bottom:1px;padding:5px 12px;
					border:1px solid var(--ib-primary);background:var(--ib-tint-mid);color:var(--ib-primary);
					border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;
					-webkit-appearance:none;appearance:none">
					<iconify-icon icon="lucide:x" width="11" height="11" style="vertical-align:middle;margin-right:3px"></iconify-icon>Clear
				</button>
			</div>
			<div class="ib-card ib-pl-table-wrap">
				<table class="ib-pl-table">
					<thead><tr>${this._is_jumbo ? jumbo_heads : cut_heads}</tr></thead>
					<tbody class="ib-rcv-tbody"></tbody>
				</table>
				<div class="ib-pl-empty ib-rcv-empty" style="display:none">
					${IB_ICONS.svg("search", 32)}<p class="ib-rcv-empty-msg">No items found</p>
				</div>
				<div class="ib-pl-pagination ib-rcv-pager" style="display:none">
					<div class="ib-pl-pg-info ib-rcv-pg-info"></div>
					<div class="ib-pl-pg-controls" style="display:flex;align-items:center;gap:6px">
						<select class="ib-pl-pg-size ib-rcv-pg-size" title="Rows per page">
							<option value="20">20 / page</option>
							<option value="50" selected>50 / page</option>
							<option value="100">100 / page</option>
							<option value="999">All</option>
						</select>
						<button class="ib-pl-pg-btn ib-rcv-first" title="First page">
							<iconify-icon icon="lucide:chevrons-left" width="13" height="13"></iconify-icon>
						</button>
						<button class="ib-pl-pg-btn ib-rcv-prev" title="Previous page">
							<iconify-icon icon="lucide:chevron-left" width="13" height="13"></iconify-icon>
						</button>
						<span class="ib-rcv-pg-nums" style="display:flex;gap:3px"></span>
						<button class="ib-pl-pg-btn ib-rcv-next" title="Next page">
							<iconify-icon icon="lucide:chevron-right" width="13" height="13"></iconify-icon>
						</button>
						<button class="ib-pl-pg-btn ib-rcv-last" title="Last page">
							<iconify-icon icon="lucide:chevrons-right" width="13" height="13"></iconify-icon>
						</button>
					</div>
				</div>
			</div>
		`);

		let _t;
		this.$el.on("input", ".ib-rcv-search", () => { clearTimeout(_t); _t = setTimeout(() => this._filter(), 150); });
		this.$el.on("click", ".ib-rcv-first", () => { if (this._page > 1) { this._page = 1; this._render_page(); } });
		this.$el.on("click", ".ib-rcv-prev",  () => { if (this._page > 1) { this._page--; this._render_page(); } });
		this.$el.on("click", ".ib-rcv-next",  () => {
			const max = Math.ceil(this._filtered.length / this._page_size);
			if (this._page < max) { this._page++; this._render_page(); }
		});
		this.$el.on("click", ".ib-rcv-last",  () => {
			const max = Math.ceil(this._filtered.length / this._page_size);
			if (this._page < max) { this._page = max; this._render_page(); }
		});
		this.$el.on("click", ".ib-rcv-pg-num", (e) => {
			const p = parseInt($(e.currentTarget).data("p"));
			if (p && p !== this._page) { this._page = p; this._render_page(); }
		});
		this.$el.on("change", ".ib-rcv-pg-size", (e) => {
			this._page_size = parseInt(e.target.value) || 50; this._page = 1; this._render_page();
		});
		this.$el.on("change", ".ib-rcv-f-color", (e) => { this._f.color = e.target.value; this._sync_filter_ui(); this._filter(); });
		this.$el.on("change", ".ib-rcv-f-thick", (e) => { this._f.thickness = e.target.value; this._sync_filter_ui(); this._filter(); });
		this.$el.on("change", ".ib-rcv-f-unit",  (e) => { this._f.unit = e.target.value; this._sync_filter_ui(); this._filter(); });
		this.$el.on("click", ".ib-rcv-clear-filters", () => {
			this._f = { color: "", thickness: "", unit: "" };
			this.$el.find(".ib-rcv-f-color").val("");
			this.$el.find(".ib-rcv-f-thick").val("");
			this.$el.find(".ib-rcv-f-unit").val("");
			this._sync_filter_ui();
			this._filter();
		});

		// action buttons — delegated
		this.$el.on("click", ".ib-pl-act--edit", (e) => {
			e.stopPropagation();
			const name = $(e.currentTarget).data("name");
			const row  = this._all.find(r => r.name === name);
			if (!row) return;
			_open_entry_dialog(row, row.product_type, (saved) => {
				Object.assign(row, saved);
				this._filter();
			});
		});

		this.$el.on("click", ".ib-pl-act--hist", (e) => {
			e.stopPropagation();
			const name = $(e.currentTarget).data("name");
			const row  = this._all.find(r => r.name === name);
			this._show_history(name, row ? row.item_code : name);
		});

		this.$el.on("click", ".ib-pl-act--del", (e) => {
			e.stopPropagation();
			const name = $(e.currentTarget).data("name");
			const row  = this._all.find(r => r.name === name);
			const label = row ? `${row.item_code} — ${row.product_name}` : name;
			frappe.confirm(
				`Delete <b>${frappe.utils.escape_html(label)}</b>?<br>
				<small style="color:var(--text-muted)">This cannot be undone.</small>`,
				() => {
					frappe.call({
						method: "instabiz.instabiz.page.ib_price_list.ib_price_list.delete_rate_card_entry",
						args: { name },
						callback: () => {
							this._all = this._all.filter(r => r.name !== name);
							this._filter();
							frappe.show_alert({ message: "Deleted", indicator: "green" }, 3);
						},
						error: () => frappe.show_alert({ message: "Delete failed", indicator: "red" }),
					});
				}
			);
		});

		this.refresh();
	}

	refresh() {
		this.$el.find(".ib-rcv-empty").hide();
		this._show_skeleton();

		frappe.call({
			method: "instabiz.instabiz.page.ib_price_list.ib_price_list.get_rate_card",
			args: { product_type: this.product_type },
			callback: (r) => {
				if (!r.message) return;
				this._all = r.message;
				this._populate_filters();
				this._filter();
				const $ts = $("#ib-pl-refresh-time");
				if ($ts.length) {
					const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
					$ts.show().find("#ib-pl-refresh-time-val").text(now);
				}
			},
			error: () => {
				this.$el.find(".ib-rcv-tbody").empty();
				frappe.show_alert({ message: "Failed to load", indicator: "red" });
			},
		});
	}

	_show_skeleton(n = 9) {
		const cols = this._is_jumbo ? 8 : 10;
		const action_cols = this._is_mgr ? 1 : 0;
		const total_cols  = cols + action_cols;
		/* vary widths so rows look natural */
		const widths = [55, 80, 65, 70, 60, 75, 50, 85, 68, 72];
		const rows = Array.from({length: n}, (_, i) =>
			`<tr class="ib-pl-skel-row">${
				Array.from({length: total_cols}, (_, c) =>
					`<td><span class="ib-pl-skel-cell" style="width:${widths[(i + c) % widths.length]}%"></span></td>`
				).join("")
			}</tr>`
		).join("");
		this.$el.find(".ib-rcv-tbody").html(rows);
	}

	_populate_filters() {
		const uniq = (field) => [...new Set(
			this._all.map(r => (r[field] || "").trim()).filter(Boolean)
		)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

		const fill = ($sel, label, vals, prev) => {
			$sel.empty().append(`<option value="">${label}</option>`);
			vals.forEach(v => $sel.append(`<option value="${frappe.utils.escape_html(v)}">${frappe.utils.escape_html(v)}</option>`));
			if (prev && vals.includes(prev)) $sel.val(prev);
		};

		fill(this.$el.find(".ib-rcv-f-color"), "All colours",   uniq("color"),     this._f.color);
		fill(this.$el.find(".ib-rcv-f-thick"), "All thickness", uniq("thickness"), this._f.thickness);
		fill(this.$el.find(".ib-rcv-f-unit"),  "All UOM",       uniq("unit"),      this._f.unit);
	}

	_sync_filter_ui() {
		const active = Object.values(this._f).some(v => v !== "");
		this.$el.find(".ib-rcv-clear-filters").toggle(active);
		this.$el.find(".ib-rcv-f-color").toggleClass("ib-active", !!this._f.color);
		this.$el.find(".ib-rcv-f-thick").toggleClass("ib-active", !!this._f.thickness);
		this.$el.find(".ib-rcv-f-unit").toggleClass("ib-active",  !!this._f.unit);
	}

	_filter() {
		const q = (this.$el.find(".ib-rcv-search").val() || "").trim();
		this._tokens = q.toLowerCase().split(/\s+/).filter(Boolean);

		this._filtered = this._all.filter(r => {
			if (this._f.color     && (r.color     || "").trim() !== this._f.color)     return false;
			if (this._f.thickness && (r.thickness || "").trim() !== this._f.thickness) return false;
			if (this._f.unit      && (r.unit      || "").trim() !== this._f.unit)      return false;
			if (this._tokens.length) {
				const hay = [r.item_code, r.product_name, r.color, r.liner, r.thickness, r.unit, r.packing_standard].join(" ").toLowerCase();
				return this._tokens.every(t => hay.includes(t));
			}
			return true;
		});

		this._page = 1;
		this._render_page();
	}

	_render_page() {
		const total    = this._filtered.length;
		const start    = (this._page - 1) * this._page_size;
		const max_page = Math.ceil(total / this._page_size) || 1;
		this._render(this._filtered.slice(start, start + this._page_size), start);

		const $pager = this.$el.find(".ib-rcv-pager");
		if (total <= this._page_size) { $pager.hide(); return; }

		const end = Math.min(start + this._page_size, total);
		const filtered_note = this._filtered.length < this._all.length
			? ` <span style="color:var(--ib-primary);font-weight:600">(filtered from ${this._all.length})</span>` : "";
		this.$el.find(".ib-rcv-pg-info").html(`${start + 1}–${end} of ${total}${filtered_note}`);

		// Disable nav buttons
		const at_start = this._page <= 1;
		const at_end   = this._page >= max_page;
		this.$el.find(".ib-rcv-first, .ib-rcv-prev").prop("disabled", at_start);
		this.$el.find(".ib-rcv-next, .ib-rcv-last").prop("disabled", at_end);

		// Page number chips (show up to 7: ellipsis around current)
		const pages = [];
		for (let p = 1; p <= max_page; p++) {
			if (max_page <= 7 || p === 1 || p === max_page ||
				(p >= this._page - 1 && p <= this._page + 1)) {
				pages.push(p);
			} else if (pages[pages.length - 1] !== "…") {
				pages.push("…");
			}
		}
		this.$el.find(".ib-rcv-pg-nums").html(pages.map(p =>
			p === "…"
				? `<span style="padding:0 2px;color:var(--text-muted);font-size:12px">…</span>`
				: `<button class="ib-pl-pg-btn ib-rcv-pg-num${p === this._page ? " ib-pg-active" : ""}" data-p="${p}"
					style="${p === this._page ? "background:var(--ib-primary);color:#fff;border-color:var(--ib-primary)" : ""}">${p}</button>`
		).join(""));

		$pager.show();
	}

	_render(rows, start_idx = 0) {
		const $tbody = this.$el.find(".ib-rcv-tbody");
		const $empty = this.$el.find(".ib-rcv-empty");

		if (!rows.length) {
			$tbody.empty();
			const q = (this.$el.find(".ib-rcv-search").val() || "").trim();
			this.$el.find(".ib-rcv-empty-msg").text(q ? "No items match your search" : "No entries found");
			$empty.show();
			return;
		}
		$empty.hide();

		const esc = frappe.utils.escape_html;
		const hl  = (v) => IBStock.highlight(v || "", this._tokens);
		const fmt = (v, col) => {
			const n = parseFloat(v);
			if (!n) return `<span style="color:var(--text-muted)">—</span>`;
			return `<span style="color:${col};font-weight:600">₹${n.toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}</span>`;
		};
		const dim_cell = (v, unit) => v
			? `<span style="font-size:12px;font-weight:500">${esc(String(v))}${unit}</span>`
			: `<span style="color:var(--text-muted)">—</span>`;

		const action_td = (name) => {
			if (!this._is_mgr) return "";
			const del_btn = this._is_admin
				? `<button class="ib-pl-act ib-pl-act--del" data-name="${esc(name)}" title="Delete entry" aria-label="Delete entry">
					<iconify-icon icon="lucide:trash-2" width="13" height="13"></iconify-icon>
				</button>`
				: "";
			return `<td class="ib-pl-td" style="padding:4px 10px">
				<div class="ib-pl-acts">
					<button class="ib-pl-act ib-pl-act--edit" data-name="${esc(name)}" title="Edit prices" aria-label="Edit prices">
						<iconify-icon icon="lucide:pencil" width="13" height="13"></iconify-icon>
					</button>
					<button class="ib-pl-act ib-pl-act--hist" data-name="${esc(name)}" title="Price history" aria-label="Price history">
						<iconify-icon icon="lucide:history" width="13" height="13"></iconify-icon>
					</button>
					${del_btn}
				</div>
			</td>`;
		};

		const html = rows.map((r, i) => {
			const alt = (start_idx + i) % 2 ? " ib-pl-row--alt" : "";

			const spec_parts = [
				r.thickness ? `<span class="ib-spec-tag ib-spec-thick">${hl(r.thickness)}</span>` : "",
				r.color     ? `<span class="ib-spec-tag ib-spec-color">${IBStock.color_dots(r.color)}${hl(r.color)}</span>` : "",
				r.liner && r.liner !== r.color
				            ? `<span class="ib-spec-tag ib-spec-liner">${hl(r.liner)}</span>` : "",
			].filter(Boolean).join(`<span class="ib-spec-sep"></span>`);

			const spec_td = spec_parts
				? `<td class="ib-pl-td ib-pl-td--spec">${spec_parts}</td>`
				: `<td class="ib-pl-td ib-pl-td--spec"><span class="text-muted">—</span></td>`;

			const uom_td = `<td class="ib-pl-td ib-pl-td--uom" style="text-align:center">${
				r.unit ? `<span class="ib-chip ib-chip--uom-${(r.unit||"").toLowerCase()}">${esc(r.unit)}</span>` : ""}</td>`;

			const code_td = `<td class="ib-pl-td ib-pl-td--code">
				<a href="/app/ib-rate-card-entry/${esc(r.name)}" target="_blank"
				   style="font-size:11px;color:var(--text-muted);text-decoration:none"
				   onclick="event.stopPropagation()">${hl(r.item_code)}</a>
			</td>`;

			const name_td = `<td class="ib-pl-td ib-pl-td--name">${hl(r.product_name)}</td>`;

			if (this._is_jumbo) {
				return `<tr class="ib-pl-row${alt}">
					${code_td}${name_td}${spec_td}
					<td class="ib-pl-td" style="text-align:center">${dim_cell(r.width_mm, "mm")}</td>
					<td class="ib-pl-td" style="text-align:center">${dim_cell(r.length_m, "m")}</td>
					${uom_td}
					<td class="ib-pl-td ib-pl-td--rate ib-pl-td--rate-start">${fmt(r.face_price, "#0284c7")}</td>
					<td class="ib-pl-td ib-pl-td--rate">${fmt(r.last_price, "#0d9488")}</td>
					${action_td(r.name)}
				</tr>`;
			}

			const pack_td = r.packing_standard
				? `<td class="ib-pl-td" style="font-size:11px;color:var(--text-muted)">${esc(r.packing_standard)}</td>`
				: `<td class="ib-pl-td"><span style="color:var(--text-muted)">—</span></td>`;

			return `<tr class="ib-pl-row${alt}">
				${code_td}${name_td}${spec_td}${uom_td}
				<td class="ib-pl-td ib-pl-td--rate ib-pl-td--rate-start">${fmt(r.slab1, "#0284c7")}</td>
				<td class="ib-pl-td ib-pl-td--rate">${fmt(r.slab2, "#7c3aed")}</td>
				<td class="ib-pl-td ib-pl-td--rate">${fmt(r.slab3, "#d97757")}</td>
				<td class="ib-pl-td ib-pl-td--rate">${fmt(r.slab4, "#16a34a")}</td>
				<td class="ib-pl-td ib-pl-td--rate">${fmt(r.slab5, "#0d9488")}</td>
				${pack_td}
				${action_td(r.name)}
			</tr>`;
		}).join("");

		$tbody.html(html);
	}

	_show_history(name, label) {
		const d = new frappe.ui.Dialog({
			title: `Price History — ${label}`,
			size: "large",
		});
		d.$body.html(`<div style="text-align:center;padding:24px;color:var(--text-muted)">
			<iconify-icon icon="lucide:loader-2" width="20" height="20" style="animation:spin 1s linear infinite"></iconify-icon>
			<span style="margin-left:8px">Loading history…</span>
		</div>`);
		d.show();
		frappe.call({
			method: "instabiz.instabiz.page.ib_price_list.ib_price_list.get_price_history",
			args: { name },
			callback: (r) => {
				const hist = r.message || [];
				if (!hist.length) {
					d.$body.html(`<div style="text-align:center;padding:32px;color:var(--text-muted)">
						<iconify-icon icon="lucide:clock" width="32" height="32" style="opacity:.3"></iconify-icon>
						<p style="margin-top:10px">No price changes recorded yet.</p>
					</div>`);
					return;
				}
				const label_map = {
					face_price: "Face Price", last_price: "Last Price",
					slab1: "Slab 1", slab2: "Slab 2", slab3: "Slab 3",
					slab4: "Slab 4", slab5: "Slab 5",
				};
				const fmt_inr = (v) => {
					const n = parseFloat(v);
					if (!n) return "—";
					return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
				};
				const html = hist.map(h => {
					const chips = (h.changes || []).map(([field, old_v, new_v]) => {
						const up = parseFloat(new_v) >= parseFloat(old_v);
						return `<div class="ib-ph-chip ${up ? "ib-ph-chip--up" : "ib-ph-chip--down"}">
							<span class="ib-ph-lbl">${label_map[field] || field}</span>
							<span class="ib-ph-old">${fmt_inr(old_v)}</span>
							<span class="ib-ph-arr">${up ? "↑" : "↓"}</span>
							<span class="ib-ph-new">${fmt_inr(new_v)}</span>
						</div>`;
					}).join("");
					const ts = frappe.datetime.str_to_user(h.timestamp);
					return `<div class="ib-ph-entry">
						<div class="ib-ph-hdr">
							<span class="ib-ph-when">${ts}</span>
							<span class="ib-ph-sep">·</span>
							<span class="ib-ph-who">${frappe.utils.escape_html(h.user)}</span>
						</div>
						<div class="ib-ph-chips">${chips}</div>
					</div>`;
				}).join("");
				d.$body.html(`<div class="ib-ph-list" style="max-height:60vh;overflow-y:auto;padding:4px 0">${html}</div>`);
			},
		});
	}

	_cleanup() {}
}


/* ─── Shared add / edit dialog ───────────────────────────────────────────── */
function _open_entry_dialog(row, product_type, on_save) {
	const is_edit = !!row;
	const is_jumbo = product_type === "Jumbo Roll";

	const fields = [
		{
			fieldtype: "Select", fieldname: "product_type", label: "Product Type",
			options: "Jumbo Roll\nCut Pack", reqd: 1,
			read_only: is_edit ? 1 : 0,
		},
		{ fieldtype: "Column Break" },
		{ fieldtype: "Data", fieldname: "item_code", label: "Item Code", reqd: 1 },
		{ fieldtype: "Section Break", label: "Product Details" },
		{ fieldtype: "Data", fieldname: "product_name", label: "Product Name" },
		{ fieldtype: "Column Break" },
		{ fieldtype: "Data", fieldname: "color", label: "Color" },
		{ fieldtype: "Data", fieldname: "liner", label: "Liner / Weight" },
		{ fieldtype: "Data", fieldname: "thickness", label: "Thickness" },
		{ fieldtype: "Column Break" },
		{ fieldtype: "Int",   fieldname: "width_mm",  label: "Width (mm)" },
		{ fieldtype: "Float", fieldname: "length_m",  label: "Length (m)" },
		{ fieldtype: "Data",  fieldname: "unit",      label: "Unit" },
		{ fieldtype: "Date",  fieldname: "effective_date", label: "Effective Date" },
		{ fieldtype: "Section Break", label: "Pricing" },
		// Jumbo pricing
		{ fieldtype: "Currency", fieldname: "face_price", label: "Face Price", hidden: !is_jumbo ? 1 : 0 },
		{ fieldtype: "Currency", fieldname: "last_price", label: "Last Price",  hidden: !is_jumbo ? 1 : 0 },
		// Cut Pack pricing
		{ fieldtype: "Currency", fieldname: "slab1", label: "Slab 1 (highest)", hidden: is_jumbo ? 1 : 0 },
		{ fieldtype: "Currency", fieldname: "slab2", label: "Slab 2",           hidden: is_jumbo ? 1 : 0 },
		{ fieldtype: "Currency", fieldname: "slab3", label: "Slab 3",           hidden: is_jumbo ? 1 : 0 },
		{ fieldtype: "Currency", fieldname: "slab4", label: "Slab 4",           hidden: is_jumbo ? 1 : 0 },
		{ fieldtype: "Currency", fieldname: "slab5", label: "Slab 5 (bulk)",    hidden: is_jumbo ? 1 : 0 },
		{ fieldtype: "Section Break", label: "Packing" },
		{ fieldtype: "Data", fieldname: "packing_standard", label: "Packing Standard" },
	];

	const d = new frappe.ui.Dialog({
		title: is_edit ? `Edit — ${row.item_code}` : "Add Rate Card Entry",
		size: "large",
		fields,
		primary_action_label: is_edit ? "Save" : "Add",
		primary_action(vals) {
			d.disable_primary_action();
			const method = is_edit
				? "instabiz.instabiz.page.ib_price_list.ib_price_list.save_rate_card_entry"
				: "instabiz.instabiz.page.ib_price_list.ib_price_list.add_rate_card_entry";
			const args = is_edit
				? { name: row.name, data: JSON.stringify(vals) }
				: { data: JSON.stringify(vals) };

			frappe.call({
				method,
				args,
				callback: (r) => {
					d.enable_primary_action();
					if (!r.message) return;
					frappe.show_alert({ message: is_edit ? "Saved" : "Entry added", indicator: "green" }, 3);
					d.hide();
					on_save && on_save(r.message);
				},
				error: () => { d.enable_primary_action(); },
			});
		},
	});

	// pre-fill for edit
	if (row) {
		d.set_values({
			product_type:     row.product_type     || product_type,
			item_code:        row.item_code        || "",
			product_name:     row.product_name     || "",
			color:            row.color            || "",
			liner:            row.liner            || "",
			thickness:        row.thickness        || "",
			width_mm:         row.width_mm         || "",
			length_m:         row.length_m         || "",
			unit:             row.unit             || "",
			effective_date:   row.effective_date   || frappe.datetime.get_today(),
			packing_standard: row.packing_standard || "",
			face_price:       row.face_price       || "",
			last_price:       row.last_price       || "",
			slab1:            row.slab1            || "",
			slab2:            row.slab2            || "",
			slab3:            row.slab3            || "",
			slab4:            row.slab4            || "",
			slab5:            row.slab5            || "",
		});
	} else {
		d.set_value("product_type", product_type);
		d.set_value("effective_date", frappe.datetime.get_today());
	}

	// for add dialog: swap price sections when product_type changes
	if (!is_edit) {
		d.fields_dict.product_type.df.onchange = function () {
			const pt = d.get_value("product_type");
			const jumbo = pt === "Jumbo Roll";
			["face_price", "last_price"].forEach(f => d.set_df_property(f, "hidden", !jumbo));
			["slab1", "slab2", "slab3", "slab4", "slab5"].forEach(f => d.set_df_property(f, "hidden", jumbo));
			d.refresh();
		};
	}

	d.show();
}
