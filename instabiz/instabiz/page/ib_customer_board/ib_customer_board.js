frappe.pages["ib-customer-board"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Customer Board",
		single_column: true,
	});
	wrapper.page_obj = new IBCustomerBoard(page, wrapper);
};

frappe.pages["ib-customer-board"].on_page_show = function (wrapper) {
	if (wrapper.page_obj) wrapper.page_obj.refresh();
};

class IBCustomerBoard {
	constructor(page, wrapper) {
		this.page = page;
		this.wrapper = wrapper;
		this.$main = $(wrapper).find(".page-content");
		this._selected_date = frappe.datetime.get_today();
		this._undo_timer = null;
		this._init();
	}

	_init() {
		this._build_toolbar();
		this._build_skeleton();
		this.refresh();
	}

	// ── Toolbar ──────────────────────────────────────────────────────────────

	_build_toolbar() {
		const self = this;
		this.page.add_field({
			fieldname: "board_date",
			fieldtype: "Date",
			label: "Date",
			default: frappe.datetime.get_today(),
			change() {
				self._selected_date = this.get_value() || frappe.datetime.get_today();
				self.refresh();
			},
		});
		this.page.add_inner_button("Refresh", () => this.refresh());
	}

	// ── Skeleton ─────────────────────────────────────────────────────────────

	_build_skeleton() {
		this.$main.html(`
			<div class="ib-cb-board">
				<div class="ib-cb-columns">
					<div class="ib-cb-col" id="ib-cb-dormant">
						<div class="ib-cb-col-header">
							<svg class="ib-cb-col-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
							<span class="ib-cb-col-title">Dormant</span>
							<span class="ib-cb-col-badge" id="ib-cb-dormant-count">0</span>
						</div>
						<div class="ib-cb-cards" id="ib-cb-dormant-cards"></div>
					</div>
					<div class="ib-cb-col" id="ib-cb-regular">
						<div class="ib-cb-col-header">
							<svg class="ib-cb-col-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
							<span class="ib-cb-col-title">Regular</span>
							<span class="ib-cb-col-badge" id="ib-cb-regular-count">0</span>
						</div>
						<div class="ib-cb-cards" id="ib-cb-regular-cards"></div>
					</div>
					<div class="ib-cb-col ib-cb-col--today" id="ib-cb-today">
						<div class="ib-cb-col-header">
							<svg class="ib-cb-col-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
							<span class="ib-cb-col-title">Today</span>
							<span class="ib-cb-col-date" id="ib-cb-today-date"></span>
							<span class="ib-cb-col-badge" id="ib-cb-today-count">0</span>
						</div>
						<div class="ib-cb-cards" id="ib-cb-today-cards"></div>
					</div>
					<div class="ib-cb-col ib-cb-col--tomorrow" id="ib-cb-tomorrow">
						<div class="ib-cb-col-header">
							<svg class="ib-cb-col-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><polyline points="8 6 12 2 16 6"/></svg>
							<span class="ib-cb-col-title">Tomorrow</span>
							<span class="ib-cb-col-date" id="ib-cb-tomorrow-date"></span>
							<span class="ib-cb-col-badge" id="ib-cb-tomorrow-count">0</span>
						</div>
						<div class="ib-cb-cards" id="ib-cb-tomorrow-cards"></div>
					</div>
				</div>
			</div>
			<div id="ib-cb-undo-toast" class="ib-cb-undo-toast" style="display:none;">
				<div class="ib-cb-undo-toast-row">
					<span class="ib-cb-undo-msg" id="ib-cb-undo-msg"></span>
					<button class="ib-cb-undo-btn" id="ib-cb-undo-btn">Undo</button>
				</div>
				<div class="ib-cb-undo-bar"><div class="ib-cb-undo-bar-fill" id="ib-cb-undo-bar-fill"></div></div>
			</div>
		`);
		this._inject_styles();
	}

	// ── Data load ─────────────────────────────────────────────────────────────

	refresh() {
		const self = this;
		this._show_shimmer();
		frappe.call({
			method: "instabiz.overrides.customer_assignment.get_customer_board_data",
			args: { date: this._selected_date },
			callback(r) {
				if (r.message) self._render(r.message);
			},
		});
	}

	_show_shimmer() {
		const cols = ["dormant", "regular", "today", "tomorrow"];
		const counts = [3, 3, 4, 3];
		cols.forEach((col, i) => {
			const $cards = $(`#ib-cb-${col}-cards`).empty();
			$(`#ib-cb-${col}-count`).text("…");
			for (let n = 0; n < counts[i]; n++) {
				$cards.append(`
					<div class="ib-cb-card ib-cb-shimmer">
						<div class="ib-cb-sh-line ib-cb-sh-line--title"></div>
						<div class="ib-cb-sh-line ib-cb-sh-line--meta"></div>
						<div class="ib-cb-sh-line ib-cb-sh-line--short"></div>
					</div>
				`);
			}
		});
	}

	// ── Render ────────────────────────────────────────────────────────────────

	_render(data) {
		$("#ib-cb-today-date").text(frappe.datetime.str_to_user(data.date));
		$("#ib-cb-tomorrow-date").text(frappe.datetime.str_to_user(data.tomorrow_date));
		this._render_pool("dormant", data.dormant, data.dormant_total);
		this._render_pool("regular", data.regular, data.regular_total);
		this._render_today(data.today);
		this._render_tomorrow(data.tomorrow);
	}

	_render_pool(col, rows, total) {
		const $cards = $(`#ib-cb-${col}-cards`).empty();
		const badge = total !== undefined && total > rows.length ? `${rows.length} / ${total}` : rows.length;
		$(`#ib-cb-${col}-count`).text(badge);
		if (!rows.length) {
			$cards.append(`<div class="ib-cb-empty">No customers</div>`);
			return;
		}
		rows.forEach((r) => $cards.append(this._pool_card(r)));
	}

	_pool_card(r) {
		const self = this;
		const last = r.last_so_date
			? `Last SO: ${frappe.datetime.str_to_user(r.last_so_date)}`
			: "No orders yet";
		const $card = $(`
			<div class="ib-cb-card ib-cb-card--pool">
				<div class="ib-cb-card-top">
					<div class="ib-cb-card-name">${frappe.utils.escape_html(r.customer_name || r.customer)}</div>
				</div>
				<div class="ib-cb-card-meta">${frappe.utils.escape_html(r.territory || "")}</div>
				<div class="ib-cb-card-last">${last}</div>
				<div class="ib-cb-card-actions">
					<button class="btn btn-xs ib-action-btn ib-cb-btn-add-today"
						data-customer="${frappe.utils.escape_html(r.customer)}">
						<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add to Today
					</button>
				</div>
			</div>
		`);
		$card.find(".ib-cb-btn-add-today").on("click", function () {
			const customer = $(this).data("customer");
			self._add_to_today(customer, $(this));
		});
		return $card;
	}

	_render_today(rows) {
		const self = this;
		const $cards = $("#ib-cb-today-cards").empty();
		const pending = rows.filter((r) => r.status === "Pending");
		const done = rows.filter((r) => r.status !== "Pending");

		$("#ib-cb-today-count").text(rows.length);
		if (!rows.length) {
			$cards.append(`<div class="ib-cb-empty">No assignments today</div>`);
			return;
		}
		pending.forEach((r) => $cards.append(self._today_card(r, false)));
		done.forEach((r) => $cards.append(self._today_card(r, true)));

	}

	_today_card(r, is_done) {
		const self = this;
		const status_cls = {
			Pending: "ib-cb-status--pending",
			Contacted: "ib-cb-status--contacted",
			"Order Placed": "ib-cb-status--ordered",
			Skipped: "ib-cb-status--skipped",
		}[r.status] || "";

		const last = r.last_so_date
			? `Last SO: ${frappe.datetime.str_to_user(r.last_so_date)}`
			: "No orders yet";

		const actions = r.status === "Skipped" ? `
			<div class="ib-cb-card-actions">
				<button class="btn btn-xs ib-action-btn ib-cb-btn-unskip" data-id="${r.name}">
					<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.49"/></svg> Undo Skip
				</button>
			</div>` : !is_done ? `
			<div class="ib-cb-card-actions">
				<button class="btn btn-xs ib-action-btn ib-cb-btn-contact" data-id="${r.name}">
					<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.99 12 19.79 19.79 0 0 1 1.85 3.5 2 2 0 0 1 3.84 1.34h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9a16 16 0 0 0 6.91 6.91l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg> Contacted
				</button>
				<div class="ib-cb-create-group">
					<button class="btn btn-xs ib-action-btn ib-cb-btn-q"
						data-customer="${frappe.utils.escape_html(r.customer)}">
						<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Quote
					</button>
					<button class="btn btn-xs ib-action-btn ib-cb-btn-so"
						data-customer="${frappe.utils.escape_html(r.customer)}">
						<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> Order
					</button>
				</div>
				<button class="btn btn-xs btn-default ib-cb-btn-skip" data-id="${r.name}">
					<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg> Skip
				</button>
			</div>` : "";

		const $card = $(`
			<div class="ib-cb-card ib-cb-card--today ${is_done ? "ib-cb-card--done" : ""}">
				<div class="ib-cb-card-top">
					<div class="ib-cb-card-name">${frappe.utils.escape_html(r.customer_name || r.customer)}</div>
					<span class="ib-cb-status ${status_cls}">${r.status}</span>
				</div>
				<div class="ib-cb-card-meta">${frappe.utils.escape_html(r.territory || "")}</div>
				<div class="ib-cb-card-last">${last}</div>
				${actions}
			</div>
		`);

		if (r.status === "Skipped") {
			$card.find(".ib-cb-btn-unskip").on("click", () => self._unskip(r.name));
		} else if (!is_done) {
			$card.find(".ib-cb-btn-contact").on("click", () => self._show_contact_modal(r.name));
			$card.find(".ib-cb-btn-q").on("click", () =>
				frappe.new_doc("Quotation", { party_name: r.customer, quotation_to: "Customer" })
			);
			$card.find(".ib-cb-btn-so").on("click", () =>
				frappe.new_doc("Sales Order", { customer: r.customer })
			);
			$card.find(".ib-cb-btn-skip").on("click", () => self._skip(r.name, $card));
		}
		return $card;
	}

	_render_tomorrow(rows) {
		const $cards = $("#ib-cb-tomorrow-cards").empty();
		$("#ib-cb-tomorrow-count").text(rows.length);
		if (!rows.length) {
			$cards.append(`<div class="ib-cb-empty">No assignments yet — scheduler runs at midnight</div>`);
			return;
		}
		rows.forEach((r) => {
			const last = r.last_so_date
				? `Last SO: ${frappe.datetime.str_to_user(r.last_so_date)}`
				: "No orders yet";
			$cards.append(`
				<div class="ib-cb-card ib-cb-card--tomorrow">
					<div class="ib-cb-card-name">${frappe.utils.escape_html(r.customer_name || r.customer)}</div>
					<div class="ib-cb-card-meta">${frappe.utils.escape_html(r.territory || "")}</div>
					<div class="ib-cb-card-last">${last}</div>
					<span class="ib-cb-pool-badge">${r.source_pool || ""}</span>
				</div>
			`);
		});
	}

	// ── Add to Today ──────────────────────────────────────────────────────────

	_add_to_today(customer, $btn) {
		const self = this;
		const $card = $btn.closest(".ib-cb-card");

		// Snapshot positions before any DOM change
		const srcRect = $card[0].getBoundingClientRect();

		// Build flying clone at source position
		const $clone = $("<div class='ib-cb-card ib-cb-card--today ib-cb-flying'></div>");
		$clone.html($card.html()).find(".ib-cb-btn-add-today").remove();
		$clone.css({
			position: "fixed",
			top: srcRect.top,
			left: srcRect.left,
			width: srcRect.width,
			zIndex: 9000,
			margin: 0,
			pointerEvents: "none",
			boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
		});
		document.body.appendChild($clone[0]);

		// Ghost the source card
		$card.css({ opacity: 0.3, transition: "opacity 0.2s ease" });
		$btn.prop("disabled", true);

		// Animate clone to top of Today cards container (below header ~49px)
		const $todayCards = $("#ib-cb-today-cards");
		const cardsRect = $todayCards[0].getBoundingClientRect();
		const targetTop = cardsRect.top + 10;
		const targetLeft = cardsRect.left + 10;
		const targetWidth = cardsRect.width - 20;

		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				$clone.css({
					transition: "top 0.38s cubic-bezier(0.4,0,0.2,1), left 0.38s cubic-bezier(0.4,0,0.2,1), width 0.38s cubic-bezier(0.4,0,0.2,1), opacity 0.3s 0.2s, transform 0.38s cubic-bezier(0.4,0,0.2,1)",
					top: targetTop,
					left: targetLeft,
					width: targetWidth,
					opacity: 0,
					transform: "scale(0.96)",
				});
			});
		});

		// Fire API call in parallel — clean up clone after animation finishes
		frappe.call({
			method: "instabiz.overrides.customer_assignment.add_customer_to_today",
			args: { customer, date: self._selected_date },
			callback(r) {
				setTimeout(() => {
					$clone.remove();
					if (r.message && r.message.status === "ok") {
						self.refresh();
						self._show_undo_toast(customer, r.message.assignment);
					} else {
						$card.css({ opacity: 1 });
						$btn.prop("disabled", false).text("+ Add to Today");
					}
				}, 420);
			},
			error() {
				setTimeout(() => {
					$clone.remove();
					$card.css({ opacity: 1 });
					$btn.prop("disabled", false).text("+ Add to Today");
				}, 420);
			},
		});
	}

	// ── Undo toast ────────────────────────────────────────────────────────────

	_show_undo_toast(customer, assignment_id) {
		const self = this;

		// Clear any running timer
		if (this._undo_timer) {
			clearInterval(this._undo_timer);
			this._undo_timer = null;
		}

		const $toast = $("#ib-cb-undo-toast");
		const $fill = $("#ib-cb-undo-bar-fill");
		const $btn = $("#ib-cb-undo-btn");

		$("#ib-cb-undo-msg").text(`${customer} added to Today`);
		$fill.css("width", "100%").css("transition", "none");
		$toast.show();

		// Animate bar shrink over 5s
		requestAnimationFrame(() => {
			$fill.css("transition", "width 5s linear").css("width", "0%");
		});

		let elapsed = 0;
		this._undo_timer = setInterval(() => {
			elapsed += 100;
			if (elapsed >= 5000) {
				clearInterval(self._undo_timer);
				self._undo_timer = null;
				$toast.hide();
			}
		}, 100);

		// Undo click
		$btn.off("click").on("click", () => {
			clearInterval(self._undo_timer);
			self._undo_timer = null;
			$toast.hide();
			frappe.call({
				method: "instabiz.overrides.customer_assignment.remove_assignment",
				args: { assignment_id },
				callback(r) {
					if (r.message && r.message.status === "ok") {
						frappe.show_alert({ message: `${customer} removed from Today`, indicator: "orange" });
						self.refresh();
					}
				},
			});
		});
	}

	// ── Actions ───────────────────────────────────────────────────────────────

	_show_contact_modal(assignment_id) {
		const self = this;
		const d = new frappe.ui.Dialog({
			title: "Mark as Contacted",
			fields: [
				{
					fieldname: "outcome",
					fieldtype: "Select",
					label: "Outcome",
					reqd: 1,
					options: ["", "Interested", "Not Interested", "Follow Up", "No Response"],
				},
				{
					fieldname: "notes",
					fieldtype: "Small Text",
					label: "Notes",
					reqd: 1,
					description: "What happened in this interaction?",
				},
			],
			primary_action_label: "Save",
			primary_action(values) {
				frappe.call({
					method: "instabiz.overrides.customer_assignment.mark_customer_contacted",
					args: { assignment_id, notes: values.notes, outcome: values.outcome },
					callback(r) {
						if (r.message && r.message.status === "ok") {
							d.hide();
							frappe.show_alert({ message: "Marked as Contacted", indicator: "green" });
							self.refresh();
						}
					},
				});
			},
		});
		d.show();
	}

	_skip(assignment_id, $card) {
		frappe.confirm("Skip this customer for today?", () => {
			frappe.call({
				method: "instabiz.overrides.customer_assignment.skip_assignment",
				args: { assignment_id },
				callback(r) {
					if (r.message && r.message.status === "ok") {
						frappe.show_alert({ message: "Skipped", indicator: "orange" });
						$card.addClass("ib-cb-card--done");
						$card.find(".ib-cb-card-actions").remove();
						$card.find(".ib-cb-status")
							.text("Skipped")
							.removeClass()
							.addClass("ib-cb-status ib-cb-status--skipped");
					}
				},
			});
		});
	}

	_unskip(assignment_id) {
		const self = this;
		frappe.call({
			method: "instabiz.overrides.customer_assignment.unskip_assignment",
			args: { assignment_id },
			callback(r) {
				if (r.message && r.message.status === "ok") {
					frappe.show_alert({ message: "Assignment restored to Pending", indicator: "green" });
					self.refresh();
				}
			},
		});
	}

	// ── Styles ────────────────────────────────────────────────────────────────

	_inject_styles() {
		if (document.getElementById("ib-cb-styles")) return;
		const style = document.createElement("style");
		style.id = "ib-cb-styles";
		style.textContent = `
			.ib-cb-board { padding: 16px 0; overflow: hidden; }

			.ib-cb-columns {
				display: grid;
				grid-template-columns: repeat(4, 1fr);
				gap: 16px;
				align-items: stretch;
				height: calc(100vh - 155px);
			}

			.ib-cb-col {
				background: var(--card-bg);
				border: 1px solid var(--border-color);
				border-radius: 8px;
				overflow: hidden;
				display: flex;
				flex-direction: column;
				min-height: 0;
			}

			.ib-cb-col-header {
				display: flex;
				align-items: center;
				gap: 8px;
				padding: 12px 14px;
				border-bottom: 1px solid var(--border-color);
				background: var(--subtle-bg);
			}

			.ib-cb-col--today .ib-cb-col-header { border-bottom-color: var(--ib-primary); }
			.ib-cb-col--tomorrow .ib-cb-col-header { border-bottom-color: var(--blue-300, #93c5fd); }

			.ib-cb-col-title { font-weight: 600; font-size: 13px; flex: 1; }
			.ib-cb-col-date { font-size: 11px; color: var(--text-muted); }

			.ib-cb-col-badge {
				background: var(--ib-primary);
				color: #fff;
				border-radius: 10px;
				padding: 1px 8px;
				font-size: 11px;
				font-weight: 600;
			}
			.ib-cb-col--tomorrow .ib-cb-col-badge { background: var(--blue-500, #3b82f6); }
			.ib-cb-col--today .ib-cb-col-badge { background: var(--ib-primary-dark, #b45e3e); }

			.ib-cb-cards { padding: 10px; display: flex; flex-direction: column; gap: 8px; flex: 1; overflow-y: auto; min-height: 0; }

			.ib-cb-card {
				background: var(--fg-color, #fff);
				border: 1px solid var(--border-color);
				border-radius: 6px;
				padding: 10px 12px;
				font-size: 12px;
			}

			.ib-cb-card--pool { border-left: 3px solid var(--border-color); }
			.ib-cb-card--today { border-left: 3px solid var(--ib-primary); }
			.ib-cb-card--tomorrow { border-left: 3px solid var(--blue-400, #60a5fa); opacity: 0.85; }
			.ib-cb-card--done { opacity: 0.55; }

			.ib-cb-card-top {
				display: flex;
				align-items: flex-start;
				justify-content: space-between;
				gap: 6px;
			}

			.ib-cb-card-name {
				font-weight: 600;
				font-size: 12.5px;
				line-height: 1.3;
				flex: 1;
			}

			.ib-cb-card-meta { color: var(--text-muted); font-size: 11px; margin-top: 2px; }
			.ib-cb-card-last { color: var(--text-muted); font-size: 11px; margin-top: 2px; }

			.ib-cb-col-icon { opacity: 0.55; flex-shrink: 0; }

			.ib-cb-card-actions {
				display: flex;
				gap: 5px;
				margin-top: 8px;
				flex-wrap: wrap;
				align-items: center;
			}
			.ib-cb-card-actions .btn,
			.ib-cb-card-actions .ib-action-btn {
				display: inline-flex; align-items: center; gap: 4px;
			}

			.ib-cb-create-group {
				display: flex;
				gap: 3px;
			}
			.ib-cb-create-group .btn { border-radius: 4px; }

			.ib-cb-status {
				font-size: 10px;
				font-weight: 600;
				border-radius: 4px;
				padding: 2px 6px;
				white-space: nowrap;
				text-transform: uppercase;
				letter-spacing: 0.3px;
			}
			.ib-cb-status--pending   { background: #fef3c7; color: #92400e; }
			.ib-cb-status--contacted { background: #d1fae5; color: #065f46; }
			.ib-cb-status--ordered   { background: #dbeafe; color: #1e40af; }
			.ib-cb-status--skipped   { background: #f3f4f6; color: #6b7280; }

			.ib-cb-pool-badge {
				display: inline-block;
				margin-top: 4px;
				font-size: 10px;
				font-weight: 600;
				padding: 1px 6px;
				border-radius: 4px;
				background: var(--subtle-bg);
				color: var(--text-muted);
				text-transform: uppercase;
			}

			.ib-cb-empty {
				color: var(--text-muted);
				font-size: 12px;
				text-align: center;
				padding: 24px 0;
			}

			/* Shimmer skeleton */
			@keyframes ib-shimmer {
				0%   { background-position: -400px 0; }
				100% { background-position:  400px 0; }
			}
			.ib-cb-shimmer {
				pointer-events: none;
			}
			.ib-cb-sh-line {
				border-radius: 4px;
				margin-bottom: 8px;
				background: linear-gradient(90deg, var(--border-color) 25%, var(--subtle-bg) 50%, var(--border-color) 75%);
				background-size: 800px 100%;
				animation: ib-shimmer 1.4s infinite linear;
			}
			.ib-cb-sh-line--title  { height: 13px; width: 70%; }
			.ib-cb-sh-line--meta   { height: 10px; width: 45%; }
			.ib-cb-sh-line--short  { height: 10px; width: 55%; margin-bottom: 0; }

			/* Flying card animation */
			.ib-cb-flying {
				border-left: 3px solid var(--ib-primary) !important;
			}

			/* Undo toast */
			.ib-cb-undo-toast {
				position: fixed;
				bottom: 28px;
				left: 50%;
				transform: translateX(-50%);
				background: var(--card-bg);
				color: var(--text-color);
				border: 1px solid var(--border-color);
				border-radius: 8px;
				padding: 10px 16px 8px;
				display: flex;
				flex-direction: column;
				gap: 8px;
				min-width: 300px;
				box-shadow: 0 4px 20px rgba(0,0,0,0.10);
				z-index: 9999;
				font-size: 13px;
			}
			.ib-cb-undo-toast-row {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 12px;
			}
			.ib-cb-undo-msg { font-weight: 500; flex: 1; }
			.ib-cb-undo-btn {
				background: var(--ib-primary);
				color: #fff;
				border: none;
				border-radius: 4px;
				padding: 4px 12px;
				font-size: 12px;
				font-weight: 600;
				cursor: pointer;
				flex-shrink: 0;
			}
			.ib-cb-undo-btn:hover { background: var(--ib-primary-dark, #b45e3e); }
			.ib-cb-undo-bar {
				height: 3px;
				background: var(--border-color);
				border-radius: 2px;
				overflow: hidden;
			}
			.ib-cb-undo-bar-fill {
				height: 100%;
				background: var(--ib-primary);
				border-radius: 2px;
				width: 100%;
			}

			@media (max-width: 1100px) {
				.ib-cb-columns { grid-template-columns: repeat(2, 1fr); height: auto; }
				.ib-cb-col { max-height: 60vh; }
			}
			@media (max-width: 640px) {
				.ib-cb-columns { grid-template-columns: 1fr; height: auto; }
				.ib-cb-col { max-height: 50vh; }
			}
		`;
		document.head.appendChild(style);
	}
}
