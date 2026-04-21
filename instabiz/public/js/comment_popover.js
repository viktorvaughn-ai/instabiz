/**
 * Comment Popover — click the comment count badge on any list row to read
 * and post comments without leaving the list.
 */
(function () {
	let $backdrop = null;
	let $popover  = null;

	/* ── open / close ─────────────────────────────────────────────────────────── */

	function close() {
		if ($backdrop) { $backdrop.remove(); $backdrop = null; }
		if ($popover)  { $popover.remove();  $popover  = null; }
	}

	function show(doctype, docname, $anchor) {
		close();

		$backdrop = $('<div class="ib-cp-backdrop"></div>').appendTo("body");
		$backdrop.on("click", close);

		$popover = $(`
			<div class="ib-cp-popover">
				<div class="ib-cp-header">
					<div class="ib-cp-title">
						<iconify-icon icon="mdi:comment-text-outline" width="14"></iconify-icon>
						<span>Comments</span>
						<span class="ib-cp-docref">${frappe.utils.escape_html(docname)}</span>
					</div>
					<button class="ib-cp-close" title="${__("Close")}">×</button>
				</div>
				<div class="ib-cp-list">
					<div class="ib-cp-loading">${__("Loading…")}</div>
				</div>
				<div class="ib-cp-footer">
					<textarea class="ib-cp-input" placeholder="${__("Write a comment… (Ctrl+Enter to post)")}" rows="2"></textarea>
					<button class="btn btn-primary btn-sm ib-cp-submit">${__("Post")}</button>
				</div>
			</div>
		`).appendTo("body");

		position($popover, $anchor);

		$popover.find(".ib-cp-close").on("click", close);

		$popover.find(".ib-cp-submit").on("click", () => submit(doctype, docname, $anchor));
		$popover.find(".ib-cp-input").on("keydown", function (e) {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				submit(doctype, docname, $anchor);
			}
		});

		fetch_comments(doctype, docname);
	}

	/* ── fetch ────────────────────────────────────────────────────────────────── */

	function fetch_comments(doctype, docname) {
		frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype:  "Comment",
				filters: {
					reference_doctype: doctype,
					reference_name:    docname,
					comment_type:      "Comment",
				},
				fields:    ["name", "comment_by", "comment_email", "content", "creation"],
				order_by:  "creation asc",
				limit:     50,
			},
			callback(r) {
				if (!$popover) return;
				const comments = (r && r.message) || [];
				const $list = $popover.find(".ib-cp-list");
				if (!comments.length) {
					$list.html(`<div class="ib-cp-empty">${__("No comments yet.")}</div>`);
				} else {
					$list.html(comments.map(render_comment).join(""));
					$list.scrollTop($list[0].scrollHeight);
				}
			},
		});
	}

	/* ── submit ───────────────────────────────────────────────────────────────── */

	function submit(doctype, docname, $anchor) {
		if (!$popover) return;
		const $input = $popover.find(".ib-cp-input");
		const text   = $input.val().trim();
		if (!text) return;

		const $btn = $popover.find(".ib-cp-submit").prop("disabled", true).text(__("Posting…"));

		frappe.call({
			method: "frappe.desk.form.utils.add_comment",
			args: {
				reference_doctype: doctype,
				reference_name:    docname,
				content:           `<p>${frappe.utils.escape_html(text).replace(/\n/g, "<br>")}</p>`,
				comment_email:     frappe.session.user,
				comment_by:        frappe.boot.user.full_name || frappe.session.user,
			},
			callback(r) {
				if (!$popover) return;
				$btn.prop("disabled", false).text(__("Post"));
				if (!r || !r.message) return;

				$input.val("");
				const $list = $popover.find(".ib-cp-list");
				$list.find(".ib-cp-empty").remove();
				$list.append(render_comment(r.message));
				$list.scrollTop($list[0].scrollHeight);

				bump_count($anchor);
				frappe.show_alert({ message: __("Comment added"), indicator: "green" });
			},
		});
	}

	/* ── render helpers ───────────────────────────────────────────────────────── */

	function render_comment(c) {
		const initials = (c.comment_by || c.comment_email || "?")
			.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
		const when = frappe.datetime.comment_when
			? frappe.datetime.comment_when(c.creation)
			: c.creation;

		return `
			<div class="ib-cp-comment">
				<div class="ib-cp-avatar">${initials}</div>
				<div class="ib-cp-body">
					<div class="ib-cp-meta">
						<span class="ib-cp-author">${frappe.utils.escape_html(c.comment_by || c.comment_email || "")}</span>
						<span class="ib-cp-time">${when}</span>
					</div>
					<div class="ib-cp-content">${c.content || ""}</div>
				</div>
			</div>`;
	}

	/* ── positioning ──────────────────────────────────────────────────────────── */

	function position($pop, $anchor) {
		const rect  = $anchor[0].getBoundingClientRect();
		const pw    = 340;
		const gap   = 6;
		const scrollY = window.scrollY || document.documentElement.scrollTop;
		const scrollX = window.scrollX || document.documentElement.scrollLeft;

		let left = rect.left + scrollX;
		let top  = rect.bottom + scrollY + gap;

		if (left + pw > window.innerWidth - 12) {
			left = rect.right + scrollX - pw;
		}

		$pop.css({ top, left, width: pw });
	}

	/* ── badge count bump ─────────────────────────────────────────────────────── */

	function bump_count($anchor) {
		const $badge = $anchor.hasClass("comment-count") ? $anchor : $anchor.find(".comment-count");
		// find the specific text node that holds the digit — not the empty one before the icon
		const textNodes = [...$badge[0].childNodes].filter(n => n.nodeType === Node.TEXT_NODE);
		const node = textNodes.find(n => /\d/.test(n.textContent));
		const cur = node ? (parseInt(node.textContent) || 0) : 0;
		if (node) {
			node.textContent = ` ${cur + 1}`;
		} else if (textNodes.length) {
			textNodes[textNodes.length - 1].textContent = ` ${cur + 1}`;
		} else {
			$badge.append(` ${cur + 1}`);
		}
	}

	/* ── global click handler (capture phase — fires before Frappe's row handler) ─ */

	document.addEventListener("click", function (e) {
		const el = e.target.closest(".comment-count");
		if (!el) return;

		// Stop event so Frappe's .list-row click never fires
		e.stopPropagation();
		e.preventDefault();

		const $this = $(el);

		// Toggle off if same badge clicked again
		if ($popover && $popover.data("anchor-el") === el) { close(); return; }

		const $row    = $this.closest(".list-row-container");
		const docname = $row.find("[data-name]").first().data("name")
		             || $row.closest("[data-name]").data("name");
		const doctype = $row.find("[data-doctype]").first().data("doctype")
		             || $row.closest("[data-doctype]").data("doctype");

		if (!doctype || !docname) return;

		show(doctype, docname, $this);
		$popover.data("anchor-el", el);
	}, true /* capture = fires top-down before any bubble handler */);

	/* ── close on route change ────────────────────────────────────────────────── */
	$(document).on("page-change", close);
})();
