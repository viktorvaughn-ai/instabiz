frappe.ui.form.on("Lead", {
	refresh(frm) {
		if (!frm.is_new()) {
			frm.add_custom_button(__("Log Activity"), () => _ib_log_activity_dialog(frm));
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
