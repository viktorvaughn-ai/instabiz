frappe.pages["ib-stock-dashboard"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Stock Balance"),
		single_column: true,
	});
	wrapper.dashboard = new IBStockDashboard(wrapper);
};

frappe.pages["ib-stock-dashboard"].on_page_show = function (wrapper) {
	if (!wrapper.dashboard) return;
	wrapper.dashboard._restore_filters();
	wrapper.dashboard.refresh();
	wrapper.dashboard._start_live();
	wrapper.dashboard._start_auto_refresh();
};

// ─────────────────────────────────────────────────────────────────────────────

class IBStockDashboard {
	constructor(wrapper) {
		this.wrapper        = wrapper;
		this.page           = wrapper.page;
		this._data          = [];
		this._filtered_data = [];
		this._summary       = {};
		this._sort          = { col: null, asc: true };
		this._active_card   = null;
		this._page          = 1;
		this._page_size     = 20;
		this._restoring     = false;
		this._auto_timer    = null;
		this._auto_secs     = 900;
		this._AUTO_SECS     = 900;
		this._$breakdown    = null;
		this._STORAGE_KEY   = "ib_sd_v1";
		this._live_debounce    = null;
		this._live_active      = false;
		this._last_refresh     = null;
		this._search_debounce  = null;
		this._search_tokens    = [];
		this._setup_filters();
		this._setup_content();
		this._setup_keyboard();
	}

	// ── Filters ──────────────────────────────────────────────────────────────

	_setup_filters() {
		this.f_uom = this.page.add_field({
			fieldname: "uom",
			label:     __("UOM"),
			fieldtype: "Select",
			options:   "\nSQMT\nPCS\nKG",
			change:    () => { if (!this._restoring) this.refresh(); },
		});

		this.f_warehouse = this.page.add_field({
			fieldname: "warehouse",
			label:     __("Warehouse"),
			fieldtype: "Select",
			options:   "\nMAHARASHTRA - IB\nCHENNAI - IB\nGUJARAT - IB",
			change:    () => { if (!this._restoring) this.refresh(); },
		});

		this.f_hide_zero = this.page.add_field({
			fieldname: "hide_zero_stock",
			label:     __("Hide Zero Stock"),
			fieldtype: "Check",
			default:   0,
			change:    () => {
				if (this._restoring) return;
				this._active_card = null;
				this._sync_cards();
				this.refresh();
			},
		});

		this.f_hide_zero.set_input(0);

		this.f_search = this.page.add_field({
			fieldname:   "search",
			label:       __("Type / to focus search"),
			fieldtype:   "Data",
			placeholder: __("item name, code, spec… (or press /)"),
		});
		$(this.f_search.wrapper).css("margin-left", "auto");

		// Native input event — fires on every keystroke, debounced
		$(this.f_search.wrapper).find("input").on("input", () => {
			if (this._restoring) return;
			clearTimeout(this._search_debounce);
			this._search_debounce = setTimeout(() => this._apply_search(), 160);
		});
	}

	// ── Layout ───────────────────────────────────────────────────────────────

	_setup_content() {
		this.$body = $(this.wrapper).find(".layout-main-section");
		this.$body.addClass("ib-sd-page");

		this.$content = $(`
			<div class="ib-sd-wrap">
				<div class="ib-sd-cards"></div>
				<div class="ib-sd-chips" style="display:none"></div>
				<div class="ib-sd-table-wrap">
					<div class="ib-sd-table-scroll">
						<table class="ib-sd-table">
							<thead></thead>
							<tbody></tbody>
						</table>
					</div>
					<div class="ib-sd-empty" style="display:none"></div>
					<div class="ib-sd-pagination"></div>
				</div>
			</div>
		`).appendTo(this.$body);
	}

	// ── Keyboard shortcuts ───────────────────────────────────────────────────

	_setup_keyboard() {
		$(document).on("keydown.ib-stock-dashboard", (e) => {
			if (frappe.get_route()[0] !== "ib-stock-dashboard") return;
			const tag = (e.target.tagName || "").toLowerCase();
			if (tag === "input" || tag === "textarea") return;

			if (e.key === "/") {
				e.preventDefault();
				$(this.f_search.wrapper).find("input").first().focus().select();
			} else if (e.key === "Escape" && this._$breakdown) {
				this._close_breakdown();
			}
		});
	}

	// ── Filter persistence ────────────────────────────────────────────────────

	_save_filters() {
		try {
			localStorage.setItem(this._STORAGE_KEY, JSON.stringify({
	
				uom:         this.f_uom.get_value()        || "",
				warehouse:   this.f_warehouse.get_value()  || "",
				hide_zero:   this.f_hide_zero.get_value()  ? 1 : 0,
				sort_col:    this._sort.col  || "",
				sort_asc:    this._sort.asc  ? 1 : 0,
				page_size:   this._page_size,
			}));
		} catch (_) {}
	}

	_restore_filters() {
		try {
			const saved = JSON.parse(localStorage.getItem(this._STORAGE_KEY) || "null");
			if (!saved) return;
			this._restoring = true;
			if (saved.uom)        this.f_uom.set_value(saved.uom);
			if (saved.warehouse)  this.f_warehouse.set_value(saved.warehouse);
			this.f_hide_zero.set_input(saved.hide_zero || 0);
			if (saved.sort_col) {
				this._sort.col = saved.sort_col;
				this._sort.asc = !!saved.sort_asc;
			}
			if (saved.page_size) this._page_size = saved.page_size;
			this._restoring = false;
		} catch (_) {
			this._restoring = false;
		}
	}

	// ── Auto-refresh ──────────────────────────────────────────────────────────

	_start_auto_refresh() {
		this._stop_auto_refresh();
		if (this._auto_secs <= 0 || this._auto_secs > this._AUTO_SECS) {
			this._auto_secs = this._AUTO_SECS;
		}
		this._auto_timer = setInterval(() => {
			if (document.hidden || frappe.get_route()[0] !== "ib-stock-dashboard") return;
			this._auto_secs--;
			if (this._auto_secs <= 0) {
				this._auto_secs = this._AUTO_SECS;
				this.refresh();
			}
		}, 1000);
	}

	_stop_auto_refresh() {
		if (this._auto_timer) {
			clearInterval(this._auto_timer);
			this._auto_timer = null;
		}
	}

	_flash_live() {
		const $badge = this.$content.find(".ib-sd-live-badge");
		$badge.addClass("ib-sd-live-badge--flash");
		setTimeout(() => $badge.removeClass("ib-sd-live-badge--flash"), 1200);
	}

	_flash_delta_rows(prev) {
		const changes = [];

		// Diff ALL data — treat items absent from prev (were zero/hidden) as { stock:0, available:0 }
		this._data.forEach(cur => {
			const p         = prev[cur.item_code] || { stock: 0, available: 0 };
			const availDiff = Number(cur.total_available) - p.available;
			if (availDiff === 0 && Number(cur.total_stock) === p.stock) return;
			changes.push({
				name:    cur.item_name || cur.item_code,
				before:  p.available,
				after:   Number(cur.total_available),
				diff:    availDiff,
				is_zero: Number(cur.total_available) === 0,
			});
		});

		// Flash only rows currently rendered in the DOM
		this.$content.find("tbody tr.ib-sd-row").each((_, tr) => {
			const $tr       = $(tr);
			const item_code = $tr.data("item-code");
			const p         = prev[item_code] || { stock: 0, available: 0 };
			const cur       = this._data.find(r => r.item_code === item_code);
			if (!cur) return;
			const availDiff = Number(cur.total_available) - p.available;
			if (availDiff === 0 && Number(cur.total_stock) === p.stock) return;
			const cls = availDiff >= 0 ? "ib-row-delta-up" : "ib-row-delta-down";
			$tr.addClass(cls);
			setTimeout(() => $tr.removeClass(cls), 2200);
		});

	}

	// ── Live WebSocket updates ────────────────────────────────────────────────

	_start_live() {
		if (!this._live_active) {
			frappe.realtime.doctype_subscribe("Bin");
			this._live_active = true;
		}
		frappe.realtime.off("ib_stock_update");
		frappe.realtime.on("ib_stock_update", () => {
			if (frappe.get_route()[0] !== "ib-stock-dashboard") return;
			clearTimeout(this._live_debounce);
			this._live_debounce = setTimeout(() => {
				this.refresh({ soft: true });
				this._flash_live();
			}, 1500);
		});
	}

	_stop_live() {
		frappe.realtime.off("ib_stock_update");
		if (this._live_active) {
			frappe.realtime.doctype_unsubscribe("Bin");
			this._live_active = false;
		}
		clearTimeout(this._live_debounce);
	}

	// ── Data fetch ────────────────────────────────────────────────────────────

	refresh({ soft = false } = {}) {
		this._page      = 1;
		this._auto_secs = this._AUTO_SECS;
		this._close_breakdown();
		this._save_filters();

		// Snapshot stock levels before soft refresh so we can flash changed rows after
		const prev = (soft && this._data.length)
			? Object.fromEntries(this._data.map(r => [r.item_code, {
				stock:     Number(r.total_stock),
				available: Number(r.total_available),
			}]))
			: null;

		this._set_loading(soft);

		frappe.call({
			method: "instabiz.instabiz.page.ib_stock_dashboard.ib_stock_dashboard.get_stock_data",
			args: {
				uom:             this.f_uom.get_value()        || null,
				warehouse:       this.f_warehouse.get_value()  || null,
				hide_zero_stock: this._get_hide_zero(),
				show_zero_only:  this._active_card === "zero" ? 1 : 0,
			},
			callback: (r) => {
				this.$content.find("tbody").removeClass("ib-tbody-dimmed");
				if (!r.message) return;
				this._last_refresh = new Date();
				this._data         = r.message.data;
				this._summary      = r.message.summary;
				this._render_cards(r.message.summary);
				this._apply_search();  // applies card filter + search tokens + renders
				if (prev) this._flash_delta_rows(prev);
			},
			error: () => {
				this.$content.find("tbody").removeClass("ib-tbody-dimmed");
				const n = this._columns().length;
				this.$content.find("tbody").html(
					`<tr><td colspan="${n}" class="ib-sd-loading" style="color:var(--red-500)">
						${__("Failed to load. Open console for details.")}
					</td></tr>`
				);
			},
		});
	}

	_get_hide_zero() {
		if (this._active_card === "zero")     return 0;
		if (this._active_card === "stock")    return 1;
		if (this._active_card === "negative") return 0;
		return this.f_hide_zero.get_value() ? 1 : 0;
	}

	_set_loading(soft = false) {
		this.$content.find(".ib-sd-empty").hide();
		this.$content.find(".ib-sd-table-scroll").show();
		this.$content.find(".ib-sd-pagination").empty();

		if (soft) {
			// Keep existing rows visible but dimmed during background refresh
			this.$content.find("tbody").addClass("ib-tbody-dimmed");
		} else {
			const n = this._columns().length;
			this.$content.find("tbody").html(`
				<tr>
					<td colspan="${n}" class="ib-sd-loading">
						<span class="ib-sd-spinner">
							<span></span><span></span><span></span>
						</span>
					</td>
				</tr>
			`);
		}
	}

	// ── Stat cards ────────────────────────────────────────────────────────────

	_render_cards(s) {
		const cards = [
			{ id: "all",      label: __("Total Items"),   value: s.total,    accent: true  },
			{ id: "stock",    label: __("In Stock"),      value: s.in_stock                },
			{ id: "zero",     label: __("Zero Stock"),    value: s.zero                    },
			{ id: "negative", label: __("Over-reserved"), value: s.negative, danger: true  },
		];

		const ts = this._last_refresh
			? this._last_refresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
			: "";

		const $cards = this.$content.find(".ib-sd-cards");
		$cards.html(cards.map(c => {
			const is_active  = this._active_card === c.id;
			const is_danger  = c.danger && c.value > 0;
			let cls = "ib-sd-card";
			if (c.accent)   cls += " ib-sd-card--accent";
			if (is_danger)  cls += " ib-sd-card--danger";
			if (is_active)  cls += " ib-sd-card--active";
			return `
				<div class="${cls}" data-card="${c.id}" style="cursor:pointer">
					<div class="ib-sd-card-value">${c.value}</div>
					<div class="ib-sd-card-label">${c.label}</div>
				</div>
			`;
		}).join(""));

		$cards.append(`
			<div class="ib-sd-actions">
				<button class="ib-sd-action-btn ib-sd-export-btn" title="${__("Export current view as CSV")}">
					<svg class="icon icon-sm"><use href="#es-line-down"></use></svg>
					${__("Export CSV")}
				</button>
				<button class="ib-sd-action-btn ib-sd-live-badge" title="${__("Click to Refresh Data")}">
					● ${__("Live")}
				</button>
				${ts ? `<span class="ib-sd-refresh-time">${__("Updated")} ${ts}</span>` : ""}
			</div>
		`);

		$cards.find(".ib-sd-card").on("click", (e) => {
			this._on_card_click($(e.currentTarget).data("card"));
		});
		$cards.find(".ib-sd-export-btn").on("click", () => this._export_csv());
		$cards.find(".ib-sd-live-badge").on("click", () => this.refresh());
	}

	_sync_cards() {
		this.$content.find(".ib-sd-card").each((_, el) => {
			$(el).toggleClass("ib-sd-card--active", this._active_card === $(el).data("card"));
		});
	}

	_on_card_click(id) {
		if (id === "all") {
			this._active_card = null;
			this._restoring = true;
			this.f_uom.set_value("");
			this.f_warehouse.set_value("");
			this.f_hide_zero.set_input(0);
			this.f_search.set_value("");
			this._restoring = false;
			this._filtered_data = [];
		} else {
			this._active_card = (this._active_card === id) ? null : id;
		}
		this._sync_cards();
		this.refresh();
	}

	// ── Active filter chips ───────────────────────────────────────────────────

	_render_chips() {
		const $chips = this.$content.find(".ib-sd-chips");
		const esc    = frappe.utils.escape_html;
		const chips  = [];

		const _clear = (fn) => () => {
			this._restoring = true;
			Promise.resolve(fn()).finally(() => {
				this._restoring = false;
				this.refresh();
			});
		};

		const uom = this.f_uom.get_value();
		if (uom) chips.push({ label: uom, type: "uom", clear: _clear(() => this.f_uom.set_value("")) });

		const wh = this.f_warehouse.get_value();
		if (wh) chips.push({ label: wh.split(" - ")[0], type: "wh", clear: _clear(() => this.f_warehouse.set_value("")) });

		if (this.f_hide_zero.get_value()) {
			chips.push({ label: __("Hide Zero"), type: "hide", clear: _clear(() => this.f_hide_zero.set_input(0)) });
		}

		const q = (this.f_search.get_value() || "").trim();
		if (q) chips.push({ label: `"${q}"`, type: "search", clear: _clear(() => this.f_search.set_value("")) });

		const card_labels = {
			stock:    __("In Stock"),
			zero:     __("Zero Stock"),
			negative: __("Over-reserved"),
		};
		if (this._active_card && card_labels[this._active_card]) {
			chips.push({
				label: card_labels[this._active_card],
				type:  this._active_card,
				clear: () => { this._active_card = null; this._sync_cards(); this.refresh(); },
			});
		}

		if (!chips.length) { $chips.empty().hide(); return; }

		$chips.html(
			chips.map((c, i) => `
				<span class="ib-chip ib-chip--${c.type}" data-idx="${i}">${esc(c.label)}<button class="ib-chip-x" aria-label="${__("Remove")}">×</button></span>
			`).join("")
		).show();

		$chips.find(".ib-chip").each((i, el) => {
			$(el).find(".ib-chip-x").on("click", (ev) => { ev.stopPropagation(); chips[i].clear(); });
		});
	}

	// ── Table ─────────────────────────────────────────────────────────────────

	_columns() {
		const wh          = this.f_warehouse.get_value();
		const stock_label = wh ? wh.split(" - ")[0] : __("Total Stock");
		return [
			{ id: "item_name",       label: __("Item Name"),     cls: "ib-col-name"             },
			{ id: "item_code",       label: __("Item Code"),     cls: "ib-col-code"             },
			{ id: "specification",   label: __("Specification"), cls: "ib-col-spec"             },
			{ id: "uom",             label: __("UOM"),           cls: "ib-col-uom"              },
			{ id: "total_stock",     label: stock_label,         cls: "ib-col-qty ib-col-total" },
			{ id: "total_available", label: __("Available"),     cls: "ib-col-qty"              },
		];
	}

	_render_table(data) {
		const cols   = this._columns();
		const $thead = this.$content.find("thead");
		const $tbody = this.$content.find("tbody");
		const $empty = this.$content.find(".ib-sd-empty");
		const $scroll = this.$content.find(".ib-sd-table-scroll");

		$thead.html(`<tr>${
			cols.map(c => `
				<th class="${c.cls}" data-col="${c.id}">
					${c.label}<span class="ib-sort-icon"></span>
				</th>
			`).join("")
		}</tr>`);

		$thead.find("th").on("click", (e) => {
			const col = $(e.currentTarget).data("col");
			this._sort.asc = (this._sort.col === col) ? !this._sort.asc : true;
			this._sort.col = col;
			this._save_filters();
			this._render_table(this._filtered_data);
		});

		$thead.find("th").each((_, th) => {
			$(th).find(".ib-sort-icon").text(
				this._sort.col === $(th).data("col") ? (this._sort.asc ? " ↑" : " ↓") : ""
			);
		});

		if (!data || data.length === 0) {
			$scroll.hide();
			const q = (this.f_search.get_value() || "").trim();
			$empty.text(q ? __("No items match your search") : __("No items found")).show();
			this.$content.find(".ib-sd-pagination").empty();
			return;
		}

		$empty.hide();
		$scroll.show();

		let rows = [...data];
		if (this._sort.col) {
			rows.sort((a, b) => {
				const va = a[this._sort.col], vb = b[this._sort.col];
				if (typeof va === "number") return this._sort.asc ? va - vb : vb - va;
				return this._sort.asc
					? String(va).localeCompare(String(vb))
					: String(vb).localeCompare(String(va));
			});
		}

		const total     = rows.length;
		const ps        = this._page_size;
		const max_pages = Math.ceil(total / ps);
		if (this._page > max_pages) this._page = max_pages || 1;
		const start = (this._page - 1) * ps;
		const end   = Math.min(start + ps, total);
		rows = rows.slice(start, end);
		this._render_pagination(total, start, end, max_pages);

		const esc = frappe.utils.escape_html;

		$tbody.html(rows.map(row => {
			const low_cls = row.low_stock ? " ib-row-low-stock" : "";
			return `
				<tr class="ib-sd-row${low_cls}" data-item-code="${esc(row.item_code || "")}"
					title="${__("Click to see warehouse breakdown")}">
					<td class="ib-col-name">${this._highlight(row.item_name, this._search_tokens)}</td>
					<td class="ib-col-code">
						<a href="/app/item/${encodeURIComponent(row.item_code)}" target="_blank">
							${this._highlight(row.item_code, this._search_tokens)}
						</a>
					</td>
					<td class="ib-col-spec">${this._spec_cell(row)}</td>
					<td class="ib-col-uom">${esc(row.uom || "")}</td>
					<td class="ib-col-qty ib-col-total">${this._qty(row.total_stock)}</td>
					<td class="ib-col-qty">${this._qty(row.total_available, true)}</td>
				</tr>
			`;
		}).join(""));

		$tbody.off("click.breakdown").on("click.breakdown", "tr.ib-sd-row", (e) => {
			if ($(e.target).is("a, button")) return;
			const $tr       = $(e.currentTarget);
			const item_code = $tr.data("item-code");
			if (this._$breakdown && $tr.hasClass("ib-row-active")) {
				this._close_breakdown();
				return;
			}
			const row = this._data.find(r => r.item_code === item_code);
			if (row) this._show_breakdown(row, e);
		});
	}

	_highlight(raw, tokens) {
		let text = frappe.utils.escape_html(raw || "");
		if (!tokens || !tokens.length) return text;
		tokens.forEach(t => {
			const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
			text = text.replace(re, m => `<mark class="ib-search-hl">${m}</mark>`);
		});
		return text;
	}

	_apply_search() {
		const query  = ($(this.f_search.wrapper).find("input").val() || "").trim();
		const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
		this._search_tokens = tokens;

		// Base: apply card-level filter first
		let base = this._data;
		if (this._active_card === "negative") {
			base = this._data.filter(r => Number(r.total_available) < 0);
		}

		this._filtered_data = tokens.length
			? base.filter(row => {
				const hay = [row.item_name || "", row.item_code || "", row.specification || ""]
					.join(" ").toLowerCase();
				return tokens.every(t => hay.includes(t));
			})
			: base;

		this._page = 1;
		this._render_chips();
		this._render_table(this._filtered_data);
	}

	_render_pagination(total, start, end, max_pages) {
		const $pg   = this.$content.find(".ib-sd-pagination");
		const sizes = [20, 50, 100, 500];

		const is_filtered = this._filtered_data.length !== this._data.length;
		const count_label = is_filtered
			? `${start + 1}–${end} of <strong>${total}</strong> matches <span class="ib-sd-pg-total">(${this._data.length} total)</span>`
			: `${start + 1}–${end} of ${total}`;

		$pg.html(`
			<div class="ib-sd-pg-left">
				<span class="ib-sd-pg-info">${count_label}</span>
				<div class="ib-sd-pg-nav">
					<button class="ib-sd-pg-btn" data-action="prev" ${this._page <= 1 ? "disabled" : ""}>&#8249;</button>
					<span class="ib-sd-pg-num">${this._page} / ${max_pages}</span>
					<button class="ib-sd-pg-btn" data-action="next" ${this._page >= max_pages ? "disabled" : ""}>&#8250;</button>
				</div>
			</div>
			<div class="ib-sd-pg-right">
				<span class="ib-sd-pg-label">${__("Per page")}</span>
				${sizes.map(s => `
					<button class="ib-sd-pg-size ${this._page_size === s ? "active" : ""}" data-size="${s}">${s}</button>
				`).join("")}
			</div>
		`);

		$pg.find("[data-action='prev']").on("click", () => {
			this._page--;
			this._render_table(this._filtered_data);
		});
		$pg.find("[data-action='next']").on("click", () => {
			this._page++;
			this._render_table(this._filtered_data);
		});
		$pg.find(".ib-sd-pg-size").on("click", (e) => {
			this._page_size = parseInt($(e.currentTarget).data("size"));
			this._page      = 1;
			this._save_filters();
			this._render_table(this._filtered_data);
		});
	}

	// ── Warehouse breakdown popover ───────────────────────────────────────────

	_show_breakdown(row, e) {
		this._close_breakdown();

		const esc = frappe.utils.escape_html;
		const whs = [
			{ label: "Maharashtra", stock: row.maharashtra || 0, res: row.mh_reserved || 0 },
			{ label: "Chennai",     stock: row.chennai     || 0, res: row.cn_reserved || 0 },
			{ label: "Gujarat",     stock: row.gujarat     || 0, res: row.gj_reserved || 0 },
		];

		const rows_html = whs.map(w => {
			const avail = Number(w.stock) - Number(w.res);
			const cls   = avail < 0 ? "ib-qty-negative" : avail > 0 ? "ib-qty-positive" : "ib-qty-zero";
			return `<tr>
				<td>${w.label}</td>
				<td class="ib-bd-num">${Number(w.stock).toLocaleString()}</td>
				<td class="ib-bd-num ib-bd-reserved">${Number(w.res).toLocaleString()}</td>
				<td class="ib-bd-num"><span class="${cls}">${avail.toLocaleString()}</span></td>
			</tr>`;
		}).join("");

		const total_res = whs.reduce((s, w) => s + Number(w.res), 0);
		const avail_cls = Number(row.total_available) < 0 ? "ib-qty-negative"
			: Number(row.total_available) > 0 ? "ib-qty-positive" : "ib-qty-zero";

		const low_badge = row.low_stock
			? `<span class="ib-breakdown-low-badge">${__("Low Stock")}</span>`
			: "";
		const reorder_footer = row.reorder_level
			? `<div class="ib-breakdown-reorder">${__("Reorder level")}: ${Number(row.reorder_level).toLocaleString()}</div>`
			: "";

		const $pop = $(`
			<div class="ib-sd-breakdown">
				<div class="ib-breakdown-hdr">
					<div>
						<div class="ib-breakdown-name">${esc(row.item_name || "")}${low_badge}</div>
						<div class="ib-breakdown-code">${esc(row.item_code || "")}</div>
						${row.specification ? `<div class="ib-breakdown-spec">${esc(row.specification)}</div>` : ""}
					</div>
					<button class="ib-breakdown-close" title="${__("Close")}">×</button>
				</div>
				<table class="ib-breakdown-table">
					<thead>
						<tr>
							<th>${__("Location")}</th>
							<th>${__("Stock")}</th>
							<th>${__("Reserved")}</th>
							<th>${__("Available")}</th>
						</tr>
					</thead>
					<tbody>${rows_html}</tbody>
					<tfoot>
						<tr>
							<td>${__("Total")}</td>
							<td class="ib-bd-num">${Number(row.total_stock || 0).toLocaleString()}</td>
							<td class="ib-bd-num ib-bd-reserved">${total_res.toLocaleString()}</td>
							<td class="ib-bd-num"><span class="${avail_cls}">${Number(row.total_available || 0).toLocaleString()}</span></td>
						</tr>
					</tfoot>
				</table>
				${reorder_footer}
			</div>
		`).css({ visibility: "hidden", position: "fixed", left: 0, top: 0 })
			.appendTo("body");

		const pw = $pop.outerWidth();
		const ph = $pop.outerHeight();
		const cx = e.clientX + 14;
		const cy = e.clientY + 14;
		$pop.css({
			visibility: "visible",
			left: Math.min(cx, window.innerWidth  - pw - 12),
			top:  Math.min(cy, window.innerHeight - ph - 12),
		});

		this.$content.find("tbody tr").removeClass("ib-row-active");
		this.$content.find(`tbody tr[data-item-code="${esc(row.item_code)}"]`).addClass("ib-row-active");

		$pop.find(".ib-breakdown-close").on("click", () => this._close_breakdown());

		setTimeout(() => {
			$(document).one("click.ib-breakdown", (ev) => {
				if (!$(ev.target).closest(".ib-sd-breakdown").length) this._close_breakdown();
			});
			$(document).one("keydown.ib-breakdown", (ev) => {
				if (ev.key === "Escape") this._close_breakdown();
			});
		}, 0);

		this._$breakdown = $pop;
	}

	_close_breakdown() {
		if (this._$breakdown) {
			this._$breakdown.remove();
			this._$breakdown = null;
			$(document).off("click.ib-breakdown keydown.ib-breakdown");
		}
		this.$content && this.$content.find("tbody tr").removeClass("ib-row-active");
	}

	// ── Spec cell ─────────────────────────────────────────────────────────────

	_spec_cell(row) {
		const hl    = (v) => this._highlight(v, this._search_tokens);
		const parts = [
			row.spec_dimension ? { cls: "ib-spec-dim",   text: hl(row.spec_dimension) } : null,
			row.spec_thickness ? { cls: "ib-spec-thick", text: hl(row.spec_thickness) } : null,
			row.spec_color     ? { cls: "ib-spec-color", text: hl(row.spec_color)     } : null,
			row.spec_liner     ? { cls: "ib-spec-liner", text: hl(row.spec_liner)     } : null,
		].filter(Boolean);

		if (!parts.length) return `<span class="text-muted">—</span>`;

		return parts.map((p, i) => `
			${i > 0 ? `<span class="ib-spec-sep"></span>` : ""}
			<span class="ib-spec-tag ${p.cls}">${p.text}</span>
		`).join("");
	}

	_qty(val, color = false) {
		const n = Number(val);
		if (!n) return `<span class="ib-qty-zero">0</span>`;
		if (color) {
			return `<span class="${n < 0 ? "ib-qty-negative" : "ib-qty-positive"}">${n.toLocaleString()}</span>`;
		}
		return `<span>${n.toLocaleString()}</span>`;
	}

	// ── Export CSV (with full warehouse breakdown) ────────────────────────────

	_export_csv() {
		const rows = this._filtered_data;
		if (!rows || !rows.length) {
			frappe.msgprint(__("Nothing to export."));
			return;
		}

		const wh      = this.f_warehouse.get_value();
		const esc_csv = v => `"${String(v ?? "").replace(/"/g, '""')}"`;

		const headers = [__("Item Name"), __("Item Code"), __("Specification"), __("UOM")];
		if (!wh) {
			headers.push(
				__("MH Stock"), __("MH Reserved"),
				__("CN Stock"), __("CN Reserved"),
				__("GJ Stock"), __("GJ Reserved"),
			);
		}
		headers.push(__("Total Stock"), __("Total Reserved"), __("Available"));

		const lines = [headers.map(esc_csv).join(",")];

		rows.forEach(row => {
			const total_res = Number(row.mh_reserved || 0) + Number(row.cn_reserved || 0) + Number(row.gj_reserved || 0);
			const vals = [row.item_name || "", row.item_code || "", row.specification || "", row.uom || ""];
			if (!wh) {
				vals.push(
					row.maharashtra  ?? 0, row.mh_reserved ?? 0,
					row.chennai      ?? 0, row.cn_reserved ?? 0,
					row.gujarat      ?? 0, row.gj_reserved ?? 0,
				);
			}
			vals.push(row.total_stock ?? 0, total_res, row.total_available ?? 0);
			lines.push(vals.map(esc_csv).join(","));
		});

		const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
		const url  = URL.createObjectURL(blob);
		const a    = document.createElement("a");
		a.href     = url;
		a.download = `stock_balance_${frappe.datetime.now_date()}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}
}
