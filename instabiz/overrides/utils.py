"""instabiz.overrides.utils"""
import frappe


# ── Dimension fields carried across all transaction child rows ────────────────
# ib_brand and ib_marking flow automatically through the entire chain:
# Quotation Item → SO Item → DN Item → SI Item
DIMENSION_FIELDS = [
    "color",
    "width_mm",
    "length_mtr",
    "qty_pkg",
    "total_pkg",
    "ib_brand",
    "ib_marking",
    "custom_branding",
    "custom_marking",
    "custom_thickness",
    "custom_specifications",
    "custom_description"
]

# ── Parent-level fields carried across document chain ─────────────────────────
PARENT_FIELDS = ["transport", "transport_gst", "booking_for"]

# ── Customer + address fields shared across all mapper postprocess functions ──
ADDRESS_CONTACT_FIELDS = [
    "customer_address",
    "shipping_address_name",
    "address_display",
    "shipping_address",
    "contact_person",
    "contact_display",
    "contact_mobile",
    "contact_email",
    "territory",
    "customer_group",
]


def recalculate_items(doc):
    """
    For every item row, derive qty from dimensions then amount from qty * rate.

    Square Meter:  qty = (width_mm / 1000) * length_mtr * qty_pkg * total_pkg
    Any other UOM: qty = qty_pkg * total_pkg
    Incomplete dims: leave qty as-is (user may have typed it manually)
    """
    for item in doc.get("items") or []:
        uom        = (item.get("uom") or "").strip()
        width_mm   = item.get("width_mm") or 0
        length_mtr = item.get("length_mtr") or 0
        qty_pkg    = item.get("qty_pkg") or 0
        total_pkg  = item.get("total_pkg") or 0
        rate       = item.get("rate") or 0

        if uom == "SQMT":
            if width_mm and length_mtr and qty_pkg and total_pkg:
                item.qty = (width_mm / 1000) * length_mtr * qty_pkg * total_pkg
        else:
            if qty_pkg and total_pkg:
                item.qty = qty_pkg * total_pkg

        item.amount = round((item.get("qty") or 0) * rate, 2)


def map_dimension_fields(source_item, target_item):
    """
    Copies all dimension + brand/marking custom fields from a source child
    row to a target child row. Used as postprocess callback in every
    get_mapped_doc call across the transaction chain.
    """
    for field in DIMENSION_FIELDS:
        value = source_item.get(field)
        if value is not None:
            target_item.set(field, value)


def map_parent_fields(source_doc, target_doc):
    """
    Copies transport fields from parent source doc to parent target doc.
    """
    for field in PARENT_FIELDS:
        value = source_doc.get(field)
        if value is not None:
            target_doc.set(field, value)


def map_address_contact_fields(source_doc, target_doc):
    """
    Copies address + contact fields from source to target parent doc.
    Shared by all mapper postprocess_parent functions.
    Also rebuilds address_display and shipping_address from the linked
    Address doctype to avoid carrying stale pre-rendered HTML blobs.
    """
    for field in ADDRESS_CONTACT_FIELDS:
        value = source_doc.get(field)
        if value:
            target_doc.set(field, value)

    # Re-derive display strings from Address doctype for clean output
    try:
        from frappe.contacts.doctype.address.address import get_address_display  # pyright: ignore[reportMissingImports]
        if target_doc.get("customer_address"):
            target_doc.address_display = get_address_display(
                target_doc.customer_address
            )
        if target_doc.get("shipping_address_name"):
            target_doc.shipping_address = get_address_display(
                target_doc.shipping_address_name
            )
    except Exception:
        pass