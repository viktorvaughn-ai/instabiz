frappe.pages["ib-cpq"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("CPQ — Quote Configurator"),
		single_column: true,
	});
	wrapper._ib_cpq = new IBCpq(wrapper, page);
};

frappe.pages["ib-cpq"].on_page_show = function (wrapper) {
	if (wrapper._ib_cpq) wrapper._ib_cpq.refresh_rate_labels();
};

class IBCpq {
	constructor(wrapper, page) {
		this.wrapper = wrapper;
		this.page = page;
		this.lines = [];
		this._inject_styles();
		this._build_header_fields();
		this._build_body();
		this._render_lines();
	}

	// ── Styles ──────────────────────────────────────────────────────────────
	_inject_styles() {
		if (document.getElementById("ib-cpq-styles")) return;
		const s = document.createElement("style");
		s.id = "ib-cpq-styles";
		s.textContent = `
.ib-cpq-wrap { padding: 4px 2px; max-width: 1200px; }
.ib-cpq-toolbar { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 16px;
  background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px 14px; }
.ib-cpq-field { min-width: 220px; }
.ib-cpq-card { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px;
  overflow: hidden; margin-bottom: 18px; }
.ib-cpq-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.ib-cpq-table th { text-align: left; padding: 9px 12px; font-size: 10.5px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .3px; color: var(--text-muted);
  border-bottom: 1px solid var(--border-color); background: var(--bg-color); }
.ib-cpq-table td { padding: 9px 12px; border-bottom: 1px solid var(--border-color); vertical-align: middle; }
.ib-cpq-table tr:last-child td { border-bottom: none; }
.ib-cpq-rate-input { width: 90px; padding: 3px 6px; border: 1px solid var(--border-color); border-radius: 4px; }
.ib-cpq-qty-input { width: 70px; padding: 3px 6px; border: 1px solid var(--border-color); border-radius: 4px; }
.ib-cpq-note { font-size: 10.5px; color: var(--text-muted); margin-top: 2px; }
.ib-cpq-note.fallback { color: #b45309; }
.ib-cpq-note.matched { color: #1a7f37; }
.ib-cpq-remove { color: var(--text-muted); cursor: pointer; }
.ib-cpq-remove:hover { color: #dc2626; }
.ib-cpq-empty { padding: 30px; text-align: center; color: var(--text-muted); font-size: 12px; }
.ib-cpq-total-row td { font-weight: 700; background: var(--bg-color); }
.ib-cpq-actions { display: flex; gap: 8px; margin-bottom: 14px; }
		`;
		document.head.appendChild(s);
	}

	// ── Header controls: Customer / Location / Territory ──────────────────────
	_build_header_fields() {
		this.$toolbar = $(`<div class="ib-cpq-toolbar"></div>`).appendTo(this.page.main);

		this.customer_ctrl = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link", options: "Customer", label: __("Customer"),
				fieldname: "customer", reqd: 1,
				onchange: () => this._on_customer_change(),
			},
			parent: $(`<div class="ib-cpq-field"></div>`).appendTo(this.$toolbar),
			render_input: true,
		});

		this.location_ctrl = frappe.ui.form.make_control({
			df: {
				fieldtype: "Select", label: __("Location"), fieldname: "location", reqd: 1,
				options: "Select\nMAHARASHTRA\nGUJARAT\nCHENNAI",
			},
			parent: $(`<div class="ib-cpq-field"></div>`).appendTo(this.$toolbar),
			render_input: true,
		});
		this.location_ctrl.set_value("Select");

		this.territory_ctrl = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link", options: "Territory", label: __("Territory (override)"),
				fieldname: "territory", description: __("Defaults to the customer's own territory"),
				onchange: () => this._reprice_all(),
			},
			parent: $(`<div class="ib-cpq-field"></div>`).appendTo(this.$toolbar),
			render_input: true,
		});
	}

	_on_customer_change() {
		const customer = this.customer_ctrl.get_value();
		if (!customer) return;
		frappe.db.get_value("Customer", customer, "territory").then((r) => {
			if (r.message && r.message.territory) {
				this.territory_ctrl.set_value(r.message.territory);
			}
		});
		this._reprice_all();
	}

	// ── Body: add-item action + line table ─────────────────────────────────────
	_build_body() {
		this.$body = $(`<div class="ib-cpq-wrap"></div>`).appendTo(this.page.main);

		const $actions = $(`<div class="ib-cpq-actions"></div>`).appendTo(this.$body);
		this.$add_btn = $(`<button class="btn btn-default btn-sm">${frappe.utils.icon("add", "xs")} ${__("Add Item")}</button>`)
			.appendTo($actions)
			.on("click", () => this._show_add_item_dialog());
		this.$create_btn = $(`<button class="btn btn-primary btn-sm">${__("Create Draft Quotation")}</button>`)
			.appendTo($actions)
			.on("click", () => this._create_quotation());

		this.$table_wrap = $(`<div class="ib-cpq-card"></div>`).appendTo(this.$body);
	}

	_show_add_item_dialog() {
		const d = new frappe.ui.Dialog({
			title: __("Add Line Item"),
			fields: [
				{
					fieldtype: "Link", fieldname: "item_code", options: "Item", label: __("Item"), reqd: 1,
					onchange: () => {
						const item_code = d.get_value("item_code");
						if (!item_code) {
							d.set_df_property("qty", "label", __("Qty"));
							return;
						}
						frappe.db.get_value("Item", item_code, "stock_uom").then((r) => {
							const uom = (r.message && r.message.stock_uom) || "";
							d.set_df_property("qty", "label", uom ? __("Qty (in {0})", [uom]) : __("Qty"));
						});
					},
				},
				{ fieldtype: "Float", fieldname: "qty", label: __("Qty"), default: 1, reqd: 1 },
			],
			primary_action_label: __("Add"),
			primary_action: (values) => {
				d.hide();
				this._add_line(values.item_code, values.qty);
			},
		});
		d.show();
	}

	_add_line(item_code, qty) {
		qty = flt(qty) || 1;
		const customer = this.customer_ctrl.get_value();
		const territory = this.territory_ctrl.get_value();
		frappe.call({
			method: "instabiz.overrides.cpq.get_cpq_price",
			args: { item_code, qty, customer, territory },
			freeze: true,
			callback: (r) => {
				const res = r.message || {};
				this.lines.push({
					item_code,
					item_name: res.item_name || item_code,
					uom: res.uom,
					qty,
					rate: flt(res.rate),
					found: res.found,
					fallback_used: res.fallback_used,
					matched_on: res.matched_on,
					note: res.note,
				});
				this._render_lines();
			},
		});
	}

	_reprice_all() {
		// Re-resolve CPQ price for every existing line when customer/territory changes.
		if (!this.lines.length) return;
		const customer = this.customer_ctrl.get_value();
		const territory = this.territory_ctrl.get_value();
		const calls = this.lines.map((line, idx) =>
			frappe.call({
				method: "instabiz.overrides.cpq.get_cpq_price",
				args: { item_code: line.item_code, qty: line.qty, customer, territory },
			}).then((r) => {
				const res = r.message || {};
				this.lines[idx].rate = flt(res.rate);
				this.lines[idx].found = res.found;
				this.lines[idx].fallback_used = res.fallback_used;
				this.lines[idx].matched_on = res.matched_on;
				this.lines[idx].note = res.note;
			})
		);
		Promise.all(calls).then(() => this._render_lines());
	}

	refresh_rate_labels() {
		// no-op hook for on_page_show — table already reflects current state
	}

	_render_lines() {
		if (!this.lines.length) {
			this.$table_wrap.html(`<div class="ib-cpq-empty">${__("No line items yet — click Add Item to start configuring a quote.")}</div>`);
			return;
		}
		let total = 0;
		const rows = this.lines.map((line, idx) => {
			const amount = flt(line.qty) * flt(line.rate);
			total += amount;
			const noteClass = line.fallback_used ? "fallback" : (line.found ? "matched" : "");
			return `
				<tr data-idx="${idx}">
					<td>${frappe.utils.escape_html(line.item_code)}<br><span class="ib-cpq-note">${frappe.utils.escape_html(line.item_name || "")}</span></td>
					<td><input type="number" min="0" step="any" class="ib-cpq-qty-input" data-idx="${idx}" data-field="qty" value="${line.qty}"></td>
					<td>${frappe.utils.escape_html(line.uom || "")}</td>
					<td>
						<input type="number" min="0" step="any" class="ib-cpq-rate-input" data-idx="${idx}" data-field="rate" value="${line.rate}">
						<div class="ib-cpq-note ${noteClass}">${frappe.utils.escape_html(line.note || "")}</div>
					</td>
					<td>${format_currency(amount)}</td>
					<td><span class="ib-cpq-remove" data-idx="${idx}">${frappe.utils.icon("close", "sm")}</span></td>
				</tr>`;
		}).join("");

		this.$table_wrap.html(`
			<table class="ib-cpq-table">
				<thead><tr>
					<th>${__("Item")}</th><th>${__("Qty")}</th><th>${__("UOM")}</th>
					<th>${__("Rate")}</th><th>${__("Amount")}</th><th></th>
				</tr></thead>
				<tbody>
					${rows}
					<tr class="ib-cpq-total-row">
						<td colspan="4">${__("Total")}</td><td>${format_currency(total)}</td><td></td>
					</tr>
				</tbody>
			</table>
		`);

		this.$table_wrap.find(".ib-cpq-rate-input").on("change", (e) => {
			const idx = cint($(e.target).data("idx"));
			// A manual rate edit is a deliberate override (e.g. correcting a
			// fallback-tier price) — never re-resolved automatically.
			this.lines[idx].rate = flt($(e.target).val());
			this._render_lines();
		});
		this.$table_wrap.find(".ib-cpq-qty-input").on("change", (e) => {
			const idx = cint($(e.target).data("idx"));
			const qty = flt($(e.target).val()) || 1;
			this.lines[idx].qty = qty;
			// Qty is the whole basis for CPQ slab pricing — re-resolve the rate
			// for this line so it reflects whichever qty tier the new qty now
			// falls into, instead of silently carrying the old qty's rate/note.
			const customer = this.customer_ctrl.get_value();
			const territory = this.territory_ctrl.get_value();
			frappe.call({
				method: "instabiz.overrides.cpq.get_cpq_price",
				args: { item_code: this.lines[idx].item_code, qty, customer, territory },
				freeze: true,
			}).then((r) => {
				const res = r.message || {};
				this.lines[idx].rate = flt(res.rate);
				this.lines[idx].found = res.found;
				this.lines[idx].fallback_used = res.fallback_used;
				this.lines[idx].matched_on = res.matched_on;
				this.lines[idx].note = res.note;
				this._render_lines();
			});
		});
		this.$table_wrap.find(".ib-cpq-remove").on("click", (e) => {
			const idx = cint($(e.currentTarget).data("idx"));
			this.lines.splice(idx, 1);
			this._render_lines();
		});
	}

	_create_quotation() {
		const customer = this.customer_ctrl.get_value();
		const location = this.location_ctrl.get_value();
		if (!customer) {
			frappe.msgprint(__("Select a Customer"));
			return;
		}
		if (!location || location === "Select") {
			frappe.msgprint(__("Select a Location"));
			return;
		}
		if (!this.lines.length) {
			frappe.msgprint(__("Add at least one line item"));
			return;
		}
		const territory = this.territory_ctrl.get_value();
		const items = this.lines.map((l) => ({
			item_code: l.item_code, qty: l.qty, rate: l.rate, uom: l.uom,
		}));

		frappe.call({
			method: "instabiz.overrides.cpq.create_quotation_from_cpq",
			args: { customer, location, items: JSON.stringify(items), territory },
			freeze: true,
			callback: (r) => {
				if (r.message && r.message.name) {
					frappe.show_alert({ message: __("Draft Quotation {0} created", [r.message.name]), indicator: "green" });
					frappe.set_route("Form", "Quotation", r.message.name);
				}
			},
		});
	}
}
