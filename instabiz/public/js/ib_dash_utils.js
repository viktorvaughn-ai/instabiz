/**
 * ib_dash_utils.js
 * Shared utilities for all IB dashboard pages.
 * Loaded globally via app_include_js.
 */

// ── countUp.js loader ──────────────────────────────────────────────────────────
let _ib_cu_promise = null;

window.ib_load_countup = function () {
	if (_ib_cu_promise) return _ib_cu_promise;
	if (window.CountUp) { _ib_cu_promise = Promise.resolve(); return _ib_cu_promise; }
	_ib_cu_promise = new Promise((resolve) => {
		const s = document.createElement("script");
		s.src = "https://cdnjs.cloudflare.com/ajax/libs/countUp.js/2.8.0/countUp.umd.min.js";
		s.onload  = resolve;
		s.onerror = () => { console.warn("IB: countUp.js CDN unavailable — animation skipped"); resolve(); };
		document.head.appendChild(s);
	});
	return _ib_cu_promise;
};

/**
 * Animate all [data-countup] elements within a jQuery-wrapped container.
 *   data-countup  = raw numeric value to count to
 *   data-cu-inr   = "1"  → format as ₹ Indian locale (overrides prefix)
 *   data-cu-prefix = "₹" (or any text prefix)
 *   data-cu-dec   = decimal places (default 0)
 *   data-cu-dur   = animation duration in seconds (default 1.2)
 */
window.ib_countup_all = async function ($container) {
	await window.ib_load_countup();
	if (!window.CountUp) return;
	($container || $(document)).find("[data-countup]").each(function () {
		const val    = parseFloat(this.dataset.countup) || 0;
		const isInr  = this.dataset.cuInr === "1";
		const prefix = isInr ? "" : (this.dataset.cuPrefix || "");
		const dec    = parseInt(this.dataset.cuDec  || "0", 10);
		const dur    = parseFloat(this.dataset.cuDur || "1.2");

		const opts = {
			duration: dur,
			decimalPlaces: dec,
			useGrouping: true,
			prefix,
		};
		if (isInr) {
			opts.formattingFn = (v) =>
				"₹" + (dec > 0
					? v.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec })
					: Math.round(v).toLocaleString("en-IN"));
		}
		const cu = new CountUp(this, val, opts);
		if (!cu.error) cu.start();
	});
};

// ── Skeleton HTML helpers ──────────────────────────────────────────────────────

/**
 * Return skeleton HTML for n KPI cards.
 * Caller should place these inside the KPI grid/row container.
 */
window.ib_skel_kpis = function (n) {
	return Array.from({ length: n || 4 }, () => `
		<div class="ib-skel-kpi-wrap">
			<span class="ib-skel ib-skel-lbl"></span>
			<span class="ib-skel ib-skel-val"></span>
			<span class="ib-skel ib-skel-sub"></span>
		</div>
	`).join("");
};

/** Return skeleton rows for a table body. */
window.ib_skel_rows = function (cols, rows) {
	const cells = Array.from({ length: cols || 4 }, () =>
		`<td><span class="ib-skel ib-skel-cell"></span></td>`
	).join("");
	return Array.from({ length: rows || 5 }, () => `<tr>${cells}</tr>`).join("");
};

// ── In-flight guard factory ────────────────────────────────────────────────────

/**
 * Wrap a frappe.call options object so that concurrent calls are suppressed.
 * Returns a new opts object with guarded callback/error.
 *   obj  - the object holding the `_fetching` flag (typically `this`)
 *   flag - property name for the flag (default "_fetching")
 */
window.ib_guarded_call = function (obj, opts, flag) {
	flag = flag || "_fetching";
	if (obj[flag]) return null;
	obj[flag] = true;
	const origCb  = opts.callback;
	const origErr = opts.error;
	opts.callback = function (...args) {
		obj[flag] = false;
		if (origCb) origCb.apply(this, args);
	};
	opts.error = function (...args) {
		obj[flag] = false;
		if (origErr) origErr.apply(this, args);
	};
	return opts;
};

// ── Tiny fmt helpers (mirrors per-dashboard copies) ───────────────────────────

/** Format a number as ₹ Indian locale, 0 decimals. */
window.ib_fmt_inr = function (v) {
	return "₹" + Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
};

/** Delta chip HTML — pos/neg/neu */
window.ib_delta_html = function (pct, suffix, cls_prefix) {
	const p = cls_prefix || "ib-delta";
	if (!pct && pct !== 0) return `<span class="${p} neu">—</span>`;
	if (pct === 0)          return `<span class="${p} neu">= vs last month</span>`;
	const sign = pct > 0 ? "▲" : "▼";
	const cls  = pct > 0 ? "pos" : "neg";
	return `<span class="${p} ${cls}">${sign} ${Math.abs(pct)}%${suffix ? " " + suffix : " vs last month"}</span>`;
};

// ── Multi-token search (client-side filter) ───────────────────────────────────
// Splits `query` on whitespace; every token must appear somewhere across the
// given fields for `row` to match — same "AND of tokens, OR of fields" logic
// already used ad-hoc in several custom pages (stock dashboard, customer
// board, price list). Use this instead of re-writing it per page.
//
//   ib_multi_token_match(row, ["customer_name", "territory"], "acme mum")
//   → true only if BOTH "acme" and "mum" appear somewhere in those two fields.
window.ib_multi_token_match = function (row, fields, query) {
	const tokens = (query || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
	if (!tokens.length) return true;
	const hay = fields.map((f) => (row[f] ?? "")).join(" ").toLowerCase();
	return tokens.every((t) => hay.includes(t));
};

/** Filter an array of row objects with ib_multi_token_match. */
window.ib_multi_token_filter = function (rows, fields, query) {
	if (!query || !query.trim()) return rows;
	return rows.filter((row) => window.ib_multi_token_match(row, fields, query));
};

/**
 * Debounced multi-token search box binder.
 *   ib_bind_search($input, 300, (query) => { ... })
 * Calls `on_search(query)` `delay`ms after typing stops. Caller decides
 * whether to filter client-side (ib_multi_token_filter) or re-fetch server-side.
 */
window.ib_bind_search = function ($input, delay, on_search) {
	let t;
	$input.off("input.ib_search").on("input.ib_search", function () {
		clearTimeout(t);
		const q = $(this).val();
		t = setTimeout(() => on_search(q), delay || 300);
	});
};
