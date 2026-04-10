"""instabiz.overrides.utils"""
import frappe
from frappe import _


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
PARENT_FIELDS = ["custom_transport", "transport_gst", "booking_for"]

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


def transfer_documents(doctype, owner_field, names, to_user,
                       owner_set_value=None,
                       display_name_field=None,
                       handover_ref=None):
    """
    Batch-reassign ownership of `names` in `doctype` to `to_user`.

    owner_set_value     : exact value to write into owner_field. When None,
                          to_user (email) is used. Pass this when owner_field
                          is a Data field storing e.g. User.first_name rather
                          than the user's email address (e.g. custom_sales_person).
    display_name_field  : optional second field updated with the new user's
                          full_name (e.g. custom_lead_owner_name on Lead).
    handover_ref        : Employee Exit Handover name stamped on audit comments.

    Returns the count of documents updated.
    """
    if not names:
        return 0

    if isinstance(names, str):
        import json as _json
        names = _json.loads(names)

    names = list(names)

    if not frappe.db.exists("User", to_user):
        frappe.throw(_("User {0} not found").format(to_user))

    full_name   = frappe.db.get_value("User", to_user, "full_name") or to_user
    field_value = owner_set_value if owner_set_value is not None else to_user

    # ── Batch UPDATE ──────────────────────────────────────────────────────────
    set_parts  = [f"`{owner_field}` = %s"]
    set_values = [field_value]

    if display_name_field:
        set_parts.append(f"`{display_name_field}` = %s")
        set_values.append(full_name)

    placeholders = ", ".join(["%s"] * len(names))
    frappe.db.sql(
        f"UPDATE `tab{doctype}` SET {', '.join(set_parts)} WHERE `name` IN ({placeholders})",
        set_values + names,
    )

    # ── Batch audit comments ──────────────────────────────────────────────────
    now   = frappe.utils.now()
    actor = frappe.session.user

    if handover_ref:
        content = _(
            "Reassigned from {0} to {1} as part of exit handover {2}"
        ).format(actor, full_name, handover_ref)
    else:
        content = _("Ownership transferred to {0}").format(full_name)

    rows = [
        (frappe.generate_hash(length=10), doctype, name, content, actor, now, now, actor)
        for name in names
    ]
    frappe.db.sql(
        "INSERT INTO `tabComment`"
        " (name, comment_type, reference_doctype, reference_name,"
        "  content, owner, creation, modified, modified_by, docstatus, published, seen)"
        " VALUES " + ", ".join(
            ["(%s, 'Info', %s, %s, %s, %s, %s, %s, %s, 0, 0, 0)"] * len(rows)
        ),
        [v for row in rows for v in row],
    )

    return len(names)


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
        frappe.log_error(
            title="Address display rebuild failed",
            message=frappe.get_traceback(),
        )