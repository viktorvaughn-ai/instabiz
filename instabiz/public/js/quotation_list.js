/**
 * quotation_list.js
 * Quotation list view — Customer filter, status indicators,
 * name formatter, sales person column, print button, auto-collapse sidebar.
 */

frappe.listview_settings["Quotation"] = {

    add_fields: ["transaction_date", "custom_sales_person"],

    // ✅ Defined statically — Frappe reads this once at init, no router needed
    button: {
        show: (doc) => true,
        get_label: () => __("Print"),
        get_description: () => __("Print Preview"),
        action(doc) {
            window.open(
                "/printview?doctype=Quotation&name=" + encodeURIComponent(doc.name) +
                "&format=QPF_V2&no_letterhead=1&letterhead=No%20Letterhead&settings=%7B%7D",
                "_blank"
            );
        },
    },

    // ✅ Defined statically — called per-row by Frappe's renderer
    get_indicator(doc) {
        const map = {
            Pending:   "orange",
            Confirmed: "green",
            Cancelled: "red",
            Draft:     "red",
        };
        return [__(doc.status), map[doc.status] || "grey"];
    },

    // ✅ Defined statically — Frappe applies these during column render
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
        ib_setup_quotation_status_multiselect(listview);
        const _orig_render_list = listview.render_list.bind(listview);
        listview.render_list = function () {
            _orig_render_list();
            ib_disable_quotation_status_click_filter(listview);
        };
    },
};

const QUOTATION_STATUSES = [
    "Pending",
    "Confirmed",
    "Cancelled",
    "Draft",
];

function ib_setup_quotation_status_multiselect(listview) {
    const existingField = listview.page.fields_dict.status;
    if (existingField && existingField.$wrapper) {
        existingField.$wrapper.hide();
    }

    $(".ib-quotation-status-multi-filter").remove();
    const $wrapper = $(
        '<div class="form-group frappe-control input-max-width col-md-2 ib-quotation-status-multi-filter" data-fieldtype="MultiSelectList" data-fieldname="status_multi"></div>'
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
                return QUOTATION_STATUSES
                    .filter((status) => status.toLowerCase().includes(q))
                    .map((status) => ({ value: status, description: __("Quotation Status") }));
            },
            onchange() {
                const selected = ib_extract_filter_values(control.get_value());
                listview.filter_area.remove("status");
                if (selected.length) {
                    listview.filter_area.add([["Quotation", "status", "in", selected]]);
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
        $clearAllBtn.off("click.ib_quotation_status_multi_clear").on("click.ib_quotation_status_multi_clear", function () {
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

function ib_disable_quotation_status_click_filter(listview) {
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