"""instabiz.overrides.utils"""
import frappe
from frappe import _


# ── Location → company billing address + GSTIN ───────────────────────────────
LOCATION_COMPANY_ADDRESS = {
    "maharashtra": "Instabiz Solutions India Pvt Ltd-Billing-1",
    "gujarat":     "Instabiz Gujarat-Billing",
    "chennai":     "INSTABIZ SOLUTIONS CHENNAI-Billing",
}

LOCATION_COMPANY_GSTIN = {
    "maharashtra": "27AAECI3431Q1Z8",
    "gujarat":     "24AAECI3431Q1ZE",
    "chennai":     "33AAECI3431Q1ZF",
}

LOCATION_COST_CENTER = {
    "maharashtra": "Maharashtra - IB",
    "gujarat":     "Gujarat - IB",
    "chennai":     "Chennai - IB",
}

# ── Location → warehouse (for place of dispatch) ──────────────────────────────
LOCATION_WAREHOUSE = {
    "maharashtra": "MAHARASHTRA - IB",
    "gujarat":     "GUJARAT - IB",
    "chennai":     "CHENNAI - IB",
}

# ── Dimension fields carried across all transaction child rows ────────────────
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
    "custom_description",
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

# ── Field map entries shared by every mapper in the Q→SO→DN→SI chain ─────────
# Each mapper merges this with its own doc-link field (e.g. name→quotation).
COMMON_PARENT_FIELD_MAP = {
    "customer":              "customer",
    "customer_name":         "customer_name",
    "customer_address":      "customer_address",
    "shipping_address_name": "shipping_address_name",
    "contact_person":        "contact_person",
    "contact_display":       "contact_display",
    "territory":             "territory",
    "customer_group":        "customer_group",
    "currency":              "currency",
    "selling_price_list":    "selling_price_list",
    "price_list_currency":   "price_list_currency",
    "plc_conversion_rate":   "plc_conversion_rate",
    "conversion_rate":       "conversion_rate",
    "custom_location":       "custom_location",
    "custom_reference_po":   "custom_reference_po",
    "custom_sales_person":   "custom_sales_person",
    "custom_sales_person_user": "custom_sales_person_user",
}

COMMON_CHILD_FIELD_MAP = {
    "custom_branding":  "custom_branding",
    "custom_marking":   "custom_marking",
    "custom_thickness": "custom_thickness",
}

# ─────────────────────────────────────────────────────────────────────────────
# Sales person helpers
# ─────────────────────────────────────────────────────────────────────────────

def set_sales_person(doc):
    """Auto-populate custom_sales_person_user (email) then custom_sales_person (display).

    Uses frappe.session.user — not doc.owner — so the actual logged-in user is
    credited even when doc.owner resolves to 'Administrator'.
    Guard conditions ensure values already carried via mapper are never overwritten.
    """
    if not doc.get("custom_sales_person_user"):
        doc.custom_sales_person_user = frappe.session.user
    if not doc.get("custom_sales_person"):
        full_name = frappe.db.get_value("User", doc.custom_sales_person_user, "full_name")
        if full_name:
            doc.custom_sales_person = full_name


def sync_sales_team(doc):
    """Mirror custom_sales_person into ERPNext's sales_team child table.

    Keeps native Sales Person analytics/reports in sync.
    Returns silently if the doctype has no sales_team table or if the
    Sales Person master record does not exist. Never adds duplicate rows.
    """
    if not frappe.get_meta(doc.doctype).get_field("sales_team"):
        return

    sp_value = (doc.get("custom_sales_person") or "").strip()
    if not sp_value:
        return

    sp_name, commission_rate = frappe.db.get_value(
        "Sales Person", {"sales_person_name": sp_value}, ["name", "commission_rate"]
    ) or (None, None)
    if not sp_name:
        return

    for row in doc.get("sales_team") or []:
        if row.sales_person == sp_name:
            return

    doc.append("sales_team", {
        "sales_person": sp_name,
        "allocated_percentage": 100,
        "commission_rate": commission_rate or 0,
    })


# ─────────────────────────────────────────────────────────────────────────────
# Status remap mixin
# ─────────────────────────────────────────────────────────────────────────────

class IbStatusMixin:
    """Mixin for all IB sales document classes.

    Remaps ERPNext's internal status values to IB display labels after every
    set_status() call. Also handles _validate_selects() by temporarily
    swapping back to a safe ERPNext value ("Draft") so Frappe's select-field
    validator doesn't reject our custom labels.

    Subclasses must declare:
        STATUS_MAP = {"ERPNext status": "IB label", ...}
    """
    STATUS_MAP: dict = {}

    def set_status(self, update=False, status=None, update_modified=True):
        super().set_status(update=update, status=status, update_modified=update_modified)
        if self.status in self.STATUS_MAP:
            self.status = self.STATUS_MAP[self.status]
            if update:
                self.db_set("status", self.status, update_modified=update_modified)

    def _validate_selects(self):
        remapped = self.status
        if remapped in self.STATUS_MAP.values():
            self.status = "Draft"
        super()._validate_selects()
        self.status = remapped


# ─────────────────────────────────────────────────────────────────────────────
# Generic reopen helper
# ─────────────────────────────────────────────────────────────────────────────

def reopen_sales_doc(doctype, name, item_doctype, pre_checks=None, extra_steps=None):
    """Reopen a cancelled IB sales document, resetting it back to Draft (docstatus=0).

    doctype       : "Quotation", "Sales Order", etc.
    name          : document name
    item_doctype  : child item table name e.g. "Quotation Item"
    pre_checks    : callable(name) — raise frappe.ValidationError to block reopen
    extra_steps   : callable(doc) — runs inside the try block after child row reset,
                    before set_status (e.g. reverting linked doc statuses)
    """
    doc = frappe.get_doc(doctype, name)
    frappe.has_permission(doctype, "cancel", doc=doc, throw=True)

    if doc.docstatus != 2:
        frappe.throw(_("Only a cancelled {0} can be reopened.").format(doctype))

    if pre_checks:
        pre_checks(name)

    try:
        frappe.db.set_value(doctype, name, "docstatus", 0)
        # Child item rows carry docstatus=2 after cancellation, making them
        # read-only even when the parent returns to Draft — reset them too.
        frappe.db.sql(
            f"UPDATE `tab{item_doctype}` SET docstatus=0 WHERE parent=%s", name
        )
        frappe.db.sql(
            "UPDATE `tabSales Taxes and Charges`"
            " SET docstatus=0 WHERE parent=%s AND parenttype=%s",
            (name, doctype),
        )
        doc.reload()
        if extra_steps:
            extra_steps(doc)
        doc.set_status(update=True)
    except Exception:
        frappe.db.rollback()
        raise

    doc.add_comment("Edit", _("Reopened by {0}").format(frappe.session.user))
    frappe.msgprint(
        _("{0} {1} has been reopened.").format(doctype, name),
        indicator="green",
        alert=True,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Mapper helpers
# ─────────────────────────────────────────────────────────────────────────────

def item_postprocess(source_item, target_item, source_doc):
    """Shared get_mapped_doc postprocess callback — copies all dimension fields."""
    map_dimension_fields(source_item, target_item)


# ─────────────────────────────────────────────────────────────────────────────
# Field copy helpers
# ─────────────────────────────────────────────────────────────────────────────

def recalculate_items(doc):
    """
    For every item row, derive qty from dimensions then amount from qty * rate.

    Square Meter:  qty = (width_mm / 1000) * length_mtr * qty_pkg * total_pkg
    Any other UOM: qty = qty_pkg * total_pkg
    Incomplete dims: leave qty as-is (user may have typed it manually)
    """
    if doc.get("is_return"):
        return

    for item in doc.get("items") or []:
        # Row already priced in the source document — preserve qty, recalc amount only
        if item.get("against_sales_order") or item.get("delivery_note"):
            item.amount = round((item.get("qty") or 0) * (item.get("rate") or 0), 2)
            continue

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
    """Copy all dimension + brand/marking custom fields from source to target child row."""
    for field in DIMENSION_FIELDS:
        value = source_item.get(field)
        if value is not None:
            target_item.set(field, value)


def map_parent_fields(source_doc, target_doc):
    """Copy transport fields from parent source doc to parent target doc."""
    for field in PARENT_FIELDS:
        value = source_doc.get(field)
        if value is not None:
            target_doc.set(field, value)


def map_address_contact_fields(source_doc, target_doc):
    """Copy address + contact fields from source to target parent doc.

    Also rebuilds address_display and shipping_address from the linked
    Address doctype to avoid carrying stale pre-rendered HTML blobs.
    """
    for field in ADDRESS_CONTACT_FIELDS:
        value = source_doc.get(field)
        if value:
            target_doc.set(field, value)

    try:
        from frappe.contacts.doctype.address.address import get_address_display  # pyright: ignore[reportMissingImports]
        if target_doc.get("customer_address"):
            target_doc.address_display = get_address_display(target_doc.customer_address)
        if target_doc.get("shipping_address_name"):
            target_doc.shipping_address = get_address_display(target_doc.shipping_address_name)
    except Exception:
        frappe.log_error(
            title="Address display rebuild failed",
            message=frappe.get_traceback(),
        )


# ─────────────────────────────────────────────────────────────────────────────
# Document transfer helper (used by Employee Exit Handover)
# ─────────────────────────────────────────────────────────────────────────────

def transfer_documents(doctype, owner_field, names, to_user,
                       owner_set_value=None,
                       display_name_field=None,
                       handover_ref=None):
    """Batch-reassign ownership of `names` in `doctype` to `to_user`.

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


# ── Floor price enforcement ───────────────────────────────────────────────────

def _check_floor_price(doc):
	"""Warn (privileged) or block (rep) when item rate is below cost + min margin."""
	from frappe.utils import flt
	from instabiz.overrides.permissions import _is_privileged

	violations = []
	for row in doc.get("items") or []:
		if not row.item_code or not flt(row.rate):
			continue
		item = frappe.db.get_value(
			"Item", row.item_code,
			["valuation_rate", "custom_min_margin_pct"],
			as_dict=True,
		)
		if not item or not flt(item.valuation_rate):
			continue
		min_margin = flt(item.custom_min_margin_pct or 0)
		floor = flt(item.valuation_rate) * (1 + min_margin / 100)
		if flt(row.rate) < floor:
			violations.append(
				f"Row {row.idx}: {row.item_code} — "
				f"rate ₹{flt(row.rate):.2f} below floor ₹{floor:.2f} "
				f"(cost ₹{flt(item.valuation_rate):.2f} + {min_margin:.0f}% min margin)"
			)

	if not violations:
		return

	msg = _("Floor price breach:") + "<br>" + "<br>".join(violations)
	if _is_privileged():
		frappe.msgprint(msg, title=_("Floor Price Warning"), indicator="orange")
	else:
		frappe.throw(msg, title=_("Floor Price Breach"))


# ── Item lifecycle enforcement ────────────────────────────────────────────────

def _check_item_lifecycle(doc):
	"""Block save if any row contains a discontinued item."""
	discontinued = []
	for row in doc.get("items") or []:
		if not row.item_code:
			continue
		if frappe.db.get_value("Item", row.item_code, "custom_is_discontinued"):
			discontinued.append(f"Row {row.idx}: {row.item_code}")

	if discontinued:
		frappe.throw(
			_("Cannot save — the following items are discontinued:") + "<br>" + "<br>".join(discontinued),
			title=_("Discontinued Item"),
		)


# ── Customer-specific item spec check ─────────────────────────────────────────

def _check_customer_item_spec(doc):
	"""Warn if any row deviates from a customer-agreed spec."""
	customer = doc.get("customer")
	if not customer:
		return

	warnings = []
	for row in doc.get("items") or []:
		if not row.item_code:
			continue
		spec = frappe.db.get_value(
			"IB Customer Item Spec",
			{"customer": customer, "item_code": row.item_code},
			["custom_width_mm", "custom_thickness", "custom_adhesion_n25mm", "custom_core_mm"],
			as_dict=True,
		)
		if not spec:
			continue

		mismatches = []
		if spec.custom_width_mm and row.get("width_mm") and abs(row.width_mm - spec.custom_width_mm) > 0.01:
			mismatches.append(f"Width: order {row.width_mm} mm vs agreed {spec.custom_width_mm} mm")
		if spec.custom_thickness and row.get("custom_thickness") and row.custom_thickness != spec.custom_thickness:
			mismatches.append(f"Thickness: order '{row.custom_thickness}' vs agreed '{spec.custom_thickness}'")

		if mismatches:
			warnings.append(f"Row {row.idx} ({row.item_code}): " + "; ".join(mismatches))

	if warnings:
		frappe.msgprint(
			_("Customer spec mismatch — please verify before proceeding:")
			+ "<br>" + "<br>".join(warnings),
			title=_("Spec Mismatch"),
			indicator="orange",
		)
