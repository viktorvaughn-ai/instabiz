"""instabiz.overrides.gstin

Replaces India Compliance's paid GSTIN lookup with the free gstincheck.co.in API.
The return format is identical so all of India Compliance's UI (address dropdown,
field mapping, etc.) works exactly as before — only the data source changes.

API: https://api.gstincheck.co.in/check/{api_key}/{gstin}
"""
import requests
from requests.exceptions import ConnectionError, Timeout, RetryError

import frappe
from frappe import _

from india_compliance.gst_india.utils import titlecase, validate_gstin
from india_compliance.gst_india.utils.gstin_info import GST_CATEGORIES

# Store the key in site_config.json ("gstincheck_api_key") so it's not in source.
# Falls back to the default key if not configured.
_DEFAULT_API_KEY = "ff488dbb6905d31aebf57ac6c6aeb7fc"
_API_URL = "https://api.gstincheck.co.in/check/{api_key}/{gstin}"


# Placeholder building numbers the GST portal inserts — meaningless, skip them
_INVALID_BNO = {"0", "0.", "na", "n/a", "-", "nil", "null", "none", "00"}


def _get_address(address):
    """Parse a GST portal address dict into a clean flat address dict.

    Fixes over India Compliance's parser:
    - Skips bno values that are placeholder zeros ("0", "0.", etc.)
    - Falls back to `dst` for city when `loc` is deduplicated away
    - Strips trailing commas/spaces from both address lines
    """
    addr = address.get("addr", {})

    def clean(val):
        return (val or "").strip().strip(",").strip()

    bno  = clean(addr.get("bno", ""))
    flno = clean(addr.get("flno", ""))
    bnm  = clean(addr.get("bnm", ""))
    st   = clean(addr.get("st", ""))
    loc  = clean(addr.get("loc", ""))
    dst  = clean(addr.get("dst", ""))
    city = clean(addr.get("city", ""))

    # Skip placeholder building numbers
    if bno.lower() in _INVALID_BNO:
        bno = ""

    # Build line 1: building parts
    line1_parts = [p for p in [bno, flno, bnm] if p]
    address_line1 = titlecase(", ".join(line1_parts))

    # Build line 2: locality/city (prefer loc; fall back to dst if loc is empty)
    locality = loc or dst
    line2_parts = [p for p in [st, locality] if p]
    address_line2 = titlecase(", ".join(line2_parts))

    # If line 1 is empty, promote line 2 content up
    if not address_line1 and address_line2:
        address_line1, address_line2 = address_line2, ""

    return {
        "address_line1": address_line1.strip(", "),
        "address_line2": address_line2.strip(", "),
        "city":    titlecase(dst or loc),
        "state":   titlecase(addr.get("stcd", "")),
        "pincode": addr.get("pncd", ""),
        "country": "India",
    }


def _get_api_key():
    return frappe.conf.get("gstincheck_api_key") or _DEFAULT_API_KEY


# ── Public whitelisted entry point (same signature as India Compliance) ────────
@frappe.whitelist()
def get_gstin_info(gstin, *, doc=None, throw_error=True):
    if doc and isinstance(doc, str):
        doc = frappe.parse_json(doc)

    if not frappe.get_cached_doc("User", frappe.session.user).has_desk_access():
        frappe.throw(_("Not allowed"), frappe.PermissionError)

    return _get_gstin_info(gstin, throw_error=throw_error)


# ── Internal fetch + transform ─────────────────────────────────────────────────
def _get_gstin_info(gstin, *, throw_error=True):
    gstin = validate_gstin(gstin)

    url = _API_URL.format(api_key=_get_api_key(), gstin=gstin)

    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        result = resp.json()
    except (ConnectionError, Timeout, RetryError):
        # Network-level failure — API unreachable or overloaded
        frappe.log_error(title="GSTIN API Unreachable", message=frappe.get_traceback())
        frappe.msgprint(
            _("Could not reach the GSTIN lookup service. Please wait a moment and try again."),
            title=_("GSTIN Lookup Failed"),
            indicator="orange",
        )
        return frappe._dict()
    except Exception:
        # Unexpected error (bad JSON, HTTP 5xx, etc.)
        frappe.log_error(title="GSTIN Fetch Error", message=frappe.get_traceback())
        frappe.msgprint(
            _("GSTIN lookup encountered an unexpected error. Please try again."),
            title=_("GSTIN Lookup Failed"),
            indicator="orange",
        )
        return frappe._dict()

    if not result.get("flag"):
        frappe.msgprint(
            _("GSTIN <b>{0}</b> was not found. Please verify the number and try again.").format(gstin),
            title=_("GSTIN Not Found"),
            indicator="red",
        )
        return frappe._dict()

    data = frappe._dict(result.get("data", {}))

    # Proprietorships/HUFs use trade name; companies use legal name
    if data.ctb in ("Proprietorship", "Hindu Undivided Family"):
        business_name = data.tradeNam or data.lgnm
    else:
        business_name = data.lgnm or data.tradeNam

    gstin_info = frappe._dict(
        gstin=data.gstin,
        business_name=titlecase(business_name or ""),
        gst_category=GST_CATEGORIES.get(data.dty, ""),
        status=data.sts,
    )

    # Build address list — same structure as GST portal, reuse IC's parser
    if permanent_address := data.get("pradr"):
        all_addresses = [permanent_address, *data.get("adadr", [])]
        gstin_info.all_addresses = list(map(_get_address, all_addresses))
        gstin_info.permanent_address = gstin_info.all_addresses[0]

    return gstin_info
