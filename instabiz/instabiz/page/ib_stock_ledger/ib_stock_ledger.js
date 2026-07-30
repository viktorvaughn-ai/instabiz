frappe.pages["ib-stock-ledger"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent:        wrapper,
		title:         __("IB Stock Ledger"),
		single_column: true,
	});
	wrapper.ledger = new IbStockLedger(wrapper);
};

frappe.pages["ib-stock-ledger"].on_page_show = function (wrapper) {
	if (!wrapper.ledger) return;
	const opts = frappe.route_options || {};
	if (opts.item_code) {
		wrapper.ledger._prefill_item = opts.item_code;
		frappe.route_options = null;
	}
	wrapper.ledger._restore_filters();
	wrapper.ledger.refresh();
};

frappe.pages["ib-stock-ledger"].on_page_hide = function (wrapper) {
	if (!wrapper.ledger) return;
	clearTimeout(wrapper.ledger._search_debounce);
	$(document).off("keydown.ib-stock-ledger");
};

// ─────────────────────────────────────────────────────────────────────────────

const _COLS = [
	{ key: "posting_datetime",      label: "Date",    sortable: true  },
	{ key: "item_code",             label: "Item",    sortable: true  },
	{ key: null,                    label: "WH",      sortable: false },
	{ key: "qty_in",                label: "In",      sortable: true,  num: true },
	{ key: "qty_out",               label: "Out",     sortable: true,  num: true },
	{ key: "qty_after_transaction", label: "Balance", sortable: true,  num: true },
	{ key: "party",                 label: "Party",   sortable: true  },
	{ key: "voucher_no",            label: "Voucher", sortable: false },
	{ key: "rate",                  label: "Rate",    sortable: true,  num: true },
];

class IbStockLedger {
	constructor(wrapper) {
		this.wrapper          = wrapper;
		this.page             = wrapper.page;
		this._data            = [];
		this._filtered_data   = [];
		this._total           = 0;
		this._summary         = {};
		this._page            = 1;
		this._page_size       = 50;
		this._loading         = false;
		this._restoring       = false;
		this._prefill_item    = null;
		this._last_refresh    = null;
		this._sort            = { col: null, asc: true };
		this._search_tokens   = [];
		this._search_chips    = [];
		this._search_debounce = null;
		this._STORAGE_KEY     = "ib_sl_v4";

		this._setup_filters();
		this._setup_content();
		this._setup_presets();
		this._setup_keyboard();
	}

	// ── Filters ──────────────────────────────────────────────────────────────

	_setup_filters() {
		$(this.page.page_form).addClass("ib-page-form");
		this.f_item = this.page.add_field({
			fieldname: "item_code",
			label:     __("Item"),
			fieldtype: "Link",
			options:   "Item",
			change:    () => { if (!this._restoring) this._reset_and_refresh(); },
		});

		this.f_warehouse = this.page.add_field({
			fieldname: "warehouse",
			label:     __("Warehouse"),
			fieldtype: "Select",
			options:   "\nMAHARASHTRA - IB\nCHENNAI - IB\nGUJARAT - IB",
			change:    () => { if (!this._restoring) this._reset_and_refresh(); },
		});

		this.f_customer = this.page.add_field({
			fieldname: "customer",
			label:     __("Customer"),
			fieldtype: "Link",
			options:   "Customer",
			change:    () => { if (!this._restoring) this._reset_and_refresh(); },
		});

		this.f_from = this.page.add_field({
			fieldname: "from_date",
			label:     __("From"),
			fieldtype: "Date",
			default:   frappe.datetime.add_days(frappe.datetime.get_today(), -30),
			change:    () => { if (!this._restoring) this._reset_and_refresh(); },
		});

		this.f_to = this.page.add_field({
			fieldname: "to_date",
			label:     __("To"),
			fieldtype: "Date",
			default:   frappe.datetime.get_today(),
			change:    () => { if (!this._restoring) this._reset_and_refresh(); },
		});

		this.f_vtype = this.page.add_field({
			fieldname: "voucher_type",
			label:     __("Voucher Type"),
			fieldtype: "Select",
			options:   "\nDelivery Note\nSales Invoice\nSales Order\nPurchase Receipt\nPurchase Invoice\nPurchase Order\nStock Entry\nStock Reconciliation",
			change:    () => { if (!this._restoring) this._reset_and_refresh(); },
		});

		this.f_search = this.page.add_field({
			fieldname:   "search",
			label:       __("Search"),
			fieldtype:   "Data",
			placeholder: __("item, party, voucher…"),
		});
		const $pf    = $(this.f_search.wrapper).parent();
		const $group = $('<div class="ib-sl-search-group"></div>').appendTo($pf);
		$(this.f_search.wrapper).appendTo($group);

		this.$clear_btn = $(`<button class="btn btn-sm btn-primary ib-sl-clear-btn" title="${__("Clear all filters")}">${__("Clear")}</button>`)
			.on("click", () => this._clear_all())
			.appendTo($group);

		const $inp = $(this.f_search.wrapper).find("input");
		$inp.on("input", () => {
			clearTimeout(this._search_debounce);
			this._search_debounce = setTimeout(() => this._apply_client_filter(), 160);
		});
		$inp.on("keydown", (e) => {
			if (e.key === "Enter") {
				const val = $inp.val().trim();
				if (!val) return;
				e.preventDefault();
				clearTimeout(this._search_debounce);
				this._search_chips.push(val);
				$inp.val("");
				this._apply_client_filter();
			} else if (e.key === "Backspace" && $inp.val() === "") {
				if (this._search_chips.length) {
					this._search_chips.pop();
					this._apply_client_filter();
				}
			}
		});
	}

	// ── Layout ───────────────────────────────────────────────────────────────

	_setup_content() {
		this.$body = $(this.wrapper).find(".layout-main-section");
		this.$body.addClass("ib-sl-page");

		const thead_html = _COLS.map(c => {
			const cls   = [c.sortable ? "ib-sl-th-sortable" : "", c.num ? "ib-sl-th-num" : ""].filter(Boolean).join(" ");
			const attrs = [cls ? `class="${cls}"` : "", c.sortable ? `data-col="${c.key}"` : ""].filter(Boolean).join(" ");
			return `<th${attrs ? " " + attrs : ""}>${__(c.label)}<span class="ib-sort-icon"></span></th>`;
		}).join("");

		this.$content = $(`
			<div class="ib-sl-wrap">
				<div class="ib-sl-cards"></div>
				<div class="ib-sl-presets"></div>
				<div class="ib-sl-chips" style="display:none"></div>
				<div class="ib-sl-table-wrap">
					<table class="ib-sl-table">
						<thead class="ib-sl-thead"><tr>${thead_html}</tr></thead>
						<tbody class="ib-sl-tbody"></tbody>
						<tfoot class="ib-sl-tfoot"></tfoot>
					</table>
					<div class="ib-sl-empty" style="display:none"></div>
				</div>
				<div class="ib-sl-pagination"></div>
			</div>
		`).appendTo(this.$body);

		this.$cards    = this.$content.find(".ib-sl-cards");
		this.$presets  = this.$content.find(".ib-sl-presets");
		this.$chips    = this.$content.find(".ib-sl-chips");
		this.$tbody    = this.$content.find(".ib-sl-tbody");
		this.$tfoot    = this.$content.find(".ib-sl-tfoot");
		this.$empty    = this.$content.find(".ib-sl-empty");
		this.$pg       = this.$content.find(".ib-sl-pagination");

		this.$content.find(".ib-sl-th-sortable").on("click", (e) => {
			const col = $(e.currentTarget).data("col");
			this._sort.asc = (this._sort.col === col) ? !this._sort.asc : true;
			this._sort.col = col;
			this._update_sort_icons();
			this._apply_client_filter();
		});
	}

	_setup_presets() {
		const today = frappe.datetime.get_today;
		const add   = frappe.datetime.add_days;
		const presets = [
			{ label: __("Today"),      fn: () => [today(), today()] },
			{ label: __("This week"),  fn: () => [frappe.datetime.week_start(), today()] },
			{ label: __("This month"), fn: () => [frappe.datetime.month_start(), today()] },
			{ label: __("Last 7d"),    fn: () => [add(today(), -6), today()] },
			{ label: __("Last 30d"),   fn: () => [add(today(), -29), today()] },
		];

		this.$presets.html(
			`<div class="ib-sl-preset-bar">` +
			presets.map((p, i) => `<button class="ib-sl-preset-btn" data-idx="${i}">${p.label}</button>`).join("") +
			`</div>`
		);

		this.$presets.find(".ib-sl-preset-btn").on("click", (e) => {
			const idx = parseInt($(e.currentTarget).data("idx"), 10);
			const [from, to] = presets[idx].fn();
			this._restoring = true;
			this.f_from.set_value(from);
			this.f_to.set_value(to);
			this._restoring = false;
			this._reset_and_refresh();
		});
	}

	_setup_keyboard() {
		$(document).on("keydown.ib-stock-ledger", (e) => {
			if (frappe.get_route()[0] !== "ib-stock-ledger") return;
			const tag = (e.target.tagName || "").toLowerCase();
			if (tag === "input" || tag === "textarea" || tag === "select") return;
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (e.key.length !== 1) return;
			$(this.f_search.wrapper).find("input").first().focus();
		});
	}

	// ── Data fetch ────────────────────────────────────────────────────────────

	_reset_and_refresh() {
		this._data          = [];
		this._filtered_data = [];
		this._page          = 1;
		this._search_chips  = [];
		$(this.f_search.wrapper).find("input").val("");
		this.$tbody.empty();
		this._save_filters();
		this.refresh();
	}

	refresh() {
		if (this._loading) return;

		if (this._prefill_item) {
			this._restoring = true;
			this.f_item.set_value(this._prefill_item);
			this._prefill_item = null;
			this._restoring    = false;
		}

		const from_date = this.f_from.get_value();
		const to_date   = this.f_to.get_value();

		if (!from_date && !to_date) {
			this._show_idle();
			return;
		}

		this._save_filters();
		this._loading = true;

		const offset = (this._page - 1) * this._page_size;

		this.$tbody.empty();
		this.$cards.html(`<span class="ib-sl-spinner"><div class="ib-sl-spin"></div>${__("Loading…")}</span>`);

		frappe.call({
			method: "instabiz.instabiz.page.ib_stock_ledger.ib_stock_ledger.get_ledger",
			args: {
				item_code:    this.f_item.get_value()      || null,
				warehouse:    this.f_warehouse.get_value() || null,
				from_date:    from_date                    || null,
				to_date:      to_date                      || null,
				voucher_type: this.f_vtype.get_value()     || null,
				customer:     this.f_customer.get_value()  || null,
				limit:        this._page_size,
				offset,
			},
			callback: (r) => {
				this._loading      = false;
				if (!r.message) return;
				const { data, total, summary } = r.message;
				this._total        = total;
				this._summary      = summary || {};
				this._data         = data;
				this._last_refresh = new Date();
				this._render_cards();
				this._apply_client_filter();
			},
			error: () => { this._loading = false; },
		});
	}

	// ── Stat cards ────────────────────────────────────────────────────────────

	_icon(name) {
		const icons = {
			activity: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>`,
			arrow_up: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m0 0-5 5m5-5 5 5"/></svg>`,
			arrow_down: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14m0 0-5-5m5 5 5-5"/></svg>`,
			clock: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
			calendar: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4m8-4v4M3 10h18"/></svg>`,
			inbox: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16l-2 10h-4l-2 3-2-3H6z"/><path d="M9 14h6"/></svg>`,
			download: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10m0 0-4-4m4 4 4-4"/><path d="M4 18v2h16v-2"/></svg>`,
		};
		return `<span class="ib-sl-svg-icon ib-sl-svg-icon--${name}">${icons[name] || ""}</span>`;
	}

	_render_cards() {
		const fmt = n => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
		const ts  = this._last_refresh
			? this._last_refresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
			: "";

		this.$cards.html(`
			<div class="ib-sl-summary">
				<span class="ib-sl-stat">
					<span class="ib-sl-stat-icon">${this._icon("activity")}</span>
					<span class="ib-sl-stat-value">${(this._total || 0).toLocaleString()}</span>
					<span class="ib-sl-stat-label">${__("movements")}</span>
				</span>
				<span class="ib-sl-stat-sep">·</span>
				<span class="ib-sl-stat ib-sl-stat--in">
					<span class="ib-sl-stat-icon">${this._icon("arrow_up")}</span>
					<span class="ib-sl-stat-value">${fmt(this._summary.qty_in)}</span>
					<span class="ib-sl-stat-label">${__("stock received")}</span>
				</span>
				<span class="ib-sl-stat-sep">·</span>
				<span class="ib-sl-stat ib-sl-stat--out">
					<span class="ib-sl-stat-icon">${this._icon("arrow_down")}</span>
					<span class="ib-sl-stat-value">${fmt(this._summary.qty_out)}</span>
					<span class="ib-sl-stat-label">${__("stock issued")}</span>
				</span>
			</div>
			<div class="ib-sl-actions">
				<button class="ib-sl-action-btn ib-sl-export-btn" title="${__("Export current view as CSV")}">
					${this._icon("download")}
					${__("Export CSV")}
				</button>
				${ts ? `<span class="ib-sl-refresh-time">${this._icon("clock")} ${__("Updated")} ${ts}</span>` : ""}
			</div>
		`);

		this.$cards.find(".ib-sl-export-btn").on("click", () => this._export_csv());
	}

	// ── Client-side filter + sort + render ────────────────────────────────────

	_apply_client_filter() {
		const live        = ($(this.f_search.wrapper).find("input").val() || "").trim();
		const live_tokens = live.toLowerCase().split(/\s+/).filter(Boolean);
		const chip_tokens = this._search_chips.map(c => c.toLowerCase());
		this._search_tokens = [...chip_tokens, ...live_tokens];

		let rows = [...this._data];

		if (this._search_tokens.length) {
			rows = rows.filter(r => {
				const hay = [
					r.item_code, r.item_name, r.party, r.voucher_no,
					r.wh_short, r.vtype_short, r.color, r.custom_thickness, r.custom_adhesive_type,
				].join(" ").toLowerCase();
				return this._search_tokens.every(t => hay.includes(t));
			});
		}

		rows = IBStock.sort_rows(rows, this._sort.col, this._sort.asc);

		this._filtered_data = rows;
		this.$tbody.empty();
		this.$empty.hide();

		if (rows.length) {
			this._render_rows(rows);
		} else {
			this._show_empty();
		}

		this._render_chips();
		this._render_tfoot();
		this._update_sort_icons();
		this._render_pagination();
	}

	// ── Rendering ─────────────────────────────────────────────────────────────

	_render_rows(data) {
		const esc  = frappe.utils.escape_html;
		const hl   = (v) => IBStock.highlight(v, this._search_tokens);
		const frag = document.createDocumentFragment();

		data.forEach(r => {
			const direction = r.actual_qty > 0 ? "in" : r.actual_qty < 0 ? "out" : "zero";
			const spec_html = this._spec_html(r);

			const item_link = `/app/item/${encodeURIComponent(r.item_code)}`;
			const doc_link  = r.voucher_no
				? `/app/${(r.voucher_type || "").toLowerCase().replace(/ /g, "-")}/${encodeURIComponent(r.voucher_no)}`
				: "#";

			const wh_cls = { MH: "ib-sl-wh--mh", CN: "ib-sl-wh--cn", GJ: "ib-sl-wh--gj" }[r.wh_short] || "";
			const vt_cls = {
				DN: "ib-sl-vt--dn", SI: "ib-sl-vt--si", SO: "ib-sl-vt--so",
				PR: "ib-sl-vt--pr", PI: "ib-sl-vt--pi", PO: "ib-sl-vt--po",
				SE: "ib-sl-vt--se", SR: "ib-sl-vt--sr",
			}[r.vtype_short] || "";

			const in_html   = r.qty_in  ? `<span class="ib-sl-qty-in">+${frappe.format(r.qty_in,  { fieldtype: "Float" })}</span>` : `<span class="ib-sl-nil">—</span>`;
			const out_html  = r.qty_out ? `<span class="ib-sl-qty-out">−${frappe.format(r.qty_out, { fieldtype: "Float" })}</span>` : `<span class="ib-sl-nil">—</span>`;
			const rate_html = r.rate    ? frappe.format(r.rate, { fieldtype: "Float" }) : `<span class="ib-sl-nil">—</span>`;

			const tr = document.createElement("tr");
			tr.className = `ib-sl-row ib-sl-row--${direction}`;
			tr.innerHTML = `
				<td class="ib-sl-td-date">${esc(r.posting_dt_str)}</td>
				<td class="ib-sl-td-item">
					${r.item_name && r.item_name !== r.item_code ? `<div class="ib-sl-item-name">${hl(r.item_name)}</div>` : ""}
					<a href="${item_link}" class="ib-sl-item-code">${hl(r.item_code)}</a>
					${spec_html ? `<div class="ib-sl-spec">${spec_html}</div>` : ""}
				</td>
				<td><span class="ib-sl-wh-badge ${wh_cls}">${esc(r.wh_short)}</span></td>
				<td class="ib-sl-td-num">${in_html}</td>
				<td class="ib-sl-td-num">${out_html}</td>
				<td class="ib-sl-td-num">
					<span class="ib-sl-balance">${frappe.format(r.qty_after_transaction, { fieldtype: "Float" })}</span>
					<span class="ib-sl-uom">${esc(r.stock_uom || "")}</span>
				</td>
				<td class="ib-sl-td-party"><span class="ib-sl-party">${hl(r.party || "—")}</span></td>
				<td class="ib-sl-td-voucher">
					<span class="ib-sl-vtype-badge ${vt_cls}">${esc(r.vtype_short)}</span>
					<a href="${doc_link}" class="ib-sl-voucher-no" target="_blank">${hl(r.voucher_no || "")}</a>
				</td>
				<td class="ib-sl-td-num">${rate_html}</td>
			`;
			frag.appendChild(tr);
		});

		this.$tbody[0].appendChild(frag);
	}

	_render_tfoot() {
		if (!this._filtered_data.length) { this.$tfoot.empty(); return; }
		const fmt      = n => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
		const in_total = this._filtered_data.reduce((s, r) => s + (r.qty_in  || 0), 0);
		const out_total= this._filtered_data.reduce((s, r) => s + (r.qty_out || 0), 0);
		this.$tfoot.html(`
			<tr class="ib-sl-tfoot-row">
				<td colspan="3" class="ib-sl-tfoot-label">${__("Page total")}</td>
				<td class="ib-sl-td-num ib-sl-tfoot-in">+${fmt(in_total)}</td>
				<td class="ib-sl-td-num ib-sl-tfoot-out">−${fmt(out_total)}</td>
				<td colspan="4"></td>
			</tr>
		`);
	}

	_spec_html(r) {
		const esc   = frappe.utils.escape_html;
		const parts = [];
		const uom   = r.stock_uom;

		if (uom === "SQMT") {
			if (r.width_mm)             parts.push(esc(String(r.width_mm)));
			if (r.length_mtr)           parts.push(esc(String(r.length_mtr)));
			if (r.custom_thickness)     parts.push(esc(r.custom_thickness));
			if (r.color)                parts.push(IBStock.color_dots(r.color) + esc(r.color));
			if (r.custom_liner)         parts.push(esc(r.custom_liner));
		} else if (uom === "PCS") {
			if (r.color)                parts.push(IBStock.color_dots(r.color) + esc(r.color));
		} else if (uom === "KG") {
			if (r.custom_adhesive_type) parts.push(esc(r.custom_adhesive_type));
		}
		return parts.join(' <span class="ib-sl-spec-sep">·</span> ');
	}

	// ── Filter chips ─────────────────────────────────────────────────────────

	_render_chips() {
		const esc   = frappe.utils.escape_html;
		const chips = [];

		const _server_clear = (fn) => () => {
			this._restoring = true;
			Promise.resolve(fn()).finally(() => { this._restoring = false; this._reset_and_refresh(); });
		};

		const item = this.f_item.get_value();
		if (item) chips.push({ label: item, type: "item",
			clear: _server_clear(() => this.f_item.set_value("")) });

		const wh = this.f_warehouse.get_value();
		if (wh) chips.push({ label: wh.split(" - ")[0], type: "wh",
			clear: _server_clear(() => this.f_warehouse.set_value("")) });

		const customer = this.f_customer.get_value();
		if (customer) chips.push({ label: customer, type: "customer",
			clear: _server_clear(() => this.f_customer.set_value("")) });

		const vtype = this.f_vtype.get_value();
		if (vtype) chips.push({ label: vtype, type: "vtype",
			clear: _server_clear(() => this.f_vtype.set_value("")) });

		const from = this.f_from.get_value();
		const to   = this.f_to.get_value();
		if (from || to) {
			chips.push({
				label: `${from || "…"} → ${to || "…"}`,
				type:  "date",
				clear: _server_clear(() => {
					this.f_from.set_value("");
					this.f_to.set_value("");
				}),
			});
		}

		this._search_chips.forEach((chip, idx) => {
			chips.push({
				label: `"${chip}"`,
				type:  "search",
				clear: () => { this._search_chips.splice(idx, 1); this._apply_client_filter(); },
			});
		});

		if (!chips.length) { this.$chips.empty().hide(); return; }

		this.$chips.html(
			chips.map((c, i) =>
				`<span class="ib-chip ib-chip--${c.type}" data-idx="${i}">${esc(c.label)}<button class="ib-chip-x" aria-label="${__("Remove")}">×</button></span>`
			).join("")
		).show();

		this.$chips.find(".ib-chip").each((i, el) => {
			$(el).find(".ib-chip-x").on("click", (ev) => { ev.stopPropagation(); chips[i].clear(); });
		});

		if (chips.length > 1) {
			this.$chips.append(`<button class="ib-chip-clear-all">${__("Clear all")}</button>`);
			this.$chips.find(".ib-chip-clear-all").on("click", () => this._clear_all());
		}
	}

	// ── Pagination ────────────────────────────────────────────────────────────

	_render_pagination() {
		const total     = this._total;
		const ps        = this._page_size;
		const max_pages = Math.max(Math.ceil(total / ps), 1);
		const start     = (this._page - 1) * ps + 1;
		const end       = Math.min(this._page * ps, total);
		const sizes     = [50, 100, 250];

		if (total === 0) { this.$pg.empty(); return; }

		const count_label = `${start}–${end} ${__("of")} <strong>${total}</strong>`;

		this.$pg.html(`
			<div class="ib-sl-pg-left">
				<span class="ib-sl-pg-info">${count_label}</span>
				<div class="ib-sl-pg-nav">
					<button class="ib-sl-pg-btn" data-action="prev" ${this._page <= 1 ? "disabled" : ""}>&#8249;</button>
					<span class="ib-sl-pg-num">${this._page} / ${max_pages}</span>
					<button class="ib-sl-pg-btn" data-action="next" ${this._page >= max_pages ? "disabled" : ""}>&#8250;</button>
				</div>
			</div>
			<div class="ib-sl-pg-right">
				<span>${__("Per page")}</span>
				${sizes.map(s => `
					<button class="ib-sl-pg-size ${this._page_size === s ? "active" : ""}" data-size="${s}">${s}</button>
				`).join("")}
			</div>
		`);

		this.$pg.find("[data-action='prev']").on("click", () => {
			if (this._page <= 1) return;
			this._page--;
			this._save_filters();
			this.refresh();
		});
		this.$pg.find("[data-action='next']").on("click", () => {
			if (this._page >= max_pages) return;
			this._page++;
			this._save_filters();
			this.refresh();
		});
		this.$pg.find(".ib-sl-pg-size").on("click", (e) => {
			this._page_size = parseInt($(e.currentTarget).data("size"), 10);
			this._page      = 1;
			this._save_filters();
			this.refresh();
		});
	}

	// ── Sort icons ────────────────────────────────────────────────────────────

	_update_sort_icons() {
		this.$content.find(".ib-sl-th-sortable").each((_, th) => {
			const col = $(th).data("col");
			$(th).find(".ib-sort-icon").text(
				this._sort.col === col ? (this._sort.asc ? " ↑" : " ↓") : ""
			);
			$(th).toggleClass("ib-sl-th-active", this._sort.col === col);
		});
	}

	// ── Empty / idle states ───────────────────────────────────────────────────

	_show_idle() {
		this.$tbody.empty();
		this.$pg.empty();
		this._render_chips();
		this.$empty.html(`
			<div class="ib-sl-empty-msg">
				<div class="ib-sl-empty-icon">${this._icon("calendar")}</div>
				${__("Select a date range to view stock movements")}
			</div>
		`).show();
	}

	_show_empty() {
		const item = this.f_item.get_value();
		const msg  = this._search_tokens.length
			? __("No entries match your search")
			: item
				? __("No stock movements for {0} in this period", [item])
				: __("No entries found — try adjusting your filters");
		this.$empty.html(`<div class="ib-sl-empty-msg"><div class="ib-sl-empty-icon">${this._icon("inbox")}</div>${msg}</div>`).show();
	}

	// ── CSV export ────────────────────────────────────────────────────────────

	_export_csv() {
		const from_date = this.f_from.get_value();
		const to_date   = this.f_to.get_value();
		if (!from_date && !to_date) { frappe.msgprint(__("Select a date range first.")); return; }

		const $btn = this.$cards.find(".ib-sl-export-btn");
		$btn.prop("disabled", true).text(__("Fetching…"));

		frappe.call({
			method: "instabiz.instabiz.page.ib_stock_ledger.ib_stock_ledger.get_ledger",
			args: {
				item_code:    this.f_item.get_value()      || null,
				warehouse:    this.f_warehouse.get_value() || null,
				from_date:    from_date                    || null,
				to_date:      to_date                      || null,
				voucher_type: this.f_vtype.get_value()     || null,
				customer:     this.f_customer.get_value()  || null,
				limit:        100000,
				offset:       0,
			},
			callback: (r) => {
				$btn.prop("disabled", false).html(`<svg class="icon icon-sm"><use href="#es-line-down"></use></svg> ${__("Export CSV")}`);
				if (!r.message || !r.message.data.length) { frappe.msgprint(__("Nothing to export.")); return; }

				const all = r.message.data;
				const tokens = this._search_tokens;
				const filtered = tokens.length ? all.filter(row => {
					const hay = [
						row.item_code, row.item_name, row.party, row.voucher_no,
						row.wh_short, row.vtype_short, row.color, row.custom_thickness, row.custom_adhesive_type,
					].join(" ").toLowerCase();
					return tokens.every(t => hay.includes(t));
				}) : all;

				IBStock.csv_download(
					`IB_Stock_Ledger_${frappe.datetime.get_today()}.csv`,
					[
						__("Date"), __("Item Code"), __("Item Name"),
						__("Width"), __("Length"), __("Thickness"), __("Color"), __("Liner"),
						__("Warehouse"), __("In Qty"), __("Out Qty"), __("Balance"),
						__("UOM"), __("Party"), __("Voucher Type"), __("Voucher No"), __("Rate"),
					],
					IBStock.sort_rows(filtered, this._sort.col, this._sort.asc),
					row => [
						row.posting_dt_str, row.item_code, row.item_name,
						row.width_mm || "", row.length_mtr || "", row.custom_thickness || "",
						row.color || "", row.custom_liner || "",
						row.warehouse, row.qty_in || 0, row.qty_out || 0, row.qty_after_transaction,
						row.stock_uom, row.party || "", row.voucher_type, row.voucher_no, row.rate || 0,
					]
				);
			},
			error: () => {
				$btn.prop("disabled", false).html(`<svg class="icon icon-sm"><use href="#es-line-down"></use></svg> ${__("Export CSV")}`);
			},
		});
	}

	// ── Filter persistence ────────────────────────────────────────────────────

	_save_filters() {
		try {
			localStorage.setItem(this._STORAGE_KEY, JSON.stringify({
				item_code:    this.f_item.get_value()      || "",
				warehouse:    this.f_warehouse.get_value() || "",
				customer:     this.f_customer.get_value()  || "",
				from_date:    this.f_from.get_value()      || "",
				to_date:      this.f_to.get_value()        || "",
				voucher_type: this.f_vtype.get_value()     || "",
				sort_col:     this._sort.col  || "",
				sort_asc:     this._sort.asc  ? 1 : 0,
				page_size:    this._page_size,
				search_chips: this._search_chips || [],
			}));
		} catch (_) {}
	}

	_restore_filters() {
		if (this._prefill_item) return;
		try {
			const saved = JSON.parse(localStorage.getItem(this._STORAGE_KEY) || "null");
			if (!saved) return;
			this._restoring = true;
			if (saved.item_code)    this.f_item.set_value(saved.item_code);
			if (saved.warehouse)    this.f_warehouse.set_value(saved.warehouse);
			if (saved.customer)     this.f_customer.set_value(saved.customer);
			if (saved.from_date)    this.f_from.set_value(saved.from_date);
			if (saved.to_date)      this.f_to.set_value(saved.to_date);
			if (saved.voucher_type) this.f_vtype.set_value(saved.voucher_type);
			if (saved.sort_col)     { this._sort.col = saved.sort_col; this._sort.asc = !!saved.sort_asc; }
			if (saved.page_size)    this._page_size = saved.page_size;
			if (Array.isArray(saved.search_chips)) this._search_chips = saved.search_chips;
			this._restoring = false;
		} catch (_) { this._restoring = false; }
	}

	_clear_all() {
		this._restoring = true;
		this.f_item.set_value("");
		this.f_warehouse.set_value("");
		this.f_customer.set_value("");
		this.f_from.set_value("");
		this.f_to.set_value("");
		this.f_vtype.set_value("");
		this._restoring    = false;
		this._search_chips = [];
		this._sort         = { col: null, asc: true };
		this._page         = 1;
		$(this.f_search.wrapper).find("input").val("");
		try { localStorage.removeItem(this._STORAGE_KEY); } catch (_) {}
		this._reset_and_refresh();
	}
}
