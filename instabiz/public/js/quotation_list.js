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
        ib_setup_list_print(listview, "Quotation");
        ib_hide_sidebar();
        ib_setup_status_multiselect(listview, "Quotation", [
            "Pending", "Confirmed", "Cancelled", "Draft",
        ]);
        ib_setup_list_sales_user_filter(listview, "Quotation");
        ib_setup_list_date_filter(listview, "Quotation", "creation", ["transaction_date"]);
        ib_setup_list_team_filter(listview, "Quotation");
        const _orig_render_list = listview.render_list.bind(listview);
        listview.render_list = function () {
            _orig_render_list();
            ib_disable_status_click_filter(listview);
        };
    },
};