frappe.listview_settings["Lead"] = Object.assign(
	frappe.listview_settings["Lead"] || {},
	{
		add_fields: ["custom_lead_owner_name"],

		formatters: {
			lead_owner: function (value, field, doc) {
				if (!value) return "";
				return frappe.utils.escape_html(doc.custom_lead_owner_name || value);
			},
		},

		get_indicator: function (doc) {
			const map = {
				"Cold Lead":   ["Cold Lead",   "grey"],
				"Hot Lead":    ["Hot Lead",    "orange"],
				"Contacted":   ["Contacted",   "yellow"],
				"Qualified":   ["Qualified",   "blue"],
				"Proposal":    ["Proposal",    "light-blue"],
				"Negotiation": ["Negotiation", "purple"],
				"Converted":   ["Converted",   "green"],
				"Customer":    ["Customer",    "green"],
				"Lost":        ["Lost",        "red"],
			};
			const s = doc.custom_status || "Cold Lead";
			const [label, color] = map[s] || [s, "grey"];
			return [__(label), color, "custom_status,=," + s];
		},

		onload: function (listview) {
			// Preserve ERPNext's own onload (Create Prospect action)
			const _erpnext_onload = frappe.listview_settings["Lead"]._erpnext_onload;
			if (_erpnext_onload) _erpnext_onload(listview);

			listview.page.add_action_item(__("Transfer Lead(s)"), function () {
				const selected = listview.get_checked_items();
				if (!selected.length) {
					frappe.msgprint(__("Please select at least one lead."));
					return;
				}

				const d = new frappe.ui.Dialog({
					title: __("Transfer Lead(s)"),
					fields: [
						{
							label: __("Transfer To"),
							fieldname: "to_user",
							fieldtype: "Link",
							options: "User",
							reqd: 1,
							filters: { enabled: 1 },
						},
					],
					primary_action_label: __("Transfer"),
					primary_action: function (values) {
						frappe.call({
							method: "instabiz.overrides.lead.transfer_leads",
							args: {
								leads: selected.map((r) => r.name),
								to_user: values.to_user,
							},
							callback: function (r) {
								if (r.message) {
									frappe.show_alert({
										message: __("{0} lead(s) transferred to {1}", [
											r.message.transferred,
											r.message.to,
										]),
										indicator: "green",
									});
									listview.refresh();
								}
							},
						});
						d.hide();
					},
				});
				d.show();
			});
		        ib_hide_sidebar();
		},
	}
);
