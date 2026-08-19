frappe.pages["ib-stock-scan"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Scan Stock"),
		single_column: true,
	});

	const page = new IBStockScanPage(wrapper);
	wrapper.ib_stock_scan = page;
};

frappe.pages["ib-stock-scan"].on_page_show = function (wrapper) {
	if (wrapper.ib_stock_scan) {
		wrapper.ib_stock_scan.$barcode.trigger("focus");
	}
};

class IBStockScanPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = wrapper.page;
		this._resolved = null;
		this._log = [];
		this._build();
	}

	_build() {
		const $body = $(`
			<div class="ib-card" style="max-width:520px; margin:12px 0; padding:16px;">
				<div style="font-weight:600; margin-bottom:8px;">${__("Scan or type a barcode")}</div>
				<input type="text" class="form-control ib-ss-barcode" placeholder="${__("Barcode")}" autocomplete="off">
				<div class="ib-ss-item" style="margin-top:10px; display:none;">
					<div class="ib-ss-item-name" style="font-weight:600; font-size:15px;"></div>
					<div class="ib-ss-item-code text-muted" style="font-size:12px;"></div>
					<div class="ib-ss-warehouse-field" style="margin-top:10px;"></div>
					<div style="margin-top:8px;">
						<label class="text-muted" style="font-size:12px;">${__("Qty")}</label>
						<input type="number" class="form-control ib-ss-qty" min="0" step="any" value="1">
					</div>
					<div style="margin-top:10px; display:flex; gap:8px;">
						<button class="btn btn-success btn-sm ib-ss-add" style="flex:1;">${__("Add (Receipt)")}</button>
						<button class="btn btn-danger btn-sm ib-ss-deduct" style="flex:1;">${__("Deduct (Issue)")}</button>
					</div>
				</div>
			</div>
			<div class="ib-card" style="max-width:520px; padding:16px;">
				<div style="font-weight:600; margin-bottom:8px;">${__("This session")}</div>
				<div class="ib-ss-log text-muted" style="font-size:12px;">${__("No scans yet")}</div>
			</div>
		`).appendTo(this.page.main);

		this.$barcode = $body.find(".ib-ss-barcode");
		this.$item = $body.find(".ib-ss-item");
		this.$log = $body.find(".ib-ss-log");

		this.warehouse_ctrl = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link", options: "Warehouse", label: __("Warehouse"),
				fieldname: "warehouse", reqd: 1,
			},
			parent: $body.find(".ib-ss-warehouse-field"),
			render_input: true,
		});
		const last_wh = localStorage.getItem("ib_stock_scan_warehouse");
		if (last_wh) this.warehouse_ctrl.set_value(last_wh);

		this.$barcode.on("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this._resolve(this.$barcode.val().trim());
			}
		});

		$body.find(".ib-ss-add").on("click", () => this._adjust("Add"));
		$body.find(".ib-ss-deduct").on("click", () => this._adjust("Deduct"));

		this.$barcode.trigger("focus");
	}

	_resolve(barcode) {
		if (!barcode) return;
		frappe.call({
			method: "instabiz.overrides.stock_scan.resolve_barcode",
			args: { barcode },
			freeze: true,
			callback: (r) => {
				if (!r.message) return;
				this._resolved = { barcode, ...r.message };
				this.$item.find(".ib-ss-item-name").text(r.message.item_name || r.message.item_code);
				this.$item.find(".ib-ss-item-code").text(r.message.item_code);
				this.$item.show();
			},
			error: () => {
				this.$item.hide();
				this._resolved = null;
			},
		});
	}

	_adjust(direction) {
		if (!this._resolved) return;
		const warehouse = this.warehouse_ctrl.get_value();
		const qty = flt(this.$item.find(".ib-ss-qty").val());
		if (!warehouse) {
			frappe.msgprint(__("Select a warehouse"));
			return;
		}
		if (!qty || qty <= 0) {
			frappe.msgprint(__("Enter a qty greater than 0"));
			return;
		}
		localStorage.setItem("ib_stock_scan_warehouse", warehouse);
		frappe.call({
			method: "instabiz.overrides.stock_scan.adjust_stock",
			args: { barcode: this._resolved.barcode, warehouse, qty, direction },
			freeze: true,
			callback: (r) => {
				if (!r.message) return;
				frappe.show_alert({
					message: __("{0}: {1} {2} → new balance {3}", [
						direction, qty, this._resolved.item_code, r.message.new_qty,
					]),
					indicator: direction === "Add" ? "green" : "orange",
				});
				this._log.unshift({
					time: frappe.datetime.now_time(),
					item_code: this._resolved.item_code,
					direction, qty, warehouse,
					stock_entry: r.message.stock_entry,
				});
				this._render_log();
				this.$barcode.val("").trigger("focus");
				this.$item.hide();
				this._resolved = null;
			},
		});
	}

	_render_log() {
		if (!this._log.length) return;
		this.$log.html(
			this._log
				.map(
					(l) =>
						`<div style="padding:4px 0; border-bottom:1px solid var(--border-color);">
							<span style="color:${l.direction === "Add" ? "var(--green-600)" : "var(--red-600)"}">${l.direction}</span>
							${l.qty} × ${frappe.utils.escape_html(l.item_code)} @ ${frappe.utils.escape_html(l.warehouse)}
							<a href="/app/stock-entry/${l.stock_entry}" target="_blank">${l.stock_entry}</a>
						</div>`
				)
				.join("")
		);
	}
}
