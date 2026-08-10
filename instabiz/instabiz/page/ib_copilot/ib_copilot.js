frappe.pages["ib-copilot"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Business Copilot",
		single_column: true,
	});
	wrapper.page_obj = page;
	frappe.ib_copilot = new IBCopilot(page, wrapper);
};

class IBCopilot {
	constructor(page, wrapper) {
		this.page = page;
		this.wrapper = wrapper;
		this.$root = $(wrapper).find(".layout-main-section");
		this.history = []; // {question, answer, source, function_used}
		this._build_html();
		this._inject_styles();
		this._load_menu();
	}

	_build_html() {
		this.$root.html(`
			<div class="ib-copilot">
				<div class="ib-copilot-intro">
					Ask a question about sales, AR, stock, or production — answers are
					scoped to what you can already see in this app.
				</div>
				<div class="ib-copilot-chips"></div>
				<div class="ib-copilot-thread"></div>
				<div class="ib-copilot-inputrow">
					<input type="text" class="form-control ib-copilot-input"
						placeholder="e.g. which customers are overdue in Gujarat?" />
					<button class="btn btn-primary btn-sm ib-copilot-ask">Ask</button>
				</div>
			</div>
		`);
		this.$input = this.$root.find(".ib-copilot-input");
		this.$thread = this.$root.find(".ib-copilot-thread");
		this.$chips = this.$root.find(".ib-copilot-chips");

		this.$root.find(".ib-copilot-ask").on("click", () => this._ask());
		this.$input.on("keydown", (e) => {
			if (e.key === "Enter") this._ask();
		});
	}

	_load_menu() {
		frappe.call({
			method: "instabiz.overrides.copilot.get_menu",
			callback: (r) => {
				const menu = r.message || {};
				const samples = {
					overdue_customers: "Which customers are overdue?",
					top_items: "What's our top-selling item this month?",
					low_stock_items: "What items are low on stock?",
					production_status: "What's our production status?",
					pending_leaves: "Any leaves pending approval?",
					sales_summary: "What's our sales summary this month?",
					ar_aging_summary: "Show me the AR aging breakdown.",
				};
				const chips = Object.keys(menu)
					.map((k) => samples[k])
					.filter(Boolean);
				this.$chips.html(
					chips
						.map((q) => `<span class="ib-copilot-chip">${frappe.utils.escape_html(q)}</span>`)
						.join("")
				);
				this.$chips.find(".ib-copilot-chip").on("click", (e) => {
					this.$input.val($(e.currentTarget).text());
					this._ask();
				});
			},
		});
	}

	_ask() {
		const question = (this.$input.val() || "").trim();
		if (!question) return;
		this.$input.val("");
		const $entry = $(`
			<div class="ib-copilot-entry">
				<div class="ib-copilot-q">${frappe.utils.escape_html(question)}</div>
				<div class="ib-copilot-a"><span class="text-muted">Thinking…</span></div>
			</div>
		`);
		this.$thread.append($entry);
		this.$thread.scrollTop(this.$thread[0].scrollHeight);

		frappe.call({
			method: "instabiz.overrides.copilot.ask",
			args: { question },
			callback: (r) => {
				const res = r.message || {};
				const badge =
					res.source === "claude"
						? '<span class="ib-copilot-badge ib-copilot-badge-ai">Claude</span>'
						: res.source === "fallback"
						? '<span class="ib-copilot-badge">Table</span>'
						: "";
				$entry.find(".ib-copilot-a").html(
					`${badge}<div class="ib-copilot-answer-text">${frappe.utils.escape_html(res.answer || "").replace(/\n/g, "<br>")}</div>`
				);
				this.$thread.scrollTop(this.$thread[0].scrollHeight);
			},
			error: () => {
				$entry.find(".ib-copilot-a").html('<span class="text-danger">Something went wrong.</span>');
			},
		});
	}

	_inject_styles() {
		if (document.getElementById("ib-copilot-style")) return;
		const style = document.createElement("style");
		style.id = "ib-copilot-style";
		style.textContent = `
			.ib-copilot { max-width: 760px; margin: 0 auto; padding: 10px 0; }
			.ib-copilot-intro { color: var(--text-muted); font-size: 13px; margin-bottom: 12px; }
			.ib-copilot-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
			.ib-copilot-chip {
				display: inline-block; padding: 4px 10px; border-radius: 14px;
				background: var(--control-bg); border: 1px solid var(--border-color);
				font-size: 12px; cursor: pointer; color: var(--text-color);
			}
			.ib-copilot-chip:hover { background: var(--bg-light-gray); }
			.ib-copilot-thread { min-height: 120px; margin-bottom: 14px; }
			.ib-copilot-entry { margin-bottom: 16px; }
			.ib-copilot-q {
				font-weight: 600; background: var(--control-bg); padding: 8px 12px;
				border-radius: 8px 8px 8px 2px; display: inline-block; margin-bottom: 6px;
			}
			.ib-copilot-a {
				background: var(--fg-color); border: 1px solid var(--border-color);
				padding: 10px 12px; border-radius: 2px 8px 8px 8px;
			}
			.ib-copilot-answer-text { white-space: pre-line; line-height: 1.5; }
			.ib-copilot-badge {
				display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 8px;
				background: var(--control-bg); color: var(--text-muted); margin-bottom: 4px;
			}
			.ib-copilot-badge-ai { background: #4e7fff22; color: #4e7fff; }
			.ib-copilot-inputrow { display: flex; gap: 8px; }
			.ib-copilot-input { flex: 1; }
		`;
		document.head.appendChild(style);
	}
}
