// Shared list view utilities — status multi-select filter + helpers.
// Loaded globally via app_include_js so all *_list.js files can use these.

function ib_extract_filter_values(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === "string") {
        return value.split(",").map((v) => v.trim()).filter(Boolean);
    }
    return [];
}

/**
 * Inject a MultiSelectList status filter into the standard filter bar.
 * Hides the native status field and wires clear-all.
 *
 * @param {object} listview  - Frappe ListView instance
 * @param {string} doctype   - e.g. "Delivery Note"
 * @param {string[]} statuses - ordered list of valid status values
 */
function ib_setup_status_multiselect(listview, doctype, statuses) {
    const slug     = doctype.toLowerCase().replace(/ /g, "-");
    const cssClass = `ib-${slug}-status-multi-filter`;
    const eventNs  = `ib_${slug.replace(/-/g, "_")}_status_multi_clear`;

    const existingField = listview.page.fields_dict.status;
    if (existingField && existingField.$wrapper) {
        existingField.$wrapper.hide();
    }

    $(`.${cssClass}`).remove();
    const $wrapper = $(
        `<div class="form-group frappe-control input-max-width col-md-2 ${cssClass}" ` +
        `data-fieldtype="MultiSelectList" data-fieldname="status_multi"></div>`
    );
    if (existingField && existingField.$wrapper && existingField.$wrapper.length) {
        $wrapper.insertAfter(existingField.$wrapper);
    } else if (listview.filter_area && listview.filter_area.standard_filters_wrapper) {
        $wrapper.appendTo(listview.filter_area.standard_filters_wrapper);
    } else {
        $wrapper.appendTo(listview.page.page_form);
    }
    $wrapper.css({ flex: "0 0 140px", maxWidth: "140px" });

    const control = frappe.ui.form.make_control({
        df: {
            label: "",
            fieldtype: "MultiSelectList",
            placeholder: __("Status"),
            input_class: "input-xs",
            get_data(txt) {
                const q = (txt || "").toLowerCase();
                return statuses
                    .filter((s) => s.toLowerCase().includes(q))
                    .map((s) => ({ value: s, description: __("Status") }));
            },
            onchange() {
                const selected = ib_extract_filter_values(control.get_value());
                listview.filter_area.remove("status");
                if (selected.length) {
                    listview.filter_area.add([[doctype, "status", "in", selected]]);
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
    if (current.length) control.set_value(current);

    const $clearAllBtn = listview.filter_area && listview.filter_area.filter_x_button;
    if ($clearAllBtn && $clearAllBtn.length) {
        $clearAllBtn
            .off(`click.${eventNs}`)
            .on(`click.${eventNs}`, () => control.set_value([]));
    }
}

function ib_disable_status_click_filter(listview) {
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
