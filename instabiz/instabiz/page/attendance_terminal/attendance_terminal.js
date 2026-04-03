// ── Constants ──────────────────────────────────────────────────────────────────
const API = {
	get_employees: "instabiz.overrides.checkin.get_employees_with_status",
	create_checkin: "instabiz.overrides.checkin.create_checkin",
	mark_absent: "instabiz.overrides.checkin.mark_absent",
};

const STATUS = {
	IN:     { label: "In",     color: "green"  },
	OUT:    { label: "Out",    color: "orange" },
	ABSENT: { label: "Absent", color: "gray"   },
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmt_time(datetime_str) {
	return moment(datetime_str).format("h:mm A");
}

// ── Page entry point ───────────────────────────────────────────────────────────
frappe.pages["attendance-terminal"].on_page_load = function (wrapper) {
	const page  = frappe.ui.make_app_page({ parent: wrapper, title: __("Attendance Terminal"), single_column: true });
	const state = { all: [], filtered: [], page_len: 20 };

	const $wrap = build_markup(page);
	setup_actions(page, state, $wrap);
	setup_events($wrap, state, page);

	load(state, $wrap, page);
};

// ── Markup ─────────────────────────────────────────────────────────────────────
function build_markup(page) {
	return $(`
		<div class="at-wrap">
			<div class="at-table">
				<div class="at-header-row" id="at-hdr-normal">
					<span class="at-c-chk"><input type="checkbox" class="list-check-all" title="${__("Select All")}"></span>
					<span class="at-c-name">${__("Employee")}</span>
					<span class="at-c-dept">${__("Department")}</span>
					<span class="at-c-role">${__("Role")}</span>
					<span class="at-c-stat">${__("Status")}</span>
					<span class="at-c-time">${__("Last In")}</span>
					<span class="at-c-act" style="justify-content:flex-end;">
						<span class="at-hdr-count"></span>
					</span>
				</div>
				<div class="at-header-row" id="at-hdr-sel" style="display:none;">
					<span class="at-c-chk"><input type="checkbox" class="list-check-all" title="${__("Select All")}"></span>
					<span class="at-hdr-sel-text list-header-meta" style="flex:1;"></span>
				</div>
				<div class="at-rows"></div>
			</div>
			<div class="at-footer">
				<span class="at-len active" data-len="20">20</span>
				<span class="at-len" data-len="100">100</span>
				<span class="at-len" data-len="500">500</span>
				<span class="at-len" data-len="2500">2500</span>
			</div>
		</div>
	`).appendTo(page.main);
}

// ── Actions menu ───────────────────────────────────────────────────────────────
function setup_actions(page, state, $wrap) {
	page.add_action_item(__("Check In Selected"),    () => bulk_action("IN",     state, $wrap, page));
	page.add_action_item(__("Check Out Selected"),   () => bulk_action("OUT",    state, $wrap, page));
	page.add_action_item(__("Mark Absent Selected"), () => bulk_action("ABSENT", state, $wrap, page));
	page.hide_actions_menu();
	page.add_inner_button(__("Refresh"), () => load(state, $wrap, page));
}

// ── Events ─────────────────────────────────────────────────────────────────────
function setup_events($wrap, state, page) {
	$wrap.on("change", "input[type=checkbox]", function () {
		if ($(this).hasClass("list-check-all")) {
			const checked = $(this).prop("checked");
			$wrap.find(".at-row-check").prop("checked", checked);
			$wrap.find(".list-check-all").prop("checked", checked);
		}
		refresh_selection($wrap, page);
	});

	$wrap.on("click", ".at-len", function () {
		state.page_len = parseInt($(this).data("len"));
		$wrap.find(".at-len").removeClass("active");
		$(this).addClass("active");
		render(state, $wrap);
	});
}

// ── Data ───────────────────────────────────────────────────────────────────────
function load(state, $wrap, page) {
	$wrap.find(".at-rows").html(`<div class="at-empty">${__("Loading…")}</div>`);
	$wrap.find(".at-hdr-count").text("");
	page.hide_actions_menu();

	frappe.call({
		method: API.get_employees,
		callback: (r) => {
			state.all      = r.message || [];
			state.filtered = [...state.all];
			render(state, $wrap);
		},
	});
}

// ── Render ─────────────────────────────────────────────────────────────────────
function render(state, $wrap) {
	const $rows   = $wrap.find(".at-rows").empty();
	const total   = state.filtered.length;
	const visible = state.filtered.slice(0, state.page_len);

	$wrap.find(".at-hdr-count").text(__("{0} of {1}", [Math.min(state.page_len, total), total]));
	$wrap.find(".list-check-all").prop("checked", false);
	$wrap.find("#at-hdr-normal").show();
	$wrap.find("#at-hdr-sel").hide();

	if (!total) {
		$rows.html(`<div class="at-empty">${__("All employees have completed attendance for today.")}</div>`);
		return;
	}

	visible.forEach(emp => $rows.append(make_row(emp, state, $wrap)));
}

function make_row(emp, state, $wrap) {
	const is_in = emp.last_log_type === "IN";
	const done  = emp.last_log_type === "OUT" || emp.last_log_type === "DONE";
	const st    = STATUS[emp.last_log_type] || STATUS.ABSENT;
	const time  = emp.last_checkin_time ? fmt_time(emp.last_checkin_time) : "—";

	const $row = $(`
		<div class="at-row" data-employee="${emp.name}">
			<span class="at-c-chk">
				<input type="checkbox" class="at-row-check" data-name="${emp.name}">
			</span>
			<span class="at-c-name">
				<div class="emp-name">${emp.employee_name}</div>
				<div class="emp-id">${emp.name}</div>
			</span>
			<span class="at-c-dept">${emp.department  || "—"}</span>
			<span class="at-c-role">${emp.designation || "—"}</span>
			<span class="at-c-stat">
				<span class="indicator-pill ${st.color}">${__(st.label)}</span>
			</span>
			<span class="at-c-time">${time}</span>
			<span class="at-c-act">
				<button class="at-btn at-btn-in"     title="${__("Check In")}"    ${(is_in || done) ? "disabled" : ""}>&#8594;</button>
				<button class="at-btn at-btn-out"    title="${__("Check Out")}"   ${!is_in ? "disabled" : ""}>&#8592;</button>
				<button class="at-btn at-btn-absent" title="${__("Mark Absent")}" ${done ? "disabled" : ""}>&#10005;</button>
			</span>
		</div>
	`);

	$row.find(".at-btn-in").on("click",     () => do_checkin(emp, "IN",  $row, state, $wrap));
	$row.find(".at-btn-out").on("click",    () => do_checkin(emp, "OUT", $row, state, $wrap));
	$row.find(".at-btn-absent").on("click", () => do_mark_absent(emp, $row, state, $wrap));

	return $row;
}

// ── Single checkin ─────────────────────────────────────────────────────────────
function do_checkin(emp, log_type, $row, state, $wrap) {
	$row.find(".at-btn").prop("disabled", true);

	frappe.call({
		method: API.create_checkin,
		args: { employee: emp.name, log_type },
		callback: (r) => {
			if (r.exc) { restore_row_state(emp, $row); return; }

			emp.last_log_type = log_type;
			$row.find(".at-c-time").text(fmt_time(frappe.datetime.now_datetime()));
			update_row_state($row, log_type);

			frappe.show_alert({
				message: log_type === "IN"
					? __("{0} checked in", [emp.employee_name])
					: __("{0} checked out", [emp.employee_name]),
				indicator: "green",
			});
		},
	});
}

// ── Mark absent ────────────────────────────────────────────────────────────────
function do_mark_absent(emp, $row, state, $wrap) {
	frappe.confirm(__("Mark {0} as Absent for today?", [emp.employee_name]), () => {
		$row.find(".at-btn").prop("disabled", true);

		frappe.call({
			method: API.mark_absent,
			args: { employee: emp.name },
			callback: (r) => {
				if (r.exc) { restore_row_state(emp, $row); return; }
				remove_row(emp.name, state, $wrap, $row);
				frappe.show_alert({ message: __("{0} marked Absent", [emp.employee_name]), indicator: "red" });
			},
		});
	});
}

// ── Bulk action ────────────────────────────────────────────────────────────────
function bulk_action(log_type, state, $wrap, page) {
	const names = $wrap.find(".at-row-check:checked").map(function () { return $(this).data("name"); }).get();
	if (!names.length) return;

	const label = { IN: __("Check In"), OUT: __("Check Out"), ABSENT: __("Mark Absent") }[log_type];
	frappe.confirm(__("{0} {1} employees?", [label, names.length]), () => {
		let pending = names.length;

		names.forEach(name => {
			const emp    = state.all.find(e => e.name === name);
			const method = log_type === "ABSENT" ? API.mark_absent : API.create_checkin;
			const args   = log_type === "ABSENT" ? { employee: name } : { employee: name, log_type };

			frappe.call({
				method, args,
				callback: (r) => {
					if (!r.exc) {
						const $row = $wrap.find(`.at-row[data-employee="${name}"]`);
						if (log_type === "ABSENT") {
							remove_row(name, state, $wrap, $row);
						} else {
							emp.last_log_type = log_type;
							$row.find(".at-c-time").text(fmt_time(frappe.datetime.now_datetime()));
							update_row_state($row, log_type);
						}
					}
					if (--pending === 0) {
						frappe.show_alert({ message: __("Done"), indicator: "green" });
						refresh_selection($wrap, page);
					}
				},
			});
		});
	});
}

// ── Row helpers ────────────────────────────────────────────────────────────────
function remove_row(name, state, $wrap, $row) {
	state.all      = state.all.filter(e => e.name !== name);
	state.filtered = state.filtered.filter(e => e.name !== name);
	$row.fadeOut(200, function () {
		$(this).remove();
		const total = state.filtered.length;
		$wrap.find(".at-hdr-count").text(__("{0} of {1}", [Math.min(state.page_len, total), total]));
	});
}

function update_row_state($row, log_type) {
	const st   = STATUS[log_type] || STATUS.ABSENT;
	const done = log_type === "OUT" || log_type === "DONE";
	$row.find(".indicator-pill").removeClass("green orange gray").addClass(st.color).text(__(st.label));
	$row.find(".at-btn-in").prop("disabled", log_type === "IN" || done);
	$row.find(".at-btn-out").prop("disabled", log_type !== "IN");
	$row.find(".at-btn-absent").prop("disabled", done);
}

function restore_row_state(emp, $row) {
	$row.find(".at-btn-in").prop("disabled", emp.last_log_type === "IN");
	$row.find(".at-btn-out").prop("disabled", emp.last_log_type !== "IN");
	$row.find(".at-btn-absent").prop("disabled", false);
}

// ── Selection ──────────────────────────────────────────────────────────────────
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
