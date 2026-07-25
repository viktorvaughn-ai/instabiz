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

class IbItemPriceHistory {
	constructor(wrapper) {
		this.page = wrapper.page;
		this._limit = 20;
		this._offset = 0;
		this._total = 0;
		this._rows = [];
		this._setup_filters();
		this._setup_content();
	}

	_setup_filters() {
		$(this.page.page_form).addClass("ib-page-form");

		this.f_item = this.page.add_field({
			fieldname: "item_code",
			label: __("Item"),
			fieldtype: "Link",
			options: "Item",
			reqd: 1,
			change: () => this.refresh(),
		});

		this.f_customer = this.page.add_field({
			fieldname: "customer",
			label: __("Customer"),
			fieldtype: "Link",
			options: "Customer",
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
	}

	_setup_content() {
		this.$body = $(this.page.main);

		this.$content = $(`
			<div class="ib-iph-wrap">
				<div class="ib-iph-cards"></div>
				<div class="ib-card ib-iph-table-wrap">
					<div class="ib-iph-toolbar">
						<input type="text" class="form-control input-sm ib-iph-search"
							placeholder="${__("Filter loaded rows by order, customer, location, sales person…")}">
					</div>
					<div class="ib-iph-table-scroll">
						<table class="ib-iph-table">
							<thead>
								<tr>
									<th>${__("Date")}</th>
									<th>${__("Sales Order")}</th>
									<th>${__("Customer")}</th>
									<th>${__("Location")}</th>
									<th>${__("Sales Person")}</th>
									<th class="text-right">${__("Qty")}</th>
									<th>${__("UOM")}</th>
									<th class="text-right">${__("Rate")}</th>
									<th class="text-right">${__("Amount")}</th>
								</tr>
							</thead>
							<tbody></tbody>
						</table>
					</div>
					<div class="ib-iph-empty">
						${__("No prior orders for this item yet.")}
					</div>
					<div class="ib-iph-pagination">
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
		this.$tbody = this.$content.find("tbody");
		this.$empty = this.$content.find(".ib-iph-empty");
		this.$prompt = this.$content.find(".ib-iph-select-prompt");
		this.$table_wrap = this.$content.find(".ib-iph-table-wrap");
		this.$search = this.$content.find(".ib-iph-search");
		this.$pagination = this.$content.find(".ib-iph-pagination");
		this.$page_info = this.$content.find(".ib-iph-page-info");
		this.$prev = this.$content.find(".ib-iph-prev");
		this.$next = this.$content.find(".ib-iph-next");

		this.$search.on("input", () => this._apply_search_and_render());
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
		this.$tbody.empty();
		this.$search.val("");
		this.$empty.addClass("ib-iph-hide");
		this.$table_wrap.addClass("ib-iph-hide");
		this.$prompt.removeClass("ib-iph-hide");
	}

	refresh(opts = {}) {
		const item_code = this.f_item.get_value();
		if (!item_code) {
			this._show_idle();
			return;
		}

		if (!opts.keep_offset) this._offset = 0;

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
				from_date: this.f_from_date.get_value() || null,
				to_date: this.f_to_date.get_value() || null,
				limit: this._limit,
				offset: this._offset,
			},
			callback: (r) => {
				const res = r.message || { data: [], total: 0, summary: {} };
				this._rows = res.data || [];
				this._total = res.total || 0;
				this.$search.val("");
				this._render_cards(res.summary, res.total);
				this._apply_search_and_render();
				this._render_pagination();
			},
		});
	}

	_render_cards(summary, total) {
		const card = (label, value, variant) => `
			<div class="ib-card ib-iph-card ${variant ? "ib-iph-card--" + variant : ""}">
				<div class="ib-iph-card-value">${value}</div>
				<div class="ib-iph-card-label">${label}</div>
			</div>`;

		this.$cards.html(`
			${card(__("Orders"), total || 0)}
			${card(__("Last Rate"), summary.last_rate != null ? format_currency(summary.last_rate) : "-", "accent")}
			${card(__("Lowest"), summary.min_rate != null ? format_currency(summary.min_rate) : "-")}
			${card(__("Highest"), summary.max_rate != null ? format_currency(summary.max_rate) : "-")}
		`);
	}

	// Quick client-side filter over the currently loaded page of rows —
	// does not refetch or affect total/pagination, just narrows what's shown.
	_apply_search_and_render() {
		const term = (this.$search.val() || "").trim().toLowerCase();
		const filtered = !term
			? this._rows
			: this._rows.filter((r) => {
				const haystack = [r.sales_order, r.customer_name, r.customer, r.location, r.sales_person]
					.filter(Boolean)
					.join(" ")
					.toLowerCase();
				return haystack.includes(term);
			});
		this._render_rows(filtered);
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
			rows.map((r, i) => `
				<tr class="${i === 0 && this._offset === 0 ? "ib-iph-row-latest" : ""}">
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
			`).join("")
		);
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
}
