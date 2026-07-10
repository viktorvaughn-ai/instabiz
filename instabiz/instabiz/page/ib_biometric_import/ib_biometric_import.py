"""IB Biometric Attendance Import.

Parses biometric device CSV exports and creates Employee Checkin records.
Supports ZKTeco, eSSL, and generic formats.

Employee lookup: matches via `custom_biometric_id` on Employee doc.
If no match found, falls back to matching by employee_name (case-insensitive).

Duplicate guard: skips rows where (employee + time) already exists in Employee Checkin.
"""
import csv
import io
import re
from datetime import datetime

import frappe
from frappe import _
from frappe.utils import nowdate


# ── Date/time parsing ──────────────────────────────────────────────────────────

_DATE_FMTS = [
    "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y",
    "%Y/%m/%d", "%d %b %Y", "%d-%b-%Y",
]
_DATETIME_FMTS = [
    "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M",
    "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M",
    "%d-%m-%Y %H:%M:%S", "%d-%m-%Y %H:%M",
    "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M",
]


def _parse_datetime(date_val, time_val=None):
    """Return (datetime_str, date_str) or raise ValueError."""
    if time_val:
        combined = f"{date_val.strip()} {time_val.strip()}"
        for fmt in _DATETIME_FMTS:
            try:
                dt = datetime.strptime(combined, fmt)
                return dt.strftime("%Y-%m-%d %H:%M:%S"), dt.strftime("%Y-%m-%d")
            except ValueError:
                pass
    else:
        combined = date_val.strip()
        for fmt in _DATETIME_FMTS:
            try:
                dt = datetime.strptime(combined, fmt)
                return dt.strftime("%Y-%m-%d %H:%M:%S"), dt.strftime("%Y-%m-%d")
            except ValueError:
                pass

    # Try date-only
    for fmt in _DATE_FMTS:
        try:
            dt = datetime.strptime(date_val.strip(), fmt)
            return dt.strftime("%Y-%m-%d 09:00:00"), dt.strftime("%Y-%m-%d")
        except ValueError:
            pass

    raise ValueError(f"Cannot parse date/time: {date_val!r} {time_val!r}")


def _parse_log_type(val):
    """Return 'IN' or 'OUT' from various encodings."""
    if val is None:
        return "IN"
    v = str(val).strip().upper()
    if v in ("0", "IN", "I", "C", "CHECK IN", "CHECKIN", "ENTRY"):
        return "IN"
    if v in ("1", "OUT", "O", "CHECK OUT", "CHECKOUT", "EXIT"):
        return "OUT"
    # ZKTeco: 0=IN 1=OUT 2=BREAK_OUT 3=BREAK_IN 4=OT_IN 5=OT_OUT
    try:
        n = int(v)
        return "OUT" if n % 2 == 1 else "IN"
    except (ValueError, TypeError):
        pass
    return "IN"


# ── CSV parsing ────────────────────────────────────────────────────────────────

def _sniff_delimiter(sample):
    """Detect tab or comma delimiter."""
    tab_count   = sample.count("\t")
    comma_count = sample.count(",")
    return "\t" if tab_count > comma_count else ","


def _col(row, *candidates):
    """Case-insensitive column lookup."""
    for k in row:
        kl = k.lower().strip().replace(" ", "").replace("_", "")
        for c in candidates:
            if c.replace(" ", "").replace("_", "") in kl:
                return (row[k] or "").strip()
    return ""


def _parse_csv(csv_text, id_col=None, datetime_col=None, date_col=None, time_col=None, type_col=None):
    """
    Parse biometric CSV. Returns list of dicts:
      biometric_id, datetime_str, date_str, log_type, raw_name

    Column params are optional column-name overrides from the user.
    Auto-detected if not provided.
    """
    lines = [l for l in csv_text.splitlines() if l.strip()]
    if not lines:
        frappe.throw(_("CSV is empty"))

    delimiter = _sniff_delimiter("\n".join(lines[:5]))
    reader = csv.DictReader(io.StringIO("\n".join(lines)), delimiter=delimiter)

    # Normalise headers
    try:
        headers = reader.fieldnames or []
    except Exception:
        frappe.throw(_("Could not parse CSV headers"))

    rows = []
    for raw_row in reader:
        # Employee ID
        if id_col and id_col in raw_row:
            bio_id = (raw_row[id_col] or "").strip()
        else:
            bio_id = _col(raw_row, "userid", "user_id", "employeeid", "employee_id", "empid", "emp_id", "id", "no")

        if not bio_id:
            continue

        # Raw name (for fallback matching)
        raw_name = _col(raw_row, "name", "employeename", "employee_name", "empname")

        # Date/time
        if datetime_col and datetime_col in raw_row:
            dt_raw = raw_row[datetime_col]
            dt_str, date_str = _parse_datetime(dt_raw)
        elif date_col and date_col in raw_row:
            dc = raw_row[date_col]
            tc = raw_row.get(time_col, "") if time_col else _col(raw_row, "time", "punchtime", "checktime")
            dt_str, date_str = _parse_datetime(dc, tc)
        else:
            # Auto-detect: try "datetime" first, then "date"+"time"
            dt_raw = _col(raw_row, "datetime", "checktime", "punchtime", "timestamp", "date_time")
            if dt_raw:
                try:
                    dt_str, date_str = _parse_datetime(dt_raw)
                except ValueError:
                    continue
            else:
                d_raw = _col(raw_row, "date", "attdate", "attendance_date", "punchdate")
                t_raw = _col(raw_row, "time", "punchtime", "checktime", "intime")
                if not d_raw:
                    continue
                try:
                    dt_str, date_str = _parse_datetime(d_raw, t_raw or None)
                except ValueError:
                    continue

        # Log type
        if type_col and type_col in raw_row:
            log_type = _parse_log_type(raw_row[type_col])
        else:
            type_raw = _col(raw_row, "status", "type", "punchtype", "logtype", "checktype", "inout")
            log_type = _parse_log_type(type_raw or "0")

        rows.append({
            "biometric_id": bio_id,
            "raw_name":     raw_name,
            "datetime_str": dt_str,
            "date_str":     date_str,
            "log_type":     log_type,
        })

    return rows, list(headers)


# ── Employee lookup ────────────────────────────────────────────────────────────

def _build_employee_map():
    """
    Returns dict: biometric_id (str) → Employee name.
    Primary: custom_biometric_id. Fallback: employee_name (lower).
    """
    emps = frappe.db.sql("""
        SELECT name, employee_name, custom_biometric_id
        FROM `tabEmployee`
        WHERE status='Active'
    """, as_dict=True)

    by_bio_id = {}
    by_name   = {}
    for e in emps:
        if e.custom_biometric_id:
            by_bio_id[str(e.custom_biometric_id).strip()] = e.name
        by_name[e.employee_name.strip().lower()] = e.name

    return by_bio_id, by_name


def _resolve_employee(bio_id, raw_name, by_bio_id, by_name):
    if bio_id in by_bio_id:
        return by_bio_id[bio_id]
    if raw_name and raw_name.strip().lower() in by_name:
        return by_name[raw_name.strip().lower()]
    return None


# ── Whitelisted API ────────────────────────────────────────────────────────────

@frappe.whitelist()
def detect_columns(csv_text):
    """Return detected headers so frontend can build mapping UI."""
    frappe.only_for(["HR Manager", "HR User", "System Manager"])
    lines = [l for l in csv_text.splitlines() if l.strip()]
    if not lines:
        return {"headers": []}
    delimiter = _sniff_delimiter("\n".join(lines[:5]))
    reader = csv.DictReader(io.StringIO("\n".join(lines)), delimiter=delimiter)
    headers = list(reader.fieldnames or [])

    # Try to parse first 3 data rows for preview
    sample = []
    for i, row in enumerate(reader):
        if i >= 3:
            break
        sample.append(dict(row))

    return {"headers": headers, "sample": sample, "delimiter": "tab" if delimiter == "\t" else "comma"}


@frappe.whitelist()
def preview_biometric(csv_text, id_col=None, datetime_col=None, date_col=None, time_col=None, type_col=None):
    """Parse CSV and return rows for preview (no DB writes)."""
    frappe.only_for(["HR Manager", "HR User", "System Manager"])
    rows, headers = _parse_csv(csv_text, id_col, datetime_col, date_col, time_col, type_col)
    by_bio_id, by_name = _build_employee_map()

    preview = []
    unmatched_ids = set()
    for r in rows:
        emp = _resolve_employee(r["biometric_id"], r["raw_name"], by_bio_id, by_name)
        preview.append({
            "biometric_id":   r["biometric_id"],
            "raw_name":       r["raw_name"],
            "employee":       emp or "",
            "matched":        bool(emp),
            "date_str":       r["date_str"],
            "datetime_str":   r["datetime_str"],
            "log_type":       r["log_type"],
        })
        if not emp:
            unmatched_ids.add(r["biometric_id"])

    return {
        "rows":           preview[:50],
        "total":          len(preview),
        "unmatched_count": len(unmatched_ids),
        "unmatched_ids":  sorted(unmatched_ids),
        "headers":        headers,
    }


@frappe.whitelist()
def import_biometric(csv_text, id_col=None, datetime_col=None, date_col=None, time_col=None, type_col=None):
    """Parse CSV and create Employee Checkin records."""
    frappe.only_for(["HR Manager", "HR User", "System Manager"])

    rows, _ = _parse_csv(csv_text, id_col, datetime_col, date_col, time_col, type_col)
    by_bio_id, by_name = _build_employee_map()

    created   = 0
    skipped   = 0
    unmatched = 0
    errors    = []

    for r in rows:
        emp = _resolve_employee(r["biometric_id"], r["raw_name"], by_bio_id, by_name)
        if not emp:
            unmatched += 1
            continue

        # Duplicate guard: same employee + same timestamp
        exists = frappe.db.exists("Employee Checkin", {
            "employee": emp,
            "time": r["datetime_str"],
        })
        if exists:
            skipped += 1
            continue

        try:
            doc = frappe.get_doc({
                "doctype":  "Employee Checkin",
                "employee": emp,
                "log_type": r["log_type"],
                "time":     r["datetime_str"],
                "device_id": "biometric-import",
            })
            doc.insert(ignore_permissions=True)
            created += 1
        except Exception as e:
            errors.append({"biometric_id": r["biometric_id"], "time": r["datetime_str"], "error": str(e)})
            frappe.log_error("IB Biometric Import", str(e))

    if created:
        frappe.db.commit()

    return {
        "created":   created,
        "skipped":   skipped,
        "unmatched": unmatched,
        "errors":    errors,
    }


@frappe.whitelist()
def get_unmatched_employees():
    """Return employees with no custom_biometric_id set (factory dept)."""
    frappe.only_for(["HR Manager", "HR User", "System Manager"])
    rows = frappe.db.sql("""
        SELECT name, employee_name, department, custom_biometric_id
        FROM `tabEmployee`
        WHERE status = 'Active' AND department LIKE '%Factory%'
        ORDER BY employee_name
    """, as_dict=True)
    return rows


@frappe.whitelist()
def save_biometric_id(employee, biometric_id):
    """Set custom_biometric_id on an Employee record."""
    frappe.only_for(["HR Manager", "System Manager"])
    frappe.db.set_value("Employee", employee, "custom_biometric_id", biometric_id)
    frappe.db.commit()
    return {"status": "ok"}


def get_context(context):
    context.no_cache = 1
