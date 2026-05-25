// IB Broadcast — global subscriber + late-joiner check
// Runs on every page load for all users.

(function () {
	// In-memory dedup for current session (prevents double-show if realtime + late-joiner overlap)
	const _session_seen = new Set();

	function _show(broadcast) {
		if (_session_seen.has(broadcast.name)) return;
		_session_seen.add(broadcast.name);

		const d = new frappe.ui.Dialog({
			title: frappe.utils.escape_html(broadcast.title || "Announcement"),
		});

		const sent_label = broadcast.sent_by
			? `<div class="ib-bcast-from">From <strong>${frappe.utils.escape_html(broadcast.sent_by)}</strong>${broadcast.sent_at ? " &middot; " + frappe.datetime.str_to_user(broadcast.sent_at) : ""}</div>`
			: "";

		const img_html = broadcast.image
			? `<img class="ib-bcast-img" src="${frappe.utils.escape_html(broadcast.image)}" />`
			: "";
		d.$body.html(`
			<div class="ib-bcast-body">
				${sent_label}
				${img_html}
				<div class="ib-bcast-msg">${frappe.markdown(broadcast.message || "")}</div>
			</div>
		`);
		d.set_primary_action("Got it", () => d.hide());
		d.show();

		// Mark seen server-side so the user never sees this broadcast again
		frappe.call({
			method: "instabiz.overrides.broadcast.mark_broadcast_seen",
			args: { name: broadcast.name },
		});
	}

	function _show_queue(queue) {
		if (!queue.length) return;
		_show(queue.shift());
		if (queue.length) setTimeout(() => _show_queue(queue), 600);
	}

	// Late-joiner: server already filters out seen broadcasts for this user
	function _check_on_load() {
		frappe.call({
			method: "instabiz.overrides.broadcast.get_recent_broadcasts",
			callback(r) {
				if (!r.message || !r.message.length) return;
				_show_queue(r.message);
			},
		});
	}

	// Poll until frappe.realtime.socket is ready, then attach listener.
	function _setup_realtime() {
		if (frappe.realtime && frappe.realtime.socket) {
			frappe.realtime.socket.on("ib_broadcast", _show);
		} else {
			setTimeout(_setup_realtime, 300);
		}
	}
	_setup_realtime();

	$(document).on("page-change", function () {
		$(document).off("page-change");
		_check_on_load();
	});
})();
