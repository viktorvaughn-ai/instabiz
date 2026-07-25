/**
 * sales_order_list.js
 * Sales Order list view — name formatter, sales person column, print button, auto-collapse sidebar.
 */

frappe.listview_settings["Sales Order"] = {

    add_fields: ["custom_sales_person", "rounded_total"],

    button: {
        show: () => true,
        get_label: () => __("Print"),
        get_description: () => __("Print Preview"),
        action(doc) {
            window.open(
                "/printview?doctype=Sales%20Order&name=" + encodeURIComponent(doc.name) +
                "&format=OSPF_V2&no_letterhead=1&letterhead=No%20Letterhead&settings=%7B%7D",
                "_blank"
            );
        },
    },

    get_indicator(doc) {
        const map = {
            Draft:      "red",
            Pending:    "orange",
            Dispatched: "blue",
            Confirmed:  "green",
            Cancelled:  "red",
        };
        return [__(doc.status), map[doc.status] || "grey"];
    },

    formatters: {
        name(value, df, doc) {
            const date = frappe.datetime.str_to_user(
                (doc.creation || "").split(" ")[0]
            );
            return `<span title="${value}">${date ? date + "<br>" : ""}<strong>${value}</strong></span>`;
        },
        custom_sales_person(value, df, doc) {
            return doc.owner === frappe.session.user ? __("You") : (value || "");
        },
    },

    onload(listview) {
        ib_setup_list_print(listview, "Sales Order");
        ib_hide_sidebar();
        // Sales Person before Status: matches the row's own field order (Customer,
        // Amount, Sales Person, Status, Delivery Date, ID) — see list_utils.js
        // _ib_chain_anchor, which threads filters in call order.
        ib_setup_list_sales_user_filter(listview, "Sales Order");
        ib_setup_status_multiselect(listview, "Sales Order", [
            "Draft", "Pending", "Dispatched", "Confirmed", "Cancelled",
        ]);
        ib_setup_list_date_filter(listview, "Sales Order", "creation", ["transaction_date", "delivery_date"]);
        ib_setup_list_team_filter(listview, "Sales Order");
        ib_setup_so_total_bar(listview);

        // Re-add bar on navigate-back (Frappe calls refresh() on page re-show)
        const _orig_refresh = listview.refresh.bind(listview);
        listview.refresh = function () {
            if (!$(".ib-so-total-bar").length) {
                ib_setup_so_total_bar(listview);
            }
            return _orig_refresh();
        };

        const _orig_render_list = listview.render_list.bind(listview);
        listview.render_list = function () {
            _orig_render_list();
            ib_disable_status_click_filter(listview);
            ib_inject_so_prod_badges(listview);
        };

        frappe.router.on("change", function () {
            const route = frappe.get_route();
            if (!route || route[0] !== "List" || route[1] !== "Sales Order") {
                $(".ib-so-total-bar").remove();
            }
        });
    },
};

// ── SO List: sticky selection total bar ──────────────────────────────────────

function ib_setup_so_total_bar(listview) {
    $(".ib-so-total-bar").remove();
    const $bar = $("<div>").attr("id", "ib-so-total-bar").addClass("ib-so-total-bar");
    const $pill = $("<span>").attr("id", "ib-so-sel-count").addClass("ib-so-sel-pill").text("0 selected");
    const $label = $("<span>").addClass("ib-so-total-label").text("Total");
    const $value = $("<span>").attr("id", "ib-so-total-value").addClass("ib-so-total-value").text("—");
    $bar.append($pill, $label, $value);
    $("body").append($bar);

    // .off().on() keeps binding idempotent across before_render calls
    listview.$result.off("change.ib_so_total").on("change.ib_so_total", "input[type=checkbox]", function () {
        setTimeout(() => ib_update_so_total_bar(listview), 0);
    });
}

// ── Production badge injection ────────────────────────────────────────────────

function ib_inject_so_prod_badges(listview) {
    if (!listview.data || !listview.data.length) return;
    const soNames = listview.data.map(r => r.name).filter(Boolean);
    if (!soNames.length) return;

    frappe.call({
        method: "instabiz.overrides.production.get_so_list_badges",
        args: { sales_orders: soNames },
        callback(r) {
            const badges = r.message || {};
            soNames.forEach(name => {
                const info = badges[name];
                if (!info) return;
                const $row = listview.$result.find(`.list-row[data-name="${CSS.escape(name)}"]`);
                if (!$row.length) return;
                $row.find(".ib-so-prod-badge").remove();
                const $badge = $(`
                    <span class="ib-so-prod-badge" style="
                        display:inline-flex;align-items:center;gap:3px;
                        background:${info.color}15;color:${info.color};
                        border:1px solid ${info.color}40;border-radius:10px;
                        padding:1px 7px;font-size:10px;font-weight:600;
                        white-space:nowrap;vertical-align:middle;margin-left:6px">
                        <iconify-icon icon="lucide:factory" width="9" height="9"></iconify-icon>
                        ${frappe.utils.escape_html(info.badge)}
                    </span>`);
                $row.find(".level-item.list-row-activity").prepend($badge);
            });
        },
    });
}

function ib_update_so_total_bar(listview) {
    const checked = listview.get_checked_items();
    const count   = checked.length;
    const total   = checked.reduce((s, r) => s + (r.rounded_total || 0), 0);

    $("#ib-so-sel-count").text(`${count} order${count !== 1 ? "s" : ""} selected`);
    const formatted = $("<div>").html(frappe.format(total, { fieldtype: "Currency" })).text().trim();
    $("#ib-so-total-value").text(formatted);
    $("#ib-so-total-bar").toggleClass("ib-so-total-bar--active", count > 0);
}