/**
 * quotation_list.js
 * Quotation list view — Customer filter, status indicators,
 * name formatter, sales person column, print button.
 */

frappe.listview_settings["Quotation"] = frappe.listview_settings["Quotation"] || {};

Object.assign(frappe.listview_settings["Quotation"], {
    add_fields: ["transaction_date", "custom_sales_person"],

    onload(listview) {
        listview.page.add_field({
            fieldtype: "Link",
            fieldname: "party_name",
            options:   "Customer",
            label:     "Customer",
            change() {
                const val = this.get_value();
                if (val) {
                    listview.filter_area.add([[listview.doctype, "party_name", "=", val]]);
                } else {
                    listview.filter_area.remove(listview.doctype, "party_name");
                }
            },
        });
    },
});

frappe.router.on("change", function () {
    const route = frappe.get_route();
    if (!route || route[0] !== "List" || route[1] !== "Quotation") return;

    setTimeout(function () {
        const ls = frappe.listview_settings["Quotation"];
        if (!ls) return;

        ls.button = {
            show: () => true,
            get_label: () => __("Print"),
            get_description: () => __("Print Preview"),
            action: (doc) => window.open(
                "/printview?doctype=Quotation&name=" + encodeURIComponent(doc.name) +
                "&format=QPF_V2&no_letterhead=1&letterhead=No%20Letterhead&settings=%7B%7D",
                "_blank"
            ),
        };

        ls.get_indicator = function (doc) {
            const map = { Pending: "orange", Confirmed: "green", Cancelled: "red", Draft: "red" };
            return [__(doc.status), map[doc.status] || "grey"];
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
