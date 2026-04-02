"""instabiz.overrides.bulk_gstin

Bulk-backfill addresses for customers that have a GSTIN but no linked Address.
Supports a list of API keys with automatic rotation when credits are exhausted.

Usage:
    bench --site frontend execute instabiz.overrides.bulk_gstin.backfill_customers_gstin \
        --kwargs '{"dry_run": false, "delay": 1.5}'

    # With explicit key list (overrides site_config / hardcoded keys):
    bench --site frontend execute instabiz.overrides.bulk_gstin.backfill_customers_gstin \
        --kwargs '{"dry_run": false, "api_keys": ["KEY1", "KEY2"]}'
"""
import time

import requests
from requests.exceptions import ConnectionError, Timeout

import frappe

from india_compliance.gst_india.utils import titlecase, validate_gstin
from india_compliance.gst_india.utils.gstin_info import GST_CATEGORIES

from instabiz.overrides.gstin import _get_address

_API_URL = "https://api.gstincheck.co.in/check/{api_key}/{gstin}"

# Keys baked into the script — caller can override via the api_keys argument.


# ── Key rotation state ────────────────────────────────────────────────────────

class _KeyPool:
    def __init__(self, keys):
        self.keys = list(keys)
        self.idx  = 0

    @property
    def current(self):
        return self.keys[self.idx] if self.idx < len(self.keys) else None

    def rotate(self):
        """Move to next key. Returns False when all keys are exhausted."""
        self.idx += 1
        if self.idx < len(self.keys):
            print(f"\n  [KEY] Credits exhausted — switching to key #{self.idx + 1} of {len(self.keys)}\n")
            return True
        return False


# ── Public entry point ────────────────────────────────────────────────────────

def backfill_customers_gstin(dry_run=True, delay=1.5, api_keys=None):
    """Create Billing Address documents for customers that have a GSTIN but no address.

    Args:
        dry_run  (bool):       If True, only report what would happen. Default True.
        delay    (float):      Seconds between API calls (free tier: 1–1.5 s). Default 1.5.
        api_keys (list[str]):  Override the bundled key list.
    """
    keys = api_keys or _BUNDLED_KEYS
    pool = _KeyPool(keys)

    customers = _find_customers_without_address()
    total = len(customers)
    print(
        f"\n{'[DRY RUN] ' if dry_run else ''}"
        f"Found {total} customer(s) needing address backfill. "
        f"Using {len(pool.keys)} API key(s).\n"
    )

    ok = skipped = failed = 0

    for i, (customer_name, gstin) in enumerate(customers, 1):
        prefix = f"[{i}/{total}] {customer_name} ({gstin})"

        # Live check — skip if address was created since the query ran (saves API credit)
        if _has_billing_address(customer_name):
            print(f"  SKIP  {prefix} — address already exists")
            skipped += 1
            continue

        if pool.current is None:
            print(f"\n  [STOP] All API keys exhausted at record {i}/{total}. Re-run after adding more keys.\n")
            break

        result, exhausted = _api_fetch(pool.current, gstin)

        if exhausted:
            if not pool.rotate():
                print(f"\n  [STOP] All API keys exhausted at record {i}/{total}.\n")
                break
            # Retry with the new key — don't count this as a sleep cycle
            result, exhausted = _api_fetch(pool.current, gstin)
            if exhausted:
                print(f"\n  [STOP] New key also out of credits. Stopping.\n")
                break

        if result is None:
            print(f"  SKIP  {prefix} — GSTIN not found or API error")
            skipped += 1
            time.sleep(delay)
            continue

        addr = result.get("permanent_address")
        if not addr:
            print(f"  SKIP  {prefix} — no address in API response")
            skipped += 1
            time.sleep(delay)
            continue

        if dry_run:
            print(
                f"  DRY   {prefix}\n"
                f"        → {addr.get('address_line1')}, {addr.get('address_line2')}, "
                f"{addr.get('city')} – {addr.get('pincode')}"
            )
            ok += 1
            time.sleep(delay)
            continue

        try:
            _create_address(customer_name, gstin, result)
            print(f"  OK    {prefix}")
            ok += 1
        except Exception:
            print(f"  FAIL  {prefix} — address creation error (see Error Log)")
            frappe.log_error(
                title=f"bulk_gstin: address create failed for {customer_name}",
                message=frappe.get_traceback(),
            )
            failed += 1

        frappe.db.commit()
        time.sleep(delay)

    print(
        f"\n{'[DRY RUN] ' if dry_run else ''}Done. "
        f"ok={ok}  skipped={skipped}  failed={failed}  total={total}\n"
    )


# ── API call with credit-exhaustion detection ─────────────────────────────────

def _api_fetch(api_key, gstin):
    """Call gstincheck.co.in for *gstin* using *api_key*.

    Returns:
        (info_dict, False)  — success
        (None,      False)  — GSTIN not found / network error
        (None,      True)   — credits exhausted (caller should rotate key)
    """
    try:
        gstin = validate_gstin(gstin)
    except Exception:
        return None, False

    url = _API_URL.format(api_key=api_key, gstin=gstin)
    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        result = resp.json()
    except (ConnectionError, Timeout):
        frappe.log_error(title=f"bulk_gstin: network error for {gstin}", message=frappe.get_traceback())
        return None, False
    except Exception:
        frappe.log_error(title=f"bulk_gstin: fetch error for {gstin}", message=frappe.get_traceback())
        return None, False

    # Credit exhausted — signal caller to rotate
    if result.get("errorCode") == "CREDIT_NOT_AVAILABLE":
        return None, True

    if not result.get("flag"):
        return None, False

    data = frappe._dict(result.get("data", {}))

    if data.ctb in ("Proprietorship", "Hindu Undivided Family"):
        business_name = data.tradeNam or data.lgnm
    else:
        business_name = data.lgnm or data.tradeNam

    info = frappe._dict(
        gstin=data.gstin,
        business_name=titlecase(business_name or ""),
        gst_category=GST_CATEGORIES.get(data.dty, ""),
        status=data.sts,
    )

    if permanent_address := data.get("pradr"):
        all_addresses = [permanent_address, *data.get("adadr", [])]
        info.all_addresses   = list(map(_get_address, all_addresses))
        info.permanent_address = info.all_addresses[0]

    return info, False


# ── Helpers ───────────────────────────────────────────────────────────────────

def _has_billing_address(customer_name):
    """Return True if the customer already has a linked Billing Address."""
    return frappe.db.exists({
        "doctype": "Dynamic Link",
        "link_doctype": "Customer",
        "link_name": customer_name,
        "parenttype": "Address",
    }) is not None


def _find_customers_without_address():
    """Return [(customer_name, gstin)] for customers with GSTIN but no Billing Address."""
    return frappe.db.sql(
        """
        SELECT c.name, c.gstin
        FROM   `tabCustomer` c
        WHERE  c.gstin IS NOT NULL
          AND  c.gstin != ''
          AND  NOT EXISTS (
               SELECT 1
               FROM   `tabDynamic Link` dl
               JOIN   `tabAddress`      a  ON a.name = dl.parent
               WHERE  dl.link_doctype = 'Customer'
                 AND  dl.link_name    = c.name
                 AND  a.address_type  = 'Billing'
          )
        ORDER BY c.name
        """,
        as_list=True,
    )


def _create_address(customer_name, gstin, info):
    """Insert a Billing Address for *customer_name* using data from *info*."""
    addr = info.permanent_address

    if frappe.db.exists("Address", f"{customer_name}-Billing"):
        return

    doc = frappe.new_doc("Address")
    doc.address_title = customer_name
    doc.address_type  = "Billing"
    doc.address_line1 = addr.get("address_line1") or customer_name
    doc.address_line2 = addr.get("address_line2") or ""
    doc.city          = addr.get("city") or ""
    doc.state         = addr.get("state") or ""
    doc.pincode       = addr.get("pincode") or ""
    doc.country       = "India"
    doc.gstin         = gstin

    doc.append("links", {
        "link_doctype": "Customer",
        "link_name":    customer_name,
    })

    doc.insert(ignore_permissions=True)
