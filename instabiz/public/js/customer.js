// Customer name is protected server-side via CustomCustomer.validate()

// Native address/contact sections replaced by inline custom fields (Billing & Shipping section).
const _IB_HIDE_ADDR_FIELDS = [
	"address_contacts",                   // Section Break: Address and Contact
	"address_html",
	"contact_html",
	"primary_address_and_contact_detail", // Section Break: Primary Address and Contact
	"customer_primary_address",
	"primary_address",
	"customer_primary_contact",
];

frappe.ui.form.on("Customer", {
	refresh: function (frm) {
		// Pre-fill Handled By on new customer forms immediately (before save)
		if (frm.is_new() && !frm.doc.custom_sales_person_user
				&& frappe.session.user !== "Administrator") {
			frm.set_value("custom_sales_person_user", frappe.session.user);
			frappe.db.get_value("User", frappe.session.user, "full_name").then(r => {
				const name = r && r.message && r.message.full_name;
				if (name) frm.set_value("custom_sales_person", name);
			});
		}

		_IB_HIDE_ADDR_FIELDS.forEach(function (f) {
			frm.set_df_property(f, "hidden", 1);
		});
		_ib_toggle_shipping_fields(frm);

		if (!frm.is_new() && _ib_is_manager()) {
			_ib_render_assign_to_user_button(frm);
			if (frm.doc.custom_sales_person_user) {
				_ib_render_remove_assignment_button(frm);
			}
			if (frm.doc.custom_overdue_block) {
				_ib_render_clear_overdue_block_button(frm);
			}
		}
		// Share button — visible to the assigned sales user AND managers
		if (!frm.is_new() && frm.doc.custom_sales_person_user) {
			const is_assigned = frm.doc.custom_sales_person_user === frappe.session.user;
			if (is_assigned || _ib_is_manager()) {
				_ib_render_share_button(frm);
			}
		}
		if (!frm.is_new()) {
			_ib_load_outstanding(frm);
			_ib_render_outstanding_btn(frm);
			_ib_render_sales_orders_btn(frm);
			frm.add_custom_button(__("Send WhatsApp"), () => {
				ib_show_wa_dialog({
					customer: frm.doc.name,
					customer_name: frm.doc.customer_name,
				});
			}, IB_ICONS.svg("whatsapp", 16));
			_ib_render_send_statement_btn(frm);
		}
	},

	custom_bill_and_ship_to_same_address: function (frm) {
		_ib_toggle_shipping_fields(frm);
		if (frm.doc.custom_bill_and_ship_to_same_address) {
			frm.set_value("custom_shipping",   frm.doc.custom_billing);
			frm.set_value("custom_st_city",    frm.doc.custom_bt_city);
			frm.set_value("custom_st_state",   frm.doc.custom_bt_state);
			frm.set_value("custom_st_pincode", frm.doc.custom_bt_pincode);
		}
	},

	custom_bt_pincode: function (frm) {
		instabiz.pincode.autofill(frm, "custom_bt_pincode", {
			city:  "custom_bt_city",
			state: "custom_bt_state",
		});
	},
	custom_st_pincode: function (frm) {
		instabiz.pincode.autofill(frm, "custom_st_pincode", {
			city:  "custom_st_city",
			state: "custom_st_state",
		});
	},

	custom_bt_state: function (frm) {
		_ib_sync_territory_from_state(frm);
	},
});

const _IB_SHIPPING_FIELDS = [
	"custom_shipping_col",
	"custom_shipping",
	"custom_st_city",
	"custom_st_state",
	"custom_st_pincode",
];

function _ib_toggle_shipping_fields(frm) {
	const hide = !!frm.doc.custom_bill_and_ship_to_same_address;
	_IB_SHIPPING_FIELDS.forEach(function (f) {
		frm.set_df_property(f, "hidden", hide ? 1 : 0);
	});
	frm.refresh_fields(_IB_SHIPPING_FIELDS);
}

function _ib_render_outstanding_btn(frm) {
	frm.remove_custom_button("Outstanding Invoices", "View");
	frm.add_custom_button("Outstanding Invoices", () => {
		frappe.set_route("List", "Sales Invoice", {
			customer: frm.doc.name,
			docstatus: 1,
			outstanding_amount: [">", 0],
		});
	}, "View");
}

function _ib_render_sales_orders_btn(frm) {
	frm.remove_custom_button("All Sales Orders", "View");
	frm.add_custom_button("All Sales Orders", () => {
		frappe.set_route("List", "Sales Order", {
			customer: frm.doc.name,
		});
	}, "View");
}

function _ib_load_outstanding(frm) {
	frappe.call({
		method: "instabiz.overrides.customer.get_outstanding",
		args: { customer: frm.doc.name },
		callback(r) {
			if (r.exc) return;
			frm.set_value("custom_outstanding_amount", r.message || 0);
		},
	});
}

function _ib_is_manager() {
	return frappe.user.has_role("Sales Manager") || frappe.user.has_role("System Manager");
}



function _ib_render_remove_assignment_button(frm) {
	frm.remove_custom_button("Remove Assignment", "Assign");
	frm.add_custom_button("Remove Assignment", () => {
		const current = frm.doc.custom_sales_person || frm.doc.custom_sales_person_user;
		frappe.confirm(`Remove assignment from ${current}?`, () => {
			frappe.call({
				method: "instabiz.overrides.customer_assignment.remove_customer_assignment",
				args: { customer: frm.doc.name },
				callback(r) {
					if (r.message && r.message.status === "ok") {
						frappe.show_alert({ message: "Assignment removed", indicator: "orange" });
						frm.reload_doc();
					}
				},
			});
		});
	}, "Assign");
}

function _ib_render_assign_to_user_button(frm) {
	frm.remove_custom_button("Assign to User", "Assign");
	frm.add_custom_button("Assign to User", () => {
		// Fetch active sales users with full names before showing dialog
		frappe.db.get_list("User", {
			filters: [["Has Role", "role", "=", "Sales User"], ["enabled", "=", 1]],
			fields: ["name", "full_name"],
			limit: 200,
		}).then((users) => {
			const name_to_email = {};
			const options = [""].concat(users.map((u) => {
				const label = u.full_name || u.name;
				name_to_email[label] = u.name;
				return label;
			}));

			const d = new frappe.ui.Dialog({
				title: "Assign to Sales User",
				fields: [
					{
						fieldname: "sales_user_label",
						label: "Sales User",
						fieldtype: "Select",
						options: options.join("\n"),
						reqd: 1,
					},
				],
				primary_action_label: "Assign",
				primary_action(values) {
					const sales_user = name_to_email[values.sales_user_label];
					if (!sales_user) return;
					frappe.call({
						method: "instabiz.overrides.customer_assignment.assign_customer_to_user",
						args: { customer: frm.doc.name, sales_user },
						callback(r) {
							if (r.message && r.message.status === "ok") {
								d.hide();
								frappe.show_alert({ message: `Assigned to ${values.sales_user_label}`, indicator: "green" });
								frm.reload_doc();
							}
						},
					});
				},
			});
			d.show();
		});
	}, "Assign");
}

// ── Overdue block ────────────────────────────────────────────────────────────

function _ib_render_clear_overdue_block_button(frm) {
	frm.remove_custom_button("Clear Overdue Block", "Credit");
	frm.add_custom_button("Clear Overdue Block", () => {
		frappe.confirm(
			`Manually clear the overdue block for <b>${frm.doc.customer_name}</b>?<br>`
			+ "This allows new Sales Orders to be submitted despite outstanding dues.",
			() => {
				frappe.call({
					method: "instabiz.overrides.customer.clear_overdue_block",
					args: { customer: frm.doc.name },
					callback(r) {
						if (r.message === "ok") {
							frappe.show_alert({ message: "Overdue block cleared", indicator: "green" });
							frm.reload_doc();
						}
					},
				});
			}
		);
	}, "Credit");
}

// ── Location helpers ─────────────────────────────────────────────────────────

function _ib_sync_territory_from_state(frm) {
	const state = (frm.doc.custom_bt_state || "").trim();
	if (!state) return;
	frappe.db.get_value("Territory", { name: state }, "name").then(r => {
		if (r && r.message && r.message.name) {
			frm.set_value("territory", r.message.name);
		}
	});
}

// ── Customer sharing ─────────────────────────────────────────────────────────

function _ib_render_share_button(frm) {
	frm.remove_custom_button("Manage Sharing", "Assign");
	frm.add_custom_button("Manage Sharing", () => {
		_ib_show_share_dialog(frm.doc.name, frm.doc.customer_name);
	}, "Assign");
}

function _ib_render_send_statement_btn(frm) {
	frm.remove_custom_button("Send Outstanding Statement", "WhatsApp");
	frm.add_custom_button(__("Send Outstanding Statement"), () => {
		frappe.confirm(
			`Send outstanding invoices list to <b>${frappe.utils.escape_html(frm.doc.customer_name)}</b> via WhatsApp?`,
			() => {
				frappe.call({
					method: "instabiz.overrides.whatsapp.send_outstanding_statement",
					args: { customer: frm.doc.name },
					freeze: true,
					freeze_message: "Sending statement…",
					callback(r) {
						if (r.message && r.message.status === "ok") {
							frappe.show_alert({
								message: `Statement sent — ${r.message.invoices} invoice(s)`,
								indicator: "green",
							});
						}
					},
				});
			}
		);
	}, "WhatsApp");
}

function _ib_show_share_dialog(customer, customer_name) {
	frappe.call({
		method: "instabiz.overrides.customer_assignment.get_customer_shares",
		args: { customer },
		callback(r) {
			if (r.exc) return;
			const current_shares = r.message || [];

			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "User",
					filters: [
						["Has Role", "role", "=", "Sales User"],
						["enabled", "=", 1],
					],
					fields: ["name", "full_name"],
					limit: 200,
				},
				callback(r2) {
					if (r2.exc) return;
					const all_users = r2.message || [];
					const shared_set = new Set(current_shares.map((s) => s.shared_with));
					const owner_user = frappe.db.get_value("Customer", customer, "custom_sales_person_user");

					const shares_html = current_shares.length
						? `<table class="table table-condensed ib-share-table">
							<thead><tr><th>Shared With</th><th>Shared By</th><th>Date</th><th></th></tr></thead>
							<tbody>
								${current_shares.map((s) => `
									<tr data-user="${frappe.utils.escape_html(s.shared_with)}">
										<td>${frappe.utils.escape_html(s.shared_with_name || s.shared_with)}</td>
										<td>${frappe.utils.escape_html(s.shared_by_name || s.shared_by || "")}</td>
										<td>${frappe.datetime.str_to_user(s.shared_at) || ""}</td>
										<td><button class="btn btn-xs btn-danger ib-share-remove" data-user="${frappe.utils.escape_html(s.shared_with)}">Remove</button></td>
									</tr>
								`).join("")}
							</tbody>
						</table>`
						: `<div class="text-muted" style="padding:4px 0">Not shared with anyone yet.</div>`;

					const available = all_users.filter((u) => !shared_set.has(u.name));

					const d = new frappe.ui.Dialog({
						title: `Sharing — ${customer_name || customer}`,
						fields: [
							{ fieldname: "current_html", fieldtype: "HTML", options: shares_html },
							{ fieldname: "add_sec", fieldtype: "Section Break", label: available.length ? "Share with another user" : "" },
							...(available.length ? [{
								fieldname: "share_with",
								label: "Add User",
								fieldtype: "Select",
								options: [""].concat(available.map((u) => `${u.name}|${u.full_name || u.name}`)).join("\n"),
							}] : [{
								fieldname: "_no_more",
								fieldtype: "HTML",
								options: `<div class="text-muted">All active Sales Users already have access.</div>`,
							}]),
						],
						primary_action_label: available.length ? "Share" : "Close",
						primary_action(values) {
							if (!available.length) { d.hide(); return; }
							const target = (values.share_with || "").split("|")[0];
							if (!target) { frappe.show_alert({ message: "Select a user first", indicator: "orange" }); return; }
							frappe.call({
								method: "instabiz.overrides.customer_assignment.share_customer",
								args: { customer, share_with: target },
								callback(res) {
									if (!res.exc) {
										frappe.show_alert({ message: "Customer shared", indicator: "green" });
										d.hide();
									}
								},
							});
						},
					});

					d.show();

					d.$wrapper.find(".ib-share-remove").on("click", function () {
						const target = $(this).data("user");
						frappe.call({
							method: "instabiz.overrides.customer_assignment.unshare_customer",
							args: { customer, share_with: target },
							callback(res) {
								if (!res.exc) {
									$(`[data-user="${target}"]`).fadeOut(200, function () { $(this).remove(); });
									frappe.show_alert({ message: "Access removed", indicator: "orange" });
								}
							},
						});
					});
				},
			});
		},
	});
}
