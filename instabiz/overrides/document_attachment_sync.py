"""
Sync Sales Invoice attached documents to Frappe Drive.

Folder hierarchy in Drive (under the IB Documents team):
  IB Documents
  └── {customer_name}
      └── {si_name}
          └── {document_type} - {filename}

Triggered:  Sales Invoice on_update (for both draft saves and submitted docs)
Dedup:      drive_file_id stored on each IB SI Document child row — skips rows that
            already have a valid Drive File.
"""

import shutil
from pathlib import Path

import frappe
from frappe.utils import get_site_path

_DRIVE_TEAM_TITLE = "IB Documents"


def _get_or_create_team():
    existing = frappe.db.get_value("Drive Team", {"title": _DRIVE_TEAM_TITLE}, "name")
    if existing:
        return existing

    team = frappe.get_doc({"doctype": "Drive Team", "title": _DRIVE_TEAM_TITLE, "personal": 0})
    team.insert(ignore_permissions=True)
    frappe.db.commit()
    return team.name


def _get_home_folder(team_name):
    row = frappe.db.sql(
        "SELECT name, path FROM `tabDrive File` WHERE team=%s AND parent_entity IS NULL",
        (team_name,),
        as_dict=True,
    )
    return row[0] if row else None


def _ensure_folder(team, title, parent_entity):
    existing = frappe.db.get_value(
        "Drive File",
        {"team": team, "title": title, "parent_entity": parent_entity, "is_group": 1, "is_active": 1},
        "name",
    )
    if existing:
        return existing

    # Use Drive's create_folder API
    try:
        from drive.api.files import create_folder

        _orig_user = frappe.session.user
        try:
            frappe.session.user = "Administrator"
            folder = create_folder(team=team, title=title, parent=parent_entity)
        finally:
            frappe.session.user = _orig_user
        return folder.name
    except Exception as e:
        frappe.log_error("IB SI Drive: create_folder failed", f"folder: {title}\n{e}")
        return None


def _copy_file_to_drive(team, folder_entity, file_url, file_title):
    """Copy a Frappe-attached file into a Drive folder."""
    try:
        from drive.utils import create_drive_file, get_home_folder
        from drive.utils.files import FileManager

        home = get_home_folder(team)
        parent_doc = frappe.get_doc("Drive File", folder_entity)

        if not file_url:
            return None

        # Resolve local path from Frappe file URL
        if file_url.startswith("/files/"):
            local_path = Path(get_site_path("public")) / file_url.lstrip("/")
        elif file_url.startswith("/private/files/"):
            local_path = Path(get_site_path()) / file_url.lstrip("/")
        else:
            return None

        if not local_path.exists():
            return None

        import mimetypes
        mime_type = mimetypes.guess_type(str(local_path))[0] or "application/octet-stream"
        file_size = local_path.stat().st_size

        manager = FileManager()

        drive_file = create_drive_file(
            team,
            file_title,
            folder_entity,
            mime_type,
            lambda entity: manager.get_disk_path(entity, home, False),
            file_size,
        )

        shutil.copy2(local_path, drive_file.path)
        return drive_file.name

    except Exception as e:
        frappe.log_error("IB SI Drive: copy file failed", f"url: {file_url}\n{e}")
        return None


def sync_si_documents_to_drive(doc, method=None):
    """Called from Sales Invoice on_update doc_event."""
    rows = doc.get("custom_si_documents") or []
    if not rows:
        return

    pending = [r for r in rows if r.attachment and not r.drive_file_id]
    if not pending:
        return

    _orig_user = frappe.session.user
    try:
        frappe.session.user = "Administrator"
        team = _get_or_create_team()
        home = _get_home_folder(team)
        if not home:
            frappe.log_error("IB SI Drive: No home folder found for team", "si_drive_sync")
            return

        customer_title = (
            frappe.db.get_value("Sales Invoice", doc.name, "customer_name")
            or doc.customer_name
            or doc.customer
        )
        cust_folder = _ensure_folder(team, customer_title, home["name"])
        if not cust_folder:
            return

        si_folder = _ensure_folder(team, doc.name, cust_folder)
        if not si_folder:
            return

        for row in pending:
            filename = row.attachment.split("/")[-1]
            doc_type = (row.document_type or "File").replace("/", "-")
            drive_title = f"{doc_type} - {filename}"
            drive_id = _copy_file_to_drive(team, si_folder, row.attachment, drive_title)
            if drive_id:
                frappe.db.set_value("IB SI Document", row.name, "drive_file_id", drive_id, update_modified=False)

        frappe.db.commit()
    except Exception as e:
        frappe.log_error(f"IB SI Drive sync: {doc.name}", str(e))
    finally:
        frappe.session.user = _orig_user
