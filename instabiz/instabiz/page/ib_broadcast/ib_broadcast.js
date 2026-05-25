frappe.pages["ib-broadcast"].on_page_load = function (wrapper) {
	if (!frappe.user.has_role("System Manager")) {
		$(wrapper).html('<div class="ib-bc-wrap"><p class="ib-bc-unauth">Not authorized.</p></div>');
		return;
	}

	frappe.ui.make_app_page({
		parent: wrapper,
		title: "Broadcast",
		single_column: true,
	});

	$(wrapper).find(".page-content").html(`
		<div class="ib-bc-wrap">

			<!-- Compose -->
			<div class="ib-bc-card">
				<div class="ib-bc-card-head">
					<span class="ib-bc-card-title">New Broadcast</span>
				</div>
				<div class="ib-bc-body">

					<div class="ib-bc-row">
						<label class="ib-bc-label">Title</label>
						<input type="text" class="form-control ib-bc-title" placeholder="e.g. System Update" />
					</div>

					<div class="ib-bc-row">
						<label class="ib-bc-label">Message <span class="ib-bc-hint">— Markdown supported</span></label>
						<textarea class="form-control ib-bc-message" rows="5" placeholder="Write your message here…"></textarea>
					</div>

					<!-- Inline preview -->
					<div class="ib-bc-preview" style="display:none">
						<label class="ib-bc-label">Preview</label>
						<div class="ib-bc-pv-box">
							<div class="ib-bc-pv-inner">
								<img class="ib-bc-pv-img" style="display:none" />
								<div class="ib-bc-pv-msg"></div>
							</div>
						</div>
					</div>

					<div class="ib-bc-row">
						<label class="ib-bc-label">Image <span class="ib-bc-hint">— optional</span></label>
						<div class="ib-bc-image-row">
							<input type="file" class="ib-bc-image-input" accept="image/*" style="display:none" />
							<button class="ib-action-btn ib-bc-image-btn">
								<span class="ib-svg-icon"><svg viewBox="0 0 24 24"><path d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"/></svg></span>
								Choose Image
							</button>
							<div class="ib-bc-img-thumb" style="display:none">
								<img class="ib-bc-thumb-img" />
								<span class="ib-bc-image-name"></span>
								<button class="ib-action-btn ib-bc-image-clear" style="color:var(--red-500,#e53e3e);border-color:transparent">✕ Remove</button>
							</div>
						</div>
					</div>

					<div class="ib-bc-row">
						<label class="ib-bc-label">Send To</label>
						<div class="ib-bc-target-row">
							<label class="ib-bc-radio-lbl">
								<input type="radio" name="ib_target" value="All" checked />
								All Users
							</label>
							<label class="ib-bc-radio-lbl">
								<input type="radio" name="ib_target" value="Specific Users" />
								Specific Users
							</label>
						</div>
					</div>

					<div class="ib-bc-row ib-bc-users-row" style="display:none">
						<label class="ib-bc-label">Users</label>
						<div class="ib-bc-search-wrap">
							<div class="ib-bc-search-box">
								<span class="ib-svg-icon" style="color:var(--text-muted)"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path stroke-linecap="round" d="m21 21-4.35-4.35"/></svg></span>
								<input type="text" class="ib-bc-user-search" placeholder="Search name or email…" />
								<span class="ib-bc-load-spin" style="display:none"><div class="ib-bc-spin"></div></span>
							</div>
							<div class="ib-bc-user-drop" style="display:none"></div>
						</div>
						<div class="ib-bc-chips"></div>
					</div>

					<div class="ib-bc-footer">
						<button class="btn btn-primary ib-bc-send-btn">Send Broadcast</button>
						<span class="ib-bc-sent-msg"></span>
					</div>

				</div>
			</div>

			<!-- History -->
			<div class="ib-bc-card">
				<div class="ib-bc-card-head">
					<span class="ib-bc-card-title">Recent Broadcasts</span>
				</div>
				<div class="ib-bc-history-list"></div>
			</div>

		</div>
	`);

	const $w       = $(wrapper);
	const $title   = $w.find(".ib-bc-title");
	const $message = $w.find(".ib-bc-message");
	const $send    = $w.find(".ib-bc-send-btn");
	const $sentMsg = $w.find(".ib-bc-sent-msg");
	const $history = $w.find(".ib-bc-history-list");

	// ── Avatar helpers ────────────────────────────────────────────────────────
	const _PALETTE = [
		"#e57373","#f06292","#ba68c8","#7986cb","#64b5f6",
		"#4fc3f7","#4db6ac","#81c784","#ffb74d","#a1887f",
	];
	function _color(str) {
		let h = 0;
		for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff;
		return _PALETTE[h % _PALETTE.length];
	}
	function _initials(name) {
		return name.trim().split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
	}

	// ── Image ─────────────────────────────────────────────────────────────────
	const $imageInput = $w.find(".ib-bc-image-input");
	const $imageBtn   = $w.find(".ib-bc-image-btn");
	const $imgThumb   = $w.find(".ib-bc-img-thumb");
	const $thumbImg   = $w.find(".ib-bc-thumb-img");
	const $imageName  = $w.find(".ib-bc-image-name");
	const $imageClear = $w.find(".ib-bc-image-clear");
	const $pvImg      = $w.find(".ib-bc-pv-img");
	let _img_url = null;

	$imageBtn.on("click", () => $imageInput.click());

	$imageInput.on("change", function () {
		const file = this.files[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = e => {
			$thumbImg.attr("src", e.target.result);
			$pvImg.attr("src", e.target.result).show();
			_update_preview();
		};
		reader.readAsDataURL(file);
		$imageName.text(file.name);
		$imgThumb.show();
		$imageBtn.hide();

		const form = new FormData();
		form.append("file", file);
		form.append("is_private", 0);
		$.ajax({
			url: "/api/method/upload_file",
			type: "POST",
			data: form,
			processData: false,
			contentType: false,
			headers: { "X-Frappe-CSRF-Token": frappe.csrf_token },
			success(r) { _img_url = r.message.file_url; },
			error() {
				frappe.show_alert({ message: "Image upload failed", indicator: "red" });
				_clear_image();
			},
		});
	});

	$imageClear.on("click", _clear_image);

	function _clear_image() {
		$imageInput.val("");
		$imageName.text("");
		$imgThumb.hide();
		$imageBtn.show();
		$thumbImg.attr("src", "");
		$pvImg.hide().attr("src", "");
		_img_url = null;
		_update_preview();
	}

	// ── Preview ───────────────────────────────────────────────────────────────
	const $preview = $w.find(".ib-bc-preview");
	const $pvMsg   = $w.find(".ib-bc-pv-msg");

	function _update_preview() {
		const msg = $message.val().trim();
		if (!msg) { $preview.hide(); return; }
		$pvMsg.html(frappe.markdown(msg));
		$preview.show();
	}

	$message.on("input", _update_preview);

	// ── Target ────────────────────────────────────────────────────────────────
	const $usersRow = $w.find(".ib-bc-users-row");
	const $userSearch = $w.find(".ib-bc-user-search");
	const $userDrop   = $w.find(".ib-bc-user-drop");
	const $chips      = $w.find(".ib-bc-chips");
	const $loadSpin   = $w.find(".ib-bc-load-spin");
	let _all_users = [], _selected = [];

	$w.find("input[name='ib_target']").on("change", function () {
		if (this.value === "Specific Users") {
			$usersRow.show();
			if (!_all_users.length) _load_users();
		} else {
			$usersRow.hide();
		}
	});

	function _load_users() {
		$loadSpin.show();
		$userSearch.prop("disabled", true);
		frappe.call({
			method: "instabiz.overrides.broadcast.get_system_users",
			callback(r) {
				_all_users = r.message || [];
				$loadSpin.hide();
				$userSearch.prop("disabled", false).focus();
			},
		});
	}

	$userSearch.on("input", function () {
		const q = this.value.toLowerCase().trim();
		if (!q) { $userDrop.hide(); return; }
		const hits = _all_users.filter(u =>
			(u.full_name.toLowerCase().includes(q) || u.name.toLowerCase().includes(q)) &&
			!_selected.find(s => s.name === u.name)
		).slice(0, 8);
		if (!hits.length) { $userDrop.hide(); return; }
		$userDrop.html(hits.map(u => {
			const bg   = _color(u.name);
			const init = _initials(u.full_name);
			return `<div class="ib-bc-drop-opt" data-name="${frappe.utils.escape_html(u.name)}" data-label="${frappe.utils.escape_html(u.full_name)}">
				<span class="ib-bc-av" style="background:${bg}">${init}</span>
				<span class="ib-bc-drop-name">${frappe.utils.escape_html(u.full_name)}</span>
				<span class="ib-bc-drop-email">${frappe.utils.escape_html(u.name)}</span>
			</div>`;
		}).join("")).show();
	});

	$userDrop.on("click", ".ib-bc-drop-opt", function () {
		_selected.push({ name: $(this).data("name"), label: $(this).data("label") });
		_render_chips();
		$userSearch.val("").focus();
		$userDrop.hide();
	});

	$(document).on("click.ib-bc-drop", e => {
		if (!$(e.target).closest(".ib-bc-search-wrap").length) $userDrop.hide();
	});

	function _render_chips() {
		$chips.html(_selected.map((u, i) => {
			const bg   = _color(u.name);
			const init = _initials(u.label);
			return `<span class="ib-bc-chip">
				<span class="ib-bc-av ib-bc-av-sm" style="background:${bg}">${init}</span>
				${frappe.utils.escape_html(u.label)}
				<button class="ib-bc-chip-rm" data-i="${i}" title="Remove">×</button>
			</span>`;
		}).join(""));
	}

	$chips.on("click", ".ib-bc-chip-rm", function () {
		_selected.splice($(this).data("i"), 1);
		_render_chips();
	});

	// ── Send ──────────────────────────────────────────────────────────────────
	$send.on("click", function () {
		const title   = $title.val().trim();
		const message = $message.val().trim();
		const target  = $w.find("input[name='ib_target']:checked").val();

		if (!title || !message) {
			frappe.show_alert({ message: "Title and message required", indicator: "red" });
			return;
		}
		if (target === "Specific Users" && !_selected.length) {
			frappe.show_alert({ message: "Select at least one user", indicator: "red" });
			return;
		}

		$send.prop("disabled", true).text("Sending…");
		frappe.call({
			method: "instabiz.overrides.broadcast.send_broadcast",
			args: {
				title,
				message,
				image: _img_url || null,
				target,
				target_users: target === "Specific Users" ? JSON.stringify(_selected.map(u => u.name)) : null,
			},
			callback(r) {
				$send.prop("disabled", false).text("Send Broadcast");
				if (r.exc) return;
				$title.val("");
				$message.val("");
				$preview.hide();
				_clear_image();
				_selected = [];
				_render_chips();
				$w.find("input[name='ib_target'][value='All']").prop("checked", true).trigger("change");
				$sentMsg.text("Sent ✓").addClass("ib-bc-ok");
				setTimeout(() => $sentMsg.text("").removeClass("ib-bc-ok"), 4000);
				load_history();
			},
		});
	});

	// ── History ───────────────────────────────────────────────────────────────
	function load_history() {
		frappe.call({
			method: "instabiz.overrides.broadcast.get_broadcast_history",
			callback(r) {
				if (!r.message || !r.message.length) {
					$history.html('<div class="ib-bc-hist-empty">No broadcasts yet.</div>');
					return;
				}
				$history.html(r.message.map(b => {
					let badge;
					if (b.target === "Specific Users") {
						let n = 0;
						try { n = JSON.parse(b.target_users || "[]").length; } catch { /**/ }
						badge = `<span class="ib-bc-badge ib-bc-badge-sp">${n} user${n !== 1 ? "s" : ""}</span>`;
					} else {
						badge = `<span class="ib-bc-badge ib-bc-badge-all">All Users</span>`;
					}
					return `
					<div class="ib-bc-hist-row">
						<div class="ib-bc-hist-top">
							<span class="ib-bc-hist-title">${frappe.utils.escape_html(b.title)}</span>
							${badge}
							<span class="ib-bc-hist-meta">${frappe.utils.escape_html(b.sent_by)} · ${frappe.datetime.str_to_user(b.sent_at)}</span>
						</div>
						${b.image ? `<img src="${frappe.utils.escape_html(b.image)}" class="ib-bc-hist-img" />` : ""}
						<div class="ib-bc-hist-msg">${frappe.markdown(b.message)}</div>
					</div>`;
				}).join(""));
			},
		});
	}

	load_history();
};
