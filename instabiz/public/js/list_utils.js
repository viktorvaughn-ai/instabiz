// Shared list view utilities — status multi-select filter + helpers.
// Loaded globally via app_include_js so all *_list.js files can use these.

// ── Global default: newest docs at top for every list view ────────────────────
// Patches ListView.prototype.setup_defaults once. Runs on every route change so
// it fires even if the ListView class is lazy-loaded after initial boot.
(function _ib_patch_listview_sort() {
    function _patch() {
        const proto = frappe?.views?.ListView?.prototype;
        if (!proto || proto._ib_sort_patched) return;
        proto._ib_sort_patched = true;

        // Patch setup_defaults — runs first, sets this.sort_by before SortSelector is created.
        const _orig_defaults = proto.setup_defaults;
        proto.setup_defaults = function () {
            _orig_defaults.call(this);
            this.sort_by    = "modified";
            this.sort_order = "desc";
        };

        // Patch setup_sort_selector — runs just before SortSelector is instantiated,
        // ensuring the widget gets sort_by="modified" even if setup_defaults was wrong.
        const _orig_sort_sel = proto.setup_sort_selector;
        if (_orig_sort_sel) {
            proto.setup_sort_selector = function () {
                this.sort_by    = "modified";
                this.sort_order = "desc";
                _orig_sort_sel.call(this);
            };
        }
    }
    frappe.after_ajax(_patch);
    $(document).on("frappe:ready", _patch);
    if (frappe?.router) frappe.router.on("change", _patch);
})();

// Remove ALL active filter rows for a fieldname (filter_area.remove() only drops one per call).
function _ib_remove_filters(listview, fieldname) {
    let guard = 20;
    while (guard-- > 0 && listview.filter_area.get().some((f) => f[1] === fieldname)) {
        listview.filter_area.remove(fieldname);
    }
}

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
                _ib_remove_filters(listview, "status");
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

// ── Generic sales person (User link) filter ───────────────────────────────────
function ib_setup_list_sales_user_filter(listview, doctype) {
    const slug    = doctype.toLowerCase().replace(/ /g, "-");
    const css     = `ib-${slug}-sales-user-filter`;
    const eventNs = `ib_${slug.replace(/-/g, "_")}_sales_user_clear`;

    $(`.${css}`).remove();

    const $wrapper = $(
        `<div class="form-group frappe-control input-max-width ${css}" ` +
        `data-fieldtype="Link" data-fieldname="custom_sales_person_user"></div>`
    );
    $wrapper.css({ flex: "0 0 160px", maxWidth: "160px" });

    const statusWrap = $(`.ib-${slug}-status-multi-filter`);
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
                _ib_remove_filters(listview, "custom_sales_person_user");
                if (val) {
                    listview.filter_area.add([
                        [doctype, "custom_sales_person_user", "=", val],
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
            .off(`click.${eventNs}`)
            .on(`click.${eventNs}`, () => control.set_value(""));
    }
}

// ── Generic date range filter ─────────────────────────────────────────────────
function ib_setup_list_date_filter(listview, doctype, dateField, nativeFieldsToHide) {
    (nativeFieldsToHide || []).forEach(function (fn) {
        const f = listview.page.fields_dict[fn];
        if (f && f.$wrapper) f.$wrapper.hide();
    });

    const slug    = doctype.toLowerCase().replace(/ /g, "-");
    const css     = `ib-${slug}-date-range-filter`;
    const eventNs = `ib_${slug.replace(/-/g, "_")}_date_clear`;

    $(`.${css}`).remove();

    const $wrapper = $(
        `<div class="form-group frappe-control input-max-width ${css}" ` +
        `data-fieldtype="DateRange" data-fieldname="${dateField}_range"></div>`
    );
    $wrapper.css({ flex: "0 0 210px", maxWidth: "210px" });

    const userWrap   = $(`.ib-${slug}-sales-user-filter`);
    const statusWrap = $(`.ib-${slug}-status-multi-filter`);
    if (userWrap.length) {
        $wrapper.insertAfter(userWrap);
    } else if (statusWrap.length) {
        $wrapper.insertAfter(statusWrap);
    } else {
        $wrapper.appendTo(listview.page.page_form);
    }

    const control = frappe.ui.form.make_control({
        df: {
            label: "",
            fieldtype: "DateRange",
            placeholder: __("From – To"),
            onchange() {
                const val = control.get_value();
                _ib_remove_filters(listview, dateField);
                if (val && val[0] && val[1]) {
                    listview.filter_area.add([
                        [doctype, dateField, ">=", val[0]],
                        [doctype, dateField, "<=", val[1]],
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
            .off(`click.${eventNs}`)
            .on(`click.${eventNs}`, () => control.set_value(null));
    }
}

// ── Generic Lead Sales Team filter ────────────────────────────────────────────
function ib_setup_list_team_filter(listview, doctype) {
    const slug    = doctype.toLowerCase().replace(/ /g, "-");
    const css     = `ib-${slug}-team-filter`;
    const eventNs = `ib_${slug.replace(/-/g, "_")}_team_clear`;

    $(`.${css}`).remove();

    const $wrapper = $(
        `<div class="form-group frappe-control input-max-width ${css}" ` +
        `data-fieldtype="Link" data-fieldname="lead_sales_team"></div>`
    );
    $wrapper.css({ flex: "0 0 160px", maxWidth: "160px" });

    // Insert after date filter (slug-based or SO legacy), else user filter, else status, else append
    const dateWrap   = $(`.ib-${slug}-date-range-filter, .ib-so-date-range-filter`);
    const userWrap   = $(`.ib-${slug}-sales-user-filter, .ib-so-sales-user-filter`);
    const statusWrap = $(`.ib-${slug}-status-multi-filter`);
    if (dateWrap.length) {
        $wrapper.insertAfter(dateWrap.last());
    } else if (userWrap.length) {
        $wrapper.insertAfter(userWrap.last());
    } else if (statusWrap.length) {
        $wrapper.insertAfter(statusWrap);
    } else {
        $wrapper.appendTo(listview.page.page_form);
    }

    const control = frappe.ui.form.make_control({
        df: {
            label: "",
            fieldtype: "Link",
            options: "Lead Sales Team",
            placeholder: __("Sales Team"),
            onchange() {
                const teamName = control.get_value();
                listview.filter_area.remove("custom_sales_person_user");
                if (!teamName) {
                    listview.refresh();
                    return;
                }
                frappe.db.get_list("Lead Sales Team Member", {
                    filters: { parent: teamName, parenttype: "Lead Sales Team" },
                    fields: ["user"],
                    limit: 200,
                }).then(function (members) {
                    const users = members.map(function (m) { return m.user; }).filter(Boolean);
                    if (users.length) {
                        listview.filter_area.add([
                            [doctype, "custom_sales_person_user", "in", users],
                        ]);
                    }
                    listview.refresh();
                });
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
            .off(`click.${eventNs}`)
            .on(`click.${eventNs}`, () => control.set_value(""));
    }
}

// Redirect Sales Users who land on the Customer Board workspace page to the actual board page.
function _ib_maybe_redirect_to_board() {
	const route = frappe.get_route_str();
	if (route === "customer-board" && !frappe.user.has_role(["Sales Manager", "System Manager"])) {
		frappe.set_route("ib-customer-board");
	}
}
frappe.router.on("change", _ib_maybe_redirect_to_board);
frappe.after_ajax(function () { _ib_maybe_redirect_to_board(); });

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

// Latest frm to inject into — updated each time a submitted SI/DN form loads.
let _ib_ewb_frm = null;

// Address controls created by make_control — referenced by the frappe.call interceptor.
let _ib_ewb_bill_from_ctrl = null;
let _ib_ewb_dispatch_ctrl  = null;
let _ib_ewb_ship_to_ctrl   = null;

function ib_watch_ewaybill_dialog(frm) {
    _ib_ewb_frm = frm;

    // Patch frappe.ui.Dialog.prototype.show once — fires synchronously on every dialog open.
    if (frappe.ui.Dialog._ib_patched) return;
    frappe.ui.Dialog._ib_patched = true;

    // Persistent frappe.call interceptor — reads #ib-txn-type + address fields at call time.
    const _origCall = frappe.call.bind(frappe);
    frappe.call = function (opts, ...rest) {
        if (opts && typeof opts.method === "string" && opts.method.includes("generate_e_waybill")) {
            const sel       = document.getElementById("ib-txn-type");
            const txnType   = sel ? parseInt(sel.value, 10) : 1;
            opts.args = opts.args || {};
            opts.args.transaction_type = txnType;
            const billFrom  = (_ib_ewb_bill_from_ctrl?.get_value?.() || "").trim();
            const dispatch  = (_ib_ewb_dispatch_ctrl?.get_value?.()  || "").trim();
            const shipTo    = (_ib_ewb_ship_to_ctrl?.get_value?.()   || "").trim();
            if (billFrom) opts.args.bill_from_address   = billFrom;
            if (dispatch) opts.args.dispatch_from_address = dispatch;
            if (shipTo)   opts.args.ship_to_address     = shipTo;
        }
        return _origCall(opts, ...rest);
    };

    const _orig = frappe.ui.Dialog.prototype.show;
    frappe.ui.Dialog.prototype.show = function () {
        _orig.call(this);
        if (!_ib_ewb_frm) return;
        if (!this.title || !this.title.includes("e-Waybill")) return;
        const el = this.$wrapper && this.$wrapper[0];
        if (!el) return;
        // Small delay so Bootstrap finishes appending to body
        setTimeout(() => {
            if ($(el).find(".ib-sp-wrap").length) return;
            _ib_inject_self_pickup(el);
            _ib_populate_distance(_ib_ewb_frm);
        }, 80);
    };
}

async function _ib_populate_distance(frm) {
    try {
        const src_addr = frm.doc.company_address;
        const dst_addr = frm.doc.shipping_address_name || frm.doc.customer_address;
        if (!src_addr && !dst_addr) return;

        const [src_val, dst_val] = await Promise.all([
            src_addr ? frappe.db.get_value("Address", src_addr, ["pincode", "city", "state"]) : null,
            dst_addr ? frappe.db.get_value("Address", dst_addr, ["pincode", "city", "state"]) : null,
        ]);

        const src = src_val?.message;
        const dst = dst_val?.message;

        // Pre-fill pincode fields in the dialog UI
        const fromIn = document.getElementById("ib-from-pin");
        const toIn   = document.getElementById("ib-to-pin");
        if (fromIn && src?.pincode) fromIn.value = src.pincode;
        if (toIn   && dst?.pincode) toIn.value   = dst.pincode;

        // Auto-calculate if both pincodes available
        if (src?.pincode && dst?.pincode) {
            await _ib_calc_and_fill(src.pincode, dst.pincode, src, dst);
        }
    } catch (_) {}
}

async function _ib_calc_and_fill(fromPin, toPin, srcFallback, dstFallback) {
    const $result = $("#ib-dist-result");
    const $btn    = $("#ib-calc-dist");
    $result.text("Calculating…").css("color", "var(--text-muted)");
    $btn.prop("disabled", true);
    try {
        const [src_geo, dst_geo] = await Promise.all([
            _ib_geocode_addr(fromPin, srcFallback?.city, srcFallback?.state),
            _ib_geocode_addr(toPin,   dstFallback?.city, dstFallback?.state),
        ]);

        if (!src_geo || !dst_geo) {
            $result.text("Could not locate one or both pincodes.").css("color", "var(--red-500, #e74c3c)");
            return;
        }

        const dist = Math.max(1, Math.round(_ib_haversine(src_geo.lat, src_geo.lng, dst_geo.lat, dst_geo.lng)));

        // Set dialog distance field
        const distInput = document.querySelector('input[data-fieldname="distance"]');
        if (distInput) {
            distInput.value = dist;
            distInput.dispatchEvent(new Event("change", { bubbles: true }));
            distInput.dispatchEvent(new Event("input",  { bubbles: true }));
        }
        if (frappe.cur_dialog) frappe.cur_dialog.set_value("distance", dist);

        $result
            .html(`<span style="color:var(--green-600,#27ae60)">✓</span> <strong>${dist} km</strong> straight-line distance (pincode ${fromPin} → ${toPin})`)
            .css("color", "");
    } catch (e) {
        $result.text("Error calculating distance.").css("color", "var(--red-500, #e74c3c)");
    } finally {
        $btn.prop("disabled", false);
    }
}

async function _ib_geocode_addr(pincode, city, state) {
    // Try pincode first (countrycodes=in is the correct Nominatim param)
    if (pincode) {
        const r1 = await fetch(
            `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(pincode)}&countrycodes=in&format=json&limit=1`,
            { headers: { "Accept-Language": "en" } }
        );
        const d1 = await r1.json();
        if (d1.length) return { lat: parseFloat(d1[0].lat), lng: parseFloat(d1[0].lon) };
    }
    // Fallback: city + state search
    if (city) {
        const q = [city, state, "India"].filter(Boolean).join(", ");
        const r2 = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,
            { headers: { "Accept-Language": "en" } }
        );
        const d2 = await r2.json();
        if (d2.length) return { lat: parseFloat(d2[0].lat), lng: parseFloat(d2[0].lon) };
    }
    return null;
}

function _ib_haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _ib_inject_self_pickup(modal_el) {
    const $modal = $(modal_el);
    if ($modal.find(".ib-sp-wrap").length) return;

    const $part_a = $modal.find('[data-fieldname="section_part_a"]');
    if (!$part_a.length) return;

    const $row = $(`
        <div class="ib-sp-wrap" style="padding:8px 15px 10px;display:flex;align-items:center;gap:8px;
            border-bottom:1px solid var(--border-color);background:var(--subtle-fg,#f5f5f5);">
            <input type="checkbox" id="ib-self-pickup"
                style="width:14px;height:14px;cursor:pointer;accent-color:#d97757;flex-shrink:0;">
            <label for="ib-self-pickup"
                style="margin:0;font-size:12px;font-weight:600;cursor:pointer;user-select:none;">
                Self Pickup
            </label>
        </div>
    `);

    $part_a.before($row);

    // ── Transaction Type injected into the second field slot of section 1 ────────
    const $txnTarget = $modal.find('.form-page > div:nth-child(1) > .section-body > div:nth-child(2)');
    if ($txnTarget.length) {
        $txnTarget.append($(`
            <div class="frappe-control" data-fieldtype="Select" data-fieldname="ib_transaction_type"
                style="margin-bottom:0;">
                <div class="clearfix">
                    <label class="control-label"
                        style="padding-right:0;font-size:var(--text-sm);">Transaction Type</label>
                </div>
                <div class="control-input-wrapper">
                    <div class="control-input">
                        <select id="ib-txn-type" class="input-with-feedback form-control bold">
                            <option value="1">Regular</option>
                            <option value="2">Bill To - Ship To</option>
                            <option value="3">Bill From - Dispatch From</option>
                            <option value="4">Combination (2 &amp; 3)</option>
                        </select>
                    </div>
                </div>
            </div>
        `));
    }

    // ── Address fields — vertical stack, full-width, directly above self-pickup ──
    const $addrWrap = $(
        '<div class="ib-addr-wrap" ' +
        'style="display:none;padding:12px 15px 0;border-top:1px solid var(--border-color);"></div>'
    );

    const $billFromCol = $('<div></div>').appendTo($addrWrap);
    const $dispatchCol = $('<div></div>').appendTo($addrWrap);
    const $shipToCol   = $('<div></div>').appendTo($addrWrap);

    // Sits directly above self-pickup row
    $row.before($addrWrap);

    function _ib_make_addr_ctrl(label, fieldname, $parent) {
        const ctrl = frappe.ui.form.make_control({
            df: { label: __(label), fieldtype: "Data", fieldname },
            parent: $parent,
            render_input: true,
        });
        ctrl.$wrapper.find(".control-label").css("font-size", "var(--text-sm)");
        return ctrl;
    }

    _ib_ewb_bill_from_ctrl = _ib_make_addr_ctrl("Bill From Address",     "ib_bill_from_addr", $billFromCol);
    _ib_ewb_dispatch_ctrl  = _ib_make_addr_ctrl("Dispatch From Address", "ib_dispatch_addr",  $dispatchCol);
    _ib_ewb_ship_to_ctrl   = _ib_make_addr_ctrl("Ship To Address",       "ib_ship_to_addr",   $shipToCol);

    function _ib_update_addr_fields(val) {
        const showBillFrom = val === 3 || val === 4;
        const showDispatch = val === 3 || val === 4;
        const showShipTo   = val === 2 || val === 4;
        $addrWrap.css("display", (showBillFrom || showDispatch || showShipTo) ? "block" : "none");
        $billFromCol.css("display", showBillFrom ? "block" : "none");
        $dispatchCol.css("display", showDispatch ? "block" : "none");
        $shipToCol.css("display",   showShipTo   ? "block" : "none");
    }

    $("#ib-txn-type").on("change", function () {
        _ib_update_addr_fields(parseInt(this.value, 10));
    });



    // ── Pincode distance calculator ───────────────────────────────────────────────
    const $distField = $modal.find('[data-fieldname="distance"]').closest(".frappe-control");
    if ($distField.length) {
        const $calcWrap = $(`
            <div class="ib-dist-calc" style="
                margin: 8px 0 4px;
                padding: 10px 12px;
                background: var(--subtle-fg, #f7f7f7);
                border: 1px solid var(--border-color);
                border-radius: 6px;
            ">
                <div style="font-size:10px; font-weight:700; letter-spacing:.5px;
                             color:var(--text-muted); margin-bottom:7px; text-transform:uppercase;">
                    Pincode Distance Calculator
                </div>
                <div style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap;">
                    <div style="flex:1; min-width:90px;">
                        <label style="font-size:11px; color:var(--text-muted); display:block; margin-bottom:2px;">From Pincode</label>
                        <input id="ib-from-pin" type="text" maxlength="6"
                            placeholder="421302"
                            class="form-control"
                            style="font-size:12px; height:28px; padding:2px 8px;">
                    </div>
                    <div style="flex:1; min-width:90px;">
                        <label style="font-size:11px; color:var(--text-muted); display:block; margin-bottom:2px;">To Pincode</label>
                        <input id="ib-to-pin" type="text" maxlength="6"
                            placeholder="400703"
                            class="form-control"
                            style="font-size:12px; height:28px; padding:2px 8px;">
                    </div>
                    <button id="ib-calc-dist" class="btn btn-xs"
                        style="height:28px; padding:0 12px; background:var(--primary,#d97757);
                               color:#fff; border:none; border-radius:4px; font-size:11px;
                               cursor:pointer; flex-shrink:0;">
                        Calculate
                    </button>
                </div>
                <div id="ib-dist-result" style="margin-top:6px; font-size:11px; min-height:16px;"></div>
            </div>
        `);
        $distField.before($calcWrap);

        // Calculate button click
        $(document).off("click.ib_calc_dist").on("click.ib_calc_dist", "#ib-calc-dist", async function () {
            const fromPin = ($("#ib-from-pin").val() || "").trim();
            const toPin   = ($("#ib-to-pin").val()   || "").trim();
            if (!fromPin || !toPin) {
                $("#ib-dist-result")
                    .text("Enter both pincodes.")
                    .css("color", "var(--orange-500, #e67e22)");
                return;
            }
            await _ib_calc_and_fill(fromPin, toPin, null, null);
        });

        // Recalculate on pincode field Enter key
        $(document).off("keydown.ib_pin").on("keydown.ib_pin", "#ib-from-pin, #ib-to-pin", async function (e) {
            if (e.key === "Enter") $("#ib-calc-dist").trigger("click");
        });
    }

    document.addEventListener("change", function (e) {
        if (e.target.id === "ib-self-pickup") {
            const gst = document.querySelector('input[data-fieldname="gst_transporter_id"]');
            const trn = $modal.find('[data-fieldname="transporter"]').closest(".frappe-control")[0];
            const gstin = localStorage.getItem("ib_ewb_gstin") || "";
            if (e.target.checked) {
                if (gst) gst.value = gstin;
                if (trn) trn.style.display = "none";
            } else {
                if (gst) gst.value = "";
                if (trn) trn.style.display = "";
            }
        }

    });
}