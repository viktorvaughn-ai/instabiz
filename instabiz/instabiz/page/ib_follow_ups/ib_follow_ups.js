frappe.pages["ib-follow-ups"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Follow-Ups"),
		single_column: true,
	});

	const page = new IBFollowUpsPage(wrapper);
	wrapper.ib_follow_ups = page;
};

frappe.pages["ib-follow-ups"].on_page_show = function (wrapper) {
	if (wrapper.ib_follow_ups) {
		wrapper.ib_follow_ups.refresh();
	}
};

const IB_FU_DOCTYPES = [
	"Quotation", "Sales Order", "Delivery Note", "Sales Invoice",
	"Purchase Order", "Purchase Receipt", "Purchase Invoice",
	"Leave Application", "IB Overtime Request", "IB Full Final Settlement", "Employee Exit Handover",
];

class IBFollowUpsPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = wrapper.page;
		this._doctype = IB_FU_DOCTYPES[0];
		this._build();
		this.refresh();
	}

	_build() {
		const $body = $(`
			<div>
				<div class="ib-fu-summary" style="display:flex; gap:12px; margin:12px 0;"></div>
				<div class="ib-card" style="padding:12px; margin-bottom:12px;">
					<div style="display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap;">
						<div class="ib-fu-doctype-field"></div>
						<input type="text" class="form-control ib-fu-search" placeholder="${__("Search")}" style="max-width:220px;">
					</div>
				</div>
				<div class="ib-fu-list"></div>
			</div>
		`).appendTo(this.page.main);

		this.$summary = $body.find(".ib-fu-summary");
		this.$list = $body.find(".ib-fu-list");
		this.$search = $body.find(".ib-fu-search");

		this.doctype_ctrl = frappe.ui.form.make_control({
			df: {
				fieldtype: "Select", label: __("Document Type"), fieldname: "doctype",
				options: IB_FU_DOCTYPES.join("\n"),
				onchange: () => {
					this._doctype = this.doctype_ctrl.get_value();
					this.refresh();
				},
			},
			parent: $body.find(".ib-fu-doctype-field"),
			render_input: true,
		});
		this.doctype_ctrl.set_value(this._doctype);

		this.$search.on("input", () => this._render_list());
	}

	refresh() {
		frappe.call({
			method: "instabiz.overrides.follow_ups.get_my_documents",
			args: { doctype: this._doctype },
			freeze: true,
			callback: (r) => {
				this._docs = r.message || [];
				this._render_summary();
				this._render_list();
			},
		});
	}

	_render_summary() {
		const total = this._docs.length;
		const overdue = this._docs.filter((d) => d.follow_up_status === "Overdue").length;
		const pending = this._docs.filter((d) => d.follow_up_status === "Never").length;
		const followed = total - overdue - pending;
		const card = (label, value, color) => `
			<div class="ib-card" style="flex:1; min-width:120px; padding:12px; text-align:center;">
				<div style="font-size:22px; font-weight:700; color:${color};">${value}</div>
				<div class="text-muted" style="font-size:12px;">${label}</div>
			</div>`;
		this.$summary.html(
			card(__("Total My Docs"), total, "var(--text-color)") +
			card(__("Followed Up"), followed, "var(--green-600)") +
			card(__("Pending"), pending, "var(--orange-600)") +
			card(__("Overdue"), overdue, "var(--red-600)")
		);
	}

	_render_list() {
		const q = (this.$search.val() || "").toLowerCase();
		const rows = (this._docs || []).filter((d) => !q || JSON.stringify(d).toLowerCase().includes(q));
		if (!rows.length) {
			this.$list.html(`<div class="text-muted" style="padding:20px;">${__("No documents found")}</div>`);
			return;
		}
		const status_color = { Never: "gray", Overdue: "red", "Followed Up": "green" };
		this.$list.html(`
			<table class="table table-bordered">
				<thead><tr>
					<th>${__("Document")}</th>
					<th>${__("Details")}</th>
					<th>${__("Status")}</th>
					<th>${__("Last Follow-up")}</th>
					<th></th>
				</tr></thead>
				<tbody>
					${rows.map((d) => `
						<tr>
							<td><a href="/app/${frappe.router.slug(this._doctype)}/${encodeURIComponent(d.name)}" target="_blank">${frappe.utils.escape_html(d.name)}</a></td>
							<td>${this._detail_text(d)}</td>
							<td><span class="indicator-pill ${status_color[d.follow_up_status]} no-indicator-dot">${d.follow_up_status}</span></td>
							<td>${d.last_follow_up ? frappe.datetime.str_to_user(d.last_follow_up) : "—"}</td>
							<td><button class="btn btn-xs btn-default ib-fu-log-btn" data-name="${frappe.utils.escape_html(d.name)}">${__("Log Follow-up")}</button></td>
						</tr>
					`).join("")}
				</tbody>
			</table>
		`);
		this.$list.find(".ib-fu-log-btn").on("click", (e) => {
			this._open_log_dialog($(e.currentTarget).data("name"));
		});
	}

	_detail_text(d) {
		return Object.keys(d)
			.filter((k) => !["name", "follow_up_status", "last_follow_up"].includes(k))
			.map((k) => d[k])
			.filter(Boolean)
			.map((v) => frappe.utils.escape_html(String(v)))
			.join(" · ");
	}

	_open_log_dialog(docname) {
		const d = new frappe.ui.Dialog({
			title: __("Log Follow-up: {0}", [docname]),
			fields: [
				{ fieldtype: "Select", fieldname: "follow_up_type", label: __("Type"), reqd: 1,
					options: "Call\nMeeting\nWhatsApp\nEmail\nVisit\nOther" },
				{ fieldtype: "Select", fieldname: "outcome", label: __("Outcome"), reqd: 1,
					options: "Positive\nNeutral\nNegative\nNo Answer" },
				{ fieldtype: "Small Text", fieldname: "notes", label: __("Notes") },
				{ fieldtype: "Date", fieldname: "next_follow_up_date", label: __("Next Follow-up Date") },
			],
			primary_action_label: __("Save"),
			primary_action: (values) => {
				frappe.call({
					method: "instabiz.overrides.follow_ups.log_follow_up",
					args: {
						reference_doctype: this._doctype,
						reference_name: docname,
						...values,
					},
					freeze: true,
					callback: () => {
						d.hide();
						frappe.show_alert({ message: __("Follow-up logged"), indicator: "green" });
						this.refresh();
					},
				});
			},
		});
		d.show();
	}
}
