/**
 * Employee Checkin — consolidated daily attendance list view.
 * One row per employee showing IN/OUT/work-hours for a selected date.
 */

(function () {
    const API = "instabiz.overrides.checkin.get_daily_attendance";
    const TZ  = "Asia/Kolkata";

    /* ── helpers ──────────────────────────────────────────────────────────── */

    function fmt_time(str) {
        if (!str || str === "—") return "—";
        try {
            return new Date(str).toLocaleTimeString("en-IN", {
                hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ,
            });
        } catch (e) { return "—"; }
    }

    function fmt_datetime(str) {
        if (!str || str === "—") return "—";
        try {
            const d    = new Date(str);
            const date = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: TZ });
            const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ });
            return `${date}, ${time}`;
        } catch (e) { return "—"; }
    }

    function pill(color, label) {
        if (!label || label === "—") return `<span style="color:#bbb;margin-left:5px;">—</span>`;
        const hex = { blue: "#1572b2", green: "#28a745", orange: "#ff851b", red: "#e74c3c", gray: "#6c757d" }[color] || "#6c757d";
        return `<div style="display:inline-flex;align-items:center;background:${hex}15;color:${hex};border:1px solid ${hex}30;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;white-space:nowrap;line-height:1.5;">${label}</div>`;
    }

    /* ── summary cards ────────────────────────────────────────────────────── */

    function render_cards($cards_wrap, summary, s) {
        const cards = [
            { id: null,       label: "Total",     value: summary.present + summary.absent, accent: false },
            { id: "Present",  label: "Present",   value: summary.present,  color: "#28a745" },
            { id: "Absent",   label: "Absent",    value: summary.absent,   color: "#e74c3c" },
            { id: "IN",       label: "Still In",  value: summary.still_in, color: "#1572b2" },
        ];

        $cards_wrap.html(cards.map(c => {
            const active = s.status_filter === c.id;
            const clr    = c.color || "var(--text-color)";
            return `
            <div class="eck-card${active ? " eck-card--active" : ""}" data-status="${c.id || ""}"
                style="cursor:${c.id ? "pointer" : "default"};">
                <div class="eck-card-value" style="color:${clr};">${c.value}</div>
                <div class="eck-card-label">${c.label}</div>
            </div>`;
        }).join(""));

        $cards_wrap.find(".eck-card[data-status]").on("click", function () {
            const id = $(this).data("status") || null;
            if (!id) return;
            s.status_filter = (s.status_filter === id) ? null : id;
            $cards_wrap.find(".eck-card").removeClass("eck-card--active");
            if (s.status_filter) $cards_wrap.find(`.eck-card[data-status="${s.status_filter}"]`).addClass("eck-card--active");
            apply_filter(s);
        });
    }

    /* ── filter + render table ────────────────────────────────────────────── */

    function apply_filter(s) {
        let rows = s.all_rows_data || [];
        const absent_statuses = ["Absent"];
        if (s.status_filter === "Present")  rows = rows.filter(r => !absent_statuses.includes(r.status));
        if (s.status_filter === "Absent")   rows = rows.filter(r => absent_statuses.includes(r.status));
        if (s.status_filter === "IN")       rows = rows.filter(r => r.status === "IN");
        render_table(s.$table_wrap, rows, s.all_rows_data.length);
    }

    /* ── data load ────────────────────────────────────────────────────────── */

    function load(listview) {
        const s = listview._eck;
        if (!s) return;

        s.$table_wrap.html(`<div style="padding:30px 0;text-align:center;color:#aaa;">Loading…</div>`);

        frappe.call({
            method: API,
            args: { date: s.date, department: s.dept, search: s.search, limit: 9999, offset: 0 },
            callback: function (r) {
                if (!r || !r.message) return;
                const { data, total, summary } = r.message;
                s.all_rows_data = data;
                s.status_filter = null;
                render_cards(s.$cards_wrap, summary, s);
                apply_filter(s);
            },
        });
    }

    /* ── table render ─────────────────────────────────────────────────────── */

    function render_table($wrap, data, total) {
        const rows = data.map(emp => `
            <tr style="border-bottom:1px solid var(--border-color);vertical-align:middle;">
                <td style="padding:10px 12px;">
                    <div style="font-weight:600;">${frappe.utils.escape_html(emp.employee_name)}</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;">${frappe.utils.escape_html(emp.employee)}</div>
                </td>
                <td style="padding:10px 12px;font-size:12px;">${frappe.utils.escape_html(emp.department || "—")}</td>
                <td style="padding:10px 12px;font-size:12px;">${frappe.utils.escape_html(emp.designation || "—")}</td>
                <td style="padding:10px 12px;">
                    ${pill({ IN: "blue", OUT: "gray", Present: "green", "Half Day": "orange", Absent: "red" }[emp.status] || "gray", emp.status)}
                </td>
                <td style="padding:10px 12px;">${pill("blue",  fmt_time(emp.in_time))}</td>
                <td style="padding:10px 12px;">${pill("gray",  fmt_time(emp.out_time))}</td>
                <td style="padding:10px 12px;">${pill(emp.work_hours ? "green" : "gray", emp.work_hours || "—")}</td>
                <td style="padding:10px 12px;min-width:150px;">${pill("gray", fmt_datetime(emp.last_in))}</td>
            </tr>`).join("");

        const tbody = rows || `<tr><td colspan="8" style="text-align:center;color:#aaa;padding:50px 0;">No records found</td></tr>`;

        $wrap.html(`
            <div style="border:1px solid var(--border-color);border-radius:var(--border-radius);overflow:hidden;background:#fff;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead>
                        <tr style="background:var(--subtle-fg);border-bottom:2px solid var(--border-color);">
                            <th class="eck-th">Employee</th>
                            <th class="eck-th">Department</th>
                            <th class="eck-th">Role</th>
                            <th class="eck-th">Status</th>
                            <th class="eck-th">In</th>
                            <th class="eck-th">Out</th>
                            <th class="eck-th">Work Hours</th>
                            <th class="eck-th">Last In</th>
                        </tr>
                    </thead>
                    <tbody>${tbody}</tbody>
                </table>
            </div>
            <div style="margin-top:8px;font-size:12px;color:var(--text-muted);text-align:right;">
                ${data.length} of ${total} employee${total !== 1 ? "s" : ""}
            </div>`);
    }

    /* ── listview hook ────────────────────────────────────────────────────── */

    frappe.listview_settings["Employee Checkin"] = {
        onload: function (listview) {
            listview._eck = {
                date:          frappe.datetime.get_today(),
                dept:          "",
                search:        "",
                status_filter: null,
                all_rows_data: [],
                $cards_wrap:   null,
                $table_wrap:   null,
            };

            listview.page.main.find(".standard-filter-section").hide();

            listview.set_primary_action = function () {
                listview.page.set_primary_action(
                    `<iconify-icon icon="mdi:refresh" width="14" style="vertical-align:-2px;margin-right:4px;"></iconify-icon>${__("Refresh")}`,
                    function () { load(listview); }
                );
            };
            listview.set_primary_action();

            ib_hide_sidebar();
        },

        refresh: function (listview) {
            listview.page.main.find(".standard-filter-section").hide();

            if (!listview._eck.$table_wrap) {
                const s   = listview._eck;
                const $fl = listview.page.main.find(".frappe-list");

                // Summary cards
                s.$cards_wrap = $(`<div class="eck-cards"></div>`);

                // Filters  (date picker lives here — not in title area which is non-interactive)
                const $sub = $(`
                    <div style="display:flex;gap:8px;padding:10px 15px 12px;flex-wrap:wrap;align-items:center;">
                        <input type="date" class="form-control eck-date"
                            style="height:28px;font-size:12px;width:150px;padding:2px 8px;"
                            value="${s.date}">
                        <input type="text" class="form-control eck-dept"
                            style="height:28px;font-size:12px;width:180px;"
                            placeholder="Department">
                        <input type="text" class="form-control eck-search"
                            style="height:28px;font-size:12px;width:200px;"
                            placeholder="Search employee…">
                    </div>`);

                let dept_t, search_t;
                $sub.find(".eck-date").on("change", function () {
                    s.date = $(this).val() || frappe.datetime.get_today();
                    load(listview);
                });
                $sub.find(".eck-dept").on("input", function () {
                    clearTimeout(dept_t);
                    const v = $(this).val().trim();
                    dept_t = setTimeout(function () { s.dept = v; load(listview); }, 500);
                });
                $sub.find(".eck-search").on("input", function () {
                    clearTimeout(search_t);
                    const v = $(this).val().trim();
                    search_t = setTimeout(function () { s.search = v; load(listview); }, 400);
                });

                s.$table_wrap = $(`<div style="padding:0 15px 20px;"></div>`);

                const $container = $("<div>")
                    .append(s.$cards_wrap)
                    .append($sub)
                    .append(s.$table_wrap);

                $fl.before($container);
                $fl.hide();

                listview.page.set_title(__("Employee Daily Checkin"));

                frappe.realtime.doctype_subscribe("Employee Checkin");
                frappe.realtime.off("list_update");
                frappe.realtime.on("list_update", function (data) {
                    if (data && data.doctype === "Employee Checkin") load(listview);
                });
                listview.page.wrapper.one("hide", function () {
                    frappe.realtime.off("list_update");
                });
            }

            load(listview);
        },
    };
})();
