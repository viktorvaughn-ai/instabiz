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
            const d = new Date(str);
            const date = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: TZ });
            const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ });
            return `${date}, ${time}`;
        } catch (e) { return "—"; }
    }

    function badge(status) {
        const map = { IN: "green", OUT: "blue", Absent: "red" };
        return `<span class="indicator-pill ${map[status] || "grey"}" style="font-size:11px;">${status}</span>`;
    }

    /* ── data load ────────────────────────────────────────────────────────── */

    function load(listview, append) {
        const s     = listview._eck;
        const $wrap = listview._eck_wrap;
        if (!$wrap || !s) return;

        if (!append) {
            s.all_rows = [];
            s.offset   = 0;
            $wrap.html(`<div style="padding:30px 0;text-align:center;color:#aaa;">Loading…</div>`);
        }

        frappe.call({
            method: API,
            args: { date: s.date, department: s.dept, search: s.search, limit: s.page_size, offset: s.offset },
            callback: function (r) {
                if (r && r.message) render(listview, r.message.data, r.message.total);
            },
        });
    }

    /* ── render ───────────────────────────────────────────────────────────── */

    function render(listview, data, total) {
        const s = listview._eck;

        data.forEach(function (emp) {
            // Internal helper for the new pills
            const make_badge = (color, label) => {
                if (!label || label === "—") return `<span style="color: #bbb; margin-left:5px;">—</span>`;
                
                const color_map = {
                    blue:   '#1572b2',
                    green:  '#28a745',
                    orange: '#ff851b',
                    red:    '#e74c3c',
                    gray:   '#6c757d'
                };

                const hex = color_map[color] || color_map.gray;

                return `
                    <div style="
                        display: inline-flex;
                        align-items: center;
                        background-color: ${hex}15; 
                        color: ${hex}; 
                        border: 1px solid ${hex}30;
                        padding: 2px 10px;
                        border-radius: 12px;
                        font-size: 11px;
                        font-weight: 600;
                        white-space: nowrap;
                        line-height: 1.5;
                    ">
                        ${label}
                    </div>`;
            };

            s.all_rows.push(`
                <tr style="border-bottom:1px solid var(--border-color); vertical-align: middle;">
                    <td style="padding:10px 12px;">
                        <div style="font-weight:600;">${frappe.utils.escape_html(emp.employee_name)}</div>
                        <div style="font-size:11px;color:#888;margin-top:2px;">${frappe.utils.escape_html(emp.employee)}</div>
                    </td>
                    <td style="padding:10px 12px;font-size:12px;">${frappe.utils.escape_html(emp.department || "—")}</td>
                    <td style="padding:10px 12px;font-size:12px;">${frappe.utils.escape_html(emp.designation || "—")}</td>
                    
                    <td style="padding:10px 12px;">${badge(emp.status)}</td>
                    
                    <td style="padding:10px 12px;">${make_badge('blue', fmt_time(emp.in_time))}</td>
                    <td style="padding:10px 12px;">${make_badge('gray', fmt_time(emp.out_time))}</td>
                    
                    <td style="padding:10px 12px;">
                        ${make_badge(emp.work_hours ? 'green' : 'gray', emp.work_hours || "—")}
                    </td>
                    
                    <td style="padding:10px 12px; min-width: 150px;">
                        ${make_badge('gray', fmt_datetime(emp.last_in))}
                    </td>
                </tr>`);
        });

        const tbody   = s.all_rows.length
            ? s.all_rows.join("")
            : `<tr><td colspan="8" style="text-align:center;color:#aaa;padding:50px 0;">No attendance records found</td></tr>`;
        
        const showing  = s.all_rows.length;
        const has_more = showing < total;

        const paging_btns = [20, 100, 500, 2500].map(function (v) {
            return `<button type="button" class="btn btn-default btn-sm btn-paging${v === s.page_size ? " btn-info" : ""}" data-value="${v}">${v}</button>`;
        }).join("");

        listview._eck_wrap.html(`
            <div style="border:1px solid var(--border-color);border-radius:var(--border-radius);overflow:hidden;background:#fff;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead>
                        <tr style="background:var(--subtle-fg);border-bottom:2px solid var(--border-color);">
                            <th style="padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:left;">Employee</th>
                            <th style="padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:left;">Department</th>
                            <th style="padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:left;">Role</th>
                            <th style="padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:left;">Status</th>
                            <th style="padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:left;">In</th>
                            <th style="padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:left;">Out</th>
                            <th style="padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:left;">Work Hours</th>
                            <th style="padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:left;">Last In</th>
                        </tr>
                    </thead>
                    <tbody>${tbody}</tbody>
                </table>
            </div>
            <div class="list-paging-area level" style="margin-top:10px;">
                <div class="level-left">
                    <div class="btn-group">${paging_btns}</div>
                </div>
                <div class="level-right" style="display:flex;align-items:center;gap:10px;">
                    <span class="text-muted" style="font-size:12px;">
                        ${total} employee${total !== 1 ? "s" : ""} &middot; showing ${showing}
                    </span>
                    <button class="btn btn-default btn-sm btn-more" ${has_more ? "" : 'style="display:none;"'}>
                        ${__("Load More")}
                    </button>
                </div>
            </div>`);

        listview._eck_wrap.find(".btn-paging").on("click", function () {
            const val = parseInt($(this).data("value"), 10);
            if (val === s.page_size) return;
            s.page_size = val;
            load(listview, false);
        });

        listview._eck_wrap.find(".btn-more").on("click", function () {
            s.offset += s.page_size;
            load(listview, true);
        });
    }

    /* ── listview hook ────────────────────────────────────────────────────── */

    frappe.listview_settings["Employee Checkin"] = {
        onload: function (listview) {
            listview._eck = {
                date:      frappe.datetime.get_today(),
                dept:      "",
                search:    "",
                page_size: 20,
                offset:    0,
                all_rows:  [],
            };

            listview.page.main.find(".standard-filter-section").hide();

            listview.set_primary_action = function () {
                listview.page.set_primary_action(
                    `<iconify-icon icon="mdi:refresh" width="14" style="vertical-align:-2px;margin-right:4px;"></iconify-icon>${__("Refresh")}`,
                    function () { load(listview, false); }
                );
            };
            listview.set_primary_action();

		ib_hide_sidebar();
        },

        refresh: function (listview) {
            listview.page.main.find(".standard-filter-section").hide();

            if (!listview._eck_wrap) {
                const s   = listview._eck;
                const $fl = listview.page.main.find(".frappe-list");

                listview.page.$title_area.find(".flex").first().append(`
                    <input type="date" class="form-control eck-date"
                        style="height:26px;font-size:12px;width:140px;margin-left:10px;padding:2px 8px;"
                        value="${s.date}">`);

                listview.page.$title_area.find(".eck-date").on("change", function () {
                    s.date = $(this).val() || frappe.datetime.get_today();
                    load(listview, false);
                });

                const $sub = $(`
                    <div style="display:flex;gap:8px;padding:10px 15px 12px;flex-wrap:wrap;">
                        <input type="text" class="form-control eck-dept"
                            style="height:28px;font-size:12px;width:180px;"
                            placeholder="Department">
                        <input type="text" class="form-control eck-search"
                            style="height:28px;font-size:12px;width:200px;"
                            placeholder="Search employee…">
                    </div>`);

                let dept_t, search_t;
                $sub.find(".eck-dept").on("input", function () {
                    clearTimeout(dept_t);
                    const v = $(this).val().trim();
                    dept_t = setTimeout(function () { s.dept = v; load(listview, false); }, 500);
                });
                $sub.find(".eck-search").on("input", function () {
                    clearTimeout(search_t);
                    const v = $(this).val().trim();
                    search_t = setTimeout(function () { s.search = v; load(listview, false); }, 400);
                });

                listview._eck_wrap = $('<div style="padding:0 15px 20px;"></div>');
                $fl.before($("<div>").append($sub).append(listview._eck_wrap));
                $fl.hide();

                listview.page.set_title(__("Employee Daily Checkin"));

                frappe.realtime.doctype_subscribe("Employee Checkin");
                frappe.realtime.off("list_update");
                frappe.realtime.on("list_update", function (data) {
                    if (data && data.doctype === "Employee Checkin") load(listview, false);
                });
                listview.page.wrapper.one("hide", function () {
                    frappe.realtime.off("list_update");
                });
            }
            load(listview, false);
        },
    };
})();