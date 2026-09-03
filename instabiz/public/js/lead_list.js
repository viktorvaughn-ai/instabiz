frappe.listview_settings["Lead"] = Object.assign(
	frappe.listview_settings["Lead"] || {},
	{
		add_fields: ["custom_lead_owner_name", "mobile_no", "phone", "email_id", "source", "custom_status", "custom_last_activity_at"],

		formatters: {
			name: function (value, field, doc) {
				const raw = doc.custom_last_activity_at || doc.creation || "";
				const date = frappe.datetime.str_to_user((raw).split(" ")[0]);
				const label = doc.custom_last_activity_at ? "Last activity" : "Created";
				return `<span title="${frappe.utils.escape_html(value)}">`
					+ `<span style="font-size:11px;color:var(--text-muted)">${label}: ${date || ""}</span><br>`
					+ `<strong>${frappe.utils.escape_html(value)}</strong></span>`;
			},
			lead_owner: function (value, field, doc) {
				if (!value) return "";
				if (value === frappe.session.user) return __("You");
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
			ib_setup_list_print(listview, "Lead");

			// Title filter removed 2026-08-13 — redundant with the native
			// Company Name filter (already in_standard_filter=1), which is
			// what leads are actually searched by in practice.
			const titleField = listview.page.fields_dict.title;
			if (titleField && titleField.$wrapper) {
				titleField.$wrapper.hide();
			}

			// Preserve ERPNext's own onload (Create Prospect action)
			const _erpnext_onload = frappe.listview_settings["Lead"]._erpnext_onload;
			if (_erpnext_onload) _erpnext_onload(listview);

			// Sort by last activity (most recently contacted first); fall back to modified for never-contacted leads
			listview.sort_by = "custom_last_activity_at";
			listview.sort_order = "desc";
			if (listview.sort_selector) {
				listview.sort_selector.set_value("custom_last_activity_at", "desc");
			}

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
			// Company Name = proxy for the Title column (displays the lead's
			// company name). Autocomplete suggests distinct existing values.
			ib_setup_list_autocomplete_filter(listview, "Lead", "company_name", "Company Name");
			ib_setup_list_link_filter(listview, "Lead", "market_segment", "Market Segment", "Market Segment");
			ib_setup_list_link_filter(listview, "Lead", "industry", "Industry", "Industry Type");
			ib_setup_list_link_filter(listview, "Lead", "source", "Source", "Lead Source");
			ib_setup_list_link_filter(listview, "Lead", "territory", "State", "Territory");
			ib_setup_lead_team_filter(listview);
			ib_setup_custom_status_multiselect(listview);
			// "Assigned To"/"Handled By" column filter — narrows by lead_owner
			// (the real Link field; the column itself displays
			// custom_lead_owner_name, a Data mirror, but that's not filterable
			// the same way). Column header and filter label both renamed
			// Title→"Company Name" / Assigned To→"Handled By" via Property
			// Setters on Lead.title / Lead.custom_lead_owner_name, so the
			// filter's own label here is kept in sync by hand.
			ib_setup_list_link_filter(listview, "Lead", "lead_owner", "Handled By", "User");

			// Native ID (name) filter and the Next Follow-up Date filter are
			// both removed outright per user request — not hidden/reordered,
			// gone from the filter row entirely.
			const nameField = listview.page.fields_dict.name;
			if (nameField && nameField.$wrapper) nameField.$wrapper.hide();
			const nextFollowUpField = listview.page.fields_dict.custom_next_follow_up_date;
			if (nextFollowUpField && nextFollowUpField.$wrapper) nextFollowUpField.$wrapper.hide();

			// Date-range filter on `creation` — NOT custom_last_activity_at.
			// custom_last_activity_at is only ever written by log_lead_activity()
			// (a rep manually logging a call/meeting/etc, see overrides/lead.py)
			// — confirmed live 2026-09-03: only ~1,055 of 3,167 real leads (33%)
			// have it set at all. A "Between" filter on a field that's NULL for
			// 2/3 of all leads silently excludes them no matter what dates are
			// picked, regardless of when they were actually created — that was
			// a real bug (user report: "from to date filter is not working
			// properly... make sure all docs get filtered"). `creation` is
			// never null for any document, so filtering on it is the only way
			// every lead is guaranteed reachable by *some* date range — same
			// field every other list in this app (Quotation/SO/DN/SI) already
			// filters on, for the same reason (see item 106/107).
			ib_setup_list_date_filter(listview, "Lead", "creation");

			// Filter row order = column order. Live list columns are: Title
			// (now "Company Name"), Status, Assigned To (now "Handled By"),
			// Phone, Territory, ID. Filter row reads the same left-to-right:
			// Company Name → Status → Handled By → Territory → Last Activity
			// (date range). Phone/ID have no filter control by design. Anything
			// not a visible column (Temperature, Market Segment, Industry,
			// Source, Lead Team) trails after.
			ib_reorder_filter_row(listview, [
				$(".ib-lead-company-name-filter"),
				$(".ib-lead-status-multi-filter"),
				$(".ib-lead-lead-owner-filter"),
				$(".ib-lead-territory-filter"),
				$(".ib-lead-date-range-filter"),
				listview.page.fields_dict.custom_lead_temperature && listview.page.fields_dict.custom_lead_temperature.$wrapper,
				$(".ib-lead-market-segment-filter"),
				$(".ib-lead-industry-filter"),
				$(".ib-lead-source-filter"),
				$(".ib-lead-team-filter"),
			]);

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

			$pill.attr("class", `indicator-pill ${color} filterable no-indicator-dot ellipsis`);
			const $inner = $pill.find(".ellipsis");
			($inner.length ? $inner : $pill).text(__(label));

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

function ib_setup_lead_team_filter(listview) {
	// Strategy: inject filter into get_args (query level) rather than filter_area.
	// Avoids "Field not permitted in query" (page.add_field registers fieldname in URL)
	// and avoids filter_area.add/remove quirks.
	$(".ib-lead-team-filter").remove();

	// Holds the resolved user list; null = no team filter active
	let _team_users = null;

	// Patch get_args once — appends lead_owner IN filter when a team is selected
	const _orig_get_args = listview.get_args.bind(listview);
	listview.get_args = function () {
		const args = _orig_get_args();
		if (_team_users && _team_users.length) {
			args.filters = (args.filters || []).concat(
				[["Lead", "lead_owner", "in", _team_users]]
			);
		}
		return args;
	};

	const $wrapper = $(
		'<div class="form-group frappe-control input-max-width ib-lead-team-filter"></div>'
	);
	$wrapper.css({ flex: "0 0 140px", maxWidth: "140px" });
	_ib_chain_anchor(listview, $wrapper);

	const control = frappe.ui.form.make_control({
		df: {
			label:       "",
			fieldtype:   "Link",
			options:     "Lead Sales Team",
			placeholder: __("Lead Team"),
			input_class: "input-xs",
		},
		parent:       $wrapper,
		only_input:   true,
		render_input: 1,
	});
	control.$wrapper.removeClass("form-group");
	control.$wrapper.css("margin-bottom", 0);

	function apply() {
		const team = control.get_value();
		if (!team) {
			_team_users = null;
			listview.refresh();
			return;
		}
		frappe.call({
			method: "instabiz.overrides.lead.get_team_member_users",
			args:   { team },
			callback(r) {
				_team_users = r.message || [];
				listview.refresh();
			},
		});
	}

	// awesomplete-selectcomplete fires when user picks from Link autocomplete
	control.$input.on("awesomplete-selectcomplete", function () {
		setTimeout(apply, 50);
	});
	// Handle manual clear (user backspaces / clears input)
	control.$input.on("change", function () {
		if (!control.$input.val()) apply();
	});

	// Clear when filter area × is clicked
	const $clearAllBtn = listview.filter_area && listview.filter_area.filter_x_button;
	if ($clearAllBtn && $clearAllBtn.length) {
		$clearAllBtn.off("click.ib_lead_team_clear").on("click.ib_lead_team_clear", function () {
			_team_users = null;
			control.set_value("");
		});
	}
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
	_ib_chain_anchor(listview, $wrapper, existingField && existingField.$wrapper);
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
 