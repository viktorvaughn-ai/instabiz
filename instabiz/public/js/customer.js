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
			_ib_render_fix_location_button(frm);
		}
		if (!frm.is_new()) {
			_ib_load_outstanding(frm);
			_ib_render_outstanding_btn(frm);
			frm.add_custom_button(__("Send WhatsApp"), () => {
				ib_show_wa_dialog({
					customer: frm.doc.name,
					customer_name: frm.doc.customer_name,
				});
			}, IB_ICONS.svg("whatsapp", 16));
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
								frappe.show_alert({ message: `Assigned to ${values.sales_user_label} — added to today's board`, indicator: "green" });
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

function _ib_render_fix_location_button(frm) {
	frm.remove_custom_button("Fix Territory from Billing State", "Location");
	frm.add_custom_button("Fix Territory from Billing State", () => {
		frappe.confirm(
			"Set territory = billing state for ALL customers where they differ?<br>"
			+ "This is a bulk operation and cannot be undone easily.",
			() => {
				frappe.call({
					method: "instabiz.overrides.customer.backfill_territory_from_billing_state",
					callback(r) {
						if (r.exc) return;
						const res = r.message;
						let msg = `Updated ${res.updated} customers.`;
						if (res.skipped > 0) {
							msg += ` ${res.skipped} skipped (billing state not found in Territory list).`;
						}
						if (res.unresolved && res.unresolved.length) {
							msg += "<br><b>Unresolved:</b><br>";
							res.unresolved.forEach(u => {
								msg += `• ${u.customer}: "${u.bt_state}"<br>`;
							});
						}
						frappe.msgprint({ title: "Territory Sync Done", message: msg, indicator: "green" });
					},
				});
			}
		);
	}, "Location");
}
