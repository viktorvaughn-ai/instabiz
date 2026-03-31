# apps/instabiz/instabiz/naming.py

import frappe

LOCATION_CODE_MAP = {
    "maharashtra": "BWD",
    "chennai":     "CN",
    "gujarat":     "SGM",
}

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

    return "XX"


def get_next_dn_si_number(warehouse_code):
    """
    Get next shared number for DN/SI pair.
    Both use same counter: IB-{wh}-DNSI-
    """
    series_name = f"IB-{warehouse_code}-DNSI-"
    
    current = frappe.db.get_value("Series", series_name, "current", order_by="name")
    
    if current is None:
        frappe.db.sql("""
            INSERT INTO `tabSeries` (name, current)
            VALUES (%s, 0)
        """, (series_name,))
        current = 0
    
    next_num = int(current) + 1
    frappe.db.sql("""
        UPDATE `tabSeries`
        SET current = %s
        WHERE name = %s
    """, (next_num, series_name))
    
    frappe.db.commit()
    
    return next_num


def autoname_quotation(doc, method=None):
    wh       = get_warehouse_code(doc)
    prefix   = f"IB-{wh}-Q-"
    doc.name = frappe.model.naming.make_autoname(f"{prefix}.#######")


def autoname_sales_order(doc, method=None):
    wh       = get_warehouse_code(doc)
    prefix   = f"IB-{wh}-SO-"
    doc.name = frappe.model.naming.make_autoname(f"{prefix}.#######")


def autoname_delivery_note(doc, method=None):
    wh = get_warehouse_code(doc)
    
    # Check if this DN is created FROM a Sales Invoice
    # If yes, extract number from SI and reuse it
    if doc.get("against_sales_invoice"):
        # Extract number from SI name: IB-BWD-INV-0001 → 0001
        si_name = doc.against_sales_invoice
        if si_name and "-INV-" in si_name:
            num_str = si_name.split("-INV-")[-1]
            doc.name = f"IB-{wh}-DN-{num_str}"
            return
    
    # Otherwise, get next shared number
    num = get_next_dn_si_number(wh)
    doc.name = f"IB-{wh}-DN-{num:07d}"


def autoname_sales_invoice(doc, method=None):
    wh = get_warehouse_code(doc)
    
    # Check if this SI is created FROM a Delivery Note
    # If yes, extract number from DN and reuse it
    dn_items = doc.get("items") or []
    for item in dn_items:
        if item.get("delivery_note"):
            dn_name = item.delivery_note
            if dn_name and "-DN-" in dn_name:
                # Extract number: IB-BWD-DN-0001 → 0001
                num_str = dn_name.split("-DN-")[-1]
                doc.name = f"IB-{wh}-INV-{num_str}"
                return
    
    # Otherwise, get next shared number
    num = get_next_dn_si_number(wh)
    doc.name = f"IB-{wh}-INV-{num:07d}"