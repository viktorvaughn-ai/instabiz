/**
 * employee_exit_handover.js
 *
 * Form JS for Employee Exit Handover.
 *
 * When status = "Pending Review" and the user is HR Manager / System Manager:
 *   - "Quick Assign All" button  — opens a dialog to fill every reassign_to
 *     cell in one shot (good for small teams; single replacement for everything).
 *   - "Execute Reassignment" primary action — validates all rows are filled,
 *     confirms, then calls the server-side bulk-update method.
 *
 * When status = "Completed" the form is read-only and shows a green indicator.
 */

frappe.ui.form.on("Employee Exit Handover", {

    refresh(frm) {
        ib_hide_sidebar();
        _set_status_indicator(frm);

        // Disable add/delete on the auto-populated items table
        frm.fields_dict.items.grid.df.cannot_add_rows    = 1;
        frm.fields_dict.items.grid.df.cannot_delete_rows = 1;
        frm.fields_dict.items.grid.refresh();

        // Restrict reassign_to to enabled, non-system users only
        frm.set_query("reassign_to", "items", function () {
            return {
                filters: {
                    enabled: 1,
                    name: ["not in", ["Administrator", "Guest"]],
                },
            };
        });

        if (frm.is_new()) return;

        var can_act = (
            frm.doc.status === "Pending Review" &&
            (frappe.user.has_role("HR Manager") || frappe.user.has_role("System Manager"))
        );

        if (can_act) {
            _add_quick_assign_button(frm);
            _set_execute_primary_action(frm);
        } else {
            // Clear primary action button so stale labels don't persist
            frm.page.clear_primary_action();
        }
    },

});


// ── Status indicator ──────────────────────────────────────────────────────────

function _set_status_indicator(frm) {
    if (frm.is_new()) return;
    if (frm.doc.status === "Completed") {
        frm.page.set_indicator(__("Completed"), "green");
    } else if (frm.doc.status === "Pending Review") {
        frm.page.set_indicator(__("Pending Review"), "orange");
    }
}


// ── Quick Assign All ──────────────────────────────────────────────────────────

function _add_quick_assign_button(frm) {
    frm.add_custom_button(__("Quick Assign All"), function () {
        var d = new frappe.ui.Dialog({
            title: __("Quick Assign All Documents"),
            fields: [
                {
                    label:     __("Reassign All To"),
                    fieldname: "to_user",
                    fieldtype: "Link",
                    options:   "User",
                    reqd:      1,
                    get_query: function () {
                        return { filters: { enabled: 1 } };
                    },
                },
            ],
            primary_action_label: __("Apply to All Rows"),
            primary_action: function (values) {
                var rows = frm.doc.items || [];
                rows.forEach(function (row) {
                    frappe.model.set_value(
                        row.doctype, row.name, "reassign_to", values.to_user
                    );
                });
                frm.refresh_field("items");
                frappe.show_alert({
                    message:   __("All {0} row(s) updated. Click Execute Reassignment to confirm.").replace("{0}", rows.length),
                    indicator: "blue",
                });
                d.hide();
            },
        });
        d.show();
    });
}


// ── Execute Reassignment (primary action) ─────────────────────────────────────

function _set_execute_primary_action(frm) {
    frm.page.set_primary_action(__("Execute Reassignment"), function () {
        var missing = (frm.doc.items || []).filter(function (r) {
            return !r.reassign_to;
        });

        if (missing.length) {
            frappe.msgprint({
                title:     __("Incomplete"),
                message:   __(
                    "{0} row(s) are missing a Reassign To value. " +
                    "Fill them individually or use Quick Assign All first."
                ).replace("{0}", missing.length),
                indicator: "red",
            });
            return;
        }

        var total = (frm.doc.items || []).length;
        frappe.confirm(
            __("Reassign all {0} document(s) to their nominated users? This cannot be undone.").replace("{0}", total),
            function () {
                frappe.call({
                    method:         "execute_reassignment",
                    doc:            frm.doc,
                    freeze:         true,
                    freeze_message: __("Reassigning documents\u2026"),
                    callback: function (r) {
                        if (r.message) {
                            frappe.show_alert({
                                message:   __("{0} document(s) reassigned successfully.").replace("{0}", r.message.reassigned),
                                indicator: "green",
                            });
                            frm.reload_doc();
                        }
                    },
                });
            }
        );
    });
}
