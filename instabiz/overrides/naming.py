# apps/instabiz/instabiz/naming.py

import frappe

LOCATION_CODE_MAP = {
    "maharashtra": "BWD",
    "chennai":     "CN",
    "gujarat":     "SGM",
}

# Single global series shared by all DN and SI across every warehouse
_GLOBAL_DNSI_SERIES = "IB-DNSI-"


def get_warehouse_code(doc):
    location = (doc.get("custom_location") or "").strip().lower()

    if not location:
        warehouse = (
            doc.get("set_warehouse")
            or (doc.items[0].warehouse if doc.items else None)
            or ""
        )
        location = warehouse.split(" - ")[0].strip().lower()

    for key, code in LOCATION_CODE_MAP.items():
        if key in location or location in key:
            return code

    valid = ", ".join(LOCATION_CODE_MAP.keys())
    frappe.throw(
        frappe._(
            "Unknown location {0!r}. Please set a valid Location on this document. "
            "Valid locations: {1}"
        ).format(doc.get("custom_location") or "(empty)", valid)
    )


def get_next_dn_si_number():
    """
    Get the next number from the single global DN/SI counter.
    All warehouses share one sequence so numbers never overlap across sites.
    Uses an advisory lock to prevent duplicate numbers under concurrent requests.
    """
    lock_key = "ib_dnsi_counter"
    frappe.db.sql("SELECT GET_LOCK(%s, 10)", lock_key)
    try:
        row = frappe.db.sql("SELECT current FROM `tabSeries` WHERE name = %s", (_GLOBAL_DNSI_SERIES,))
        current = row[0][0] if row else None
        if current is None:
            frappe.db.sql(
                "INSERT INTO `tabSeries` (name, current) VALUES (%s, 0)",
                (_GLOBAL_DNSI_SERIES,),
            )
            current = 0
        next_num = int(current) + 1
        frappe.db.sql(
            "UPDATE `tabSeries` SET current = %s WHERE name = %s",
            (next_num, _GLOBAL_DNSI_SERIES),
        )
        return next_num
    finally:
        frappe.db.sql("SELECT RELEASE_LOCK(%s)", lock_key)


def autoname_quotation(doc, method=None):
    wh       = get_warehouse_code(doc)
    prefix   = f"IB-{wh}-Q-"
    doc.name = frappe.model.naming.make_autoname(f"{prefix}.#####")


def autoname_sales_order(doc, method=None):
    wh       = get_warehouse_code(doc)
    prefix   = f"IB-{wh}-SO-"
    doc.name = frappe.model.naming.make_autoname(f"{prefix}.#####")


def autoname_delivery_note(doc, method=None):
    wh  = get_warehouse_code(doc)
    num = get_next_dn_si_number()
    doc.name = f"IB-{wh}-DN-{num:05d}"


def autoname_sales_invoice(doc, method=None):
    wh = get_warehouse_code(doc)
    # If created from a Delivery Note, reuse its number so DN/SI share the same sequence slot.
    # Mapper sets delivery_note on the parent SI doc; fall back to checking item rows.
    dn_name = doc.get("delivery_note") or ""
    if not dn_name:
        for item in (doc.get("items") or []):
            dn_name = item.get("delivery_note") or ""
            if "-DN-" in dn_name:
                break
    if dn_name and "-DN-" in dn_name:
        num_str = dn_name.split("-DN-")[-1]
        candidate = f"IB-{wh}-INV-{num_str}"
        # Only reuse if not already taken by a cancelled (or any) existing doc.
        if not frappe.db.exists("Sales Invoice", candidate):
            doc.name = candidate
            return
        # Cancelled SI with that name still occupies the slot — fall through to new number.
    # Standalone SI, or DN-reuse conflict — consume the next global number.
    num = get_next_dn_si_number()
    doc.name = f"IB-{wh}-INV-{num:05d}"
