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
            console.log("[IB TxnType] inject:", txnType, "bill_from:", billFrom, "dispatch:", dispatch, "ship_to:", shipTo);
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
        const dst_addr = frm.doc.customer_address || frm.doc.shipping_address_name;
        if (!src_addr || !dst_addr) return;

        const [src_val, dst_val] = await Promise.all([
            frappe.db.get_value("Address", src_addr, ["pincode", "city", "state"]),
            frappe.db.get_value("Address", dst_addr, ["pincode", "city", "state"]),
        ]);

        const src = src_val?.message;
        const dst = dst_val?.message;
        if (!src || !dst) return;

        const [src_geo, dst_geo] = await Promise.all([
            _ib_geocode_addr(src.pincode, src.city, src.state),
            _ib_geocode_addr(dst.pincode, dst.city, dst.state),
        ]);
        if (!src_geo || !dst_geo) return;

        const dist = parseInt(_ib_haversine(src_geo.lat, src_geo.lng, dst_geo.lat, dst_geo.lng), 10);
        console.log("[IB Distance] calculated:", dist, "km");
        const distInput = document.querySelector('input[data-fieldname="distance"]');
        if (distInput) {
            distInput.value = dist;
            distInput.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const d = frappe.cur_dialog;
        if (d) d.set_value("distance", dist);
    } catch (_) {}
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



    document.addEventListener("change", function (e) {
        if (e.target.id === "ib-self-pickup") {
            const gst = document.querySelector('input[data-fieldname="gst_transporter_id"]');
            const trn = $modal.find('[data-fieldname="transporter"]').closest(".frappe-control")[0];
            const gstin = localStorage.getItem("ib_ewb_gstin") || "";
            console.log("[IB Self Pickup] checked:", e.target.checked, "| localStorage gstin:", gstin, "| gst input found:", !!gst, "| transporter found:", !!trn);
            if (e.target.checked) {
                if (gst) gst.value = gstin;
                if (trn) trn.style.display = "none";
            } else {
                if (gst) gst.value = "";
                if (trn) trn.style.display = "";
            }
            console.log("[IB Self Pickup] gst input value after set:", gst ? gst.value : "N/A");
        }

    });
}
