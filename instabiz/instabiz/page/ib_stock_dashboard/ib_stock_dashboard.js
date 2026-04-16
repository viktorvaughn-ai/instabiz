frappe.pages["ib-stock-dashboard"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Stock Dashboard"),
		single_column: true,
	});
	wrapper.dashboard = new IBStockDashboard(wrapper);
};

frappe.pages["ib-stock-dashboard"].on_page_show = function (wrapper) {
	if (wrapper.dashboard) {
		wrapper.dashboard.refresh();
	}
};

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
		this._setup_filters();
		this._setup_content();
		this.refresh();
	}

	// ── Filters ──────────────────────────────────────────────────────────────

	_setup_filters() {
		this.f_item_group = this.page.add_field({
			fieldname: "item_group",
			label:     __("Item Group"),
			fieldtype: "Link",
			options:   "Item Group",
			change:    () => this.refresh(),
		});

		this.f_uom = this.page.add_field({
			fieldname: "uom",
			label:     __("UOM"),
			fieldtype: "Select",
			options:   "\nSQMT\nPCS\nKG",
			change:    () => this.refresh(),
		});

		this.f_warehouse = this.page.add_field({
			fieldname: "warehouse",
			label:     __("Warehouse"),
			fieldtype: "Select",
			options:   "\nMAHARASHTRA - IB\nCHENNAI - IB\nGUJARAT - IB",
			change:    () => this.refresh(),
		});

		this.f_hide_zero = this.page.add_field({
			fieldname: "hide_zero_stock",
			label:     __("Hide Zero Stock"),
			fieldtype: "Check",
			default:   1,
			change:    () => { this._active_card = null; this._sync_cards(); this.refresh(); },
		});

		this.f_hide_zero.set_input(1);

		this.f_search = this.page.add_field({
			fieldname: "search",
			label:     __("Search"),
			fieldtype: "Data",
			placeholder: __("item name, code, spec…"),
			change:    () => this._apply_search(),
		});
		// Push search to far right in the filter bar
		$(this.f_search.wrapper).css("margin-left", "auto");
	}

	// ── Layout ───────────────────────────────────────────────────────────────

	_setup_content() {
		this.$body = $(this.wrapper).find(".layout-main-section");
		this.$body.addClass("ib-sd-page");

		this.$content = $(`
			<div class="ib-sd-wrap">
				<div class="ib-sd-cards"></div>
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

	// ── Data fetch ───────────────────────────────────────────────────────────

	refresh() {
		this._page = 1;
		this._set_loading();

		frappe.call({
			method:   "instabiz.instabiz.page.ib_stock_dashboard.ib_stock_dashboard.get_stock_data",
			args:     {
				item_group:      this.f_item_group.get_value() || null,
				uom:             this.f_uom.get_value() || null,
				warehouse:       this.f_warehouse.get_value() || null,
				hide_zero_stock: this._get_hide_zero(),
				show_zero_only:  this._active_card === "zero" ? 1 : 0,
			},
			callback: (r) => {
				if (!r.message) return;
				this._data          = r.message.data;
				this._filtered_data = this._data;
				this._summary       = r.message.summary;
				this._render_cards(r.message.summary);
				// Re-apply active search on fresh data
				const q = (this.f_search.get_value() || "").trim();
				if (q) {
					this._apply_search();
				} else {
					this._render_table(this._filtered_data);
				}
			},
			error: () => {
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
		if (this._active_card === "zero")  return 0;
		if (this._active_card === "stock") return 1;
		return this.f_hide_zero.get_value() ? 1 : 0;
	}

	_set_loading() {
		const n = this._columns().length;
		this.$content.find(".ib-sd-empty").hide();
		this.$content.find(".ib-sd-table-scroll").show();
		this.$content.find(".ib-sd-pagination").empty();
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

	// ── Stat cards ───────────────────────────────────────────────────────────

	_render_cards(s) {
		const cards = [
			{ id: "all",   label: __("Total Items"), value: s.total,    accent: true  },
			{ id: "stock", label: __("In Stock"),    value: s.in_stock, accent: false },
			{ id: "zero",  label: __("Zero Stock"),  value: s.zero,     accent: false },
		];

		const $cards = this.$content.find(".ib-sd-cards");
		$cards.html(cards.map(c => `
			<div class="ib-sd-card${c.accent ? " ib-sd-card--accent" : ""}${this._active_card === c.id ? " ib-sd-card--active" : ""}"
				data-card="${c.id}" style="cursor:pointer">
				<div class="ib-sd-card-value">${c.value}</div>
				<div class="ib-sd-card-label">${c.label}</div>
			</div>
		`).join(""));

		$cards.append(`
			<div class="ib-sd-actions">
				<button class="ib-sd-action-btn ib-sd-refresh-btn" title="${__("Refresh")}">
					<svg class="icon icon-sm"><use href="#es-line-reload"></use></svg>
					${__("Refresh")}
				</button>
				<button class="ib-sd-action-btn ib-sd-export-btn" title="${__("Export current view as CSV")}">
					<svg class="icon icon-sm"><use href="#es-line-down"></use></svg>
					${__("Export CSV")}
				</button>
			</div>
		`);

		$cards.find(".ib-sd-card").on("click", (e) => {
			this._on_card_click($(e.currentTarget).data("card"));
		});
		$cards.find(".ib-sd-refresh-btn").on("click", () => this.refresh());
		$cards.find(".ib-sd-export-btn").on("click", () => this._export_csv());
	}

	_sync_cards() {
		this.$content.find(".ib-sd-card").each((_, el) => {
			$(el).toggleClass("ib-sd-card--active", this._active_card === $(el).data("card"));
		});
	}

	_on_card_click(id) {
		if (id === "all") {
			this._active_card = null;
			this.f_item_group.set_value("");
			this.f_uom.set_value("");
			this.f_warehouse.set_value("");
			this.f_hide_zero.set_input(0);
			this.f_search.set_value("");
			this._filtered_data = [];
		} else {
			this._active_card = (this._active_card === id) ? null : id;
		}
		this._sync_cards();   // instant highlight before API returns
		this.refresh();
	}

	// ── Table ────────────────────────────────────────────────────────────────

	_columns() {
		const wh = this.f_warehouse.get_value();
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
		const $scroll= this.$content.find(".ib-sd-table-scroll");

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

		// Pagination
		const total     = rows.length;
		const ps        = this._page_size;
		const max_pages = Math.ceil(total / ps);
		if (this._page > max_pages) this._page = max_pages || 1;
		const start = (this._page - 1) * ps;
		const end   = Math.min(start + ps, total);
		rows = rows.slice(start, end);
		this._render_pagination(total, start, end, max_pages);

		const esc = frappe.utils.escape_html;
		$tbody.html(rows.map(row => `
			<tr>
				<td class="ib-col-name">${esc(row.item_name || "")}</td>
				<td class="ib-col-code">
					<a href="/app/item/${encodeURIComponent(row.item_code)}" target="_blank">
						${esc(row.item_code || "")}
					</a>
				</td>
				<td class="ib-col-spec">${this._spec_cell(row)}</td>
				<td class="ib-col-uom">${esc(row.uom || "")}</td>
				<td class="ib-col-qty ib-col-total">${this._qty(row.total_stock)}</td>
				<td class="ib-col-qty">${this._qty(row.total_available, true)}</td>
			</tr>
		`).join(""));
	}

	_apply_search() {
		const query  = (this.f_search.get_value() || "").trim();
		const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);

		if (!tokens.length) {
			this._filtered_data = this._data;
			this._page = 1;
			this._render_table(this._filtered_data);
			return;
		}

		this._filtered_data = this._data.filter(row => {
			const haystack = [
				row.item_name     || "",
				row.item_code     || "",
				row.specification || "",
			].join(" ").toLowerCase();
			return tokens.every(t => haystack.includes(t));
		});

		this._page = 1;
		this._render_table(this._filtered_data);
	}

	_render_pagination(total, start, end, max_pages) {
		const $pg  = this.$content.find(".ib-sd-pagination");
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
			this._page = 1;
			this._render_table(this._filtered_data);
		});
	}

	_spec_cell(row) {
		const esc   = frappe.utils.escape_html;
		const parts = [
			row.spec_dimension ? { cls: "ib-spec-dim",   text: esc(row.spec_dimension) } : null,
			row.spec_thickness ? { cls: "ib-spec-thick", text: esc(row.spec_thickness) } : null,
			row.spec_color     ? { cls: "ib-spec-color", text: esc(row.spec_color)     } : null,
			row.spec_liner     ? { cls: "ib-spec-liner", text: esc(row.spec_liner)     } : null,
		].filter(Boolean);

		if (!parts.length) {
			return `<span class="text-muted">—</span>`;
		}
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

	// ── Export ───────────────────────────────────────────────────────────────

	_export_csv() {
		const rows = this._filtered_data;
		if (!rows || !rows.length) {
			frappe.msgprint(__("Nothing to export."));
			return;
		}
		const cols  = this._columns();
		const lines = [cols.map(c => c.label).join(",")];

		rows.forEach(row => {
			lines.push(cols.map(c => {
				const v = String(row[c.id] ?? "").replace(/"/g, '""');
				return `"${v}"`;
			}).join(","));
		});

		// UTF-8 BOM so Excel opens it correctly without encoding prompts
		const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
		const url  = URL.createObjectURL(blob);
		const a    = document.createElement("a");
		a.href     = url;
		a.download = `stock_dashboard_${frappe.datetime.now_date()}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}
}
