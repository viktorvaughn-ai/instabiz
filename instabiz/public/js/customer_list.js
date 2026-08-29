function _ib_cust_next_working_day(date_str) {
	const d = new Date(date_str + "T00:00:00");
	do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0);
	return d.toISOString().split("T")[0];
}

frappe.listview_settings["Customer"] = {
	add_fields: ["custom_primary_contact_person", "custom_sales_person", "gstin"],

	formatters: {
		mobile_no(value, df, doc) {
			// custom_primary_contact_person (Address tab) is the number sales
			// actually maintain — Contact-linked mobile_no is unused/unreliable,
			// so it's only a fallback, not the primary source.
			return doc.custom_primary_contact_person || value || "";
		},
	},

	onload(listview) {
		ib_setup_list_print(listview, "Customer");
		ib_setup_party_ledger_print(listview, "Customer");
		// Real Sales Person picker (Link → User, autocomplete, exact match on
		// custom_sales_person_user) — same shared control Quotation/Sales
		// Order use, replacing the old free-text "Handled By" filter (fuzzy
		// LIKE-match on the display-name field custom_sales_person, no
		// autocomplete, typo-prone).
		ib_setup_list_sales_user_filter(listview, "Customer");

		// Filter row order = column order (2026-08-13): live columns are
		// Company Name, Status, Location, Mobile No, Outstanding Amount,
		// Handled By, ID. Status/Mobile No/Outstanding Amount have no
		// filter to move. Customer Group isn't a visible column, trails
		// after.
		ib_reorder_filter_row(listview, [
			listview.page.fields_dict.customer_name && listview.page.fields_dict.customer_name.$wrapper,
			listview.page.fields_dict.territory && listview.page.fields_dict.territory.$wrapper,
			$(".ib-customer-sales-user-filter"),
			listview.page.fields_dict.customer_group && listview.page.fields_dict.customer_group.$wrapper,
		]);

		// Remove native Frappe actions we don't use — deferred so Frappe adds them first
		const _REMOVE = ["Assign To", "Clear Assignment", "Apply Assignment Rule"];
		setTimeout(() => {
			$(listview.page.wrapper).find(".actions-btn-group .dropdown-menu li").filter(function () {
				return _REMOVE.includes($(this).text().trim());
			}).remove();
		}, 0);

		const is_manager =
			frappe.user.has_role("Sales Manager") || frappe.user.has_role("System Manager");
		if (!is_manager) return;

		listview.page.add_actions_menu_item(__("Assign to Sales User"), () => {
			const selected = listview.get_checked_items();
			if (!selected.length) {
				frappe.show_alert({ message: __("Select at least one customer"), indicator: "orange" });
				return;
			}
			const customers = selected.map((r) => r.name);

			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "User",
					filters: [["Has Role", "role", "=", "Sales User"], ["enabled", "=", 1]],
					fields: ["name", "full_name"],
					limit_page_length: 200,
				},
				callback(r) {
					const users = r.message || [];
					const d = new frappe.ui.Dialog({
						title: __("Assign {0} Customer(s) to Sales User", [customers.length]),
						fields: [
							{
								fieldname: "assigned_to",
								fieldtype: "Select",
								label: __("Sales User"),
								options: users.map((u) => u.full_name || u.name).join("\n"),
								reqd: 1,
							},
						],
						primary_action_label: __("Assign"),
						primary_action(values) {
							const user_obj = users.find(
								(u) => (u.full_name || u.name) === values.assigned_to
							);
							const assigned_to = user_obj ? user_obj.name : values.assigned_to;

							frappe.call({
								method: "instabiz.overrides.customer_assignment.bulk_assign_to_user",
								args: {
									customers: JSON.stringify(customers),
									assigned_to,
								},
								callback(r) {
									if (r.exc) return;
									const { assigned } = r.message;
									frappe.show_alert({
										message: __("{0} customer(s) assigned to {1}", [assigned, values.assigned_to]),
										indicator: assigned > 0 ? "green" : "orange",
									});
									d.hide();
									listview.refresh();
								},
							});
						},
					});
					d.show();
				},
			});
		});

		listview.page.add_actions_menu_item(__("Remove Assignment"), () => {
			const selected = listview.get_checked_items();
			if (!selected.length) {
				frappe.show_alert({ message: __("Select at least one customer"), indicator: "orange" });
				return;
			}
			const customers = selected.map((r) => r.name);
			frappe.confirm(
				__("Remove assignment from {0} customer(s)?", [customers.length]),
				() => {
					const calls = customers.map((customer) =>
						frappe.call({
							method: "instabiz.overrides.customer_assignment.remove_customer_assignment",
							args: { customer },
						})
					);
					Promise.all(calls).then(() => {
						frappe.show_alert({ message: __("{0} assignment(s) removed", [customers.length]), indicator: "orange" });
						listview.refresh();
					});
				}
			);
		});
	},

	after_render(listview) {
		// Fetch Contact Phone for customers with no mobile_no or custom_primary_contact_person
		const missing = (listview.data || []).filter(
			(r) => !r.mobile_no && !r.custom_primary_contact_person
		).map((r) => r.name);

		if (missing.length) {
			frappe.call({
				method: "instabiz.overrides.customer.get_customer_phones",
				args: { customers: JSON.stringify(missing) },
				callback(r) {
					const phones = r.message || {};
					listview.$result.find(".list-row-container").each(function () {
						const name = $(this).find("[data-name]").data("name") || $(this).attr("data-name");
						if (!name || !phones[name]) return;
						const $cell = $(this).find(".list-row-col[data-fieldname='mobile_no']");
						if ($cell.length && !$cell.text().trim()) {
							$cell.find(".ellipsis, span").first().text(phones[name]);
							if (!$cell.find(".ellipsis, span").length) {
								$cell.text(phones[name]);
							}
						}
					});
				},
			});
		}

		const is_manager =
			frappe.user.has_role("Sales Manager") || frappe.user.has_role("System Manager");
		if (!is_manager || !listview.data || !listview.data.length) return;

		const customers = listview.data.map((r) => r.name);
		frappe.call({
			method: "instabiz.overrides.customer_assignment.get_assignments_for_customers",
			args: { customers: JSON.stringify(customers) },
			callback(r) {
				if (!r.message) return;
				const map = r.message;
				listview.$result.find(".list-row").each(function () {
					const name = $(this).find("[data-name]").data("name")
						|| $(this).attr("data-name");
					if (!name || !map[name]) return;
					const info = map[name];
					const date_fmt = frappe.datetime.str_to_user(info.date);
					const badge = $(
						`<span class="ib-cust-assigned-badge" title="${frappe.utils.escape_html(info.assigned_to)}">` +
						`${frappe.utils.escape_html(info.full_name)} · ${date_fmt}</span>`
					);
					// Inject into the list row subject area — avoid duplicates
					if (!$(this).find(".ib-cust-assigned-badge").length) {
						$(this).find(".level-item.bold").first().after(badge);
					}
				});
			},
		});
	},
};
