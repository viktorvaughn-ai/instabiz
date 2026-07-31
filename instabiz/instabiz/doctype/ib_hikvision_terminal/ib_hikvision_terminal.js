frappe.ui.form.on("IB Hikvision Terminal", {
	refresh(frm) {
		if (frm.is_new()) return;

		frm.add_custom_button(__("Sync Now"), () => {
			frappe.show_alert({ message: __("Pulling events from {0}…", [frm.doc.terminal_name]), indicator: "blue" });
			frappe.call({
				method: "instabiz.overrides.hikvision.pull_terminal_events",
				args: { terminal_name: frm.doc.name },
				freeze: true,
				freeze_message: __("Contacting terminal…"),
			}).then((r) => {
				const res = r.message || {};
				frappe.msgprint({
					title: __("Hikvision Sync Result"),
					indicator: res.unmatched ? "orange" : "green",
					message: __("Created {0} checkin(s). {1} unmatched event(s).", [
						res.created || 0,
						res.unmatched || 0,
					]),
				});
				frm.reload_doc();
			});
		}, __("Actions"));
	},
});
