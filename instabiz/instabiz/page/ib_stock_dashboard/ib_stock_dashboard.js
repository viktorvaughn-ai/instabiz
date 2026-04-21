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
	wrapper.dashboard._live.start();
};

frappe.pages["ib-stock-dashboard"].on_page_hide = function (wrapper) {
	if (!wrapper.dashboard) return;
	wrapper.dashboard._live.stop();
	wrapper.dashboard._auto.stop();
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
		this._ncols         = 6;
		this._restoring     = false;
		this._last_refresh  = null;
		this._search_debounce = null;
		this._search_tokens = [];
		this._search_chips  = [];
		this._STORAGE_KEY   = "ib_sd_v1";

		this._live = IBStock.make_live("ib-stock-dashboard", () => {
			this.refresh({ soft: true });
			this._flash_live();
		});
		this._auto = IBStock.make_auto_refresh(900, "ib-stock-dashboard", () => this.refresh());

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
				this._apply_search();
			},
		});

		this.f_hide_zero.set_input(0);

		this.f_search = this.page.add_field({
			fieldname:   "search",
			label:       __("Search"),
			fieldtype:   "Data",
			placeholder: __("name, code, colour, size…"),
		});
		$(this.f_search.wrapper).css("margin-left", "auto");

		const $inp = $(this.f_search.wrapper).find("input");

		$inp.on("input", () => {
			if (this._restoring) return;
			clearTimeout(this._search_debounce);
			this._search_debounce = setTimeout(() => this._apply_search(), 160);
		});

		$inp.on("keydown", (e) => {
			if (this._restoring) return;
			if (e.key === "Enter") {
				const val = $inp.val().trim();
				if (!val) return;
				e.preventDefault();
				clearTimeout(this._search_debounce);
				this._search_chips.push(val);
				$inp.val("");
				this._apply_search();
			} else if (e.key === "Backspace" && $inp.val() === "") {
				if (this._search_chips.length) {
					this._search_chips.pop();
					this._apply_search();
				}
			}
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

			if (e.key === "Escape" && this._$breakdown) {
				this._close_breakdown();
				return;
			}

			const tag = (e.target.tagName || "").toLowerCase();
			if (tag === "input" || tag === "textarea" || tag === "select") return;
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (e.key.length !== 1) return;

			$(this.f_search.wrapper).find("input").first().focus();
		});
	}

	// ── Filter persistence ────────────────────────────────────────────────────

	_save_filters() {
		try {
			localStorage.setItem(this._STORAGE_KEY, JSON.stringify({
				uom:          this.f_uom.get_value()          || "",
				warehouse:    this.f_warehouse.get_value()    || "",
				hide_zero:    this.f_hide_zero.get_value()    ? 1 : 0,
				search:       $(this.f_search.wrapper).find("input").val() || "",
				search_chips: this._search_chips,
				sort_col:     this._sort.col  || "",
				sort_asc:     this._sort.asc  ? 1 : 0,
				page_size:    this._page_size,
			}));
		} catch (_) {}
	}

	_restore_filters() {
		try {
			const saved = JSON.parse(localStorage.getItem(this._STORAGE_KEY) || "null");
			if (!saved) return;
			this._restoring = true;
			if (saved.uom)         this.f_uom.set_value(saved.uom);
			if (saved.warehouse)   this.f_warehouse.set_value(saved.warehouse);
			this.f_hide_zero.set_input(saved.hide_zero || 0);
			if (saved.search)      $(this.f_search.wrapper).find("input").val(saved.search);
			if (Array.isArray(saved.search_chips)) this._search_chips = saved.search_chips;
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

	// ── Live badge ────────────────────────────────────────────────────────────

	_flash_live() {
		const $badge = this.$content.find(".ib-sd-live-badge");
		$badge.addClass("ib-sd-live-badge--flash");
		setTimeout(() => $badge.removeClass("ib-sd-live-badge--flash"), 1200);
	}

	// ── Data fetch ────────────────────────────────────────────────────────────

	refresh({ soft = false } = {}) {
		this._page = 1;
		this._auto.stop();
		this._auto.start();
		this._close_breakdown();
		this._save_filters();
		this._set_loading(soft);

		frappe.call({
			method: "instabiz.instabiz.page.ib_stock_dashboard.ib_stock_dashboard.get_stock_data",
			args: {
				uom:       this.f_uom.get_value()       || null,
				warehouse: this.f_warehouse.get_value() || null,
			},
			callback: (r) => {
				this.$content.find("tbody").removeClass("ib-tbody-dimmed");
				if (!r.message) return;
				this._last_refresh = new Date();
				this._data         = r.message.data;
				this._summary      = r.message.summary;
				this._render_cards(r.message.summary);
				this._apply_search();
			},
			error: () => {
				this.$content.find("tbody").removeClass("ib-tbody-dimmed");
				this.$content.find("tbody").html(
					`<tr><td colspan="${this._ncols}" class="ib-sd-loading" style="color:var(--red-500)">
						${__("Failed to load. Open console for details.")}
					</td></tr>`
				);
			},
		});
	}

	_set_loading(soft = false) {
		this.$content.find(".ib-sd-empty").hide();
		this.$content.find(".ib-sd-table-scroll").show();
		this.$content.find(".ib-sd-pagination").empty();

		if (soft) {
			this.$content.find("tbody").addClass("ib-tbody-dimmed");
		} else {
			this.$content.find("tbody").html(`
				<tr>
					<td colspan="${this._ncols}" class="ib-sd-loading">
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
			{ id: "all",      label: __("Total Items"),   value: s.total,     accent: true  },
			{ id: "stock",    label: __("In Stock"),      value: s.in_stock                 },
			{ id: "low",      label: __("Low Stock"),     value: s.low_stock, warn: true    },
			{ id: "zero",     label: __("Zero Stock"),    value: s.zero                     },
			{ id: "negative", label: __("Over-reserved"), value: s.negative,  danger: true  },
		];

		const ts = this._last_refresh
			? this._last_refresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
			: "";

		const $cards = this.$content.find(".ib-sd-cards");
		$cards.html(cards.map(c => {
			const is_active  = this._active_card === c.id;
			const is_warn    = c.warn   && c.value > 0;
			const is_danger  = c.danger && c.value > 0;
			let cls = "ib-sd-card";
			if (c.accent)   cls += " ib-sd-card--accent";
			if (is_warn)    cls += " ib-sd-card--warn";
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
			this._active_card  = null;
			this._search_chips = [];
			this._restoring    = true;
			this.f_uom.set_value("");
			this.f_warehouse.set_value("");
			this.f_hide_zero.set_input(0);
			this.f_search.set_value("");
			$(this.f_search.wrapper).find("input").val("");
			this._restoring = false;
			this._filtered_data = [];
			this._sync_cards();
			this.refresh();
		} else {
			this._active_card = (this._active_card === id) ? null : id;
			this._sync_cards();
			this._apply_search();
		}
	}

	// ── Active filter chips ───────────────────────────────────────────────────

	_render_chips() {
		const $chips = this.$content.find(".ib-sd-chips");
		const esc    = frappe.utils.escape_html;
		const chips  = [];

		const _clear_server = (fn) => () => {
			this._restoring = true;
			Promise.resolve(fn()).finally(() => {
				this._restoring = false;
				this.refresh();
			});
		};

		const uom = this.f_uom.get_value();
		if (uom) chips.push({ label: uom, type: `uom-${uom.toLowerCase()}`, clear: _clear_server(() => this.f_uom.set_value("")) });

		const wh = this.f_warehouse.get_value();
		if (wh) chips.push({ label: wh.split(" - ")[0], type: "wh", clear: _clear_server(() => this.f_warehouse.set_value("")) });

		if (this.f_hide_zero.get_value()) {
			chips.push({ label: __("Hide Zero"), type: "hide", clear: () => {
				this.f_hide_zero.set_input(0);
				this._apply_search();
			}});
		}

		this._search_chips.forEach((chip, idx) => {
			chips.push({
				label: `"${chip}"`,
				type:  "search",
				clear: () => {
					this._search_chips.splice(idx, 1);
					this._apply_search();
				},
			});
		});

		const card_labels = {
			stock:    __("In Stock"),
			low:      __("Low Stock"),
			zero:     __("Zero Stock"),
			negative: __("Over-reserved"),
		};
		if (this._active_card && card_labels[this._active_card]) {
			chips.push({
				label: card_labels[this._active_card],
				type:  this._active_card,
				clear: () => { this._active_card = null; this._sync_cards(); this._apply_search(); },
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

		if (chips.length > 1) {
			$chips.append(`<button class="ib-chip-clear-all">${__("Clear all")}</button>`);
			$chips.find(".ib-chip-clear-all").on("click", () => this._on_card_click("all"));
		}
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
		this._ncols  = cols.length;
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
			const has_search = this._search_tokens.length > 0;
			let msg;
			if (this._active_card === "zero" && !has_search) {
				msg = __("All items have stock");
			} else if (this._active_card === "negative" && !has_search) {
				msg = __("No over-reserved items");
			} else if (this._active_card === "low" && !has_search) {
				msg = __("No low stock items");
			} else if (has_search) {
				const terms = [
					...this._search_chips,
					($(this.f_search.wrapper).find("input").val() || "").trim(),
				].filter(Boolean);
				msg = terms.length
					? `${__("No matches for")} "${terms.join('", "')}"`
					: __("No items match your search");
			} else {
				msg = __("No items found for these filters");
			}
			$empty.text(msg).show();
			this.$content.find(".ib-sd-pagination").empty();
			return;
		}

		$empty.hide();
		$scroll.show();

		const rows = IBStock.sort_rows(data, this._sort.col, this._sort.asc);

		const total     = rows.length;
		const ps        = this._page_size;
		const max_pages = Math.ceil(total / ps);
		if (this._page > max_pages) this._page = max_pages || 1;
		const start   = (this._page - 1) * ps;
		const end     = Math.min(start + ps, total);
		const page_rows = rows.slice(start, end);
		this._render_pagination(total, start, end, max_pages);

		const esc = frappe.utils.escape_html;

		$tbody.html(page_rows.map(row => {
			const low_cls = row.low_stock ? " ib-row-low-stock" : "";
			return `
				<tr class="ib-sd-row${low_cls}" data-item-code="${esc(row.item_code || "")}"
					title="${__("Click to see warehouse breakdown")}">
					<td class="ib-col-name">${IBStock.highlight(row.item_name, this._search_tokens)}</td>
					<td class="ib-col-code">
						<a href="/app/item/${encodeURIComponent(row.item_code)}" target="_blank">
							${IBStock.highlight(row.item_code, this._search_tokens)}
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

	_apply_search() {
		this._save_filters();
		const live        = ($(this.f_search.wrapper).find("input").val() || "").trim();
		const live_tokens = live.toLowerCase().split(/\s+/).filter(Boolean);
		const chip_tokens = this._search_chips.map(c => c.toLowerCase());
		const all_tokens  = [...chip_tokens, ...live_tokens];
		this._search_tokens = all_tokens;

		let base = this._data;
		if      (this._active_card === "stock")    base = base.filter(r => Number(r.total_stock) > 0);
		else if (this._active_card === "zero")     base = base.filter(r => Number(r.total_stock) === 0);
		else if (this._active_card === "negative") base = base.filter(r => Number(r.total_available) < 0);
		else if (this._active_card === "low")      base = base.filter(r => r.low_stock);

		if (this.f_hide_zero.get_value() && this._active_card !== "zero") {
			base = base.filter(r => Number(r.total_stock) !== 0);
		}

		this._filtered_data = all_tokens.length
			? base.filter(row => {
				const hay = [
					row.item_name      || "",
					row.item_code      || "",
					row.specification  || "",
					row.spec_color     || "",
					row.spec_liner     || "",
					row.spec_thickness || "",
					row.spec_adhesive  || "",
					row.spec_sqmt ? String(row.spec_sqmt) : "",
				].join(" ").toLowerCase();
				return all_tokens.every(t => hay.includes(t));
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

		const esc         = frappe.utils.escape_html;
		const total_stock = Number(row.total_stock   || 0);
		const total_avail = Number(row.total_available || 0);

		const whs = [
			{ label: "Maharashtra", stock: Number(row.maharashtra || 0), res: Number(row.mh_reserved || 0), reorder: Number(row.mh_reorder_level || 0) },
			{ label: "Chennai",     stock: Number(row.chennai     || 0), res: Number(row.cn_reserved  || 0), reorder: Number(row.cn_reorder_level || 0) },
			{ label: "Gujarat",     stock: Number(row.gujarat     || 0), res: Number(row.gj_reserved  || 0), reorder: Number(row.gj_reorder_level || 0) },
		];
		const total_res     = whs.reduce((s, w) => s + w.res, 0);
		const total_reorder = whs.reduce((s, w) => s + w.reorder, 0);
		const max_stock     = Math.max(...whs.map(w => w.stock), 1);

		let status, status_cls;
		if (total_stock === 0)    { status = __("No Stock");      status_cls = "ib-status--none";   }
		else if (total_avail < 0) { status = __("Over-reserved"); status_cls = "ib-status--danger"; }
		else if (row.low_stock)   { status = __("Low Stock");     status_cls = "ib-status--warn";   }
		else                      { status = __("Healthy");        status_cls = "ib-status--good";   }

		const rows_html = whs.map(w => {
			const avail     = w.stock - w.res;
			const avail_cls = avail < 0 ? "ib-qty-negative" : avail > 0 ? "ib-qty-positive" : "ib-qty-zero";
			const bar_pct   = Math.round(w.stock / max_stock * 100);
			const res_pct   = w.stock > 0 ? Math.round(w.res / w.stock * 100) : 0;
			const res_label = w.res > 0
				? `${w.res.toLocaleString()} <span class="ib-bd-pct">(${res_pct}%)</span>`
				: `<span class="ib-bd-zero">—</span>`;
			const reorder_label = w.reorder > 0
				? w.reorder.toLocaleString()
				: `<span class="ib-bd-zero">—</span>`;
			return `<tr>
				<td class="ib-bd-loc">${w.label}</td>
				<td class="ib-bd-num">
					${w.stock.toLocaleString()}
					<div class="ib-bd-bar">
						<div class="ib-bd-bar-stock" style="width:${bar_pct}%">
							<div class="ib-bd-bar-res" style="width:${res_pct}%"></div>
						</div>
					</div>
				</td>
				<td class="ib-bd-num ib-bd-reserved">${res_label}</td>
				<td class="ib-bd-num ib-bd-reorder">${reorder_label}</td>
				<td class="ib-bd-num"><span class="${avail_cls}">${avail.toLocaleString()}</span></td>
			</tr>`;
		}).join("");

		const avail_cls     = total_avail < 0 ? "ib-qty-negative" : total_avail > 0 ? "ib-qty-positive" : "ib-qty-zero";
		const tot_res_pct   = total_stock > 0 ? Math.round(total_res / total_stock * 100) : 0;
		const tot_res_label = total_res > 0
			? `${total_res.toLocaleString()} <span class="ib-bd-pct">(${tot_res_pct}%)</span>`
			: `<span class="ib-bd-zero">—</span>`;
		const tot_reorder_label = total_reorder > 0
			? total_reorder.toLocaleString()
			: `<span class="ib-bd-zero">—</span>`;

		const saved_tokens  = this._search_tokens;
		this._search_tokens = [];
		const spec_html     = this._spec_cell(row);
		this._search_tokens = saved_tokens;
		const has_spec      = row.spec_dimension || row.spec_thickness || row.spec_color || row.spec_liner;

		const $pop = $(`
			<div class="ib-sd-breakdown">
				<div class="ib-breakdown-hdr">
					<div class="ib-breakdown-meta">
						<div class="ib-breakdown-name">${esc(row.item_name || "")}</div>
						<a class="ib-breakdown-code" href="/app/item/${encodeURIComponent(row.item_code || "")}" target="_blank">${esc(row.item_code || "")}</a>
						${has_spec ? `<div class="ib-breakdown-tags">${spec_html}</div>` : ""}
						<span class="ib-breakdown-uom">${esc(row.uom || "")}</span>
					</div>
					<button class="ib-breakdown-close" title="${__("Close")}">×</button>
				</div>
				<div class="ib-breakdown-status ${status_cls}">${status}</div>
				<table class="ib-breakdown-table">
					<thead>
						<tr>
							<th>${__("Warehouse")}</th>
							<th>${__("Stock")}</th>
							<th>${__("Reserved")}</th>
							<th>${__("Reorder")}</th>
							<th>${__("Available")}</th>
						</tr>
					</thead>
					<tbody>${rows_html}</tbody>
					<tfoot>
						<tr>
							<td>${__("Total")}</td>
							<td class="ib-bd-num">${total_stock.toLocaleString()}</td>
							<td class="ib-bd-num ib-bd-reserved">${tot_res_label}</td>
							<td class="ib-bd-num ib-bd-reorder">${tot_reorder_label}</td>
							<td class="ib-bd-num"><span class="${avail_cls}">${total_avail.toLocaleString()}</span></td>
						</tr>
					</tfoot>
				</table>
				<div class="ib-breakdown-footer">
					<a class="ib-breakdown-report-link" href="#"
						data-item="${frappe.utils.escape_html(row.item_code || "")}">
						${__("View Stock Ledger")} →
					</a>
				</div>
			</div>
		`).css({ visibility: "hidden", position: "fixed", left: 0, top: 0 })
			.appendTo("body");

		const $backdrop = $('<div class="ib-breakdown-backdrop"></div>').appendTo("body");
		$backdrop.on("click", () => this._close_breakdown());

		const pw   = $pop.outerWidth();
		const ph   = $pop.outerHeight();
		const left = (window.innerWidth - e.clientX) >= pw + 20
			? e.clientX + 14
			: e.clientX - pw - 14;
		const top  = Math.max(8, Math.min(e.clientY + 14, window.innerHeight - ph - 12));
		$pop.css({ visibility: "visible", left, top });

		this.$content.find("tbody tr").removeClass("ib-row-active");
		this.$content.find(`tbody tr[data-item-code="${esc(row.item_code)}"]`).addClass("ib-row-active");

		$pop.find(".ib-breakdown-close").on("click", () => this._close_breakdown());

		$pop.find(".ib-breakdown-report-link").on("click", (ev) => {
			ev.preventDefault();
			const item_code = $(ev.currentTarget).data("item");
			this._close_breakdown();
			frappe.route_options = { item_code };
			frappe.set_route("ib-stock-ledger");
		});

		this._$backdrop  = $backdrop;
		this._$breakdown = $pop;
	}

	_close_breakdown() {
		if (this._$backdrop)  { this._$backdrop.remove();  this._$backdrop  = null; }
		if (this._$breakdown) { this._$breakdown.remove(); this._$breakdown = null; }
		this.$content && this.$content.find("tbody tr").removeClass("ib-row-active");
	}

	// ── Spec cell ─────────────────────────────────────────────────────────────

	_spec_cell(row) {
		const hl         = (v) => IBStock.highlight(v, this._search_tokens);
		const color_html = row.spec_color
			? `${IBStock.color_dots(row.spec_color)}${hl(row.spec_color)}`
			: null;
		const dim_text = row.spec_dimension
			? hl(row.spec_dimension) + (row.spec_sqmt
				? ` <span class="ib-spec-sqmt">${hl(String(row.spec_sqmt))} SQMT</span>`
				: "")
			: null;
		const parts = [
			row.spec_dimension ? { cls: "ib-spec-dim",   text: dim_text              } : null,
			row.spec_thickness ? { cls: "ib-spec-thick", text: hl(row.spec_thickness) } : null,
			row.spec_color     ? { cls: "ib-spec-color", text: color_html              } : null,
			row.spec_liner     ? { cls: "ib-spec-liner", text: hl(row.spec_liner)      } : null,
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

	// ── Export CSV ────────────────────────────────────────────────────────────

	_export_csv() {
		if (!this._filtered_data || !this._filtered_data.length) {
			frappe.msgprint(__("Nothing to export."));
			return;
		}

		const wh = this.f_warehouse.get_value();

		const headers = [
			__("Item Name"), __("Item Code"), __("UOM"),
			__("Width (mm)"), __("Length (mtr)"), __("Thickness"), __("Color"), __("Liner"),
		];
		if (!wh) {
			headers.push(
				__("MH Stock"), __("MH Reserved"),
				__("CN Stock"), __("CN Reserved"),
				__("GJ Stock"), __("GJ Reserved"),
			);
		}
		headers.push(__("Total Stock"), __("Total Reserved"), __("Available"));

		IBStock.csv_download(
			`stock_balance_${frappe.datetime.now_date()}.csv`,
			headers,
			IBStock.sort_rows(this._filtered_data, this._sort.col, this._sort.asc),
			row => {
				const total_res = Number(row.mh_reserved || 0) + Number(row.cn_reserved || 0) + Number(row.gj_reserved || 0);
				const vals = [
					row.item_name      || "",
					row.item_code      || "",
					row.uom            || "",
					row.spec_width     || "",
					row.spec_length    || "",
					row.spec_thickness || "",
					row.spec_color     || "",
					row.spec_liner     || "",
				];
				if (!wh) {
					vals.push(
						row.maharashtra  ?? 0, row.mh_reserved ?? 0,
						row.chennai      ?? 0, row.cn_reserved ?? 0,
						row.gujarat      ?? 0, row.gj_reserved ?? 0,
					);
				}
				vals.push(row.total_stock ?? 0, total_res, row.total_available ?? 0);
				return vals;
			}
		);
	}
}
