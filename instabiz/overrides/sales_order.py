"""instabiz.overrides.sales_order"""
import frappe
from frappe import _
from frappe.model.mapper import get_mapped_doc  # pyright: ignore[reportMissingImports]
from erpnext.selling.doctype.sales_order.sales_order import SalesOrder  # pyright: ignore[reportMissingImports]

from instabiz.overrides.utils import (
    IbStatusMixin,
    recalculate_items,
    set_sales_person,
    sync_sales_team,
    reopen_sales_doc,
    item_postprocess,
    map_parent_fields,
    map_address_contact_fields,
    COMMON_PARENT_FIELD_MAP,
    COMMON_CHILD_FIELD_MAP,
    _check_floor_price,
    _check_item_lifecycle,
    _check_customer_item_spec,
)
from instabiz.overrides.naming import autoname_sales_order
from instabiz.overrides.quotation import (
    _set_company_gstin_from_warehouse,
    _auto_correct_gst_template,
)


# ── Hook entry point ──────────────────────────────────────────────────────────

def recalculate_sales_order(doc, method=None):
    recalculate_items(doc)


# ── Document class ────────────────────────────────────────────────────────────

class CustomSalesOrder(IbStatusMixin, SalesOrder):
    STATUS_MAP = {
        "To Deliver and Bill": "Pending",
        "To Deliver":          "Pending",
        "To Bill":             "Dispatched",
        "Completed":           "Confirmed",
        "Closed":              "Confirmed",
    }

    def autoname(self):
        self.flags.name_set = True
        autoname_sales_order(self)

    def before_insert(self):
        set_sales_person(self)

    def validate(self):
        if not self.custom_location or self.custom_location == "Select":
            frappe.throw(_("Please select a Location before saving."))
        _set_company_gstin_from_warehouse(self)
        _auto_correct_gst_template(self)
        set_sales_person(self)
        sync_sales_team(self)
        recalculate_items(self)
        _check_floor_price(self)
        _check_item_lifecycle(self)
        _check_customer_item_spec(self)
        super().validate()

    def before_cancel(self):
        if not (self.custom_cancel_reason or "").strip():
            frappe.throw(_("Fill in Cancellation Reason before cancelling this Sales Order."))

    def before_submit(self):
        _check_credit_limit(self)
        _check_overdue_block(self)


# ── Credit limit ──────────────────────────────────────────────────────────────

def _check_credit_limit(doc):
    """Block submit if customer exceeds credit limit AND oldest unpaid invoice
    is older than the configured credit days. Both conditions must be met."""
    row = frappe.db.get_value(
        "Customer Credit Limit",
        {"parent": doc.customer, "company": doc.company},
        ["credit_limit", "bypass_credit_limit_check", "custom_days"],
        as_dict=True,
    )
    if not row:
        return
    if row.bypass_credit_limit_check:
        return
    if not row.credit_limit or not row.custom_days:
        return

    result = frappe.db.sql(
        """
        SELECT
            SUM(outstanding_amount) AS total_outstanding,
            MIN(posting_date)       AS oldest_date
        FROM `tabSales Invoice`
        WHERE customer    = %(customer)s
          AND company     = %(company)s
          AND docstatus   = 1
          AND outstanding_amount > 0
        """,
        {"customer": doc.customer, "company": doc.company},
        as_dict=True,
    )
    if not result or not result[0].oldest_date:
        return

    from frappe.utils import date_diff, fmt_money, today
    total_outstanding = result[0].total_outstanding or 0
    overdue_days = date_diff(today(), result[0].oldest_date)

    if total_outstanding > row.credit_limit and overdue_days > row.custom_days:
        name = doc.customer_name or doc.customer
        outstanding_fmt = fmt_money(total_outstanding, currency="INR")
        limit_fmt = fmt_money(row.credit_limit, currency="INR")
        frappe.throw(
            f"Cannot submit: {name} has outstanding {outstanding_fmt} "
            f"(limit {limit_fmt}) with an invoice unpaid for {overdue_days} days "
            f"(allowed {row.custom_days} days). Clear dues or contact your manager."
        )


def _check_overdue_block(doc):
    """Block SO submit when customer has a 30d+ overdue flag set by overdue_alert scheduler."""
    if frappe.db.get_value("Customer", doc.customer, "custom_overdue_block"):
        frappe.throw(
            f"Cannot submit: {doc.customer_name or doc.customer} has invoices overdue 30+ days. "
            "Clear outstanding dues to submit new orders. Contact Sales Manager to override."
        )


# ── Reopen ────────────────────────────────────────────────────────────────────

def _so_pre_checks(name):
    """Block reopen if submitted DN or SI is still linked."""
    linked_dn = frappe.db.get_all(
        "Delivery Note Item",
        filters={"against_sales_order": name, "docstatus": 1},
        fields=["parent"],
        limit=1,
    )
    if linked_dn:
        frappe.throw(
            _("Cannot reopen: submitted Delivery Note {0} is linked to this order.").format(
                linked_dn[0].parent
            )
        )
    linked_si = frappe.db.get_all(
        "Sales Invoice Item",
        filters={"sales_order": name, "docstatus": 1},
        fields=["parent"],
        limit=1,
    )
    if linked_si:
        frappe.throw(
            _("Cannot reopen: submitted Sales Invoice {0} is linked to this order.").format(
                linked_si[0].parent
            )
        )


def _so_extra_steps(doc):
    """Revert linked Quotation statuses after the SO is reset to Draft."""
    for q_name in set(d.prevdoc_docname for d in doc.get("items") if d.prevdoc_docname):
        if frappe.db.get_value("Quotation", q_name, "docstatus") != 2:
            frappe.get_doc("Quotation", q_name).set_status(update=True)


@frappe.whitelist()
def get_so_rounded_total(filters=None):
	from frappe.utils import flt
	raw = frappe.parse_json(filters or "[]")
	# List view sends [[doctype, field, op, value]] — strip doctype prefix
	clean = []
	for f in raw:
		if isinstance(f, (list, tuple)) and len(f) == 4:
			clean.append([f[1], f[2], f[3]])
		elif isinstance(f, (list, tuple)) and len(f) == 3:
			clean.append(list(f))
	result = frappe.db.get_all(
		"Sales Order",
		filters=clean,
		fields=["sum(rounded_total) as total"],
	)
	return flt((result[0].get("total") or 0) if result else 0)


@frappe.whitelist()
def reopen_sales_order(name):
    """Reopen a cancelled Sales Order, resetting it back to Draft (docstatus=0)."""
    reopen_sales_doc(
        "Sales Order", name, "Sales Order Item",
        pre_checks=_so_pre_checks,
        extra_steps=_so_extra_steps,
    )


# ── Mapper: Sales Order → Delivery Note ──────────────────────────────────────

_LOCATION_WAREHOUSE = {
    "maharashtra": "MAHARASHTRA - IB",
    "chennai":     "CHENNAI - IB",
    "gujarat":     "GUJARAT - IB",
}


@frappe.whitelist()
def custom_make_delivery_note(source_name, target_doc=None):
    def postprocess_parent(source_doc, target_doc, source_parent):
        if source_doc.get("customer"):
            target_doc.customer = source_doc.customer
            target_doc.customer_name = source_doc.customer_name
            customer_doc = frappe.get_cached_doc("Customer", source_doc.customer)
            if not target_doc.get("customer_group") and customer_doc.customer_group:
                target_doc.customer_group = customer_doc.customer_group
            if not target_doc.get("territory") and customer_doc.territory:
                target_doc.territory = customer_doc.territory
        location = (source_doc.get("custom_location") or "").strip().lower()
        warehouse = _LOCATION_WAREHOUSE.get(location)
        if warehouse and not target_doc.set_warehouse:
            target_doc.set_warehouse = warehouse
        map_parent_fields(source_doc, target_doc)
        map_address_contact_fields(source_doc, target_doc)

    return get_mapped_doc(
        "Sales Order",
        source_name,
        {
            "Sales Order": {
                "doctype": "Delivery Note",
                "validation": {"docstatus": ["=", 1]},
                "postprocess": postprocess_parent,
                "field_map": {
                    **COMMON_PARENT_FIELD_MAP,
                    "name": "against_sales_order",
                },
            },
            "Sales Order Item": {
                "doctype": "Delivery Note Item",
                "postprocess": item_postprocess,
                "condition": lambda row: row.qty != 0,
                "field_map": {
                    **COMMON_CHILD_FIELD_MAP,
                    "name":   "so_detail",
                    "parent": "against_sales_order",
                },
            },
            "Sales Taxes and Charges": {
                "doctype": "Sales Taxes and Charges",
                "add_if_empty": True,
            },
        },
        target_doc,
    )
