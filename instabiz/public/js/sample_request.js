frappe.ui.form.on("IB Sample Request", {
	refresh(frm) {
		if (frm.is_new()) return;

		const status = frm.doc.status;

		if (status === "Draft") {
			frm.add_custom_button(__("Mark Work Order Created"), () => {
				frappe.call({
					method: "instabiz.overrides.sample_request.mark_work_order_created",
					args: { name: frm.docname },
					callback: () => frm.reload_doc(),
				});
			});
			frm.add_custom_button(__("Mark Sent"), () => {
				frappe.call({
					method: "instabiz.overrides.sample_request.mark_sent",
					args: { name: frm.docname },
					callback: () => frm.reload_doc(),
				});
			});
		}

		if (status === "Work Order Created") {
			frm.add_custom_button(__("Mark Sent"), () => {
				frappe.call({
					method: "instabiz.overrides.sample_request.mark_sent",
					args: { name: frm.docname },
					callback: () => frm.reload_doc(),
				});
			});
		}

		if (status === "Sent" || status === "Feedback Received") {
			frm.add_custom_button(__("Record Feedback"), () => {
				const d = new frappe.ui.Dialog({
					title: "Record Customer Feedback",
					fields: [
						{ label: "Feedback", fieldname: "feedback", fieldtype: "Small Text", reqd: 1 },
						{ label: "Outcome", fieldname: "outcome", fieldtype: "Select", options: "\nConverted\nNot Interested\nFollow Up\nNo Response", reqd: 1 },
					],
					primary_action_label: "Save",
					primary_action(values) {
						frappe.call({
							method: "instabiz.overrides.sample_request.record_feedback",
							args: { name: frm.docname, feedback: values.feedback, outcome: values.outcome },
							callback: () => { d.hide(); frm.reload_doc(); },
						});
					},
				});
				d.show();
			});

			frm.add_custom_button(__("Convert to Order"), () => {
				const d = new frappe.ui.Dialog({
					title: "Link Sales Order",
					fields: [
						{
							label: "Sales Order",
							fieldname: "sales_order",
							fieldtype: "Link",
							options: "Sales Order",
							get_query: () => ({ filters: { customer: frm.doc.customer, docstatus: 1 } }),
							reqd: 1,
						},
					],
					primary_action_label: "Link & Convert",
					primary_action(values) {
						frappe.call({
							method: "instabiz.overrides.sample_request.convert_to_order",
							args: { name: frm.docname, sales_order: values.sales_order },
							callback: () => { d.hide(); frm.reload_doc(); },
						});
					},
				});
				d.show();
			});
		}
	},
});
