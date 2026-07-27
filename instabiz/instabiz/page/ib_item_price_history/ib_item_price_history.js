frappe.pages["ib-item-price-history"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Item Price History"),
		single_column: true,
	});
	wrapper.iph = new IbItemPriceHistory(wrapper);
};

frappe.pages["ib-item-price-history"].on_page_show = function (wrapper) {
	if (!wrapper.iph) return;
	const opts = frappe.route_options || {};
	if (opts.item_code || opts.customer) {
		if (opts.item_code) wrapper.iph.f_item.set_value(opts.item_code);
		if (opts.customer) wrapper.iph.f_customer.set_value(opts.customer);
		frappe.route_options = null;
	}
};

const SORT_DEFAULT_DIR = {
	transaction_date: "desc",
	sales_order: "asc",
	customer: "asc",
	location: "asc",
	sales_person: "asc",
	qty: "desc",
	uom: "asc",
	rate: "desc",
	amount: "desc",
};

class IbItemPriceHistory {
	constructor(wrapper) {
		this.page = wrapper.page;
		this._limit = 20;
		this._offset = 0;
		this._total = 0;
		this._rows = [];
		this._sort_by = "transaction_date";
		this._sort_dir = "desc";
		this._search_timer = null;
		this._last_refresh = null;
		this._chart = null;
		this._current_uoms = [];
		this._setup_filters();
		this._setup_content();
	}

	_icon(name) {
		const icons = {
			download: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10m0 0-4-4m4 4 4-4"/><path d="M4 18v2h16v-2"/></svg>`,
			clock: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
		};
		return `<span class="ib-svg-icon ib-iph-svg-icon--${name}">${icons[name] || ""}</span>`;
	}

	_setup_filters() {
		$(this.page.page_form).addClass("ib-page-form ib-iph-filters");

		this.f_item = this.page.add_field({
			fieldname: "item_code",
			label: __("Item"),
			fieldtype: "Link",
			options: "Item",
			reqd: 1,
			change: () => this._on_item_change(),
		});
		this.f_item.$wrapper.addClass("ib-iph-filter-primary");

		this.f_customer = this.page.add_field({
			fieldname: "customer",
			label: __("Customer"),
			fieldtype: "Link",
			options: "Customer",
			change: () => this.refresh(),
		});

		this.f_uom = this.page.add_field({
			fieldname: "uom",
			label: __("UOM"),
			fieldtype: "Select",
			options: "",
			description: __("One item can sell in several UOMs at very different rate scales — pick one to compare like-for-like."),
			change: () => this.refresh(),
		});

		this.f_sales_person_user = this.page.add_field({
			fieldname: "sales_person_user",
			label: __("Sales Person"),
			fieldtype: "Link",
			options: "User",
			change: () => this.refresh(),
		});

		this.f_location = this.page.add_field({
			fieldname: "location",
			label: __("Location"),
			fieldtype: "Select",
			options: "\nMAHARASHTRA\nGUJARAT\nCHENNAI",
			change: () => this.refresh(),
		});

		this.f_from_date = this.page.add_field({
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			change: () => this.refresh(),
		});

		this.f_to_date = this.page.add_field({
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			change: () => this.refresh(),
		});

		this._setup_date_presets();
		this.page.set_secondary_action(__("Clear Filters"), () => this._clear_all_filters());
	}

	_on_item_change() {
		const item_code = this.f_item.get_value();
		this._current_uoms = [];
		if (!item_code) {
			this._set_uom_options([]);
			this.refresh();
			return;
		}
		frappe.call({
			method: "instabiz.instabiz.page.ib_item_price_history.ib_item_price_history.get_item_uoms",
			args: { item_code },
			callback: (r) => {
				const uoms = r.message || [];
				this._current_uoms = uoms;
				this._set_uom_options(uoms);
				// Auto-pick the most-frequent UOM so the summary cards compare
				// like-for-like by default instead of blending different unit scales.
				this.f_uom.set_value(uoms.length ? uoms[0].uom : "");
				this.refresh();
			},
		});
	}

	_set_uom_options(uoms) {
		this.f_uom.df.options = [""].concat(uoms.map((u) => u.uom)).join("\n");
		this.f_uom.refresh();
	}

	_setup_date_presets() {
		const presets = [
			{ label: __("Last 30 Days"), days: 30 },
			{ label: __("Last 90 Days"), days: 90 },
			{ label: __("This Year"), year: true },
			{ label: __("All Time"), all: true },
		];

		const $row = $(`<div class="ib-iph-date-presets"></div>`);
		presets.forEach((p) => {
			const $btn = $(`<button type="button" class="ib-iph-preset-btn">${p.label}</button>`);
			$btn.on("click", () => {
				if (p.all) {
					this.f_from_date.set_value("");
					this.f_to_date.set_value("");
				} else if (p.year) {
					const y = new Date().getFullYear();
					this.f_from_date.set_value(`${y}-01-01`);
					this.f_to_date.set_value(frappe.datetime.get_today());
				} else {
					this.f_from_date.set_value(frappe.datetime.add_days(frappe.datetime.get_today(), -p.days));
					this.f_to_date.set_value(frappe.datetime.get_today());
				}
			});
			$row.append($btn);
		});
		this.f_to_date.$wrapper.after($row);
	}

	_setup_content() {
		this.$body = $(this.page.main);

		this.$content = $(`
			<div class="ib-iph-wrap">
				<div class="ib-iph-cards-row">
					<div class="ib-iph-cards"></div>
					<span class="ib-refresh-time ib-iph-hide"></span>
				</div>
				<div class="ib-iph-uom-note ib-iph-hide"></div>
				<div class="ib-iph-trend-card ib-card ib-iph-hide">
					<div class="ib-iph-trend-label">${__("Rate Trend")}</div>
					<div class="ib-iph-trend-chart"></div>
				</div>
				<div class="ib-card ib-iph-table-wrap">
					<div class="ib-iph-toolbar">
						<div class="ib-iph-toolbar-row">
							<input type="text" class="form-control input-sm ib-iph-search"
								placeholder="${__("Search order, customer, location, sales person…")}">
							<div class="ib-iph-toolbar-actions">
								<select class="ib-iph-pg-size" title="${__("Rows per page")}">
									<option value="20">${__("20 / page")}</option>
									<option value="50">${__("50 / page")}</option>
									<option value="100">${__("100 / page")}</option>
								</select>
								<button class="ib-action-btn ib-iph-export-btn" title="${__("Export current results as CSV")}">
									${this._icon("download")}
									${__("Export CSV")}
								</button>
							</div>
						</div>
						<div class="ib-iph-chips ib-iph-hide"></div>
					</div>
					<div class="ib-iph-table-scroll">
						<table class="ib-iph-table">
							<thead>
								<tr>
									<th data-col="transaction_date">${__("Date")}</th>
									<th data-col="sales_order">${__("Sales Order")}</th>
									<th data-col="customer">${__("Customer")}</th>
									<th data-col="location">${__("Location")}</th>
									<th data-col="sales_person">${__("Sales Person")}</th>
									<th data-col="qty" class="text-right">${__("Qty")}</th>
									<th>${__("UOM")}</th>
									<th data-col="rate" class="text-right">${__("Rate")}</th>
									<th data-col="amount" class="text-right">${__("Amount")}</th>
								</tr>
							</thead>
							<tbody></tbody>
						</table>
					</div>
					<div class="ib-iph-empty">
						${__("No prior orders for this item yet.")}
					</div>
					<div class="ib-iph-pagination">
						<select class="ib-iph-pg-size ib-iph-pg-size--bottom" title="${__("Rows per page")}">
							<option value="20">${__("20 / page")}</option>
							<option value="50">${__("50 / page")}</option>
							<option value="100">${__("100 / page")}</option>
						</select>
						<span class="ib-iph-page-info"></span>
						<div class="ib-iph-page-btns">
							<button class="btn btn-default btn-xs ib-iph-prev">${__("Prev")}</button>
							<button class="btn btn-default btn-xs ib-iph-next">${__("Next")}</button>
						</div>
					</div>
				</div>
				<div class="ib-iph-select-prompt">
					${__("Select an item above to view its price history.")}
				</div>
			</div>
		`).appendTo(this.$body);

		this.$cards = this.$content.find(".ib-iph-cards");
		this.$refresh_time = this.$content.find(".ib-refresh-time");
		this.$uom_note = this.$content.find(".ib-iph-uom-note");
		this.$trend_card = this.$content.find(".ib-iph-trend-card");
		this.$trend_chart = this.$content.find(".ib-iph-trend-chart");
		this.$tbody = this.$content.find("tbody");
		this.$thead_ths = this.$content.find("thead th[data-col]");
		this.$empty = this.$content.find(".ib-iph-empty");
		this.$prompt = this.$content.find(".ib-iph-select-prompt");
		this.$table_wrap = this.$content.find(".ib-iph-table-wrap");
		this.$search = this.$content.find(".ib-iph-search");
		this.$chips = this.$content.find(".ib-iph-chips");
		this.$export_btn = this.$content.find(".ib-iph-export-btn");
		this.$page_size = this.$content.find(".ib-iph-pg-size");
		this.$pagination = this.$content.find(".ib-iph-pagination");
		this.$page_info = this.$content.find(".ib-iph-page-info");
		this.$prev = this.$content.find(".ib-iph-prev");
		this.$next = this.$content.find(".ib-iph-next");

		this.$search.on("input", () => {
			clearTimeout(this._search_timer);
			this._search_timer = setTimeout(() => {
				this._offset = 0;
				this.refresh();
			}, 300);
		});

		this.$thead_ths.on("click", (e) => {
			const col = $(e.currentTarget).data("col");
			if (!col) return;
			if (this._sort_by === col) {
				this._sort_dir = this._sort_dir === "asc" ? "desc" : "asc";
			} else {
				this._sort_by = col;
				this._sort_dir = SORT_DEFAULT_DIR[col] || "asc";
			}
			this._offset = 0;
			this.refresh();
		});

		this.$export_btn.on("click", () => this._export_csv());

		this.$page_size.on("change", (e) => {
			this._limit = parseInt($(e.currentTarget).val(), 10);
			this._offset = 0;
			this.$page_size.val(this._limit);
			this.refresh();
		});

		this.$prev.on("click", () => {
			if (this._offset <= 0) return;
			this._offset = Math.max(0, this._offset - this._limit);
			this.refresh({ keep_offset: true });
		});
		this.$next.on("click", () => {
			if (this._offset + this._limit >= this._total) return;
			this._offset += this._limit;
			this.refresh({ keep_offset: true });
		});

		this._show_idle();
	}

	_show_idle() {
		this.$cards.empty();
		this.$refresh_time.addClass("ib-iph-hide");
		this.$uom_note.addClass("ib-iph-hide").empty();
		this.$trend_card.addClass("ib-iph-hide");
		this.$tbody.empty();
		this.$search.val("");
		this.$chips.addClass("ib-iph-hide").empty();
		this._update_sort_indicators();
		this.$empty.addClass("ib-iph-hide");
		this.$table_wrap.addClass("ib-iph-hide");
		this.$prompt.removeClass("ib-iph-hide");
	}

	_get_active_filters() {
		const filters = [];
		const customer = this.f_customer.get_value();
		if (customer) {
			filters.push({
				type: "customer",
				label: this.f_customer.$input.val() || customer,
				clear: () => this.f_customer.set_value(""),
			});
		}
		const sp = this.f_sales_person_user.get_value();
		if (sp) {
			filters.push({
				type: "sp",
				label: this.f_sales_person_user.$input.val() || sp,
				clear: () => this.f_sales_person_user.set_value(""),
			});
		}
		const loc = this.f_location.get_value();
		if (loc) {
			filters.push({
				type: "wh",
				label: loc,
				clear: () => this.f_location.set_value(""),
			});
		}
		const uom = this.f_uom.get_value();
		if (uom) {
			filters.push({
				// Reuses Stock Dashboard's existing uom-sqmt/pcs/kg color chips when
				// the value matches; falls back to plain neutral styling otherwise.
				type: `uom-${uom.toLowerCase()}`,
				label: `${__("UOM")}: ${uom}`,
				clear: () => this.f_uom.set_value(""),
			});
		}
		const fd = this.f_from_date.get_value();
		if (fd) {
			filters.push({
				type: "date",
				label: `${__("From")} ${frappe.datetime.str_to_user(fd)}`,
				clear: () => this.f_from_date.set_value(""),
			});
		}
		const td = this.f_to_date.get_value();
		if (td) {
			filters.push({
				type: "date",
				label: `${__("To")} ${frappe.datetime.str_to_user(td)}`,
				clear: () => this.f_to_date.set_value(""),
			});
		}
		const search = (this.$search.val() || "").trim();
		if (search) {
			filters.push({
				type: "search",
				label: `"${search}"`,
				clear: () => {
					this.$search.val("");
					this._offset = 0;
					this.refresh();
				},
			});
		}
		return filters;
	}

	_clear_all_filters() {
		this.f_customer.set_value("");
		this.f_sales_person_user.set_value("");
		this.f_location.set_value("");
		this.f_uom.set_value("");
		this.f_from_date.set_value("");
		this.f_to_date.set_value("");
		this.$search.val("");
		this._offset = 0;
		this.refresh();
	}

	_render_chips() {
		const filters = this._get_active_filters();
		if (!filters.length) {
			this.$chips.addClass("ib-iph-hide").empty();
			return;
		}
		const esc = (v) => frappe.utils.escape_html(v);
		this.$chips.removeClass("ib-iph-hide").html(
			filters
				.map(
					(f, i) => `
				<span class="ib-chip ib-chip--${f.type}" data-idx="${i}">${esc(f.label)}<button class="ib-chip-x" aria-label="${__("Remove")}">×</button></span>`
				)
				.join("") + (filters.length > 1 ? `<button class="ib-chip-clear-all">${__("Clear all")}</button>` : "")
		);
		this.$chips.find(".ib-chip").each((i, el) => {
			$(el)
				.find(".ib-chip-x")
				.on("click", (ev) => {
					ev.stopPropagation();
					filters[i].clear();
				});
		});
		this.$chips.find(".ib-chip-clear-all").on("click", () => this._clear_all_filters());
	}

	refresh(opts = {}) {
		const item_code = this.f_item.get_value();
		if (!item_code) {
			this._show_idle();
			return;
		}

		if (!opts.keep_offset) this._offset = 0;

		this._render_chips();
		this.$prompt.addClass("ib-iph-hide");
		this.$table_wrap.addClass("ib-iph-hide");
		this.$cards.html(`
			<div class="ib-iph-spinner">
				<span></span><span></span><span></span>
			</div>
		`);

		frappe.call({
			method: "instabiz.instabiz.page.ib_item_price_history.ib_item_price_history.get_item_price_history",
			args: {
				item_code,
				customer: this.f_customer.get_value() || null,
				sales_person_user: this.f_sales_person_user.get_value() || null,
				location: this.f_location.get_value() || null,
				uom: this.f_uom.get_value() || null,
				from_date: this.f_from_date.get_value() || null,
				to_date: this.f_to_date.get_value() || null,
				search: (this.$search.val() || "").trim() || null,
				sort_by: this._sort_by,
				sort_dir: this._sort_dir,
				limit: this._limit,
				offset: this._offset,
			},
			callback: (r) => {
				const res = r.message || { data: [], total: 0, summary: {}, trend: [] };
				this._rows = res.data || [];
				this._total = res.total || 0;
				this._last_refresh = new Date();
				this._render_cards(res.summary, res.total);
				this._render_trend(res.trend || []);
				this._render_rows(this._rows);
				this._render_pagination();
				this._update_sort_indicators();
				this._render_refresh_time();
			},
		});
	}

	_render_refresh_time() {
		if (!this._last_refresh) {
			this.$refresh_time.addClass("ib-iph-hide");
			return;
		}
		const ts = this._last_refresh.toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		this.$refresh_time.removeClass("ib-iph-hide").html(`${this._icon("clock")} ${__("Updated")} ${ts}`);
	}

	_render_cards(summary, total) {
		const card = (label, value, variant) => `
			<div class="ib-card ib-iph-card ${variant ? "ib-iph-card--" + variant : ""}">
				<div class="ib-iph-card-value">${value}</div>
				<div class="ib-iph-card-label">${label}</div>
			</div>`;

		// One item can sell in several UOMs at very different rate scales — the
		// rate cards suffix the active UOM so they never look like a like-for-like
		// comparison when they aren't.
		const uom = this.f_uom.get_value();
		const rate_suffix = uom ? ` (${uom})` : "";

		this.$cards.html(`
			${card(__("Orders"), total || 0)}
			${card(__("Last Rate") + rate_suffix, summary.last_rate != null ? format_currency(summary.last_rate) : "-", "accent")}
			${card(__("Lowest") + rate_suffix, summary.min_rate != null ? format_currency(summary.min_rate) : "-")}
			${card(__("Highest") + rate_suffix, summary.max_rate != null ? format_currency(summary.max_rate) : "-")}
		`);

		if (!uom && this._current_uoms.length > 1) {
			const uom_list = this._current_uoms.map((u) => u.uom).join(", ");
			this.$uom_note.removeClass("ib-iph-hide").text(
				__("This item sells in multiple UOMs ({0}) — rates above are blended across all of them. Pick a UOM above to compare like-for-like.", [uom_list])
			);
		} else {
			this.$uom_note.addClass("ib-iph-hide").empty();
		}
	}

	_render_trend(trend) {
		if (this._chart) {
			this._chart.destroy && this._chart.destroy();
			this._chart = null;
		}
		if (!trend || trend.length < 2) {
			this.$trend_card.addClass("ib-iph-hide");
			this.$trend_chart.empty();
			return;
		}
		this.$trend_card.removeClass("ib-iph-hide");
		this._chart = new frappe.Chart(this.$trend_chart[0], {
			type: "line",
			data: {
				labels: trend.map((r) => frappe.datetime.str_to_user(r.date)),
				datasets: [{ name: __("Rate"), values: trend.map((r) => parseFloat(r.rate || 0)) }],
			},
			colors: ["#d97757"],
			height: 140,
			lineOptions: { regionFill: 1, hideDots: 0, spline: 1 },
			tooltipOptions: {
				formatTooltipY: (v) => format_currency(v),
			},
			axisOptions: { xIsSeries: 1 },
		});
	}

	_render_rows(rows) {
		this.$table_wrap.removeClass("ib-iph-hide");

		if (!rows || !rows.length) {
			this.$tbody.empty();
			this.$empty.removeClass("ib-iph-hide");
			return;
		}
		this.$empty.addClass("ib-iph-hide");

		this.$tbody.html(
			rows
				.map(
					(r, i) => `
					<tr class="${i === 0 && this._offset === 0 && this._sort_by === "transaction_date" && this._sort_dir === "desc" ? "ib-iph-row-latest" : ""}">
						<td>${frappe.datetime.str_to_user(r.transaction_date)}</td>
						<td><a href="/app/sales-order/${r.sales_order}">${r.sales_order}</a></td>
						<td><a href="/app/customer/${encodeURIComponent(r.customer)}">${frappe.utils.escape_html(r.customer_name || r.customer || "")}</a></td>
						<td>${frappe.utils.escape_html(r.location || "")}</td>
						<td>${frappe.utils.escape_html(r.sales_person || "")}</td>
						<td class="text-right">${r.qty}</td>
						<td>${frappe.utils.escape_html(r.uom || "")}</td>
						<td class="text-right">${format_currency(r.rate)}</td>
						<td class="text-right">${format_currency(r.amount)}</td>
					</tr>
				`
				)
				.join("")
		);
	}

	_update_sort_indicators() {
		this.$thead_ths.removeClass("ib-iph-th-sort-asc ib-iph-th-sort-desc");
		this.$thead_ths
			.filter(`[data-col="${this._sort_by}"]`)
			.addClass(this._sort_dir === "asc" ? "ib-iph-th-sort-asc" : "ib-iph-th-sort-desc");
	}

	_render_pagination() {
		if (!this._total) {
			this.$pagination.addClass("ib-iph-hide");
			return;
		}
		this.$pagination.removeClass("ib-iph-hide");

		const start = this._total ? this._offset + 1 : 0;
		const end = Math.min(this._offset + this._limit, this._total);
		this.$page_info.text(__("Showing {0}-{1} of {2}", [start, end, this._total]));

		this.$prev.prop("disabled", this._offset <= 0);
		this.$next.prop("disabled", this._offset + this._limit >= this._total);
	}

	_export_csv() {
		const item_code = this.f_item.get_value();
		if (!item_code) return;

		this.$export_btn.prop("disabled", true);
		frappe.call({
			method: "instabiz.instabiz.page.ib_item_price_history.ib_item_price_history.export_item_price_history",
			args: {
				item_code,
				customer: this.f_customer.get_value() || null,
				sales_person_user: this.f_sales_person_user.get_value() || null,
				location: this.f_location.get_value() || null,
				uom: this.f_uom.get_value() || null,
				from_date: this.f_from_date.get_value() || null,
				to_date: this.f_to_date.get_value() || null,
				search: (this.$search.val() || "").trim() || null,
				sort_by: this._sort_by,
				sort_dir: this._sort_dir,
			},
			callback: (r) => {
				const res = r.message || { data: [], truncated: false };
				if (!res.data.length) {
					frappe.msgprint(__("Nothing to export."));
					return;
				}
				IBStock.csv_download(
					`Item_Price_History_${item_code}_${frappe.datetime.get_today()}.csv`,
					[
						__("Date"),
						__("Sales Order"),
						__("Customer"),
						__("Location"),
						__("Sales Person"),
						__("Qty"),
						__("UOM"),
						__("Rate"),
						__("Amount"),
					],
					res.data,
					(row) => [
						frappe.datetime.str_to_user(row.transaction_date),
						row.sales_order,
						row.customer_name || row.customer,
						row.location || "",
						row.sales_person || "",
						row.qty,
						row.uom,
						row.rate,
						row.amount,
					]
				);
				if (res.truncated) {
					frappe.show_alert({
						message: __("Export capped at {0} rows — narrow your filters for a complete export.", [5000]),
						indicator: "orange",
					});
				}
			},
			always: () => this.$export_btn.prop("disabled", false),
		});
	}
}
