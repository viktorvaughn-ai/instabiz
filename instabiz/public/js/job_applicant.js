frappe.ui.form.on("Job Applicant", {
	refresh(frm) {
		if (frm.is_new()) return;
		const r1 = frm.doc.custom_round1_result;
		const r2 = frm.doc.custom_round2_result;
		const fd = frm.doc.custom_final_decision;

		// Round 1 button — always visible unless already decided
		if (fd === "Pending" || !fd) {
			frm.add_custom_button(__("Record Round 1"), () => _round_dialog(frm, 1), __("Interview"));
		}

		// Round 2 — only after Round 1 pass
		if (r1 === "Pass" && (fd === "Pending" || !fd)) {
			frm.add_custom_button(__("Record Round 2"), () => _round_dialog(frm, 2), __("Interview"));
		}

		// Final actions — after Round 2 pass
		if (r2 === "Pass" && fd === "Pending") {
			frm.add_custom_button(__("Extend Offer"), () => _extend_offer(frm), __("Decision"))
				.addClass("btn-primary");
		}

		// Reject — available after any round result
		if ((r1 || r2) && fd === "Pending") {
			frm.add_custom_button(__("Reject"), () => _reject(frm), __("Decision"));
		}
	},
});

function _round_dialog(frm, round) {
	const label = round === 1 ? "Round 1 (HR + Manager)" : "Round 2 (Director / CEO)";
	const dlg = new frappe.ui.Dialog({
		title: __("Record {0}", [label]),
		fields: [
			{ fieldname: "date",         label: __("Interview Date"), fieldtype: "Date",     reqd: 1, default: frappe.datetime.get_today() },
			{ fieldname: "interviewers", label: __("Interviewers"),   fieldtype: "Data",     reqd: 1 },
			{ fieldname: "result",       label: __("Result"),         fieldtype: "Select",   reqd: 1, options: "\nPass\nFail" },
			{ fieldname: "notes",        label: __("Notes"),          fieldtype: "Small Text" },
		],
		primary_action_label: __("Save"),
		primary_action(vals) {
			const prefix = `custom_round${round}_`;
			frm.set_value(`${prefix}date`,         vals.date);
			frm.set_value(`${prefix}interviewers`, vals.interviewers);
			frm.set_value(`${prefix}result`,       vals.result);
			frm.set_value(`${prefix}notes`,        vals.notes);
			frm.save().then(() => {
				dlg.hide();
				frappe.show_alert({ message: __("Round {0} recorded", [round]), indicator: "green" });
			});
		},
	});
	dlg.show();
}

function _extend_offer(frm) {
	frappe.confirm(__("Extend offer to {0}?", [frm.doc.applicant_name]), () => {
		frm.set_value("custom_final_decision", "Offer Extended");
		frm.set_value("custom_offer_date", frappe.datetime.get_today());
		frm.set_value("status", "Accepted");
		frm.save().then(() =>
			frappe.show_alert({ message: __("Offer extended"), indicator: "green" })
		);
	});
}

function _reject(frm) {
	frappe.confirm(__("Reject {0}?", [frm.doc.applicant_name]), () => {
		frm.set_value("custom_final_decision", "Rejected");
		frm.set_value("status", "Rejected");
		frm.save().then(() =>
			frappe.show_alert({ message: __("Applicant rejected"), indicator: "red" })
		);
	});
}
