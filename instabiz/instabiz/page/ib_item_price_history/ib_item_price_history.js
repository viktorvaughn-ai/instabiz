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
	if (opts.item_code) {
		wrapper.iph.f_item.set_value(opts.item_code);
		frappe.route_options = null;
	}
};

class IbItemPriceHistory {
	constructor(wrapper) {
		this.page = wrapper.page;
		this._setup_filters();
		this._setup_content();
	}

	_setup_filters() {
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
	}

	_setup_content() {
		this.$body = $(this.page.main).empty();

		this.$content = $(`
			<div class="ib-iph-wrap">
				<div class="ib-iph-cards"></div>
				<div class="ib-card ib-iph-table-wrap">
					<table class="table table-bordered ib-iph-table">
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
					<div class="ib-iph-empty text-muted text-center" style="display:none;padding:24px;">
						${__("No prior orders for this item yet.")}
					</div>
				</div>
			</div>
		`).appendTo(this.$body);

		this.$cards = this.$content.find(".ib-iph-cards");
		this.$tbody = this.$content.find("tbody");
		this.$empty = this.$content.find(".ib-iph-empty");
		this._show_idle();
	}

	_show_idle() {
		this.$cards.empty();
		this.$tbody.empty();
		this.$empty.hide();
		this.$content.find(".ib-iph-table-wrap").hide();
	}

	refresh() {
		const item_code = this.f_item.get_value();
		if (!item_code) {
			this._show_idle();
			return;
		}

		this.$cards.html(`<span class="text-muted">${__("Loading…")}</span>`);

		frappe.call({
			method: "instabiz.instabiz.page.ib_item_price_history.ib_item_price_history.get_item_price_history",
			args: {
				item_code,
				customer: this.f_customer.get_value() || null,
			},
			callback: (r) => {
				const res = r.message || { data: [], total: 0, summary: {} };
				this._render_cards(res.summary, res.total);
				this._render_rows(res.data);
			},
		});
	}

	_render_cards(summary, total) {
		const card = (label, value) => `
			<div class="ib-card ib-iph-card">
				<div class="ib-iph-card-label">${label}</div>
				<div class="ib-iph-card-value">${value}</div>
			</div>`;

		this.$cards.html(`
			${card(__("Orders"), total || 0)}
			${card(__("Last Rate"), summary.last_rate != null ? format_currency(summary.last_rate) : "-")}
			${card(__("Lowest"), summary.min_rate != null ? format_currency(summary.min_rate) : "-")}
			${card(__("Highest"), summary.max_rate != null ? format_currency(summary.max_rate) : "-")}
		`);
	}

	_render_rows(rows) {
		this.$content.find(".ib-iph-table-wrap").show();
		if (!rows || !rows.length) {
			this.$tbody.empty();
			this.$empty.show();
			return;
		}
		this.$empty.hide();

		this.$tbody.html(
			rows.map((r) => `
				<tr>
					<td>${frappe.datetime.str_to_user(r.transaction_date)}</td>
					<td><a href="/app/sales-order/${r.sales_order}">${r.sales_order}</a></td>
					<td>${frappe.utils.escape_html(r.customer_name || r.customer || "")}</td>
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
}
