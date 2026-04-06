/**
 * instabiz.pincode — shared pincode autofill utility
 *
 * Usage:
 *   instabiz.pincode.autofill(frm, pincode_fieldname, {
 *     city:      "city",        // fieldname to fill city (or null to skip)
 *     district:  "custom_district", // fieldname to fill district (or null)
 *     territory: "territory",   // Link fieldname to fill territory (or null)
 *     state:     "state",       // Data fieldname to fill state text (or null)
 *   });
 */

window.instabiz = window.instabiz || {};

instabiz.pincode = {
	autofill: function (frm, pincode_fieldname, opts) {
		const pincode = (frm.doc[pincode_fieldname] || "").trim();

		if (!/^\d{6}$/.test(pincode)) {
			frm.set_df_property(pincode_fieldname, "description", "");
			return;
		}

		frm.set_df_property(pincode_fieldname, "description",
			`<span style="color:var(--ib-primary,#d97757);">Looking up…</span>`);

		frappe.call({
			method: "instabiz.overrides.lead.get_pincode_info",
			args:   { pincode },
			callback: function (r) {
				if (!r.message) {
					frm.set_df_property(pincode_fieldname, "description",
						`<span style="color:var(--red,#e53e3e);">No data found for this pincode</span>`);
					return;
				}

				frm.set_df_property(pincode_fieldname, "description", "");
				const info = r.message;

				if (opts.city      && info.city)      frm.set_value(opts.city,      info.city);
				if (opts.district  && info.district)  frm.set_value(opts.district,  info.district);
				if (opts.state     && info.state)     frm.set_value(opts.state,     info.state);
				if (opts.territory && info.territory) frm.set_value(opts.territory, info.territory);
			},
			error: function () {
				frm.set_df_property(pincode_fieldname, "description",
					`<span style="color:var(--red,#e53e3e);">Lookup failed, please try again</span>`);
			},
		});
	},
};
