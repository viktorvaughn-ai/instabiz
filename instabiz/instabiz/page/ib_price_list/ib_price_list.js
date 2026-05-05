frappe.pages["ib-price-list"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "IB Rate Card",
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
								<th class="ib-pl-th ib-pl-th--rate" style="color:#0284c7">Rate 1</th>
								<th class="ib-pl-th ib-pl-th--rate" style="color:#7c3aed">Rate 2</th>
								<th class="ib-pl-th ib-pl-th--rate" style="color:#d97757">Rate 3</th>
								<th class="ib-pl-th ib-pl-th--rate" style="color:#0d9488">Rate 4</th>
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
		const RATE_COL = { rate1: "#0284c7", rate2: "#7c3aed", rate3: "#d97757", rate4: "#0d9488" };
		const fmt_rate = (v, col) => {
			const n = parseFloat(v);
			if (!n) return `<span class="ib-pl-rate ib-pl-rate--empty">—</span>`;
			return `<span class="ib-pl-rate" style="color:${col};font-weight:600">₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;
		};
		const edit_td = this._is_manager
			? `<td class="ib-pl-td ib-pl-td--actions"><button class="ib-pl-edit-btn" title="Edit">${IB_ICONS.svg("file", 13)}</button></td>`
			: "";

		const html = rows.map((r, idx) => `
			<tr class="ib-pl-row${(start_idx + idx) % 2 ? " ib-pl-row--alt" : ""}" data-item="${esc(r.item_code)}">
				<td class="ib-pl-td ib-pl-td--code"><a class="ib-pl-code ib-pl-code--link" href="/app/item/${esc(r.item_code)}" onclick="event.stopPropagation()">${IBStock.highlight(r.item_code, this._search_tokens)}</a></td>
				<td class="ib-pl-td ib-pl-td--name">${IBStock.highlight(r.item_name, this._search_tokens)}</td>
				<td class="ib-pl-td ib-pl-td--spec">${this._spec_cell(r)}</td>
				<td class="ib-pl-td ib-pl-td--uom">${r.uom ? `<span class="ib-chip ib-chip--uom-${r.uom.toLowerCase()}">${esc(r.uom)}</span>` : ""}</td>
				<td class="ib-pl-td ib-pl-td--rate">${fmt_rate(r.rate1, RATE_COL.rate1)}</td>
				<td class="ib-pl-td ib-pl-td--rate">${fmt_rate(r.rate2, RATE_COL.rate2)}</td>
				<td class="ib-pl-td ib-pl-td--rate">${fmt_rate(r.rate3, RATE_COL.rate3)}</td>
				<td class="ib-pl-td ib-pl-td--rate">${fmt_rate(r.rate4, RATE_COL.rate4)}</td>
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
				<div class="ib-breakdown-footer">
					<a class="ib-breakdown-report-link ib-pl-history-link" href="#" data-item="${esc(row.item_code)}">
						${IB_ICONS.svg("clock", 12)} Price History
					</a>
				</div>
			</div>
		`).css({ visibility: "hidden", position: "fixed", left: 0, top: 0 }).appendTo("body");

		$pop.find(".ib-pl-history-link").on("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this._close_popover();
			this._show_price_history(row);
		});

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

	_show_price_history(row) {
		const esc      = frappe.utils.escape_html;
		const fmt_rate = (v) => {
			const n = parseFloat(v) || 0;
			return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
		};
		const LABELS     = { rate1: "Rate 1", rate2: "Rate 2", rate3: "Rate 3", rate4: "Rate 4" };
		const RATE_COLOR = { rate1: "#0284c7", rate2: "#7c3aed", rate3: "#d97757", rate4: "#0d9488" };
		const PAGE_SIZE  = 5;

		const d = new frappe.ui.Dialog({
			title: `Price History — ${row.item_name || row.item_code}`,
			size: "large",
			fields: [{ fieldtype: "HTML", fieldname: "ph" }],
		});
		d.show();

		const $modal_body = d.$wrapper.find(".modal-body").css({ padding: "0", overflow: "hidden" });
		const $wrap = d.fields_dict.ph.$wrapper.css({ width: "100%" });
		$wrap.html(`<p style="padding:2rem;text-align:center;color:var(--text-muted)">Loading…</p>`);

		const make_row = (entry) => {
			const m    = moment(entry.timestamp);
			const date = esc(m.format("D MMM YYYY"));
			const time = esc(m.format("h:mm A"));
			const user = esc(entry.user || "Unknown");

			const chips = entry.changes.map(([field, old_val, new_val]) => {
				const old_n    = parseFloat(old_val) || 0;
				const new_n    = parseFloat(new_val) || 0;
				const is_new   = old_n === 0 && new_n > 0;
				const is_up    = !is_new && new_n > old_n;
				const is_down  = !is_new && new_n < old_n;
				const lbl      = esc(LABELS[field] || field);
				const rate_col = RATE_COLOR[field] || "#6b7280";

				// label chip — always rate color
				const label_chip = `<span style="display:inline-flex;align-items:center;padding:4px 9px;
				    border-radius:6px 0 0 6px;background:${rate_col};color:#fff;
				    font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
				    white-space:nowrap">${lbl}</span>`;

				// value chip — directional color
				let val_bg, val_bdr, arrow, val_txt_color;
				if (is_new)       { val_bg="#e0f2fe"; val_bdr="#0284c7"; arrow=""; val_txt_color="#0369a1"; }
				else if (is_up)   { val_bg="#dcfce7"; val_bdr="#16a34a"; arrow=`<span style="font-size:10px;font-weight:900;color:#16a34a;margin-left:4px">▲</span>`; val_txt_color="#111827"; }
				else if (is_down) { val_bg="#fee2e2"; val_bdr="#dc2626"; arrow=`<span style="font-size:10px;font-weight:900;color:#dc2626;margin-left:4px">▼</span>`; val_txt_color="#111827"; }
				else              { val_bg="#f3f4f6"; val_bdr="#9ca3af"; arrow=""; val_txt_color="#374151"; }

				const price_content = is_new
					? `<span style="font-weight:700;font-size:13px;font-variant-numeric:tabular-nums;color:${val_txt_color}">${esc(fmt_rate(new_val))}</span>
					   <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;background:${rate_col};color:#fff;border-radius:3px;padding:1px 5px;margin-left:5px">new</span>`
					: `<span style="color:#9ca3af;font-size:12px;font-variant-numeric:tabular-nums;text-decoration:line-through">${esc(fmt_rate(old_val))}</span>
					   <span style="color:#d1d5db;font-size:11px;margin:0 4px">→</span>
					   <span style="font-weight:700;font-size:13px;font-variant-numeric:tabular-nums;color:${val_txt_color}">${esc(fmt_rate(new_val))}</span>
					   ${arrow}`;

				const val_chip = `<span style="display:inline-flex;align-items:center;padding:4px 10px;
				    border-radius:0 6px 6px 0;background:${val_bg};border:1px solid ${val_bdr};border-left:none;
				    font-size:12px;white-space:nowrap">${price_content}</span>`;

				return `<span style="display:inline-flex;align-items:stretch;margin-right:8px;margin-bottom:6px;
				    border-radius:6px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">
					${label_chip}${val_chip}
				</span>`;
			}).join("");

			return `<tr>
				<td style="width:150px;vertical-align:middle;padding:14px 20px;border-bottom:1px solid var(--border-color);white-space:nowrap;text-align:center">
					<div style="font-size:12px;font-weight:600;color:var(--text-color)">${date}</div>
					<div style="font-size:11px;color:var(--text-muted);margin-top:3px">${time}</div>
				</td>
				<td style="width:160px;vertical-align:middle;padding:14px 20px;border-bottom:1px solid var(--border-color);white-space:nowrap;text-align:center;border-left:1px solid var(--border-color)">
					<span style="font-size:12px;color:var(--text-muted)">${user}</span>
				</td>
				<td style="vertical-align:middle;padding:14px 20px;border-bottom:1px solid var(--border-color);border-left:1px solid var(--border-color)">
					<div style="display:flex;flex-wrap:wrap;gap:0">${chips}</div>
				</td>
			</tr>`;
		};

		frappe.call({
			method: "instabiz.instabiz.page.ib_price_list.ib_price_list.get_price_history",
			args: { item_code: row.item_code },
			callback: (r) => {
				const history = (r && r.message) || [];

				if (!history.length) {
					$wrap.html(`
						<div style="padding:3rem 1rem;text-align:center;color:var(--text-muted)">
							${IB_ICONS.svg("clock", 28)}
							<p style="margin:8px 0 0;font-size:13px">No rate changes recorded yet.</p>
						</div>`);
					return;
				}

				let shown = Math.min(PAGE_SIZE, history.length);

				const THEAD = `
					<thead style="position:sticky;top:0;z-index:1">
						<tr style="background:var(--fg-color)">
							<th style="padding:10px 20px;text-align:center;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);border-bottom:2px solid var(--border-color)">Date</th>
							<th style="padding:10px 20px;text-align:center;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);border-bottom:2px solid var(--border-color);border-left:1px solid var(--border-color)">Changed By</th>
							<th style="padding:10px 20px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);border-bottom:2px solid var(--border-color);border-left:1px solid var(--border-color)">Rate Changes</th>
						</tr>
					</thead>`;

				const render = (append_from) => {
					const has_more = shown < history.length;

					if (append_from == null) {
						// full initial render
						const rows = history.slice(0, shown).map(make_row).join("");
						const footer = _ph_footer(has_more, shown, history.length);
						$wrap.html(`
							<div id="ib-ph-scroll" style="max-height:60vh;overflow-y:auto;overflow-x:hidden">
								<table style="width:100%;border-collapse:collapse">${THEAD}<tbody id="ib-ph-tbody">${rows}</tbody></table>
							</div>
							${footer}`);
					} else {
						// append new rows + animate them in
						const new_rows = history.slice(append_from, shown).map(make_row).join("");
						const $tbody = $wrap.find("#ib-ph-tbody");
						const $new = $(new_rows).appendTo($tbody);

						if (window.gsap) {
							gsap.fromTo($new.toArray(), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.25, stagger: 0.06, ease: "power2.out" });
							const $scroll = $wrap.find("#ib-ph-scroll")[0];
							gsap.to($scroll, { scrollTop: $scroll.scrollHeight, duration: 0.4, ease: "power2.inOut" });
						}

						// replace footer
						$wrap.find("#ib-ph-footer").replaceWith(_ph_footer(has_more, shown, history.length));
					}

					$wrap.find("#ib-ph-more").on("click", () => {
						const prev = shown;
						shown = Math.min(shown + PAGE_SIZE, history.length);
						render(prev);
					});
				};

				const _ph_footer = (has_more, shown, total) => {
					if (has_more) {
						return `<div id="ib-ph-footer" style="padding:14px 20px;text-align:center;border-top:1px solid var(--border-color);background:var(--fg-color)">
							<button id="ib-ph-more" style="display:inline-flex;align-items:center;gap:8px;padding:8px 22px;
							    border-radius:8px;border:1.5px solid var(--ib-primary,#d97757);background:var(--card-bg);
							    font-size:12px;font-weight:600;color:var(--ib-primary,#d97757);cursor:pointer;
							    transition:background .15s,color .15s"
							    onmouseover="this.style.background='#d97757';this.style.color='#fff'"
							    onmouseout="this.style.background='var(--card-bg)';this.style.color='var(--ib-primary,#d97757)'">
								${IB_ICONS.svg("clock", 12)} Load ${Math.min(PAGE_SIZE, total - shown)} more
								<span style="font-size:10px;color:inherit;opacity:.7">&nbsp;· ${total - shown} remaining</span>
							</button>
						</div>`;
					}
					return `<div id="ib-ph-footer" style="padding:8px 20px;font-size:11px;color:var(--text-muted);background:var(--fg-color);border-top:1px solid var(--border-color);text-align:center">
						All ${total} change${total === 1 ? "" : "s"} shown
					</div>`;
				};

				render();
				if (window.gsap) {
					gsap.fromTo($wrap.find("#ib-ph-tbody tr").toArray(),
						{ opacity: 0, y: 10 },
						{ opacity: 1, y: 0, duration: 0.28, stagger: 0.06, ease: "power2.out", delay: 0.05 }
					);
				}
			},
		});
	}

	_close_popover() {
		if (this._$backdrop)   { this._$backdrop.remove();                        this._$backdrop   = null; }
		if (this._$popover)    { this._$popover.remove();                         this._$popover    = null; }
		if (this._$active_row) { this._$active_row.removeClass("ib-row-active"); this._$active_row = null; }
	}
}
