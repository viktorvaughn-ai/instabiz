frappe.listview_settings["Lead"] = Object.assign(
	frappe.listview_settings["Lead"] || {},
	{
		add_fields: ["custom_lead_owner_name", "mobile_no", "phone", "email_id", "source", "custom_status"],

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
			ib_setup_custom_status_multiselect(listview);

			// Restore inline status picker behavior on list pills.
			const _orig_render_list = listview.render_list.bind(listview);
			listview.render_list = function () {
				_orig_render_list();
				ib_bind_status_pills(listview);
			};
		},
	}
);

const LEAD_STATUSES = [
	["Cold Lead", "grey"],
	["Hot Lead", "orange"],
	["Contacted", "yellow"],
	["Qualified", "blue"],
	["Proposal", "light-blue"],
	["Negotiation", "purple"],
	["Converted", "green"],
	["Customer", "green"],
	["Lost", "red"],
];

function ib_bind_status_pills(listview) {
	listview.$result.find(".list-row-container").each(function () {
		const $container = $(this);
		const encoded = $container.find(".list-row-checkbox").attr("data-name");
		if (!encoded) return;
		const lead = decodeURIComponent(encoded);

		$container.find(".indicator-pill").each(function () {
			$(this)
				.off("click.ib_status")
				.on("click.ib_status", function (e) {
					e.stopPropagation();
					e.preventDefault();
					ib_show_lead_status_picker($(this), lead, listview);
				});
		});
	});
}

function ib_show_lead_status_picker($pill, lead, listview) {
	$(".ib-status-picker").remove();

	const $picker = $(`<div class="ib-status-picker"></div>`);

	LEAD_STATUSES.forEach(function ([label, color]) {
		const $item = $(
			`<button class="ib-status-picker-item indicator-pill ${color}" data-status="${label}">${__(label)}</button>`
		);
		$item.on("click", function (e) {
			e.stopPropagation();
			const newStatus = $(this).data("status");
			ib_cleanup();

			$pill
				.attr("class", `indicator-pill ${color} filterable no-indicator-dot ellipsis`)
				.find(".ellipsis")
				.text(__(label));

			frappe.call({
				method: "instabiz.overrides.lead.set_lead_status",
				args: { lead: lead, status: newStatus },
				error: function () {
					listview.refresh();
				},
			});
		});
		$picker.append($item);
	});

	$("body").append($picker);

	function ib_reposition() {
		const rect = $pill[0].getBoundingClientRect();
		const pickerH = $picker.outerHeight();
		const pickerW = $picker.outerWidth();
		const viewportH = window.innerHeight;
		const viewportW = window.innerWidth;
		const spaceBelow = viewportH - rect.bottom;
		const spaceAbove = rect.top;

		let top = (spaceBelow >= pickerH + 4 || spaceBelow >= spaceAbove)
			? rect.bottom + 4
			: rect.top - pickerH - 4;

		let left = rect.left;
		if (left + pickerW > viewportW - 8) left = viewportW - pickerW - 8;
		if (left < 8) left = 8;

		$picker.css({ top, left });
	}

	ib_reposition();

	$(window).on("scroll.ib_status_scroll", ib_reposition);
	$pill.closest(".layout-main-section, .frappe-list").on("scroll.ib_status_scroll", ib_reposition);

	function ib_cleanup() {
		$picker.remove();
		$(document).off("mousedown.ib_status_close", onOutside);
		$(window).off("scroll.ib_status_scroll", ib_reposition);
		$pill.closest(".layout-main-section, .frappe-list").off("scroll.ib_status_scroll", ib_reposition);
	}

	function onOutside(e) {
		if (!$(e.target).closest(".ib-status-picker").length) {
			ib_cleanup();
		}
	}

	setTimeout(function () {
		$(document).on("mousedown.ib_status_close", onOutside);
	}, 0);
}

function ib_setup_custom_status_multiselect(listview) {
	const leadTypeField = listview.page.fields_dict.status;
	if (leadTypeField && leadTypeField.$wrapper) {
		leadTypeField.$wrapper.hide();
	}

	const existingField = listview.page.fields_dict.custom_status;
	if (existingField && existingField.$wrapper) {
		existingField.$wrapper.hide();
	}

	$(".ib-lead-status-multi-filter").remove();
	const $wrapper = $(
		'<div class="form-group frappe-control input-max-width col-md-2 ib-lead-status-multi-filter" data-fieldtype="MultiSelectList" data-fieldname="custom_status_multi"></div>'
	);
	if (existingField && existingField.$wrapper && existingField.$wrapper.length) {
		$wrapper.insertAfter(existingField.$wrapper);
	} else if (listview.filter_area && listview.filter_area.standard_filters_wrapper) {
		$wrapper.appendTo(listview.filter_area.standard_filters_wrapper);
	} else {
		$wrapper.appendTo(listview.page.page_form);
	}
	$wrapper.css({
		flex: "0 0 140px",
		maxWidth: "140px",
	});

	const control = frappe.ui.form.make_control({
		df: {
			label: "",
			fieldtype: "MultiSelectList",
			placeholder: __("Status"),
			input_class: "input-xs",
			get_data(txt) {
				const q = (txt || "").toLowerCase();
				return LEAD_STATUSES
					.map(([status]) => status)
					.filter((status) => status.toLowerCase().includes(q))
					.map((status) => ({ value: status, description: __("Lead Status") }));
			},
			onchange() {
				const selected = ib_extract_status_values(control.get_value());
				listview.filter_area.remove("custom_status");
				if (selected.length) {
					listview.filter_area.add([["Lead", "custom_status", "in", selected]]);
				}
				listview.refresh();
			},
		},
		parent: $wrapper,
		only_input: true,
		render_input: 1,
	});
	control.$wrapper.removeClass("form-group");
	control.$wrapper.css("margin-bottom", 0);

	const current = listview.filter_area
		.get()
		.filter((f) => f[1] === "custom_status")
		.flatMap((f) => ib_extract_status_values(f[3]));
	if (current.length) {
		control.set_value(current);
	}

	const $clearAllBtn = listview.filter_area && listview.filter_area.filter_x_button;
	if ($clearAllBtn && $clearAllBtn.length) {
		$clearAllBtn.off("click.ib_lead_status_multi_clear").on("click.ib_lead_status_multi_clear", function () {
			control.set_value([]);
		});
	}
}

function ib_extract_status_values(value) {
	if (Array.isArray(value)) return value.filter(Boolean);
	if (typeof value === "string") {
		return value
			.split(",")
			.map((v) => v.trim())
			.filter(Boolean);
	}
	return [];
}
 