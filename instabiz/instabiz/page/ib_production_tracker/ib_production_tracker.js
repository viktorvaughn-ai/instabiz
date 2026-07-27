frappe.pages["ib-production-tracker"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Production Tracker"),
		single_column: true,
	});
	wrapper.prod_tracker = new IbProductionTracker(wrapper);
};

const _IB_PT_STAGE_ICONS = {
	"Coating":          "lucide:paintbrush",
	"Slitting":         "lucide:scissors",
	"Rewinding":        "lucide:rotate-cw",
	"Cutting":          "lucide:scissors",
	"Packing":          "lucide:package",
	"Ready to Deliver": "lucide:truck",
	"Delivered":        "lucide:check-circle",
};

const _IB_PT_RISK = {
	"overdue":  { label: "Overdue",  color: "#dc2626", bg: "#fef2f2" },
	"at-risk":  { label: "At Risk",  color: "#ea580c", bg: "#fff7ed" },
	"on-track": { label: "On Track", color: "#059669", bg: "#ecfdf5" },
	"none":     { label: "No Date",  color: "#6b7280", bg: "#f9fafb" },
};

const _IB_PT_PRIORITY_COLOR = {
	Urgent: "#dc2626", High: "#ea580c", Normal: "#2563eb", Low: "#6b7280",
};

function _ib_pt_esc(s) {
	return frappe.utils.escape_html(String(s || ""));
}

class IbProductionTracker {
	constructor(wrapper) {
		this.page = wrapper.page;
		this._orders = [];
		this._risk_filter = "all";
		this._is_privileged = frappe.user.has_role(["Sales Manager", "System Manager"]);
		this._setup_toolbar();
		this._setup_content();
		this.refresh();
	}

	_setup_toolbar() {
		this.page.set_secondary_action(__("Refresh"), () => this.refresh());

		$(this.page.page_form).addClass("ib-page-form");

		this.f_search = this.page.add_field({
			fieldname: "search", label: __("Search"), fieldtype: "Data",
			placeholder: __("Order, customer…"),
			change: () => this._render(),
		});

		if (this._is_privileged) {
			this.f_sales_person = this.page.add_field({
				fieldname: "sales_person_user", label: __("Sales Person"),
				fieldtype: "Link", options: "User",
				change: () => this.refresh(),
			});
			this.f_show_completed = this.page.add_field({
				fieldname: "show_completed", label: __("Show Completed"),
				fieldtype: "Check",
				change: () => this.refresh(),
			});
		}
	}

	_setup_content() {
		this.$body = $(this.page.main);
		this.$content = $(`
			<div class="ib-pt-wrap">
				<div class="ib-pt-cards"></div>
				<div class="ib-pt-chips">
					<span class="ib-pt-chip ib-pt-chip--active" data-risk="all">${__("All")}</span>
					<span class="ib-pt-chip" data-risk="overdue">${__("Overdue")}</span>
					<span class="ib-pt-chip" data-risk="at-risk">${__("At Risk")}</span>
					<span class="ib-pt-chip" data-risk="on-track">${__("On Track")}</span>
				</div>
				<div class="ib-card ib-pt-list"></div>
				<div class="ib-pt-empty" style="display:none">${__("No in-flight orders.")}</div>
			</div>
		`).appendTo(this.$body);

		this.$cards = this.$content.find(".ib-pt-cards");
		this.$chips = this.$content.find(".ib-pt-chips");
		this.$list  = this.$content.find(".ib-pt-list");
		this.$empty = this.$content.find(".ib-pt-empty");

		this.$chips.on("click", ".ib-pt-chip", (e) => {
			this.$chips.find(".ib-pt-chip").removeClass("ib-pt-chip--active");
			$(e.currentTarget).addClass("ib-pt-chip--active");
			this._risk_filter = $(e.currentTarget).data("risk");
			this._render();
		});
	}

	refresh() {
		this.$list.html(`<div class="ib-pt-spinner"><span></span><span></span><span></span></div>`);
		frappe.call({
			method: "instabiz.overrides.production.get_my_production_orders",
			args: {
				sales_person_user: this._is_privileged ? (this.f_sales_person.get_value() || null) : null,
				show_completed: this._is_privileged ? (this.f_show_completed.get_value() ? 1 : 0) : 0,
			},
			callback: (r) => {
				this._orders = r.message || [];
				this._render_cards();
				this._render();
			},
		});
	}

	_render_cards() {
		const total = this._orders.length;
		const overdue = this._orders.filter(o => o.risk === "overdue").length;
		const at_risk = this._orders.filter(o => o.risk === "at-risk").length;
		const ready = this._orders.filter(o => o.pct >= 100).length;

		const card = (label, value, variant) => `
			<div class="ib-card ib-pt-card ${variant ? "ib-pt-card--" + variant : ""}">
				<div class="ib-pt-card-value">${value}</div>
				<div class="ib-pt-card-label">${label}</div>
			</div>`;

		this.$cards.html(`
			${card(__("In Production"), total)}
			${card(__("Overdue"), overdue, overdue ? "danger" : "")}
			${card(__("At Risk"), at_risk, at_risk ? "warn" : "")}
			${card(__("Ready to Deliver"), ready, ready ? "accent" : "")}
		`);
	}

	_render() {
		const term = (this.f_search.get_value() || "").trim().toLowerCase();
		let rows = this._orders;
		if (this._risk_filter !== "all") rows = rows.filter(o => o.risk === this._risk_filter);
		if (term) {
			rows = rows.filter(o => [o.sales_order, o.customer, o.sales_person]
				.filter(Boolean).join(" ").toLowerCase().includes(term));
		}

		if (!rows.length) {
			this.$list.empty();
			this.$empty.show();
			return;
		}
		this.$empty.hide();

		this.$list.html(rows.map(o => this._row_html(o)).join(""));

		this.$list.find(".ib-pt-row").on("click", (e) => {
			const so = $(e.currentTarget).data("so");
			this._toggle_detail($(e.currentTarget), so);
		});
	}

	_row_html(o) {
		const risk = _IB_PT_RISK[o.risk] || _IB_PT_RISK.none;
		const priColor = _IB_PT_PRIORITY_COLOR[o.priority] || "#6b7280";
		const stageIcon = _IB_PT_STAGE_ICONS[o.current_stage] || "lucide:circle";
		const pct = o.pct || 0;
		const deliveryTxt = o.delivery_date ? frappe.datetime.str_to_user(o.delivery_date) : __("No date");
		const daysTxt = o.days_left == null ? "" :
			o.days_left < 0 ? __("{0}d overdue", [Math.abs(o.days_left)]) :
			o.days_left === 0 ? __("Due today") :
			__("{0}d left", [o.days_left]);

		return `
		<div class="ib-pt-row" data-so="${_ib_pt_esc(o.sales_order)}">
			<div class="ib-pt-row-main">
				<div class="ib-pt-row-id">
					<a href="/app/sales-order/${_ib_pt_esc(o.sales_order)}" onclick="event.stopPropagation()">${_ib_pt_esc(o.sales_order)}</a>
					<span class="ib-pt-priority" style="background:${priColor}18;color:${priColor}">${_ib_pt_esc(o.priority || "Normal")}</span>
				</div>
				<div class="ib-pt-row-customer">${_ib_pt_esc(o.customer)}</div>
				${o.sales_person ? `<div class="ib-pt-row-sp">${_ib_pt_esc(o.sales_person)}</div>` : ""}
			</div>
			<div class="ib-pt-row-stage">
				<iconify-icon icon="${stageIcon}" width="13" height="13"></iconify-icon>
				${_ib_pt_esc(o.current_stage || (pct >= 100 ? "Ready to Deliver" : "Pending"))}
			</div>
			<div class="ib-pt-row-progress">
				<div class="ib-pt-bar"><div class="ib-pt-bar-fill" style="width:${pct}%;background:${pct >= 100 ? "#059669" : "#2563eb"}"></div></div>
				<span class="ib-pt-pct">${pct}%</span>
			</div>
			<div class="ib-pt-row-delivery">
				<div>${deliveryTxt}</div>
				<span class="ib-pt-risk-badge" style="background:${risk.bg};color:${risk.color}">${daysTxt || risk.label}</span>
			</div>
			<div class="ib-pt-row-detail" style="display:none"></div>
		</div>`;
	}

	_toggle_detail($row, so_name) {
		const $detail = $row.find(".ib-pt-row-detail");
		if ($detail.is(":visible")) { $detail.slideUp(120); return; }

		this.$list.find(".ib-pt-row-detail").not($detail).slideUp(120);

		if ($detail.data("loaded")) { $detail.slideDown(120); return; }
		$detail.html(`<div class="ib-pt-spinner"><span></span><span></span><span></span></div>`).slideDown(120);

		frappe.call({
			method: "instabiz.overrides.production.get_so_production_timeline",
			args: { sales_order: so_name },
			callback: (r) => {
				$detail.data("loaded", true).html(this._detail_html(r.message));
			},
			error: () => $detail.html(`<div class="text-muted" style="padding:10px">${__("Could not load detail.")}</div>`),
		});
	}

	_detail_html(data) {
		if (!data || !data.has_order_sheet || !(data.items || []).length) {
			return `<div class="text-muted" style="padding:10px">${__("No production detail available.")}</div>`;
		}
		return `<table class="ib-pt-detail-table">
			<thead><tr>
				<th>${__("Item")}</th><th>${__("Stages")}</th><th>${__("Progress")}</th>
			</tr></thead>
			<tbody>${data.items.map(item => {
				const chips = (item.stages || []).map(s => {
					const done = s.status === "Completed";
					const active = s.status === "In Progress";
					const col = done ? "#059669" : active ? "#2563eb" : "#d1d5db";
					const bg   = done ? "#d1fae5" : active ? "#dbeafe" : "#f9fafb";
					const icon = _IB_PT_STAGE_ICONS[s.stage] || "lucide:circle";
					const label = s.stage.replace("Ready to Deliver", "RTD");
					return `<span class="ib-pt-stage-chip" style="background:${bg};color:${col};border-color:${col}40"
						title="${_ib_pt_esc(s.stage)}: ${_ib_pt_esc(s.status || "Not created")}">
						<iconify-icon icon="${icon}" width="9" height="9"></iconify-icon> ${_ib_pt_esc(label)}</span>`;
				}).join("");
				return `<tr>
					<td class="ib-pt-detail-item">${_ib_pt_esc(item.item_code)}</td>
					<td>${chips}</td>
					<td>
						<div class="ib-pt-bar" style="width:70px">
							<div class="ib-pt-bar-fill" style="width:${item.completion_pct}%;background:${item.completion_pct >= 100 ? "#059669" : "#2563eb"}"></div>
						</div>
						<span class="ib-pt-pct">${item.completion_pct}%</span>
					</td>
				</tr>`;
			}).join("")}</tbody>
		</table>`;
	}
}
