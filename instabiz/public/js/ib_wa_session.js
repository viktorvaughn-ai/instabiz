frappe.ui.form.on("IB WA Session", {
	refresh(frm) {
		_ib_render_qr(frm);

		frm.add_custom_button(__("Get QR"), () => {
			if (!frm.doc.session_id) {
				frappe.show_alert({ message: __("Set a Session ID first"), indicator: "orange" });
				return;
			}
			frappe.call({
				method: "instabiz.overrides.whatsapp.get_session_qr",
				args: { session_id: frm.doc.session_id },
				freeze: true,
				freeze_message: __("Fetching QR…"),
				callback(r) {
					if (r.exc || !r.message) return;
					const qr = r.message.qr;
					if (!qr) {
						frappe.show_alert({ message: __("No QR returned — session may already be connected"), indicator: "orange" });
						return;
					}
					frm.set_value("qr_data", qr);
					frm.set_value("status", "QR Pending");
					frm.save().then(() => _ib_render_qr(frm));
				},
			});
		});

		frm.add_custom_button(__("Sync Status"), () => {
			if (!frm.doc.session_id) return;
			frappe.call({
				method: "instabiz.overrides.whatsapp.sync_session_status",
				args: { session_id: frm.doc.session_id },
				callback(r) {
					if (r.exc || !r.message) return;
					const s = r.message.status;
					frm.set_value("status", s);
					if (s === "Connected") frm.set_value("qr_data", "");
					frm.save().then(() => {
						frappe.show_alert({ message: __("Status: {0}", [s]), indicator: s === "Connected" ? "green" : "orange" });
						_ib_render_qr(frm);
					});
				},
			});
		});
	},
});

function _ib_render_qr(frm) {
	const qr = frm.doc.qr_data;
	const html = qr
		? `<div style="padding:12px 0"><img src="${frappe.utils.escape_html(qr)}" style="width:220px;height:220px;display:block" /><p class="text-muted" style="margin-top:8px;font-size:12px">Scan with WhatsApp on the linked phone</p></div>`
		: `<p class="text-muted">Click <b>Get QR</b> to fetch the QR code, then scan with WhatsApp on the linked phone.</p>`;
	frm.set_df_property("qr_display", "options", html);
	frm.refresh_field("qr_display");
}
