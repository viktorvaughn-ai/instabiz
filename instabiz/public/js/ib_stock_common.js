window.IBStock = (function () {

	function highlight(raw, tokens) {
		let text = frappe.utils.escape_html(raw || "");
		if (!tokens || !tokens.length) return text;
		tokens.forEach(t => {
			const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
			text = text.replace(re, m => `<mark class="ib-search-hl">${m}</mark>`);
		});
		return text;
	}

	function color_dots(color_str) {
		if (!color_str) return "";
		const map   = window.IB_COLOR_MAP || {};
		const names = color_str.split(/\s*[\/&+]\s*|\s+and\s+/i).map(s => s.trim()).filter(Boolean);
		return names.map(name => {
			const hex = map[name.toLowerCase()];
			if (hex === null) return `<span class="ib-color-dot ib-color-dot--checker" title="${name}"></span>`;
			const bg  = hex ? `background:${hex};` : "background:#D1D5DB;";
			return `<span class="ib-color-dot" style="${bg}" title="${name}"></span>`;
		}).join("");
	}

	function sort_rows(rows, col, asc) {
		if (!col) return rows;
		return [...rows].sort((a, b) => {
			const va = a[col], vb = b[col];
			if (typeof va === "number" && typeof vb === "number")
				return asc ? va - vb : vb - va;
			return asc
				? String(va ?? "").localeCompare(String(vb ?? ""))
				: String(vb ?? "").localeCompare(String(va ?? ""));
		});
	}

	function csv_download(filename, headers, rows, row_fn) {
		const esc   = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
		const lines = [headers.map(esc).join(",")];
		rows.forEach(r => lines.push(row_fn(r).map(esc).join(",")));
		const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
		const url  = URL.createObjectURL(blob);
		const a    = document.createElement("a");
		a.href     = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	function make_live(route, on_update) {
		let _active = false, _timer = null;
		return {
			start() {
				if (!_active) { frappe.realtime.doctype_subscribe("Bin"); _active = true; }
				frappe.realtime.off("ib_stock_update");
				frappe.realtime.on("ib_stock_update", () => {
					if (frappe.get_route()[0] !== route) return;
					clearTimeout(_timer);
					_timer = setTimeout(on_update, 1500);
				});
			},
			stop() {
				frappe.realtime.off("ib_stock_update");
				if (_active) { frappe.realtime.doctype_unsubscribe("Bin"); _active = false; }
				clearTimeout(_timer);
			},
		};
	}

	function make_auto_refresh(secs, route, callback) {
		let _timer = null;
		function _schedule() {
			_timer = setTimeout(() => {
				_timer = null;
				if (document.hidden || frappe.get_route()[0] !== route) { _schedule(); return; }
				callback();
			}, secs * 1000);
		}
		return {
			start() { if (_timer) clearTimeout(_timer); _schedule(); },
			stop()  { if (_timer) { clearTimeout(_timer); _timer = null; } },
		};
	}

	return { highlight, color_dots, sort_rows, csv_download, make_live, make_auto_refresh };
})();
