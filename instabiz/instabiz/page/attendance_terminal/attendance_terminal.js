// ── Constants ──────────────────────────────────────────────────────────────────
const API = {
	get_employees:      "instabiz.overrides.attendance_terminal.get_employees_with_status",
	create_checkin:     "instabiz.overrides.attendance_terminal.create_checkin",
	mark_absent:        "instabiz.overrides.attendance_terminal.mark_absent",
	get_terminal_ctx:   "instabiz.overrides.attendance_terminal.get_terminal_context",
};

const STATUS = {
	IN:   { label: "In",              color: "green" },
	OUT:  { label: "Out",             color: "blue"  },
	DONE: { label: "Done",            color: "green" },
	NONE: { label: "Not Checked In",  color: "gray"  },
};

const TZ = "Asia/Kolkata";

// ── Templates ──────────────────────────────────────────────────────────────────
const ROW_TEMPLATE = `
<tr class="at-row" data-employee="{%= emp.name %}">
	<td class="at-col-check">
		<input type="checkbox" class="at-row-check" data-name="{%= emp.name %}">
	</td>
	<td class="at-col-emp">
		<div class="at-emp-name">{%= frappe.utils.escape_html(emp.employee_name) %}</div>
		<div class="at-emp-id">{%= frappe.utils.escape_html(emp.name) %}</div>
		<div class="at-emp-meta-mobile">
			{%= frappe.utils.escape_html([emp.department, emp.designation].filter(Boolean).join(" · ")) %}
		</div>
	</td>
	<td class="at-col-dept">{%= frappe.utils.escape_html(emp.department || "·") %}</td>
	<td class="at-col-role">{%= frappe.utils.escape_html(emp.designation || "·") %}</td>
	<td class="at-col-stat">
		<span class="indicator-pill {%= status.color %}">{%= __(status.label) %}</span>
	</td>
	<td class="at-col-time">{%= last_in %}</td>
	<td class="at-col-actions">
		<div class="at-actions">
			<button class="at-btn at-btn-in"     title="${__("Check In")}"    {%= (is_in || is_done) ? "disabled" : "" %}>
				<iconify-icon icon="mdi:login-variant"  width="16"></iconify-icon>
			</button>
			<button class="at-btn at-btn-out"    title="${__("Check Out")}"   {%= !is_in ? "disabled" : "" %}>
				<iconify-icon icon="mdi:logout-variant" width="16"></iconify-icon>
			</button>
			<button class="at-btn at-btn-absent" title="${__("Mark Absent")}" {%= is_done ? "disabled" : "" %}>
				<iconify-icon icon="mdi:close"          width="16"></iconify-icon>
			</button>
		</div>
	</td>
</tr>`;

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmt_datetime(str) {
	if (!str) return "·";
	const d    = new Date(str);
	const date = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: TZ });
	const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ });
	return `<span class="at-time-date">${date}</span><br>${time}`;
}

function make_row(emp) {
	const is_in   = emp.last_log_type === "IN";
	const is_done = emp.last_log_type === "OUT" || emp.last_log_type === "DONE";
	const status  = STATUS[emp.last_log_type] || STATUS.NONE;

	return frappe.render(ROW_TEMPLATE, {
		emp, status, is_in, is_done,
		last_in: fmt_datetime(emp.last_checkin_time),
	});
}

// ── Page entry point ───────────────────────────────────────────────────────────
frappe.pages["attendance-terminal"].on_page_load = function (wrapper) {
	const page  = frappe.ui.make_app_page({ parent: wrapper, title: __("Attendance Terminal"), single_column: true });
	const state = { all_data: [], total: 0, privileged: false };

	page.$title_area.find(".flex").first().append(
		`<input type="date" class="form-control at-date" value="${frappe.datetime.get_today()}">`
	);

	const $wrap = build_markup(page, state);

	setup_events($wrap, state, page);
	setup_actions(page, state, $wrap);

	page.add_inner_button(__("Refresh"), () => load(state, $wrap, page));

	frappe.call({
		method: API.get_terminal_ctx,
		callback: ({ message: ctx }) => {
			state.privileged = !!(ctx && ctx.privileged);
			if (!state.privileged) {
				// Lock category based on user's own department (office or factory)
				const cat = (ctx && ctx.category) || "office";
				$wrap.find(".at-category-wrap").hide();
				$wrap.find(`.at-category[value='${cat}']`).prop("checked", true);
				// Non-privileged users always see today only — lock the date picker
				page.$title_area.find(".at-date").prop("readonly", true).css("pointer-events", "none");
			}
			load(state, $wrap, page, false);
		},
	});

	frappe.realtime.doctype_subscribe("Employee Checkin");
	const _checkin_handler = (data) => {
		if (data.doctype === "Employee Checkin") load(state, $wrap, page);
	};
	frappe.realtime.on("list_update", _checkin_handler);

	frappe.pages["attendance-terminal"].on_page_hide = function () {
		frappe.realtime.off("list_update", _checkin_handler);
	};
};

// ── Markup (built once) ────────────────────────────────────────────────────────
function build_markup(page, state) {
	return $(`
		<div class="at-wrap">
			<div class="at-card">

				<div class="at-filter-bar">
					<input type="text"   class="form-control at-search" placeholder="${__("Search employee…")}">
					<input type="text"   class="form-control at-dept"   placeholder="${__("Department")}">
					<select class="form-control at-status">
						<option value="">${__("All Status")}</option>
						<option value="In">${__("In")}</option>
						<option value="Out">${__("Out")}</option>
						<option value="Absent">${__("Not Checked In")}</option>
					</select>
					<div class="at-category-wrap btn-group">
						<label class="btn btn-default btn-sm at-cat-label">
							<input type="radio" class="at-category" name="at-category" value="" checked> ${__("All")}
						</label>
						<label class="btn btn-default btn-sm at-cat-label">
							<input type="radio" class="at-category" name="at-category" value="office"> ${__("Office")}
						</label>
						<label class="btn btn-default btn-sm at-cat-label">
							<input type="radio" class="at-category" name="at-category" value="factory"> ${__("Factory")}
						</label>
					</div>
				</div>

				<div class="at-table-scroll">
					<table class="at-table">
						<thead>
							<tr id="at-hdr-normal" class="at-hdr">
								<th class="at-col-check"><input type="checkbox" class="list-check-all"></th>
								<th class="at-th">${__("Employee")}</th>
								<th class="at-th at-col-desktop">${__("Department")}</th>
								<th class="at-th at-col-desktop">${__("Role")}</th>
								<th class="at-th">${__("Status")}</th>
								<th class="at-th">${__("Last In")}</th>
								<th class="at-th at-th-right"><span class="at-hdr-count"></span></th>
							</tr>
							<tr id="at-hdr-sel" class="at-hdr" style="display:none;">
								<th class="at-col-check"><input type="checkbox" class="list-check-all"></th>
								<th colspan="6" class="list-header-meta at-th"></th>
							</tr>
						</thead>
						<tbody class="at-rows"></tbody>
					</table>
				</div>
			</div>

			<div class="at-footer">
				<span class="at-page-info"></span>
			</div>
		</div>
	`).appendTo(page.main);
}

// ── Load & render ──────────────────────────────────────────────────────────────
function load(state, $wrap, page) {
	state.all_data = [];
	$wrap.find(".at-rows").html(
		`<tr><td colspan="7" class="at-loading">${__("Loading…")}</td></tr>`
	);
	page.hide_actions_menu();

	const args = {
		limit:             9999,
		offset:            0,
		date:              $wrap.closest("[data-page-route]").find(".at-date").val() || frappe.datetime.get_today(),
		search:            $wrap.find(".at-search").val().trim()             || null,
		department:        $wrap.find(".at-dept").val().trim()               || null,
		status:            $wrap.find(".at-status").val()                    || null,
		employee_category: $wrap.find(".at-category:checked").val()         || null,
	};

	frappe.call({
		method: API.get_employees,
		args,
		callback: ({ message: res = { data: [], total: 0 } }) => {
			state.total    = res.total;
			state.all_data = res.data;
			render(state, $wrap, res.data, page);
		},
	});
}

function render(state, $wrap, new_data, page) {
	const $rows = $wrap.find(".at-rows");
	$rows.empty();
	$wrap.find(".list-check-all").prop("checked", false);
	$wrap.find("#at-hdr-normal").show();
	$wrap.find("#at-hdr-sel").hide();

	update_count(state, $wrap);

	if (!state.total) {
		$rows.html(`<tr><td colspan="7" class="at-loading">${__("No employees found.")}</td></tr>`);
		return;
	}

	new_data.forEach(emp => {
		const $row = $(make_row(emp)).appendTo($rows);
		bind_row($row, emp, state, $wrap, page);
	});
}

// ── Row bindings ───────────────────────────────────────────────────────────────
function bind_row($row, emp, state, $wrap, page) {
	$row.find(".at-btn-in").on("click",     () => do_checkin(emp, "IN",  $row, state, $wrap));
	$row.find(".at-btn-out").on("click",    () => do_checkin(emp, "OUT", $row, state, $wrap));
	$row.find(".at-btn-absent").on("click", () => do_mark_absent(emp, $row, state, $wrap, page));
}

const LATE_GRACE_SECONDS = 10 * 60; // 10-minute grace window

function _seconds_since_midnight() {
	const now = new Date();
	return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
}

function _is_late_in(emp) {
	if (emp.shift_start_seconds == null) return false;
	return _seconds_since_midnight() > emp.shift_start_seconds + LATE_GRACE_SECONDS;
}

function _is_early_out(emp) {
	if (emp.shift_end_seconds == null) return false;
	return _seconds_since_midnight() < emp.shift_end_seconds - LATE_GRACE_SECONDS;
}

function _is_today($wrap) {
	const selected = $wrap.closest("[data-page-route]").find(".at-date").val();
	return !selected || selected === frappe.datetime.get_today();
}

function show_reason_dialog(title, default_preset, callback) {
	const presets    = ["", __("Came Late"), __("Left Early"), __("Traffic Delay"), __("Personal Emergency"), __("Other")];
	const has_preset = !!default_preset;
	const d = new frappe.ui.Dialog({
		title,
		fields: [
			{
				fieldname: "reason_preset",
				fieldtype: "Select",
				label:     __("Reason (optional)"),
				options:   presets.join("\n"),
				default:   default_preset,
			},
			{
				fieldname: "custom_reason",
				fieldtype: "Small Text",
				label:     __("Details"),
				depends_on: "eval:doc.reason_preset === '" + __("Other") + "'",
			},
		],
		primary_action_label: __("Confirm"),
		primary_action(values) {
			let reason = null;
			if (values.reason_preset === __("Other")) {
				reason = values.custom_reason || __("Other");
			} else if (values.reason_preset) {
				reason = values.reason_preset;
			}
			d.hide();
			callback(reason);
		},
	});
	d.show();
}

function _execute_checkin(emp, log_type, late_reason, $row) {
	$row.find(".at-btn").prop("disabled", true);
	frappe.call({
		method: API.create_checkin,
		args:   { employee: emp.name, log_type, late_reason: late_reason || null },
		callback: ({ exc }) => {
			if (exc) { restore_buttons(emp, $row); return; }
			emp.last_log_type = log_type;
			$row.find(".at-col-time").html(fmt_datetime(frappe.datetime.now_datetime()));
			update_row_ui($row, log_type);
			frappe.show_alert({
				message:   log_type === "IN"
					? __("{0} checked in", [emp.employee_name])
					: __("{0} checked out", [emp.employee_name]),
				indicator: "green",
			});
		},
	});
}

function do_checkin(emp, log_type, $row, state, $wrap) {
	const today_mode = _is_today($wrap);
	const is_late    = today_mode && log_type === "IN"  && _is_late_in(emp);
	const is_early   = today_mode && log_type === "OUT" && _is_early_out(emp);

	if (is_late) {
		show_reason_dialog(
			__("Late Arrival — {0}", [emp.employee_name]),
			__("Came Late"),
			reason => _execute_checkin(emp, log_type, reason, $row)
		);
	} else if (is_early) {
		show_reason_dialog(
			__("Early Departure — {0}", [emp.employee_name]),
			__("Left Early"),
			reason => _execute_checkin(emp, log_type, reason, $row)
		);
	} else {
		_execute_checkin(emp, log_type, null, $row);
	}
}

function do_mark_absent(emp, $row, state, $wrap, page) {
	frappe.confirm(__("Mark {0} as Absent for today?", [emp.employee_name]), () => {
		$row.find(".at-btn").prop("disabled", true);
		frappe.call({
			method: API.mark_absent,
			args:   { employee: emp.name },
			callback: ({ exc }) => {
				if (exc) { restore_buttons(emp, $row); return; }
				$row.fadeOut(200, function () { $(this).remove(); });
				state.total--;
				state.all_data = state.all_data.filter(e => e.name !== emp.name);
				update_count(state, $wrap);
				frappe.show_alert({ message: __("{0} marked Absent", [emp.employee_name]), indicator: "red" });
			},
		});
	});
}

// ── Actions ────────────────────────────────────────────────────────────────────
function setup_actions(page, state, $wrap) {
	page.add_action_item(__("Check In Selected"),    () => bulk_action("IN",     state, $wrap, page));
	page.add_action_item(__("Check Out Selected"),   () => bulk_action("OUT",    state, $wrap, page));
	page.add_action_item(__("Mark Absent Selected"), () => bulk_action("ABSENT", state, $wrap, page));
	page.hide_actions_menu();
}

function bulk_action(log_type, state, $wrap, page) {
	const names = $wrap.find(".at-row-check:checked").map(function () { return $(this).data("name"); }).get();
	if (!names.length) return;

	const label = { IN: __("Check In"), OUT: __("Check Out"), ABSENT: __("Mark Absent") }[log_type];
	frappe.confirm(__("{0} {1} employees?", [label, names.length]), () => {
		let pending = names.length;
		names.forEach(name => {
			const emp    = state.all_data.find(e => e.name === name);
			const method = log_type === "ABSENT" ? API.mark_absent : API.create_checkin;
			const args   = log_type === "ABSENT" ? { employee: name } : { employee: name, log_type };

			frappe.call({
				method, args,
				callback: ({ exc }) => {
					if (!exc) {
						const $row = $wrap.find(`tr[data-employee="${name}"]`);
						if (log_type === "ABSENT") {
							$row.fadeOut(200, function () { $(this).remove(); });
							state.total--;
							state.all_data = state.all_data.filter(e => e.name !== name);
						} else {
							emp.last_log_type = log_type;
							$row.find(".at-col-time").html(fmt_datetime(frappe.datetime.now_datetime()));
							update_row_ui($row, log_type);
						}
					}
					if (--pending === 0) {
						frappe.show_alert({ message: __("Done"), indicator: "green" });
						update_count(state, $wrap);
						refresh_selection($wrap, page);
					}
				},
			});
		});
	});
}

// ── Events ─────────────────────────────────────────────────────────────────────
function setup_events($wrap, state, page) {
	let search_t, dept_t;

	$wrap.find(".at-search").on("input", () => { clearTimeout(search_t); search_t = setTimeout(() => load(state, $wrap, page), 400); });
	$wrap.find(".at-dept").on("input",   () => { clearTimeout(dept_t);   dept_t   = setTimeout(() => load(state, $wrap, page), 500); });
	$wrap.find(".at-status").on("change", () => load(state, $wrap, page));
	$wrap.on("change", ".at-category", () => {
		$wrap.find(".at-cat-label").removeClass("btn-primary").addClass("btn-default");
		$wrap.find(".at-category:checked").closest(".at-cat-label").removeClass("btn-default").addClass("btn-primary");
		load(state, $wrap, page);
	});

	$(document).on("change", ".at-date", () => load(state, $wrap, page));

	$wrap.on("change", "input[type=checkbox]", function () {
		if ($(this).hasClass("list-check-all")) {
			const checked = $(this).prop("checked");
			$wrap.find(".at-row-check").prop("checked", checked);
			$wrap.find(".list-check-all").prop("checked", checked);
		}
		refresh_selection($wrap, page);
	});

}

// ── UI helpers ─────────────────────────────────────────────────────────────────
function update_row_ui($row, log_type) {
	const st   = STATUS[log_type] || STATUS.NONE;
	const done = log_type === "OUT" || log_type === "DONE";
	$row.find(".indicator-pill").attr("class", `indicator-pill ${st.color}`).text(__(st.label));
	$row.find(".at-btn-in").prop("disabled",     log_type === "IN" || done);
	$row.find(".at-btn-out").prop("disabled",    log_type !== "IN");
	$row.find(".at-btn-absent").prop("disabled", done);
}

function restore_buttons(emp, $row) {
	$row.find(".at-btn-in").prop("disabled",     emp.last_log_type === "IN" || emp.last_log_type === "DONE");
	$row.find(".at-btn-out").prop("disabled",    emp.last_log_type !== "IN");
	$row.find(".at-btn-absent").prop("disabled", emp.last_log_type === "DONE");
}

function update_count(state, $wrap) {
	const { total } = state;
	$wrap.find(".at-hdr-count").text(total ? `${total} employees` : "");
	$wrap.find(".at-page-info").text(total ? `${total} employee${total !== 1 ? "s" : ""}` : "");
}

function refresh_selection($wrap, page) {
	const count = $wrap.find(".at-row-check:checked").length;
	$wrap.find("#at-hdr-normal").toggle(count === 0);
	$wrap.find("#at-hdr-sel").toggle(count > 0);
	if (count > 0) {
		$wrap.find(".list-header-meta").text(__("{0} items selected", [count]));
		page.show_actions_menu();
		page.clear_primary_action();
	} else {
		page.hide_actions_menu();
	}
}
