/**
 * sales_order_list.js
 * Sales Order list view — name formatter, sales person column, print button.
 */

frappe.listview_settings["Sales Order"] = frappe.listview_settings["Sales Order"] || {};

Object.assign(frappe.listview_settings["Sales Order"], {
    add_fields: ["custom_sales_person"],
});

frappe.router.on("change", function () {
    const route = frappe.get_route();
    if (!route || route[0] !== "List" || route[1] !== "Sales Order") return;

    setTimeout(function () {
        const ls = frappe.listview_settings["Sales Order"];
        if (!ls) return;

        ls.button = {
            show: (doc) => !["Draft", "Cancelled"].includes(doc.status),
            get_label: () => __("Print"),
            get_description: () => __("Print Preview"),
            action: (doc) => window.open(
                "/printview?doctype=Sales%20Order&name=" + encodeURIComponent(doc.name) +
                "&format=OSPF_V2&no_letterhead=1&letterhead=No%20Letterhead&settings=%7B%7D",
                "_blank"
            ),
        };

        ls.formatters = ls.formatters || {};
        ls.formatters.name = function (value, df, doc) {
            const date = frappe.datetime.str_to_user((doc.creation || "").split(" ")[0]);
            return `<span title="${value}">${date ? date + "<br>" : ""}<strong>${value}</strong></span>`;
        };
        ls.formatters.custom_sales_person = function (value, df, doc) {
            return doc.owner === frappe.session.user ? "You" : (value || "");
        };

        if (cur_list) cur_list.render();
    }, 500);
});
