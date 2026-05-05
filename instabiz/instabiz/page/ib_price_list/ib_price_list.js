frappe.pages["ib-price-list"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Item Price List",
		single_column: true,
	});
	wrapper.page_obj = new IBPriceList(page, wrapper);
};

frappe.pages["ib-price-list"].on_page_show = function (wrapper) {
	if (wrapper.page_obj) wrapper.page_obj.refresh();
};

frappe.pages["ib-price-list"].on_page_hide = function (wrapper) {
	if (wrapper.page_obj) wrapper.page_obj._cleanup();
};

class IBPriceList {
	constructor(page, wrapper) {
		this.page    = page;
		this.wrapper = wrapper;
		this.$main   = $(wrapper).find(".page-content");
		this._all_rows      = [];
		this._filtered_rows = [];
		this._row_map       = new Map();
		this._search_tokens = [];
		this._page          = 1;
		this._page_size     = 50;
		this._is_manager    = frappe.user.has_role("Sales Manager") || frappe.user.has_role("System Manager");
		this._$popover      = null;
		this._$backdrop     = null;
		this._$active_row   = null;
		this._init();
	}

	_init() {
		this._build_layout();
		this._build_toolbar();
		this._bind_keyboard();
		this.refresh();
	}

	_build_toolbar() {
		if (this._is_manager) {
			this.page.add_inner_button(`${IB_ICONS.svg("plus", 13)} New Entry`, () => {
				frappe.new_doc("IB Item Price List");
			}, null, "primary");
		}
		this.page.add_inner_button("Refresh", () => this.refresh());
	}

	_build_layout() {
		this.$main.html(`
			<div class="ib-pl-root">
				<div class="ib-pl-search-bar">
					<div class="ib-pl-search-field">
						<label class="ib-pl-search-label">Search</label>
						<input class="form-control ib-pl-search-input" id="ib-pl-search"
							type="text" placeholder="name, code, colour, size…" autocomplete="off">
					</div>
				</div>
				<div class="ib-card ib-pl-table-wrap">
					<table class="ib-pl-table">
						<thead>
							<tr>
								<th class="ib-pl-th ib-pl-th--code">Item Code</th>
								<th class="ib-pl-th ib-pl-th--name">Item Name</th>
								<th class="ib-pl-th ib-pl-th--spec">Specification</th>
								<th class="ib-pl-th ib-pl-th--uom">UOM</th>
								<th class="ib-pl-th ib-pl-th--rate">Rate 1</th>
								<th class="ib-pl-th ib-pl-th--rate">Rate 2</th>
								<th class="ib-pl-th ib-pl-th--rate">Rate 3</th>
								<th class="ib-pl-th ib-pl-th--rate">Rate 4</th>
								${this._is_manager ? '<th class="ib-pl-th ib-pl-th--actions"></th>' : ""}
							</tr>
						</thead>
						<tbody id="ib-pl-tbody"></tbody>
					</table>
					<div class="ib-pl-empty" id="ib-pl-empty" style="display:none;">
						${IB_ICONS.svg("search", 32)}
						<p id="ib-pl-empty-msg">No entries found</p>
					</div>
					<div class="ib-pl-loading" id="ib-pl-loading">
						<div class="ib-pl-spinner"></div>
						<span>Loading prices…</span>
					</div>
					<div class="ib-pl-pagination" id="ib-pl-pagination" style="display:none;">
						<div class="ib-pl-pg-info" id="ib-pl-pg-info"></div>
						<div class="ib-pl-pg-controls">
							<select class="ib-pl-pg-size" id="ib-pl-pg-size" title="Rows per page">
								<option value="20">20 / page</option>
								<option value="50" selected>50 / page</option>
								<option value="100">100 / page</option>
							</select>
							<button class="ib-pl-pg-btn" id="ib-pl-pg-prev" title="Previous page">‹ Prev</button>
							<button class="ib-pl-pg-btn" id="ib-pl-pg-next" title="Next page">Next ›</button>
						</div>
					</div>
				</div>
			</div>
		`);

		let _t;
		this.$main.on("input", "#ib-pl-search", () => {
			clearTimeout(_t);
			_t = setTimeout(() => this._filter(), 160);
		});

		this.$main.on("click", "tr.ib-pl-row", (e) => {
			if ($(e.target).closest(".ib-pl-edit-btn").length) return;
			const row = this._row_map.get($(e.currentTarget).attr("data-item"));
			if (row) this._show_popover(row, e);
		});

		if (this._is_manager) {
			this.$main.on("click", ".ib-pl-edit-btn", (e) => {
				e.stopPropagation();
				frappe.set_route("Form", "IB Item Price List", $(e.currentTarget).closest("tr").attr("data-item"));
			});
		}

		this.$main.on("click", "#ib-pl-pg-prev", () => {
			if (this._page > 1) { this._page--; this._render_page(); }
		});
		this.$main.on("click", "#ib-pl-pg-next", () => {
			const total_pages = Math.ceil(this._filtered_rows.length / this._page_size);
			if (this._page < total_pages) { this._page++; this._render_page(); }
		});
		this.$main.on("change", "#ib-pl-pg-size", (e) => {
			this._page_size = parseInt(e.target.value) || 50;
			this._page = 1;
			this._render_page();
		});
	}

	_bind_keyboard() {
		$(document).on("keydown.ib-pl", (e) => {
			if (e.key === "Escape" && this._$popover) this._close_popover();
		});
	}

	_cleanup() {
		$(document).off("keydown.ib-pl");
		this._close_popover();
	}

	refresh() {
		this._close_popover();
		this.$main.find("#ib-pl-loading").show();
		this.$main.find("#ib-pl-tbody").empty();
		this.$main.find("#ib-pl-empty").hide();

		frappe.call({
			method: "instabiz.instabiz.page.ib_price_list.ib_price_list.get_item_price_list",
			callback: (r) => {
				this.$main.find("#ib-pl-loading").hide();
				if (!r.message) return;
				this._all_rows = r.message;
				this._filter();
			},
			error: () => {
				this.$main.find("#ib-pl-loading").hide();
				frappe.show_alert({ message: "Failed to load price list", indicator: "red" });
			},
		});
	}

	_filter() {
		const q      = (this.$main.find("#ib-pl-search").val() || "").trim();
		const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
		this._search_tokens = tokens;

		this._filtered_rows = tokens.length
			? this._all_rows.filter(r => {
				const hay = [r.item_code, r.item_name, r.uom, r.specification].join(" ").toLowerCase();
				return tokens.every(t => hay.includes(t));
			})
			: this._all_rows;

		this._page = 1;
		this._render_page();
	}

	_render_page() {
		const total      = this._filtered_rows.length;
		const page_size  = this._page_size;
		const page       = this._page;
		const start      = (page - 1) * page_size;
		const page_rows  = this._filtered_rows.slice(start, start + page_size);
		const total_pages = Math.ceil(total / page_size);

		this._render(page_rows, start);

		const $pg = this.$main.find("#ib-pl-pagination");
		if (total <= page_size) {
			$pg.hide();
			return;
		}

		const end = Math.min(start + page_size, total);
		this.$main.find("#ib-pl-pg-info").text(`${start + 1}–${end} of ${total}`);
		this.$main.find("#ib-pl-pg-prev").prop("disabled", page <= 1);
		this.$main.find("#ib-pl-pg-next").prop("disabled", page >= total_pages);
		$pg.show();
	}

	_render(rows, start_idx = 0) {
		const $tbody = this.$main.find("#ib-pl-tbody");
		const $empty = this.$main.find("#ib-pl-empty");

		this._row_map = new Map(rows.map(r => [r.item_code, r]));

		if (!rows.length) {
			$tbody.empty();
			const q = (this.$main.find("#ib-pl-search").val() || "").trim();
			this.$main.find("#ib-pl-empty-msg").text(q ? "No items match your search" : "No entries found");
			$empty.show();
			this.$main.find("#ib-pl-pagination").hide();
			return;
		}

		$empty.hide();

		const esc      = frappe.utils.escape_html;
		const fmt_rate = (v) => {
			const n = parseFloat(v);
			if (!n) return `<span class="ib-pl-rate ib-pl-rate--empty">—</span>`;
			return `<span class="ib-pl-rate">₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;
		};
		const edit_td = this._is_manager
			? `<td class="ib-pl-td ib-pl-td--actions"><button class="ib-pl-edit-btn" title="Edit">${IB_ICONS.svg("file", 13)}</button></td>`
			: "";

		const html = rows.map((r, idx) => `
			<tr class="ib-pl-row${(start_idx + idx) % 2 ? " ib-pl-row--alt" : ""}" data-item="${esc(r.item_code)}">
				<td class="ib-pl-td ib-pl-td--code"><span class="ib-pl-code">${IBStock.highlight(r.item_code, this._search_tokens)}</span></td>
				<td class="ib-pl-td ib-pl-td--name">${IBStock.highlight(r.item_name, this._search_tokens)}</td>
				<td class="ib-pl-td ib-pl-td--spec">${this._spec_cell(r)}</td>
				<td class="ib-pl-td ib-pl-td--uom">${r.uom ? `<span class="ib-chip ib-chip--uom-${r.uom.toLowerCase()}">${esc(r.uom)}</span>` : ""}</td>
				<td class="ib-pl-td ib-pl-td--rate">${fmt_rate(r.rate1)}</td>
				<td class="ib-pl-td ib-pl-td--rate">${fmt_rate(r.rate2)}</td>
				<td class="ib-pl-td ib-pl-td--rate">${fmt_rate(r.rate3)}</td>
				<td class="ib-pl-td ib-pl-td--rate">${fmt_rate(r.rate4)}</td>
				${edit_td}
			</tr>
		`).join("");

		$tbody.html(html);
	}

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
			row.spec_dimension ? { cls: "ib-spec-dim",   text: dim_text               } : null,
			row.spec_thickness ? { cls: "ib-spec-thick", text: hl(row.spec_thickness)  } : null,
			row.spec_color     ? { cls: "ib-spec-color", text: color_html               } : null,
			row.spec_liner     ? { cls: "ib-spec-liner", text: hl(row.spec_liner)       } : null,
			row.spec_adhesive  ? { cls: "ib-spec-thick", text: hl(row.spec_adhesive)    } : null,
		].filter(Boolean);

		if (!parts.length) return `<span class="text-muted">—</span>`;

		return parts.map((p, i) => `
			${i > 0 ? `<span class="ib-spec-sep"></span>` : ""}
			<span class="ib-spec-tag ${p.cls}">${p.text}</span>
		`).join("");
	}

	_show_popover(row, e) {
		this._close_popover();

		const esc = frappe.utils.escape_html;
		const fmt = (v) => {
			const n = parseFloat(v);
			return n ? `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;
		};

		const rates_html = [
			{ label: "Rate 1", val: fmt(row.rate1) },
			{ label: "Rate 2", val: fmt(row.rate2) },
			{ label: "Rate 3", val: fmt(row.rate3) },
			{ label: "Rate 4", val: fmt(row.rate4) },
		].map(({ label, val }) => `
			<div class="ib-pl-pop-rate-row${val ? "" : " ib-pl-pop-rate-row--empty"}">
				<span class="ib-pl-pop-rate-label">${label}</span>
				<span class="ib-pl-pop-rate-val">${val || "—"}</span>
			</div>
		`).join("");

		const saved = this._search_tokens;
		this._search_tokens = [];
		const spec_html = this._spec_cell(row);
		this._search_tokens = saved;

		const $pop = $(`
			<div class="ib-sd-breakdown ib-pl-breakdown">
				<div class="ib-breakdown-hdr">
					<div class="ib-breakdown-meta">
						<div class="ib-breakdown-name">${esc(row.item_name || "")}</div>
						<a class="ib-breakdown-code" href="/app/ib-item-price-list/${encodeURIComponent(row.item_code || "")}" target="_blank">${esc(row.item_code || "")}</a>
						${spec_html ? `<div class="ib-breakdown-tags">${spec_html}</div>` : ""}
						${row.uom ? `<span class="ib-chip ib-chip--uom-${row.uom.toLowerCase()}">${esc(row.uom)}</span>` : ""}
					</div>
					<button class="ib-breakdown-close" title="Close">×</button>
				</div>
				<div class="ib-pl-pop-rates">${rates_html}</div>
			</div>
		`).css({ visibility: "hidden", position: "fixed", left: 0, top: 0 }).appendTo("body");

		const $backdrop = $('<div class="ib-breakdown-backdrop"></div>').appendTo("body");
		$backdrop.on("click", () => this._close_popover());
		$pop.find(".ib-breakdown-close").on("click", () => this._close_popover());

		const pw   = $pop.outerWidth();
		const ph   = $pop.outerHeight();
		const left = (window.innerWidth - e.clientX) >= pw + 20 ? e.clientX + 14 : e.clientX - pw - 14;
		const top  = Math.max(8, Math.min(e.clientY + 14, window.innerHeight - ph - 12));
		$pop.css({ visibility: "visible", left, top });

		this._$active_row = $(e.currentTarget).addClass("ib-row-active");
		this._$backdrop   = $backdrop;
		this._$popover    = $pop;
	}

	_close_popover() {
		if (this._$backdrop)   { this._$backdrop.remove();                        this._$backdrop   = null; }
		if (this._$popover)    { this._$popover.remove();                         this._$popover    = null; }
		if (this._$active_row) { this._$active_row.removeClass("ib-row-active"); this._$active_row = null; }
	}
}
