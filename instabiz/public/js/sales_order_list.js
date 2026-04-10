/**
 * sales_order_list.js
 * Sales Order list view — name formatter, sales person column, print button, auto-collapse sidebar.
 */

frappe.listview_settings["Sales Order"] = {

    add_fields: ["custom_sales_person"],

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
    },
};