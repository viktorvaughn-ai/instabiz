/**
 * gstin.js
 * Bypasses India Compliance's paid API gate so GSTIN autofill works
 * with our free gstincheck.co.in backend override.
 */
frappe.after_ajax(function () {
    if (typeof india_compliance === "undefined") return;

    // Make IC think the API is active — our Python backend handles the real call
    india_compliance.is_api_enabled = function () { return true; };

    // Patch boot settings so the quick-entry form enables autofill
    const gs = frappe.boot.gst_settings;
    if (gs) {
        gs.sandbox_mode        = false;
        gs.autofill_party_info = true;
        gs.enable_api          = true;
    }

    // GSTIN format: 2-digit state + 5 alpha (PAN) + 4 digits + alpha + alphanum + Z + alphanum
    const GSTIN_REGEX  = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;

    // Intercept the GSTIN backend call to:
    //   • validate format before hitting the API (saves quota on typos)
    //   • show a loading spinner while fetching
    //   • clear the "Status: …" text IC writes after the result arrives
    const GSTIN_METHOD = "india_compliance.gst_india.utils.gstin_info.get_gstin_info";
    const _orig_call   = frappe.call.bind(frappe);

    frappe.call = function (opts, ...rest) {
        if (opts && opts.method === GSTIN_METHOD) {
            const gstin = (opts.args && opts.args.gstin || "").toUpperCase();
            const $desc = $('.modal:visible [data-fieldname="_gstin"] .help-box');

            // Reject invalid format before touching the API
            if (!GSTIN_REGEX.test(gstin)) {
                $desc.html(
                    '<span class="text-danger">' +
                    __("Invalid GSTIN format. Please check and re-enter.") +
                    '</span>'
                );
                // Return a resolved promise with empty message so IC's UI doesn't break
                return { then: (fn) => { fn({ message: {} }); return { always: (f) => f() }; } };
            }

            // Show loading spinner
            $desc.html(
                '<span class="ib-gstin-loading">' +
                '<span class="ib-gstin-spinner"></span>' +
                __("Fetching GSTIN info…") +
                '</span>'
            );

            const promise = _orig_call(opts, ...rest);
            promise.then(function () {
                setTimeout(function () {
                    $('.modal:visible [data-fieldname="_gstin"] .help-box').html("");
                }, 50);
            });
            return promise;
        }
        return _orig_call(opts, ...rest);
    };
});
