// ── Constants ──────────────────────────────────────────────────────────────────
const API = {
	get_employees: "instabiz.overrides.attendance_terminal.get_employees_with_status",
	create_checkin: "instabiz.overrides.attendance_terminal.create_checkin",
	mark_absent:    "instabiz.overrides.attendance_terminal.mark_absent",
};

const STATUS = {
	IN:   { label: "In",     color: "green" },
	OUT:  { label: "Out",    color: "blue"  },
	DONE: { label: "Out",    color: "blue"  },
};

const TZ = "Asia/Kolkata";

// ── Templates ──────────────────────────────────────────────────────────────────
const ROW_TEMPLATE = `
<tr data-employee="{%= emp.name %}" style="border-bottom:1px solid var(--border-color,#d1d8dd);">
	<td style="padding:10px 12px;width:36px;">
		<input type="checkbox" class="at-row-check" data-name="{%= emp.name %}">
	</td>
	<td style="padding:10px 12px;">
		<div style="font-weight:600;">{%= frappe.utils.escape_html(emp.employee_name) %}</div>
		<div style="font-size:11px;color:#888;margin-top:2px;">{%= frappe.utils.escape_html(emp.name) %}</div>
	</td>
	<td class="at-c-dept" style="padding:10px 12px;font-size:12px;color:var(--text-muted,#8d99a6);">{%= frappe.utils.escape_html(emp.department || "·") %}</td>
	<td class="at-c-role" style="padding:10px 12px;font-size:12px;color:var(--text-muted,#8d99a6);">{%= frappe.utils.escape_html(emp.designation || "·") %}</td>
	<td class="at-c-stat" style="padding:10px 12px;">
		<span class="indicator-pill {%= status.color %}" style="font-size:11px;">{%= __(status.label) %}</span>
	</td>
	<td class="at-c-time" style="padding:10px 12px;font-size:12px;color:var(--text-muted,#8d99a6);line-height:1.6;">{%= last_in %}</td>
	<td style="padding:10px 12px;">
		<div style="display:flex;gap:6px;justify-content:flex-end;">
			<button class="at-btn at-btn-in"     title="Check In"    {%= (is_in || is_done) ? "disabled" : "" %}>
				<iconify-icon icon="mdi:login-variant"  width="14"></iconify-icon>
			</button>
			<button class="at-btn at-btn-out"    title="Check Out"   {%= !is_in ? "disabled" : "" %}>
				<iconify-icon icon="mdi:logout-variant" width="14"></iconify-icon>
			</button>
			<button class="at-btn at-btn-absent" title="Mark Absent" {%= is_done ? "disabled" : "" %}>
				<iconify-icon icon="mdi:close"          width="14"></iconify-icon>
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
	return `<span style="font-size:10px;color:#aaa;">${date}</span><br>${time}`;
}

function make_row(emp) {
	const is_in   = emp.last_log_type === "IN";
	const is_done = emp.last_log_type === "OUT" || emp.last_log_type === "DONE";
	const status  = STATUS[emp.last_log_type] || { label: "Absent", color: "red" };

	return frappe.render(ROW_TEMPLATE, {
		emp,
		status,
		is_in,
		is_done,
		last_in: fmt_datetime(emp.last_checkin_time),
	});
}

// ── Page entry point ───────────────────────────────────────────────────────────
frappe.pages["attendance-terminal"].on_page_load = function (wrapper) {
	const page  = frappe.ui.make_app_page({ parent: wrapper, title: __("Attendance Terminal"), single_column: true });
	const state = { all_data: [], total: 0, page_len: 20, offset: 0 };

	page.$title_area.find(".flex").first().append(`
		<input type="date" class="form-control at-date"
			style="height:26px;font-size:12px;width:140px;margin-left:10px;padding:2px 8px;"
			value="${frappe.datetime.get_today()}">`);

	const $wrap = build_markup(page, state);

	setup_events($wrap, state, page);
	setup_actions(page, state, $wrap);

	page.add_inner_button(__("Refresh"), () => load(state, $wrap, page, false));

	load(state, $wrap, page, false);

	frappe.realtime.doctype_subscribe("Employee Checkin");
	frappe.realtime.off("list_update");
	frappe.realtime.on("list_update", (data) => {
		if (data.doctype === "Employee Checkin") load(state, $wrap, page, false);
	});
};

// ── Markup (built once) ────────────────────────────────────────────────────────
function build_markup(page, state) {
	const paging_btns = [20, 100, 500, 2500].map(v =>
		`<button type="button" class="btn btn-default btn-sm btn-paging${v === state.page_len ? " btn-info" : ""}" data-value="${v}">${v}</button>`
	).join("");

	return $(`
		<div style="padding:12px 15px 20px;">
			<div style="border:1px solid var(--border-color,#d1d8dd);border-radius:var(--border-radius,6px);overflow:hidden;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,0.04);">

				<div style="display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border-color,#d1d8dd);background:var(--subtle-fg,#f8f9fa);flex-wrap:wrap;">
					<input type="text"   class="form-control at-search" placeholder="${__("Search employee…")}" style="height:28px;font-size:12px;width:200px;">
					<input type="text"   class="form-control at-dept"   placeholder="${__("Department")}"       style="height:28px;font-size:12px;width:160px;">
					<select class="form-control at-status" style="height:28px;font-size:12px;width:130px;">
						<option value="">${__("All Status")}</option>
						<option value="In">${__("In")}</option>
						<option value="Out">${__("Out")}</option>
						<option value="Absent">${__("Absent")}</option>
					</select>
				</div>

				<table style="width:100%;border-collapse:collapse;font-size:13px;">
					<thead>
						<tr id="at-hdr-normal" style="background:var(--subtle-fg,#f8f9fa);border-bottom:2px solid var(--border-color,#d1d8dd);">
							<th style="padding:10px 12px;width:36px;"><input type="checkbox" class="list-check-all"></th>
							<th style="padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:left;">${__("Employee")}</th>
							<th style="padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:left;">${__("Department")}</th>
							<th style="padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:left;">${__("Role")}</th>
							<th style="padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:left;">${__("Status")}</th>
							<th style="padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:left;">${__("Last In")}</th>
							<th style="padding:10px 12px;text-align:right;"><span class="at-hdr-count" style="font-size:12px;font-weight:400;color:var(--text-muted,#8d99a6);"></span></th>
						</tr>
						<tr id="at-hdr-sel" style="display:none;background:var(--subtle-fg,#f8f9fa);border-bottom:2px solid var(--border-color,#d1d8dd);">
							<th style="padding:10px 12px;width:36px;"><input type="checkbox" class="list-check-all"></th>
							<th colspan="6" class="list-header-meta" style="padding:10px 12px;font-size:12px;font-weight:400;color:var(--text-muted,#8d99a6);text-align:left;"></th>
						</tr>
					</thead>
					<tbody class="at-rows"></tbody>
				</table>
			</div>

			<div class="list-paging-area level" style="margin-top:10px;">
				<div class="level-left"><div class="btn-group">${paging_btns}</div></div>
				<div class="level-right" style="display:flex;align-items:center;gap:10px;">
					<span class="at-page-info" style="font-size:12px;color:var(--text-muted,#8d99a6);"></span>
					<button class="btn btn-default btn-sm btn-more" style="display:none;">${__("Load More")}</button>
				</div>
			</div>
		</div>
	`).appendTo(page.main);
}

// ── Load & render ──────────────────────────────────────────────────────────────
function load(state, $wrap, page, append) {
	if (!append) {
		state.all_data = [];
		state.offset   = 0;
		$wrap.find(".at-rows").html(
			`<tr><td colspan="7" style="text-align:center;color:var(--text-muted,#8d99a6);padding:30px 0;">${__("Loading…")}</td></tr>`
		);
		page.hide_actions_menu();
	}

	const args = {
		limit:      state.page_len,
		offset:     state.offset,
		date:       $wrap.closest("[data-page-route]").find(".at-date").val() || frappe.datetime.get_today(),
		search:     $wrap.find(".at-search").val().trim()     || null,
		department: $wrap.find(".at-dept").val().trim()       || null,
		status:     $wrap.find(".at-status").val()            || null,
	};

	frappe.call({
		method: API.get_employees,
		args,
		callback: ({ message: res = { data: [], total: 0 } }) => {
			state.total    = res.total;
			state.all_data = state.all_data.concat(res.data);
			render(state, $wrap, res.data, append, page);
		},
	});
}

function render(state, $wrap, new_data, append, page) {
	const $rows   = $wrap.find(".at-rows");
	const showing = state.all_data.length;

	if (!append) {
		$rows.empty();
		$wrap.find(".list-check-all").prop("checked", false);
		$wrap.find("#at-hdr-normal").show();
		$wrap.find("#at-hdr-sel").hide();
	}

	update_pagination(state, $wrap);

	if (!state.total) {
		$rows.html(`<tr><td colspan="7" style="text-align:center;color:var(--text-muted,#8d99a6);padding:50px 0;">${__("No employees found.")}</td></tr>`);
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

function do_checkin(emp, log_type, $row, state, $wrap) {
	$row.find(".at-btn").prop("disabled", true);
	frappe.call({
		method: API.create_checkin,
		args:   { employee: emp.name, log_type },
		callback: ({ exc }) => {
			if (exc) { restore_buttons(emp, $row); return; }
			emp.last_log_type = log_type;
			$row.find(".at-c-time").html(fmt_datetime(frappe.datetime.now_datetime()));
			update_row_ui($row, log_type);
			frappe.show_alert({
				message:   log_type === "IN" ? __("{0} checked in", [emp.employee_name]) : __("{0} checked out", [emp.employee_name]),
				indicator: "green",
			});
		},
	});
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
				update_pagination(state, $wrap);
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
							$row.find(".at-c-time").html(fmt_datetime(frappe.datetime.now_datetime()));
							update_row_ui($row, log_type);
						}
					}
					if (--pending === 0) {
						frappe.show_alert({ message: __("Done"), indicator: "green" });
						update_pagination(state, $wrap);
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

	$wrap.find(".at-search").on("input", () => { clearTimeout(search_t); search_t = setTimeout(() => load(state, $wrap, page, false), 400); });
	$wrap.find(".at-dept").on("input",   () => { clearTimeout(dept_t);   dept_t   = setTimeout(() => load(state, $wrap, page, false), 500); });
	$wrap.find(".at-status").on("change", () => load(state, $wrap, page, false));

	// Date in title area — need to watch via document since it's outside $wrap
	$(document).on("change", ".at-date", () => load(state, $wrap, page, false));

	$wrap.on("change", "input[type=checkbox]", function () {
		if ($(this).hasClass("list-check-all")) {
			const checked = $(this).prop("checked");
			$wrap.find(".at-row-check").prop("checked", checked);
			$wrap.find(".list-check-all").prop("checked", checked);
		}
		refresh_selection($wrap, page);
	});

	$wrap.on("click", ".btn-paging", function () {
		const len = parseInt($(this).data("value"));
		if (len === state.page_len) return;
		state.page_len = len;
		$wrap.find(".btn-paging").removeClass("btn-info");
		$(this).addClass("btn-info");
		load(state, $wrap, page, false);
	});

	$wrap.on("click", ".btn-more", () => {
		state.offset += state.page_len;
		load(state, $wrap, page, true);
	});
}

// ── UI helpers ─────────────────────────────────────────────────────────────────
function update_row_ui($row, log_type) {
	const st   = STATUS[log_type] || { label: "Absent", color: "red" };
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

function update_pagination(state, $wrap) {
	const { total, all_data } = state;
	const showing = all_data.length;
	$wrap.find(".at-hdr-count").text(total ? `${total} employees` : "");
	$wrap.find(".at-page-info").text(total ? `${total} employee${total !== 1 ? "s" : ""} · showing ${showing}` : "");
	$wrap.find(".btn-more").toggle(showing < total);
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
