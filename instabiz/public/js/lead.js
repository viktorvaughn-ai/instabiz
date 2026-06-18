frappe.ui.form.on("Lead", {
	onload(frm) {
		if (frm.is_new() && !frm.doc.lead_owner) {
			frm.set_value("lead_owner", frappe.session.user);
		}
	},

	refresh(frm) {
		// Hide "Assigned To" (lead_owner) from regular sales users — team leaders and above only
		const can_reassign = frappe.user.has_role("Sales Manager")
			|| frappe.user.has_role("System Manager")
			|| frappe.user.has_role("Team Leader");
		frm.set_df_property("lead_owner", "hidden", can_reassign ? 0 : 1);
		frm.set_df_property("lead_owner", "read_only", can_reassign ? 0 : 1);

		if (!frm.is_new()) {
			frm.add_custom_button(__("Log Activity"), () => _ib_log_activity_dialog(frm));
			if (frappe.user.has_role("Sales Manager") || frappe.user.has_role("System Manager")) {
				frm.add_custom_button(__("Reassign"), () => _ib_reassign_lead_dialog(frm), __("Actions"));
			}
		}
	},

	custom_pincode: function (frm) {
		instabiz.pincode.autofill(frm, "custom_pincode", {
			city:      "city",
			district:  "custom_district",
			territory: "territory",
			state:     null,
		});
	},
});

function _ib_log_activity_dialog(frm) {
	const d = new frappe.ui.Dialog({
		title: __("Log Activity"),
		fields: [
			{
				fieldname: "activity_type",
				label: __("Activity Type"),
				fieldtype: "Select",
				options: "Call\nMeeting\nWhatsApp\nEmail\nVisit",
				reqd: 1,
			},
			{
				fieldname: "outcome",
				label: __("Outcome"),
				fieldtype: "Select",
				options: "Positive\nNeutral\nNegative\nNo Answer",
				reqd: 1,
			},
			{
				fieldname: "notes",
				label: __("Notes"),
				fieldtype: "Small Text",
				reqd: 1,
			},
			{
				fieldname: "next_follow_up_date",
				label: __("Next Follow-Up Date"),
				fieldtype: "Date",
			},
		],
		primary_action_label: __("Log"),
		primary_action(values) {
			frappe.call({
				method: "instabiz.overrides.lead.log_lead_activity",
				args: {
					lead: frm.docname,
					activity_type: values.activity_type,
					outcome: values.outcome,
					notes: values.notes,
					next_follow_up_date: values.next_follow_up_date || null,
				},
				callback() {
					d.hide();
					frm.reload_doc();
				},
			});
		},
	});
	d.show();
}

function _ib_reassign_lead_dialog(frm) {
	frappe.db.get_list("User", {
		filters: [["Has Role", "role", "in", ["Sales User", "Sales Manager"]], ["enabled", "=", 1]],
		fields: ["name", "full_name"],
		limit: 200,
	}).then(users => {
		const name_to_email = {};
		const options = users.map(u => {
			const label = u.full_name || u.name;
			name_to_email[label] = u.name;
			return label;
		});
		const d = new frappe.ui.Dialog({
			title: __("Reassign Lead"),
			fields: [{
				fieldname: "to_user_label",
				label: __("Assign To"),
				fieldtype: "Select",
				options: options.join("\n"),
				reqd: 1,
			}],
			primary_action_label: __("Reassign"),
			primary_action(values) {
				const to_user = name_to_email[values.to_user_label];
				if (!to_user) return;
				frappe.call({
					method: "instabiz.overrides.lead.transfer_leads",
					args: { leads: JSON.stringify([frm.docname]), to_user },
					callback(r) {
						if (r.message && r.message.transferred) {
							d.hide();
							frappe.show_alert({ message: `Lead reassigned to ${values.to_user_label}`, indicator: "green" });
							frm.reload_doc();
						}
					},
				});
			},
		});
		d.show();
	});
}
