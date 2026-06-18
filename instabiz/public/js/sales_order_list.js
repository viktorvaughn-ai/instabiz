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
        ib_setup_status_multiselect(listview, "Sales Order", [
            "Draft", "Pending", "Dispatched", "Confirmed", "Cancelled",
        ]);
        ib_setup_so_sales_user_filter(listview);
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
        };

        frappe.router.on("change", function () {
            const route = frappe.get_route();
            if (!route || route[0] !== "List" || route[1] !== "Sales Order") {
                $(".ib-so-total-bar").remove();
            }
        });
    },
};

// ── SO List: sales person user (Link → User) filter ──────────────────────────

function ib_setup_so_sales_user_filter(listview) {
    const cssClass = "ib-so-sales-user-filter";
    $(`.${cssClass}`).remove();

    const $wrapper = $(
        `<div class="form-group frappe-control input-max-width ${cssClass}" ` +
        `data-fieldtype="Link" data-fieldname="custom_sales_person_user"></div>`
    );
    $wrapper.css({ flex: "0 0 160px", maxWidth: "160px" });

    const statusWrap = $(".ib-sales-order-status-multi-filter");
    if (statusWrap.length) {
        $wrapper.insertAfter(statusWrap);
    } else {
        $wrapper.appendTo(listview.page.page_form);
    }

    const control = frappe.ui.form.make_control({
        df: {
            label: "",
            fieldtype: "Link",
            options: "User",
            placeholder: __("Sales Person"),
            onchange() {
                const val = control.get_value();
                listview.filter_area.remove("custom_sales_person_user");
                if (val) {
                    listview.filter_area.add([
                        ["Sales Order", "custom_sales_person_user", "=", val],
                    ]);
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

    const $clearBtn = listview.filter_area && listview.filter_area.filter_x_button;
    if ($clearBtn && $clearBtn.length) {
        $clearBtn
            .off("click.ib_so_sales_user_clear")
            .on("click.ib_so_sales_user_clear", () => control.set_value(""));
    }
}

// ── SO List: transaction_date range filter ────────────────────────────────────

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

function ib_update_so_total_bar(listview) {
    const checked = listview.get_checked_items();
    const count   = checked.length;
    const total   = checked.reduce((s, r) => s + (r.rounded_total || 0), 0);

    $("#ib-so-sel-count").text(`${count} order${count !== 1 ? "s" : ""} selected`);
    const formatted = $("<div>").html(frappe.format(total, { fieldtype: "Currency" })).text().trim();
    $("#ib-so-total-value").text(formatted);
    $("#ib-so-total-bar").toggleClass("ib-so-total-bar--active", count > 0);
}