import frappe
from frappe.utils import add_days, today

# Roles that can see all leads
_LEAD_ADMIN_ROLES = {"System Manager", "Sales Manager", "Administrator"}


def get_permission_query_conditions(user):
	"""
	Sales Users see only leads assigned to them.
	Sales Managers and above see everything.
	"""
	if not user:
		user = frappe.session.user

	roles = set(frappe.get_roles(user))
	if roles & _LEAD_ADMIN_ROLES:
		return ""

	escaped = frappe.db.escape(user)
	return f"`tabLead`.`lead_owner` = {escaped}"


def on_before_insert(doc, method=None):
	assign_lead(doc)


def on_before_save(doc, method=None):
	if doc.has_value_changed("territory"):
		assign_lead(doc)


def on_after_insert(doc, method=None):
	_notify_lead_assignee(doc)


def on_after_save(doc, method=None):
	_notify_lead_assignee(doc)


def assign_lead(doc):
	"""
	Find the Territory Sales Team whose cluster contains doc.territory,
	then assign the next member via round-robin.
	"""
	if not doc.territory:
		return

	cluster = _find_cluster(doc.territory)
	if not cluster:
		return

	team = _get_team_for_cluster(cluster)
	if not team:
		return

	members = team.members
	if not members:
		return

	idx = (team.rr_index or 0) % len(members)
	new_owner = members[idx].user

	previous_owner = doc.lead_owner
	doc.lead_owner = new_owner

	# Advance the pointer atomically — avoid re-triggering Lead save hooks
	frappe.db.set_value(
		"Territory Sales Team", team.name,
		"rr_index", (idx + 1) % len(members),
		update_modified=False,
	)

	# Notify the assigned user (skip if unchanged to avoid noise)
	if new_owner and new_owner != previous_owner:
		doc._notify_assignee = new_owner


def _notify_lead_assignee(doc):
	"""Send a system notification to the newly assigned lead owner."""
	user = getattr(doc, "_notify_assignee", None)
	if not user:
		return

	lead_url = f"/app/crm/leads/{doc.name}"
	frappe.publish_realtime(
		"eval_js",
		f"frappe.show_alert({{message: __('Lead {doc.lead_name or doc.name} assigned to you'), indicator: 'blue'}})",
		user=user,
	)

	frappe.get_doc({
		"doctype": "Notification Log",
		"subject": frappe._("New lead assigned: {0}").format(doc.lead_name or doc.company_name or doc.name),
		"email_content": frappe._("Lead <b>{0}</b> ({1}) has been assigned to you.").format(
			doc.lead_name or doc.company_name or doc.name,
			doc.territory or "",
		),
		"for_user": user,
		"from_user": frappe.session.user,
		"document_type": "Lead",
		"document_name": doc.name,
		"type": "Assignment",
	}).insert(ignore_permissions=True)


def _find_cluster(territory):
	"""
	Walk up the territory tree and return the immediate child of the root
	(i.e. the cluster-level territory). If the territory itself is a cluster
	(its parent is root / has no parent), return it directly.
	"""
	visited = []
	current = territory

	while current:
		data = frappe.db.get_value(
			"Territory", current, ["parent_territory", "is_group"], as_dict=True
		)
		if not data:
			break
		visited.append(current)
		if not data.parent_territory:
			# Reached root — the cluster is the node just below root
			# i.e. the last visited that is NOT the root itself
			if len(visited) >= 2:
				return visited[-2]   # one level below root
			return visited[-1]       # territory itself is root-level
		current = data.parent_territory

	return None


def _get_team_for_cluster(cluster):
	"""Return the Territory Sales Team document for this cluster, or None."""
	name = frappe.db.get_value(
		"Territory Sales Team", {"territory_cluster": cluster}, "name"
	)
	if not name:
		return None
	return frappe.get_doc("Territory Sales Team", name)


# ── Scheduled: reassign leads stale for > 30 days ─────────────────────────────

def reassign_stale_leads():
	"""
	Daily job: any open lead unchanged for 30+ days gets reassigned
	to the next member of its territory team.
	"""
	cutoff = add_days(today(), -30)

	stale = frappe.get_all(
		"Lead",
		filters={
			"status": ["in", ["Lead", "Open", "Replied", "Interested"]],
			"modified": ["<", cutoff],
			"territory": ["is", "set"],
		},
		fields=["name", "territory"],
	)

	for row in stale:
		try:
			doc = frappe.get_doc("Lead", row.name)
			old_owner = doc.lead_owner
			assign_lead(doc)
			if doc.lead_owner != old_owner:
				doc.add_comment(
					"Info",
					frappe._("Auto-reassigned from {0} to {1} (stale >30 days)").format(
						old_owner, doc.lead_owner
					),
				)
				doc.save(ignore_permissions=True)
		except Exception:
			frappe.log_error(frappe.get_traceback(), f"Stale lead reassign failed: {row.name}")
