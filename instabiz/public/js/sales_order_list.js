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
        ib_hide_sidebar();
        ib_setup_sales_order_status_multiselect(listview);
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
            ib_disable_sales_order_status_click_filter(listview);
        };

        frappe.router.on("change", function () {
            const route = frappe.get_route();
            if (!route || route[0] !== "List" || route[1] !== "Sales Order") {
                $(".ib-so-total-bar").remove();
            }
        });
    },
};

const SALES_ORDER_STATUSES = [
    "Draft",
    "Pending",
    "Dispatched",
    "Confirmed",
    "Cancelled",
];

function ib_setup_sales_order_status_multiselect(listview) {
    const existingField = listview.page.fields_dict.status;
    if (existingField && existingField.$wrapper) {
        existingField.$wrapper.hide();
    }

    $(".ib-sales-order-status-multi-filter").remove();
    const $wrapper = $(
        '<div class="form-group frappe-control input-max-width col-md-2 ib-sales-order-status-multi-filter" data-fieldtype="MultiSelectList" data-fieldname="status_multi"></div>'
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
                return SALES_ORDER_STATUSES
                    .filter((status) => status.toLowerCase().includes(q))
                    .map((status) => ({ value: status, description: __("Sales Order Status") }));
            },
            onchange() {
                const selected = ib_extract_filter_values(control.get_value());
                listview.filter_area.remove("status");
                if (selected.length) {
                    listview.filter_area.add([["Sales Order", "status", "in", selected]]);
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
        .filter((f) => f[1] === "status")
        .flatMap((f) => ib_extract_filter_values(f[3]));
    if (current.length) {
        control.set_value(current);
    }

    const $clearAllBtn = listview.filter_area && listview.filter_area.filter_x_button;
    if ($clearAllBtn && $clearAllBtn.length) {
        $clearAllBtn.off("click.ib_sales_order_status_multi_clear").on("click.ib_sales_order_status_multi_clear", function () {
            control.set_value([]);
        });
    }
}

function ib_extract_filter_values(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === "string") {
        return value
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);
    }
    return [];
}

function ib_disable_sales_order_status_click_filter(listview) {
    listview.$result.find(".indicator-pill").each(function () {
        $(this)
            .removeClass("filterable")
            .off("click.ib_disable_status_filter")
            .on("click.ib_disable_status_filter", function (e) {
                e.preventDefault();
                e.stopPropagation();
            });
    });
}

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