"""instabiz.overrides.gstin

Replaces India Compliance's paid GSTIN lookup with the free gstincheck.co.in API.
The return format is identical so all of India Compliance's UI (address dropdown,
field mapping, etc.) works exactly as before — only the data source changes.

Key rotation: when a key returns CREDIT_NOT_AVAILABLE it is marked exhausted in
Redis (30-day TTL). The next available key is used automatically. Admin can check
status via the `gstin_key_status` whitelisted method.

API: https://api.gstincheck.co.in/check/{api_key}/{gstin}
"""
import requests
from requests.exceptions import ConnectionError, Timeout, RetryError

import frappe
from frappe import _

from india_compliance.gst_india.utils import titlecase, validate_gstin  # pyright: ignore[reportMissingImports]
from india_compliance.gst_india.utils.gstin_info import GST_CATEGORIES  # pyright: ignore[reportMissingImports]


_API_URL = "https://api.gstincheck.co.in/check/{api_key}/{gstin}"

# Redis key that stores the list of exhausted API keys (JSON, 30-day TTL)
_CACHE_KEY     = "gstincheck_exhausted_keys"
_CACHE_TTL     = 30 * 24 * 3600  # 30 days in seconds

# Ordered key pool — first non-exhausted key wins.
# Add new keys at the end; depleted ones are skipped automatically.
_API_KEYS = [
    "1c02c196c57a69aa829b482c28cd4884",
    "1effcd5f330661240bad20f48394316e",
    "d6f0243f3ac2375279436212e403227c",
    "9a04b0eb60f28cfcee4c87dbc58c0a15",
    "cc4c0f4c516414011cc41a6442bae808",
    "46daacb3f3a209c639bd7220b58833e0",
    "154eacd2e8b5b987e20a100536fc1084",
    "bb17448e044b468c0608ec252e84c5a1",
    "a33aecc8b69ddda0540f65c3605c7978",
    "c6237b67ccf51cb4f92bd21261c6b41c",
    "ea21f5dc2e6391350c2ce96f27ce6348",
    "062f5433aa3ef181c1335d6228a78055",
    "12eabe77b38265186227f6955afe8183",
    "c17279a0580f0b1ad6be38da7d29be1a",
    "2b230755a331a39ce1c80cbcf3927c82",
    "1cb9a5b6b22f7bcdd4066c93e999eb46",
    "ec6bccb3343d3327e2c7ba656d795122",
    "7129b59be99057e6d64aa3303873f53c",
    "b9670092e853288fc1329cc94d43529e",
    "264b55497be63941367208e3c18aea07",
    "5dc5329d22e9ddd67d8a4527f0523310",
    "65bdcae53302f9c6f59d5ef921265e3e",
    "4782a61996642433f8aefa372c1b36f9",
    "609aecd487c73d0b3c0eb7c04e9312e8",
    "dae9c5b8c43fbe20bad0271b291f5d40",
    "a47ea1c58a94184b65c50e116d9da0b3",
    "8c6225d85d07a51d2042b2de1a005f52",
    "140f625bd46a7e2790f4f39f1cbb6f93",
    "2c0351b291449956dc07986044ff3665",
]

# Placeholder building numbers the GST portal inserts — meaningless, skip them
_INVALID_BNO = {"0", "0.", "na", "n/a", "-", "nil", "null", "none", "00"}


# ── Key pool helpers ───────────────────────────────────────────────────────────

def _get_exhausted_keys():
    """Return set of keys already marked as credit-exhausted (from Redis)."""
    cached = frappe.cache().get_value(_CACHE_KEY)
    if isinstance(cached, list):
        return set(cached)
    return set()


def _mark_key_exhausted(key):
    """Mark *key* as exhausted in Redis so it is skipped on future calls."""
    exhausted = _get_exhausted_keys()
    exhausted.add(key)
    frappe.cache().set_value(_CACHE_KEY, list(exhausted), expires_in_sec=_CACHE_TTL)
    frappe.log_error(
        title="GSTIN API key exhausted",
        message=f"Key ...{key[-6:]} has run out of credits and will no longer be used.",
    )


def _get_api_key():
    """Return the first non-exhausted key from the pool.

    Priority order:
    1. site_config.json → ``gstincheck_api_key``  (manual override, always wins)
    2. First active key from ``_API_KEYS`` pool
    Returns None when all keys are exhausted.
    """
    # Manual override in site_config always takes priority
    manual = frappe.conf.get("gstincheck_api_key")
    if manual:
        return manual

    exhausted = _get_exhausted_keys()
    for key in _API_KEYS:
        if key not in exhausted:
            return key

    return None  # all exhausted


# ── Address parser ─────────────────────────────────────────────────────────────

def _get_address(address):
    """Parse a GST portal address dict into a clean flat address dict."""
    addr = address.get("addr", {})

    def clean(val):
        return (val or "").strip().strip(",").strip()

    bno  = clean(addr.get("bno", ""))
    flno = clean(addr.get("flno", ""))
    bnm  = clean(addr.get("bnm", ""))
    st   = clean(addr.get("st", ""))
    loc  = clean(addr.get("loc", ""))
    dst  = clean(addr.get("dst", ""))

    if bno.lower() in _INVALID_BNO:
        bno = ""

    line1_parts = [p for p in [bno, flno, bnm] if p]
    address_line1 = titlecase(", ".join(line1_parts))

    locality = loc or dst
    line2_parts = [p for p in [st, locality] if p]
    address_line2 = titlecase(", ".join(line2_parts))

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


# ── Public whitelisted entry point (same signature as India Compliance) ────────

@frappe.whitelist()
def get_gstin_info(gstin, *, doc=None, throw_error=True):
    if doc and isinstance(doc, str):
        doc = frappe.parse_json(doc)

    if not frappe.get_cached_doc("User", frappe.session.user).has_desk_access():
        frappe.throw(_("Not allowed"), frappe.PermissionError)

    return _get_gstin_info(gstin, throw_error=throw_error)


@frappe.whitelist()
def gstin_key_status():
    """Return a summary of API key pool status. Admin use only."""
    frappe.only_for("System Manager")
    exhausted = _get_exhausted_keys()
    total     = len(_API_KEYS)
    active    = [k for k in _API_KEYS if k not in exhausted]
    dead      = [k for k in _API_KEYS if k in exhausted]
    current   = _get_api_key()

    return {
        "total":     total,
        "active":    len(active),
        "exhausted": len(dead),
        "current_key_suffix": f"...{current[-6:]}" if current else "NONE — all exhausted!",
        "exhausted_keys": [f"...{k[-6:]}" for k in dead],
    }


# ── Internal fetch + transform ─────────────────────────────────────────────────

def _get_gstin_info(gstin, *, throw_error=True):
    gstin = validate_gstin(gstin)

    api_key = _get_api_key()
    if not api_key:
        frappe.msgprint(
            _("All GSTIN API keys are exhausted. Please add new keys to the system."),
            title=_("No API Keys Available"),
            indicator="red",
        )
        return frappe._dict()

    url = _API_URL.format(api_key=api_key, gstin=gstin)

    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        result = resp.json()
    except (ConnectionError, Timeout, RetryError):
        frappe.log_error(title="GSTIN API Unreachable", message=frappe.get_traceback())
        frappe.msgprint(
            _("Could not reach the GSTIN lookup service. Please wait a moment and try again."),
            title=_("GSTIN Lookup Failed"),
            indicator="orange",
        )
        return frappe._dict()
    except Exception:
        frappe.log_error(title="GSTIN Fetch Error", message=frappe.get_traceback())
        frappe.msgprint(
            _("GSTIN lookup encountered an unexpected error. Please try again."),
            title=_("GSTIN Lookup Failed"),
            indicator="orange",
        )
        return frappe._dict()

    # Key ran out of credits — mark it and retry once with the next key
    if result.get("errorCode") == "CREDIT_NOT_AVAILABLE":
        _mark_key_exhausted(api_key)
        next_key = _get_api_key()
        if not next_key:
            frappe.msgprint(
                _("All GSTIN API keys are exhausted. Please add new keys to the system."),
                title=_("No API Keys Available"),
                indicator="red",
            )
            return frappe._dict()

        # One automatic retry with the next key
        try:
            resp = requests.get(
                _API_URL.format(api_key=next_key, gstin=gstin), timeout=10
            )
            resp.raise_for_status()
            result = resp.json()
        except Exception:
            frappe.log_error(title="GSTIN Fetch Error (retry)", message=frappe.get_traceback())
            return frappe._dict()

    if not result.get("flag"):
        frappe.msgprint(
            _("GSTIN <b>{0}</b> was not found. Please verify the number and try again.").format(gstin),
            title=_("GSTIN Not Found"),
            indicator="red",
        )
        return frappe._dict()

    data = frappe._dict(result.get("data", {}))

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

    if permanent_address := data.get("pradr"):
        all_addresses = [permanent_address, *data.get("adadr", [])]
        gstin_info.all_addresses    = list(map(_get_address, all_addresses))
        gstin_info.permanent_address = gstin_info.all_addresses[0]

    return gstin_info
