/**
 * ib_show_wa_dialog({ customer, customer_name, ref_doctype, ref_docname })
 * Global helper — loaded via app_include_js.
 * Opens template picker, previews rendered message, sends via whatsapp.py.
 */
function ib_show_wa_dialog({ customer, customer_name, ref_doctype, ref_docname } = {}) {
	frappe.call({
		method: "instabiz.overrides.customer_assignment.get_wa_templates",
		callback(r) {
			const templates = r.message || [];
			if (!templates.length) {
				frappe.show_alert({ message: __("No active WA templates. Add one in IB WA Template."), indicator: "orange" });
				return;
			}

			const display = customer_name || customer;
			const fields = [
				{
					fieldname: "template",
					fieldtype: "Select",
					label: __("Template"),
					options: templates.map(t => t.name).join("\n"),
					reqd: 1,
					onchange() { _ib_wa_update_preview(d, templates, display); },
				},
				{
					fieldname: "preview",
					fieldtype: "Small Text",
					label: __("Message"),
				},
			];

			if (ref_doctype && ref_docname) {
				fields.push({
					fieldname: "attach_doc",
					fieldtype: "Check",
					label: __("Attach {0} as PDF", [ref_docname]),
					default: 1,
				});
			}

			const d = new frappe.ui.Dialog({
				title: __("Send WhatsApp — {0}", [display]),
				fields,
				primary_action_label: __("Send"),
				primary_action(values) {
					const attach = values.attach_doc;
					frappe.call({
						method: "instabiz.overrides.whatsapp.send_whatsapp",
						args: {
							customer,
							template_name: values.template,
							message: values.preview || null,
							ref_doctype: (attach && ref_doctype) ? ref_doctype : null,
							ref_docname: (attach && ref_docname) ? ref_docname : null,
						},
						freeze: true,
						freeze_message: __("Sending WhatsApp…"),
						callback(r) {
							if (r.exc) return;
							frappe.show_alert({ message: __("WhatsApp sent to {0}", [display]), indicator: "green" });
							d.hide();
						},
					});
				},
			});

			if (templates.length) {
				d.set_value("template", templates[0].name);
				_ib_wa_update_preview(d, templates, display);
			}
			d.show();
		},
	});
}

function _ib_wa_update_preview(dialog, templates, customer_name) {
	const selected = dialog.get_value("template");
	const tmpl = templates.find(t => t.name === selected);
	if (!tmpl) return;
	const preview = (tmpl.message || "")
		.replace(/\{customer\}/g, customer_name)
		.replace(/\{name\}/g, frappe.user.full_name() || frappe.session.user)
		.replace(/\{territory\}/g, "")
		.replace(/\{contact\}/g, customer_name)
		.replace(/\{last_order\}/g, "");
	dialog.set_value("preview", preview);
}
