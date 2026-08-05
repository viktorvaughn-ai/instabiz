frappe.pages["ib-bank-statement-import"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Bank Statement Import",
		single_column: true,
	});
	wrapper.page_obj = new IBBankStatementImport(page, wrapper);
};

class IBBankStatementImport {
	constructor(page, wrapper) {
		this.page = page;
		this.wrapper = wrapper;
		this.$main = $(wrapper).find(".layout-main-section");
		this._csv_text = null;
		this._preview_rows = [];
		this._bank_account = null;
		this._profile = null;
		this._render();
	}

	_render() {
		this.$main.empty().append(`
			<div class="ib-bsi-wrap">
				<div class="ib-bsi-card ib-card" style="max-width:820px;margin:0 auto;padding:28px 32px;">

					<!-- Bank account selector -->
					<div class="ib-bsi-field" style="margin-bottom:20px;">
						<label class="control-label">Bank Account</label>
						<div class="ib-bsi-bank-ctrl"></div>
					</div>

					<!-- Drop zone -->
					<div class="ib-bsi-drop" id="ib-bsi-drop">
						<svg width="40" height="40" fill="none" stroke="#adb5bd" stroke-width="1.5" viewBox="0 0 24 24">
							<path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M16 12l-4-4-4 4M12 8v8"/>
						</svg>
						<p style="margin:12px 0 4px;font-weight:600;color:var(--text-color);">
							Drop any bank's CSV here or <label for="ib-bsi-file" style="color:var(--ib-primary);cursor:pointer;text-decoration:underline;">browse</label>
						</p>
						<p style="font-size:12px;color:var(--text-muted);">Works with any bank's export — you'll map the columns once per bank account</p>
						<input type="file" id="ib-bsi-file" accept=".csv,.txt" style="display:none;">
					</div>

					<!-- Column mapping -->
					<div class="ib-bsi-mapping" style="display:none;margin-top:24px;">
						<h5 style="margin-bottom:4px;">Map Columns</h5>
						<p style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">This bank account has no saved mapping yet — tell us which column is which.</p>
						<div class="ib-bsi-map-form"></div>
						<div style="margin-top:14px;">
							<label style="font-size:13px;font-weight:normal;">
								<input type="checkbox" class="ib-bsi-save-profile" checked> Remember this mapping for this bank account
							</label>
						</div>
						<div style="margin-top:16px;">
							<button class="btn btn-primary btn-sm ib-bsi-map-continue">Continue</button>
						</div>
					</div>

					<!-- Preview -->
					<div class="ib-bsi-preview" style="display:none;margin-top:24px;">
						<div class="ib-bsi-summary" style="display:flex;gap:24px;margin-bottom:16px;flex-wrap:wrap;"></div>
						<div style="overflow-x:auto;">
							<table class="table table-bordered table-sm ib-bsi-table" style="font-size:12px;margin:0;">
								<thead>
									<tr style="background:var(--subtle-accent);">
										<th>Date</th>
										<th>Description</th>
										<th>Ref No</th>
										<th style="text-align:right;">Withdrawal (Dr)</th>
										<th style="text-align:right;">Deposit (Cr)</th>
									</tr>
								</thead>
								<tbody></tbody>
							</table>
						</div>
						<div class="ib-bsi-actions" style="margin-top:20px;display:flex;gap:12px;align-items:center;">
							<button class="btn btn-primary ib-bsi-import-btn">Import</button>
							<button class="btn btn-default ib-bsi-reset-btn">Clear</button>
							<span class="ib-bsi-status" style="font-size:13px;color:var(--text-muted);"></span>
						</div>
					</div>

					<!-- Result -->
					<div class="ib-bsi-result" style="display:none;margin-top:20px;"></div>
				</div>
			</div>
		`);

		this._setup_bank_ctrl();
		this._bind();
	}

	_setup_bank_ctrl() {
		this._bank_ctrl = frappe.ui.form.make_control({
			parent: this.$main.find(".ib-bsi-bank-ctrl")[0],
			df: {
				fieldtype: "Link",
				options: "Bank Account",
				fieldname: "bank_account",
				placeholder: "Select bank account…",
				get_query: () => ({ filters: { is_company_account: 1 } }),
			},
			render_input: true,
		});
		this._bank_ctrl.refresh();
	}

	_bind() {
		const $drop = this.$main.find("#ib-bsi-drop");
		const $file = this.$main.find("#ib-bsi-file");

		$drop.on("dragover", (e) => {
			e.preventDefault();
			$drop.addClass("ib-bsi-drop--active");
		});
		$drop.on("dragleave drop", (e) => {
			e.preventDefault();
			$drop.removeClass("ib-bsi-drop--active");
			if (e.type === "drop") this._load_file(e.originalEvent.dataTransfer.files[0]);
		});
		$file.on("change", (e) => {
			if (e.target.files[0]) this._load_file(e.target.files[0]);
		});

		this.$main.on("click", ".ib-bsi-map-continue", () => this._on_mapping_continue());
		this.$main.on("click", ".ib-bsi-import-btn", () => this._do_import());
		this.$main.on("click", ".ib-bsi-reset-btn", () => this._reset());
	}

	_load_file(file) {
		if (!file) return;
		const bank_account = this._bank_ctrl.get_value();
		if (!bank_account) {
			frappe.msgprint("Select a bank account first.");
			return;
		}
		this._bank_account = bank_account;

		const reader = new FileReader();
		reader.onload = (e) => {
			this._csv_text = e.target.result;
			this._resolve_mapping();
		};
		reader.readAsText(file);
	}

	_resolve_mapping() {
		frappe.call({
			method: "instabiz.instabiz.page.ib_bank_statement_import.ib_bank_statement_import.get_saved_profile",
			args: { bank_account: this._bank_account },
			callback: (r) => {
				if (r.message) {
					this._profile = r.message;
					this._preview();
				} else {
					this._show_mapping_form();
				}
			},
		});
	}

	_show_mapping_form() {
		frappe.call({
			method: "instabiz.instabiz.page.ib_bank_statement_import.ib_bank_statement_import.get_csv_headers",
			args: { csv_text: this._csv_text },
			freeze: true,
			freeze_message: "Reading file…",
			callback: (r) => {
				if (r.exc) return;
				this._render_mapping_form(r.message.headers, r.message.samples);
			},
		});
	}

	_render_mapping_form(headers, samples) {
		const opts = ["", ...headers].map((h) => `<option value="${frappe.utils.escape_html(h)}">${frappe.utils.escape_html(h || "— none —")}</option>`).join("");
		const $form = this.$main.find(".ib-bsi-map-form").empty();

		const row = (label, cls, required) => `
			<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
				<label style="width:180px;font-size:13px;margin:0;">${label}${required ? " *" : ""}</label>
				<select class="form-control input-sm ${cls}" style="max-width:260px;">${opts}</select>
			</div>
		`;

		$form.append(`
			<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
				<label style="width:180px;font-size:13px;margin:0;">Column Layout *</label>
				<select class="form-control input-sm ib-bsi-map-mode" style="max-width:260px;">
					<option value="Separate Debit/Credit Columns">Separate Debit/Credit columns</option>
					<option value="Single Amount Column">Single Amount column</option>
				</select>
			</div>
		`);
		$form.append(row("Date Column", "ib-bsi-map-date", true));
		$form.append(row("Description Column", "ib-bsi-map-desc", false));
		$form.append(row("Reference No. Column", "ib-bsi-map-ref", false));
		$form.append(`<div class="ib-bsi-map-dc">${row("Debit/Withdrawal Column", "ib-bsi-map-debit", false)}${row("Credit/Deposit Column", "ib-bsi-map-credit", false)}</div>`);
		$form.append(`<div class="ib-bsi-map-single" style="display:none;">${row("Amount Column", "ib-bsi-map-amount", false)}${row("Type Column (Dr/Cr)", "ib-bsi-map-type", false)}`
			+ `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><label style="width:180px;font-size:13px;margin:0;">Credit Indicator Value</label>`
			+ `<input type="text" class="form-control input-sm ib-bsi-map-credit-indicator" style="max-width:260px;" placeholder="e.g. CR"></div></div>`);

		if (samples && samples.length) {
			$form.append(`<p style="font-size:11px;color:var(--text-muted);margin-top:6px;">Sample row: ${frappe.utils.escape_html(JSON.stringify(samples[0]))}</p>`);
		}

		$form.find(".ib-bsi-map-mode").on("change", (e) => {
			const single = e.target.value === "Single Amount Column";
			$form.find(".ib-bsi-map-dc").toggle(!single);
			$form.find(".ib-bsi-map-single").toggle(single);
		});

		this.$main.find(".ib-bsi-mapping").show();
		this.$main.find(".ib-bsi-preview").hide();
		this.$main.find(".ib-bsi-result").hide().empty();
	}

	_on_mapping_continue() {
		const $form = this.$main.find(".ib-bsi-map-form");
		const mode = $form.find(".ib-bsi-map-mode").val();
		const col_date = $form.find(".ib-bsi-map-date").val();
		if (!col_date) {
			frappe.msgprint("Date column is required.");
			return;
		}
		const profile = {
			mode,
			col_date,
			col_description: $form.find(".ib-bsi-map-desc").val() || null,
			col_reference: $form.find(".ib-bsi-map-ref").val() || null,
			col_debit: $form.find(".ib-bsi-map-debit").val() || null,
			col_credit: $form.find(".ib-bsi-map-credit").val() || null,
			col_amount: $form.find(".ib-bsi-map-amount").val() || null,
			col_type: $form.find(".ib-bsi-map-type").val() || null,
			credit_indicator: $form.find(".ib-bsi-map-credit-indicator").val() || null,
		};
		this._profile = profile;

		const save = this.$main.find(".ib-bsi-save-profile").is(":checked");
		if (save) {
			frappe.call({
				method: "instabiz.instabiz.page.ib_bank_statement_import.ib_bank_statement_import.save_profile",
				args: { bank_account: this._bank_account, profile },
			});
		}

		this.$main.find(".ib-bsi-mapping").hide();
		this._preview();
	}

	_preview() {
		frappe.call({
			method: "instabiz.instabiz.page.ib_bank_statement_import.ib_bank_statement_import.preview_statement",
			args: { bank_account: this._bank_account, csv_text: this._csv_text, profile: this._profile },
			freeze: true,
			freeze_message: "Parsing statement…",
			callback: (r) => {
				if (r.exc) return;
				const d = r.message;
				this._preview_rows = d.rows;
				this._render_preview(d);
			},
		});
	}

	_render_preview(d) {
		const fmt = (n) => frappe.format(n, { fieldtype: "Currency" });

		const $sum = this.$main.find(".ib-bsi-summary").empty();
		[
			["Transactions", d.count, "#2d6a4f"],
			["Total Deposits", fmt(d.total_deposit), "#1a6b3c"],
			["Total Withdrawals", fmt(d.total_withdrawal), "#c0392b"],
		].forEach(([label, val, color]) => {
			$sum.append(`
				<div style="background:var(--card-bg);border:1px solid var(--border-color);border-radius:8px;padding:10px 18px;">
					<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;">${label}</div>
					<div style="font-size:18px;font-weight:700;color:${color};">${val}</div>
				</div>
			`);
		});

		const $tbody = this.$main.find(".ib-bsi-table tbody").empty();
		d.rows.forEach((r) => {
			const desc = frappe.utils.escape_html(r.description || "");
			const ref  = frappe.utils.escape_html(r.reference_number || "—");
			$tbody.append(`
				<tr>
					<td style="white-space:nowrap;">${frappe.format(r.date, { fieldtype: "Date" })}</td>
					<td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${desc}">${desc}</td>
					<td>${ref}</td>
					<td style="text-align:right;color:#c0392b;">${r.withdrawal ? fmt(r.withdrawal) : "—"}</td>
					<td style="text-align:right;color:#1a6b3c;">${r.deposit ? fmt(r.deposit) : "—"}</td>
				</tr>
			`);
		});

		this.$main.find(".ib-bsi-preview").show();
		this.$main.find(".ib-bsi-result").hide().empty();
		this.$main.find(".ib-bsi-status").text("");
	}

	_do_import() {
		if (!this._preview_rows.length) return;

		this.$main.find(".ib-bsi-import-btn").prop("disabled", true).text("Importing…");

		frappe.call({
			method: "instabiz.instabiz.page.ib_bank_statement_import.ib_bank_statement_import.import_statement",
			args: { bank_account: this._bank_account, csv_text: this._csv_text, profile: this._profile },
			freeze: true,
			freeze_message: "Creating Bank Transactions…",
			callback: (r) => {
				this.$main.find(".ib-bsi-import-btn").prop("disabled", false).text("Import");
				if (r.exc) return;
				this._render_result(r.message);
			},
		});
	}

	_render_result(res) {
		const has_errors = res.errors && res.errors.length;
		const $result = this.$main.find(".ib-bsi-result").empty().show();

		let html = `
			<div class="alert alert-${res.created ? "success" : "warning"}" style="border-radius:8px;">
				<strong>${res.created} transaction${res.created !== 1 ? "s" : ""} imported.</strong>
				${res.auto_matched ? `&nbsp; ${res.auto_matched} auto-matched to an open document and reconciled with a Payment Entry.` : ""}
				${res.skipped ? `&nbsp; ${res.skipped} skipped (duplicates).` : ""}
				${has_errors ? `&nbsp; <span class="text-danger">${res.errors.length} errors.</span>` : ""}
			</div>
		`;

		if (has_errors) {
			html += `<div style="font-size:12px;color:var(--text-muted);margin-top:8px;">`;
			res.errors.forEach((e) => {
				html += `<div>• ${e.row.date} ${e.row.description}: <span class="text-danger">${e.error}</span></div>`;
			});
			html += `</div>`;
		}

		if (res.created) {
			html += `
				<div style="margin-top:16px;display:flex;gap:10px;">
					<a href="/app/bank-reconciliation-tool" class="btn btn-sm btn-default">
						Open Bank Reconciliation Tool →
					</a>
					<a href="/app/query-report/IB Bank Reconciliation" class="btn btn-sm btn-default">
						View Reconciliation Status →
					</a>
				</div>
			`;
		}

		$result.html(html);
		this.$main.find(".ib-bsi-preview").hide();
	}

	_reset() {
		this._csv_text = null;
		this._preview_rows = [];
		this._profile = null;
		this.$main.find(".ib-bsi-mapping").hide();
		this.$main.find(".ib-bsi-preview").hide();
		this.$main.find(".ib-bsi-result").hide().empty();
		this.$main.find("#ib-bsi-file").val("");
	}
}
