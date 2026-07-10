import shutil
from pathlib import Path

import frappe

HR_TEAM_TITLE = "HR Documents"
EMPLOYEES_FOLDER = "Employee Documents"


def sync_employee_docs_to_drive(doc, method=None):
	"""After Employee save: enqueue Drive sync for new document rows; rename folder if name changed."""
	before = doc.get_doc_before_save()
	name_changed = (
		before
		and before.get("employee_name")
		and before.get("employee_name") != doc.employee_name
	)
	if name_changed:
		frappe.enqueue(
			"instabiz.overrides.employee_drive._rename_employee_folder",
			employee=doc.name,
			old_name=before.get("employee_name"),
			new_name=doc.employee_name,
			queue="short",
		)

	needs_sync = any(
		row.document_file and not row.drive_file_id
		for row in (doc.get("custom_employee_documents") or [])
	)
	if not needs_sync:
		return

	frappe.enqueue(
		"instabiz.overrides.employee_drive._do_sync",
		employee=doc.name,
		queue="short",
	)


def _do_sync(employee):
	"""Background job: copy unsynced Employee Document files into Drive."""
	try:
		import magic
		from drive.utils import create_drive_file, get_home_folder
		from drive.utils.files import FileManager
	except ImportError:
		frappe.log_error("Employee Drive Sync: Frappe Drive not installed", frappe.get_traceback())
		return

	doc = frappe.get_doc("Employee", employee)
	rows = [
		r for r in (doc.get("custom_employee_documents") or [])
		if r.document_file and not r.drive_file_id
	]
	if not rows:
		return

	team_name = _ensure_hr_team()
	manager = FileManager()
	home = get_home_folder(team_name)

	root_folder = _ensure_folder(EMPLOYEES_FOLDER, home["name"], team_name, manager, home)
	emp_title = f"{doc.employee_name} ({doc.name})"
	emp_folder = _ensure_folder(emp_title, root_folder, team_name, manager, home)

	for row in rows:
		drive_id = _file_to_drive(
			row.document_file, emp_folder, team_name, row.document_type, manager, home
		)
		if drive_id:
			frappe.db.set_value("Employee Document", row.name, "drive_file_id", drive_id)
			frappe.db.commit()


def _rename_employee_folder(employee, old_name, new_name):
	"""Rename the Drive folder when employee_name changes."""
	try:
		from drive.utils import get_home_folder
	except ImportError:
		return

	team_name = frappe.db.get_value("Drive Team", {"title": HR_TEAM_TITLE}, "name")
	if not team_name:
		return

	home = get_home_folder(team_name)
	root = frappe.db.get_value(
		"Drive File",
		{"title": EMPLOYEES_FOLDER, "parent_entity": home["name"], "is_group": 1, "is_active": 1},
		"name",
	)
	if not root:
		return

	old_title = f"{old_name} ({employee})"
	folder = frappe.db.get_value(
		"Drive File",
		{"title": old_title, "parent_entity": root, "is_group": 1, "is_active": 1},
		"name",
	)
	if not folder:
		return

	new_title = f"{new_name} ({employee})"
	frappe.db.set_value("Drive File", folder, "title", new_title)
	frappe.db.commit()


def _ensure_hr_team():
	"""Find or create the HR Documents Drive Team; sync HR + System Manager users."""
	existing = frappe.db.get_value("Drive Team", {"title": HR_TEAM_TITLE}, "name")
	if not existing:
		team = frappe.get_doc({"doctype": "Drive Team", "title": HR_TEAM_TITLE, "personal": 0})
		team.insert(ignore_permissions=True)
		frappe.db.commit()
		existing = team.name

	hr_users = set(
		frappe.get_all(
			"Has Role",
			filters={"role": ["in", ["HR Manager", "System Manager"]], "parenttype": "User"},
			pluck="parent",
		)
	)
	team_doc = frappe.get_doc("Drive Team", existing)
	current_users = {m.user for m in team_doc.users}
	changed = False
	for user in hr_users:
		if user not in current_users and frappe.db.get_value("User", user, "enabled"):
			team_doc.append("users", {"user": user, "access_level": 2})
			changed = True
	if changed:
		team_doc.save(ignore_permissions=True)
		frappe.db.commit()

	return existing


def _ensure_folder(title, parent_name, team_name, manager, home):
	"""Find or create a Drive folder. Returns the Drive File entity name."""
	existing = frappe.db.get_value(
		"Drive File",
		{"title": title, "parent_entity": parent_name, "is_group": 1, "is_active": 1},
		"name",
	)
	if existing:
		return existing

	parent_path = Path(frappe.db.get_value("Drive File", parent_name, "path") or "")
	disk_path = manager.create_folder(
		frappe._dict({"title": title, "team": team_name, "parent_path": parent_path}),
		home,
	)

	from drive.utils import create_drive_file

	drive_file = create_drive_file(
		team=team_name,
		title=title,
		parent=parent_name,
		mime_type="",
		entity_path=lambda _: disk_path,
		is_group=True,
		owner="Administrator",
	)
	frappe.db.commit()
	return drive_file.name


def _file_to_drive(url, folder_name, team_name, doc_label, manager, home):
	"""Copy one Frappe Attach file into a Drive folder. Returns Drive File name or None."""
	if not url:
		return None

	if url.startswith("/private/files/"):
		filename = url.split("/private/files/", 1)[1]
		src_path = Path(frappe.get_site_path("private", "files", filename))
	elif url.startswith("/files/"):
		filename = url.split("/files/", 1)[1]
		src_path = Path(frappe.get_site_path("public", "files", filename))
	else:
		return None  # external URL — skip

	if not src_path.exists():
		frappe.log_error(f"Employee Drive Sync: file not found on disk: {url}", frappe.get_traceback())
		return None

	title = f"{doc_label} - {src_path.name}"

	# Dedup: same title already in this folder → return existing
	existing = frappe.db.get_value(
		"Drive File",
		{"title": title, "parent_entity": folder_name, "is_active": 1, "is_group": 0},
		"name",
	)
	if existing:
		return existing

	try:
		import magic
		mime_type = magic.from_file(str(src_path), mime=True)
	except Exception:
		mime_type = "application/octet-stream"

	file_size = src_path.stat().st_size

	if manager.flat:
		entity_path = lambda df: manager.get_disk_path(df, home)
	else:
		folder_path = Path(frappe.db.get_value("Drive File", folder_name, "path") or "")
		entity_path = lambda df: folder_path / df.title

	from drive.utils import create_drive_file

	drive_file = create_drive_file(
		team=team_name,
		title=title,
		parent=folder_name,
		mime_type=mime_type,
		entity_path=entity_path,
		file_size=file_size,
		owner="Administrator",
	)

	# Copy to Drive storage — keep original attached to Employee
	dest = Path(frappe.get_site_path("private/files")) / drive_file.path
	dest.parent.mkdir(parents=True, exist_ok=True)
	shutil.copy2(str(src_path), str(dest))

	return drive_file.name


@frappe.whitelist()
def get_employee_drive_folder(employee):
	"""Return Drive folder entity name for this employee, or None if not synced yet."""
	try:
		from drive.utils import get_home_folder
	except ImportError:
		return None

	team_name = frappe.db.get_value("Drive Team", {"title": HR_TEAM_TITLE}, "name")
	if not team_name:
		return None

	home = get_home_folder(team_name)
	root = frappe.db.get_value(
		"Drive File",
		{"title": EMPLOYEES_FOLDER, "parent_entity": home["name"], "is_group": 1},
		"name",
	)
	if not root:
		return None

	emp = frappe.get_doc("Employee", employee)
	emp_title = f"{emp.employee_name} ({emp.name})"
	return frappe.db.get_value(
		"Drive File",
		{"title": emp_title, "parent_entity": root, "is_group": 1},
		"name",
	)
