frappe.ui.form.on("Employee", {
	refresh(frm) {
		if (!frm.is_new()) {
			_add_drive_button(frm);
		}
	},

	after_save(frm) {
		_add_drive_button(frm);
	},
});

function _add_drive_button(frm) {
	frm.remove_custom_button(__("Open in Drive"), __("Drive"));

	frappe.call({
		method: "instabiz.overrides.employee_drive.get_employee_drive_folder",
		args: { employee: frm.doc.name },
		callback(r) {
			const folder = r && r.message;
			if (folder) {
				frm.add_custom_button(
					__("Open in Drive"),
					() => window.open(`/drive/d/${folder}`, "_blank"),
					__("Drive")
				);
			} else {
				// No folder yet — show hint if documents exist
				const has_docs = (frm.doc.custom_employee_documents || []).some(
					(r) => r.document_file
				);
				if (has_docs) {
					frm.add_custom_button(
						__("Syncing to Drive…"),
						() =>
							frappe.msgprint(
								__("Files are being synced to Drive in the background. Refresh in a moment.")
							),
						__("Drive")
					);
				}
			}
		},
	});
}
