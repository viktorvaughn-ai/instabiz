frappe.ui.form.on("Sales Invoice", {
	async refresh(frm) {
		if (frm.doc.docstatus === 1) {
			ib_watch_ewaybill_dialog(frm);
			let gstin = frm.doc.billing_address_gstin || frm.doc.shipping_address_gstin || "";
			if (!gstin && frm.doc.customer_address) {
				try {
					const r = await frappe.db.get_value("Address", frm.doc.customer_address, "gstin");
					gstin = r?.message?.gstin || "";
				} catch (_) {}
			}
			localStorage.setItem("ib_ewb_gstin", gstin);
		}

		if (frm.doc.docstatus === 0) {
			ib_si_setup_row_buttons(frm);
		}
	},
});

function ib_si_setup_row_buttons(frm) {
	const grid = frm.fields_dict.items && frm.fields_dict.items.grid;
	if (!grid) return;

	if (!grid._ib_si_patched) {
		grid._ib_si_patched = true;
		const _orig = grid.refresh.bind(grid);
		grid.refresh = function (...args) {
			const r = _orig(...args);
			ib_si_inject_row_btns(frm, grid);
			return r;
		};
	}

	ib_si_inject_row_btns(frm, grid);
}

function ib_si_inject_row_btns(frm, grid) {
	grid.wrapper.find(".grid-row").each(function () {
		const $row = $(this);
		if ($row.find(".ib-si-row-btns").length) return;

		const $openBtn = $row.find(".btn-open-row");
		if (!$openBtn.length) return;

		const $col = $openBtn.parent();
		$col.css({
			display: "flex",
			"align-items": "center",
			gap: "3px",
			"min-width": "68px",
			padding: "0 4px",
		});

		const $copy = $(
			`<button class="btn btn-xs btn-default ib-si-copy-btn" type="button" title="Copy row"
				style="height:22px;width:22px;padding:0;font-size:11px;flex-shrink:0;border-radius:3px">
				<i class="fa fa-copy"></i>
			</button>`
		);
		const $ndup = $(
			`<button class="btn btn-xs btn-default ib-si-ndup-btn" type="button" title="N copies"
				style="height:22px;width:22px;padding:0;font-size:11px;font-weight:700;flex-shrink:0;border-radius:3px">
				N
			</button>`
		);

		$copy.on("click", function (e) {
			e.stopPropagation();
			e.preventDefault();
			ib_si_copy_row(frm, parseInt($(this).closest(".grid-row").attr("data-idx")));
		});

		$ndup.on("click", function (e) {
			e.stopPropagation();
			e.preventDefault();
			ib_si_ndup_row(frm, parseInt($(this).closest(".grid-row").attr("data-idx")));
		});

		$('<span class="ib-si-row-btns" style="display:inline-flex;align-items:center;gap:3px"></span>')
			.append($copy)
			.append($ndup)
			.prependTo($col);
	});
}

const _SI_SKIP = new Set([
	"name", "idx", "creation", "modified", "modified_by",
	"owner", "docstatus", "__unedited",
]);

function ib_si_copy_row(frm, idx) {
	const src = frm.doc.items[idx - 1];
	if (!src) return;
	const row = frm.add_child("items");
	Object.keys(src).forEach(k => { if (!_SI_SKIP.has(k)) row[k] = src[k]; });
	frm.refresh_field("items");
	frm.dirty();
}

function ib_si_ndup_row(frm, idx) {
	frappe.prompt(
		{ label: __("Number of copies"), fieldname: "n", fieldtype: "Int", default: 2, reqd: 1 },
		({ n }) => {
			if (!n || n < 1) return;
			const src = frm.doc.items[idx - 1];
			if (!src) return;
			for (let i = 0; i < n; i++) {
				const row = frm.add_child("items");
				Object.keys(src).forEach(k => { if (!_SI_SKIP.has(k)) row[k] = src[k]; });
			}
			frm.refresh_field("items");
			frm.dirty();
		},
		__("How many copies?"),
		__("Create")
	);
}
