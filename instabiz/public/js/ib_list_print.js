// ── IB List Print — shared print utility for all list views ──────────────────
// ib_setup_list_print(listview, doctype)       → "Print List" in actions menu
// ib_setup_party_ledger_print(listview, type)  → "Print Ledger" for selection
// ib_setup_gl_print(listview)                  → "Print GL" for GL Entry list

const _IB_BRAND = "#d97757";

// ── Column definitions ────────────────────────────────────────────────────────
const _IB_LP_COLS = {
    "Customer": [
        { f: "name",                        l: "Customer",      bold: true },
        { f: "gstin",                       l: "GSTIN" },
        { f: "territory",                   l: "State" },
        { f: "custom_contact_person_name",  l: "Contact Person" },
        { f: "mobile_no",                   l: "Mobile" },
        { f: "custom_sales_person",         l: "Handled By" },
    ],
    "Lead": [
        { f: "lead_name",           l: "Name",        bold: true },
        { f: "company_name",        l: "Company" },
        { f: "custom_status",       l: "Status",      badge: true },
        { f: "territory",           l: "State" },
        { f: "lead_owner",          l: "Owner" },
    ],
    "Quotation": [
        { f: "name",                l: "Quotation #",  bold: true },
        { f: "transaction_date",    l: "Date",         date: true },
        { f: "party_name",          l: "Customer" },
        { f: "grand_total",         l: "Amount",       currency: true, right: true },
        { f: "status",              l: "Status",       badge: true },
        { f: "custom_sales_person", l: "Sales Person" },
    ],
    "Sales Order": [
        { f: "name",                l: "Order #",      bold: true },
        { f: "transaction_date",    l: "Date",         date: true },
        { f: "customer",            l: "Customer" },
        { f: "rounded_total",       l: "Amount",       currency: true, right: true },
        { f: "status",              l: "Status",       badge: true },
        { f: "custom_sales_person", l: "Sales Person" },
    ],
    "Delivery Note": [
        { f: "name",                l: "DN #",         bold: true },
        { f: "posting_date",        l: "Date",         date: true },
        { f: "customer",            l: "Customer" },
        { f: "rounded_total",       l: "Amount",       currency: true, right: true },
        { f: "status",              l: "Status",       badge: true },
        { f: "custom_sales_person", l: "Sales Person" },
    ],
    "Sales Invoice": [
        { f: "name",                l: "Invoice #",    bold: true },
        { f: "posting_date",        l: "Date",         date: true },
        { f: "customer",            l: "Customer" },
        { f: "grand_total",         l: "Amount",       currency: true, right: true },
        { f: "outstanding_amount",  l: "Outstanding",  currency: true, right: true },
        { f: "status",              l: "Status",       badge: true },
        { f: "custom_sales_person", l: "Sales Person" },
    ],
    "Purchase Order": [
        { f: "name",             l: "PO #",          bold: true },
        { f: "transaction_date", l: "Date",           date: true },
        { f: "supplier",         l: "Supplier" },
        { f: "grand_total",      l: "Amount",         currency: true, right: true },
        { f: "status",           l: "Status",         badge: true },
    ],
    "Purchase Receipt": [
        { f: "name",         l: "GRN #",         bold: true },
        { f: "posting_date", l: "Date",           date: true },
        { f: "supplier",     l: "Supplier" },
        { f: "total",        l: "Amount",         currency: true, right: true },
        { f: "status",       l: "Status",         badge: true },
    ],
    "Purchase Invoice": [
        { f: "name",                l: "Invoice #",    bold: true },
        { f: "posting_date",        l: "Date",         date: true },
        { f: "supplier",            l: "Supplier" },
        { f: "grand_total",         l: "Amount",       currency: true, right: true },
        { f: "outstanding_amount",  l: "Outstanding",  currency: true, right: true },
        { f: "status",              l: "Status",       badge: true },
    ],
    "GL Entry": [
        { f: "posting_date", l: "Date",         date: true },
        { f: "account",      l: "Account",      bold: true },
        { f: "party_type",   l: "Party Type" },
        { f: "party",        l: "Party" },
        { f: "voucher_type", l: "Voucher Type" },
        { f: "voucher_no",   l: "Voucher #" },
        { f: "debit",        l: "Debit",        currency: true, right: true },
        { f: "credit",       l: "Credit",       currency: true, right: true },
        { f: "remarks",      l: "Remarks" },
    ],
};

// ── Cached company info ───────────────────────────────────────────────────────
let _ib_lp_company = null;

async function _ib_lp_fetch_company() {
    if (_ib_lp_company) return _ib_lp_company;
    const r = await frappe.call({
        method: "instabiz.overrides.list_print.get_print_company_info",
    });
    _ib_lp_company = r.message || {};
    return _ib_lp_company;
}

// ── Open print window ─────────────────────────────────────────────────────────
function _ib_lp_open(html) {
    const w = window.open("", "_blank", "width=1100,height=800");
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.onload = () => w.print();
}

// ── Format helpers ────────────────────────────────────────────────────────────
function _ib_lp_fmt_date(v) {
    if (!v) return "";
    return frappe.datetime.str_to_user((v + "").split(" ")[0]);
}

function _ib_lp_fmt_currency(v) {
    if (v === null || v === undefined || v === "") return "";
    const n = parseFloat(v) || 0;
    return "₹ " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _ib_lp_cell(col, row) {
    let v = row[col.f];
    if (v === null || v === undefined) v = "";
    if (col.date)     v = _ib_lp_fmt_date(v);
    if (col.currency) v = _ib_lp_fmt_currency(v);
    if (col.bold)     v = `<strong>${frappe.utils.escape_html(v)}</strong>`;
    else if (!col.currency) v = frappe.utils.escape_html(v + "");
    return v;
}

// ── Status badge colors ───────────────────────────────────────────────────────
const _IB_STATUS_COLORS = {
    Draft: "#e74c3c", Pending: "#e67e22", Confirmed: "#27ae60",
    Completed: "#27ae60", Paid: "#27ae60", Unpaid: "#e67e22",
    Overdue: "#e74c3c", Cancelled: "#95a5a6", Return: "#7f8c8d",
    "Return Issued": "#95a5a6", "To Receive and Bill": "#e67e22",
    "To Receive": "#3498db", "To Bill": "#f1c40f",
    Lost: "#e74c3c", Converted: "#27ae60", "Hot Lead": "#e67e22",
    "Cold Lead": "#95a5a6", Qualified: "#3498db",
};

function _ib_lp_badge(v) {
    const color = _IB_STATUS_COLORS[v] || "#7f8c8d";
    return `<span style="display:inline-block;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:600;background:${color}20;color:${color};border:1px solid ${color}60">${frappe.utils.escape_html(v)}</span>`;
}

// ── Describe active filters for print header ──────────────────────────────────
function _ib_lp_filter_desc(listview) {
    try {
        const filters = listview.filter_area.get();
        if (!filters || !filters.length) return "";
        return filters
            .map(f => `${f[1]} ${f[2]} ${f[3]}`)
            .filter(s => !s.includes("docstatus"))
            .join("  ·  ");
    } catch (_) { return ""; }
}

// ── Print CSS ─────────────────────────────────────────────────────────────────
function _ib_lp_css() {
    return `
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; font-size: 11px; color: #1a1a1a; background: #fff; }
        .page { max-width: 1050px; margin: 0 auto; padding: 18px 20px; }
        .header { display: flex; align-items: flex-start; justify-content: space-between;
                  border-bottom: 2px solid ${_IB_BRAND}; padding-bottom: 10px; margin-bottom: 12px; }
        .header-left { display: flex; align-items: center; gap: 12px; }
        .logo { height: 44px; width: auto; object-fit: contain; }
        .co-name { font-size: 16px; font-weight: 700; color: ${_IB_BRAND}; }
        .co-meta { font-size: 10px; color: #555; margin-top: 2px; line-height: 1.5; }
        .header-right { text-align: right; font-size: 10px; color: #555; }
        .print-title { font-size: 15px; font-weight: 700; color: #1a1a1a; }
        .print-meta { margin-top: 3px; color: #777; font-size: 10px; }
        .filter-bar { background: #f9f4f0; border-left: 3px solid ${_IB_BRAND};
                      padding: 5px 10px; margin-bottom: 12px; font-size: 10px; color: #555;
                      border-radius: 0 4px 4px 0; }
        table { width: 100%; border-collapse: collapse; }
        thead tr { background: ${_IB_BRAND}; color: #fff; }
        thead th { padding: 6px 8px; font-size: 10px; font-weight: 700;
                   letter-spacing: 0.3px; text-transform: uppercase; white-space: nowrap; }
        thead th.r { text-align: right; }
        tbody tr { border-bottom: 1px solid #eee; }
        tbody tr:nth-child(even) { background: #fdf6f2; }
        tbody td { padding: 5px 8px; vertical-align: middle; }
        tbody td.r { text-align: right; font-variant-numeric: tabular-nums; }
        .footer { margin-top: 14px; display: flex; justify-content: space-between;
                  border-top: 1px solid #ddd; padding-top: 8px; color: #888; font-size: 10px; }
        .total-row td { font-weight: 700; background: #f9f4f0 !important;
                        border-top: 2px solid ${_IB_BRAND}; }
        @media print {
            body { font-size: 10px; }
            .page { padding: 0; max-width: 100%; }
            .header { margin-bottom: 8px; }
            tbody tr:nth-child(even) { background: #fafafa !important; print-color-adjust: exact; }
            thead tr { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            .filter-bar { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
    `;
}

// ── Build print HTML ──────────────────────────────────────────────────────────
function _ib_lp_build_html(title, cols, rows, company, filter_desc, currency) {
    currency = currency || "INR";

    // Company header
    const addr = company.address;
    const addr_str = addr
        ? [addr.address_line1, addr.address_line2, addr.city, addr.state, addr.pincode]
            .filter(Boolean).join(", ")
        : "";
    const logo_html = company.logo
        ? `<img src="${company.logo}" class="logo" alt="">`
        : "";
    const gstin_str = company.gstin ? `GSTIN: ${company.gstin}` : "";

    const co_html = `
        <div class="header">
            <div class="header-left">
                ${logo_html}
                <div>
                    <div class="co-name">${frappe.utils.escape_html(company.name || "")}</div>
                    <div class="co-meta">
                        ${addr_str ? frappe.utils.escape_html(addr_str) + "<br>" : ""}
                        ${gstin_str ? frappe.utils.escape_html(gstin_str) : ""}
                    </div>
                </div>
            </div>
            <div class="header-right">
                <div class="print-title">${frappe.utils.escape_html(title)}</div>
                <div class="print-meta">
                    Printed: ${frappe.datetime.str_to_user(frappe.datetime.get_today())}<br>
                    ${rows.length} record${rows.length !== 1 ? "s" : ""}
                </div>
            </div>
        </div>
        ${filter_desc ? `<div class="filter-bar">Filters: ${frappe.utils.escape_html(filter_desc)}</div>` : ""}
    `;

    // Table
    const thead = `<thead><tr><th style="width:30px">#</th>${
        cols.map(c => `<th${c.right ? ' class="r"' : ""}>${frappe.utils.escape_html(c.l)}</th>`).join("")
    }</tr></thead>`;

    // Compute currency totals
    const currency_cols = cols.filter(c => c.currency);
    const totals = {};
    currency_cols.forEach(c => { totals[c.f] = 0; });

    const tbody_rows = rows.map((row, i) => {
        currency_cols.forEach(c => { totals[c.f] += parseFloat(row[c.f] || 0); });
        const cells = cols.map(c => {
            let v;
            if (c.badge) v = _ib_lp_badge(row[c.f] || "");
            else v = _ib_lp_cell(c, row);
            return `<td${c.right ? ' class="r"' : ""}>${v}</td>`;
        }).join("");
        return `<tr><td style="color:#888;font-size:10px">${i + 1}</td>${cells}</tr>`;
    }).join("");

    // Totals row (if any currency col)
    let totals_row = "";
    if (currency_cols.length && rows.length > 1) {
        const tot_cells = cols.map(c => {
            if (c.currency) return `<td class="r">${_ib_lp_fmt_currency(totals[c.f])}</td>`;
            return `<td></td>`;
        }).join("");
        totals_row = `<tr class="total-row"><td style="font-size:10px;color:#888">Σ</td>${tot_cells}</tr>`;
    }

    const table_html = `<table>${thead}<tbody>${tbody_rows}${totals_row}</tbody></table>`;

    const footer_html = `
        <div class="footer">
            <span>${frappe.utils.escape_html(company.name || "")} — Confidential</span>
            <span>Instabiz &nbsp;·&nbsp; ${frappe.datetime.now_datetime().split(" ")[0]}</span>
        </div>
    `;

    return `<!DOCTYPE html><html><head>
        <meta charset="utf-8">
        <title>${frappe.utils.escape_html(title)}</title>
        <style>${_ib_lp_css()}</style>
    </head><body>
        <div class="page">${co_html}${table_html}${footer_html}</div>
    </body></html>`;
}

// ── Build party ledger HTML ───────────────────────────────────────────────────
function _ib_lp_build_ledger_html(party_type, party, entries, from_date, to_date, company) {
    const addr = company.address;
    const addr_str = addr
        ? [addr.address_line1, addr.address_line2, addr.city, addr.state, addr.pincode]
            .filter(Boolean).join(", ")
        : "";
    const logo_html = company.logo ? `<img src="${company.logo}" class="logo" alt="">` : "";
    const gstin_str = company.gstin ? `GSTIN: ${company.gstin}` : "";

    const date_range = (from_date || to_date)
        ? `Period: ${from_date ? _ib_lp_fmt_date(from_date) : "All"} – ${to_date ? _ib_lp_fmt_date(to_date) : "Today"}`
        : "All Dates";

    const co_html = `
        <div class="header">
            <div class="header-left">
                ${logo_html}
                <div>
                    <div class="co-name">${frappe.utils.escape_html(company.name || "")}</div>
                    <div class="co-meta">
                        ${addr_str ? frappe.utils.escape_html(addr_str) + "<br>" : ""}
                        ${gstin_str ? frappe.utils.escape_html(gstin_str) : ""}
                    </div>
                </div>
            </div>
            <div class="header-right">
                <div class="print-title">${frappe.utils.escape_html(party_type)} Ledger</div>
                <div class="print-meta" style="font-size:12px;font-weight:600;color:#1a1a1a;margin-top:4px">
                    ${frappe.utils.escape_html(party)}
                </div>
                <div class="print-meta">${frappe.utils.escape_html(date_range)}</div>
            </div>
        </div>
    `;

    const thead = `<thead><tr>
        <th>Date</th><th>Voucher Type</th><th>Voucher #</th>
        <th>Remarks</th>
        <th class="r">Debit (₹)</th><th class="r">Credit (₹)</th><th class="r">Balance (₹)</th>
    </tr></thead>`;

    let total_debit = 0, total_credit = 0;
    const rows_html = entries.map((e, i) => {
        total_debit  += e.debit  || 0;
        total_credit += e.credit || 0;
        const bal_color = (e.balance || 0) > 0 ? "#e74c3c" : "#27ae60";
        return `<tr>
            <td>${_ib_lp_fmt_date(e.posting_date)}</td>
            <td>${frappe.utils.escape_html(e.voucher_type || "")}</td>
            <td><strong>${frappe.utils.escape_html(e.voucher_no || "")}</strong></td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                title="${frappe.utils.escape_html(e.remarks || "")}">${frappe.utils.escape_html((e.remarks || "").substring(0, 60))}</td>
            <td class="r">${e.debit ? _ib_lp_fmt_currency(e.debit) : ""}</td>
            <td class="r">${e.credit ? _ib_lp_fmt_currency(e.credit) : ""}</td>
            <td class="r" style="color:${bal_color};font-weight:600">${_ib_lp_fmt_currency(Math.abs(e.balance || 0))} ${(e.balance || 0) >= 0 ? "Dr" : "Cr"}</td>
        </tr>`;
    }).join("");

    const final_balance = entries.length ? entries[entries.length - 1].balance || 0 : 0;
    const bal_color = final_balance > 0 ? "#e74c3c" : "#27ae60";

    const totals_row = entries.length ? `<tr class="total-row">
        <td colspan="4" style="font-weight:700">Total</td>
        <td class="r">${_ib_lp_fmt_currency(total_debit)}</td>
        <td class="r">${_ib_lp_fmt_currency(total_credit)}</td>
        <td class="r" style="color:${bal_color}">${_ib_lp_fmt_currency(Math.abs(final_balance))} ${final_balance >= 0 ? "Dr" : "Cr"}</td>
    </tr>` : "";

    const no_data = entries.length === 0
        ? `<tr><td colspan="7" style="text-align:center;padding:20px;color:#888">No entries found</td></tr>`
        : "";

    const table_html = `<table>${thead}<tbody>${rows_html}${no_data}${totals_row}</tbody></table>`;

    const footer_html = `
        <div class="footer">
            <span>${frappe.utils.escape_html(company.name || "")} — Confidential</span>
            <span>Printed: ${frappe.datetime.str_to_user(frappe.datetime.get_today())}</span>
        </div>
    `;

    return `<!DOCTYPE html><html><head>
        <meta charset="utf-8">
        <title>${frappe.utils.escape_html(party_type)} Ledger — ${frappe.utils.escape_html(party)}</title>
        <style>${_ib_lp_css()}</style>
    </head><body>
        <div class="page">${co_html}${table_html}${footer_html}</div>
    </body></html>`;
}

// ── Core: fetch list data and print ──────────────────────────────────────────
async function _ib_lp_print_list(listview, doctype) {
    const cols = _IB_LP_COLS[doctype];
    if (!cols) {
        frappe.show_alert({ message: __("No print config for {0}", [doctype]), indicator: "orange" });
        return;
    }

    frappe.show_alert({ message: __("Preparing print…"), indicator: "blue" });

    const company = await _ib_lp_fetch_company();

    // Frappe's get_checked_items() only returns rows in listview.data (current page).
    // When ALL loaded rows are checked the user almost certainly wants everything —
    // fall back to a server fetch with the current list filters.
    // When a SUBSET is checked, use those rows directly (already in memory).
    const selected     = listview.get_checked_items ? listview.get_checked_items() : [];
    const loaded_count = (listview.data || []).length;
    const all_checked  = selected.length > 0 && selected.length >= loaded_count;

    let rows;
    let filter_desc;

    if (selected.length && !all_checked) {
        // Specific subset selected — use the already-loaded row objects directly
        rows        = selected;
        filter_desc = __("{0} selected", [selected.length]);
    } else {
        // Nothing selected OR all visible items checked → fetch all from server
        let filters = [];
        try { filters = listview.filter_area.get() || []; } catch (_) {}

        const fields = [...new Set(cols.map(c => c.f).concat(["name"]))];
        const r = await frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype,
                filters: filters.length ? filters : undefined,
                fields,
                limit_page_length: 2000,
                order_by: (listview.sort_by || "modified") + " " + (listview.sort_order || "desc"),
            },
        });
        rows        = r.message || [];
        filter_desc = _ib_lp_filter_desc(listview);
    }

    if (!rows.length) {
        frappe.show_alert({ message: __("No records to print"), indicator: "orange" });
        return;
    }

    const html = _ib_lp_build_html(doctype, cols, rows, company, filter_desc);
    _ib_lp_open(html);
}

// ── Public: add "Print List" to actions menu ──────────────────────────────────
function ib_setup_list_print(listview, doctype) {
    listview.page.add_actions_menu_item(__("Print List"), () => {
        _ib_lp_print_list(listview, doctype);
    });
}

// ── Public: add "Print Ledger" for selected party ─────────────────────────────
function ib_setup_party_ledger_print(listview, party_type) {
    listview.page.add_actions_menu_item(__("Print Ledger"), async () => {
        const selected = listview.get_checked_items();
        if (!selected.length) {
            frappe.show_alert({ message: __("Select a {0} to print ledger", [party_type]), indicator: "orange" });
            return;
        }
        if (selected.length > 1) {
            frappe.show_alert({ message: __("Select only one {0} for ledger", [party_type]), indicator: "orange" });
            return;
        }

        const party = selected[0].name;

        // Date range dialog
        const d = new frappe.ui.Dialog({
            title: __("{0} Ledger — {1}", [party_type, party]),
            fields: [
                { fieldname: "from_date", fieldtype: "Date", label: __("From Date") },
                { fieldname: "to_date",   fieldtype: "Date", label: __("To Date"),
                  default: frappe.datetime.get_today() },
            ],
            primary_action_label: __("Print"),
            async primary_action(values) {
                d.hide();
                frappe.show_alert({ message: __("Fetching ledger…"), indicator: "blue" });

                const company = await _ib_lp_fetch_company();

                const r = await frappe.call({
                    method: "instabiz.overrides.list_print.get_party_gl",
                    args: {
                        party_type,
                        party,
                        from_date: values.from_date || null,
                        to_date:   values.to_date   || null,
                    },
                });

                const entries = r.message || [];
                const html = _ib_lp_build_ledger_html(
                    party_type, party, entries,
                    values.from_date, values.to_date, company
                );
                _ib_lp_open(html);
            },
        });
        d.show();
    });
}

// ── Public: GL Entry list print ───────────────────────────────────────────────
function ib_setup_gl_print(listview) {
    listview.page.add_actions_menu_item(__("Print GL"), () => {
        _ib_lp_print_list(listview, "GL Entry");
    });
}

// ── Outstanding report: Print Reminder button ─────────────────────────────────
// Hooks into "Sales Invoice - Outstanding Amount by party" Report Builder report.
// Adds a Customer filter widget and a "Print Reminder" toolbar button.
// Select a customer, run the report, then click Print Reminder to generate the letter.
frappe.query_reports["Sales Invoice - Outstanding Amount by party"] = {
    filters: [
        {
            fieldname: "customer",
            label:     __("Customer"),
            fieldtype: "Link",
            options:   "Customer",
            reqd:      0,
        },
    ],

    onload: function(report) {
        report.page.add_inner_button(__("Print Reminder"), () => {
            const customer = report.get_filter_value("customer");
            if (!customer) {
                frappe.msgprint({
                    title: __("Customer Required"),
                    message: __("Select a Customer in the filter above, then click Print Reminder."),
                    indicator: "orange",
                });
                return;
            }
            frappe.show_alert({ message: __("Generating reminder letter…"), indicator: "blue" });
            frappe.call({
                method: "instabiz.overrides.list_print.get_customer_outstanding_letter",
                args: { customer },
                callback(r) {
                    if (r.message) _ib_lp_open(r.message);
                },
            });
        });
    },
};
