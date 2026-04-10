"""instabiz.overrides.item

Custom item search query — replaces ERPNext's default item_query for
Quotation and Sales Order child tables.

Shows: Item Code | Item Name | Color, Liner
instead of the default: Item Code | Item Name | Item Group
"""
import frappe
from erpnext.controllers.queries import get_filters_cond, get_match_cond
from frappe.utils import nowdate


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def item_query(doctype, txt, searchfield, start, page_len, filters, as_dict=False):
    doctype = "Item"
    conditions = []

    if isinstance(filters, str):
        import json
        filters = json.loads(filters)

    # Handle party-specific item rules (same as ERPNext)
    if filters and isinstance(filters, dict):
        if filters.get("customer") or filters.get("supplier"):
            scrub = frappe.scrub
            party = filters.get("customer") or filters.get("supplier")
            item_rules = frappe.get_all(
                "Party Specific Item",
                filters={"party": party},
                fields=["restrict_based_on", "based_on_value"],
            )
            filters_dict = {}
            for rule in item_rules:
                if rule["restrict_based_on"] == "Item":
                    rule["restrict_based_on"] = "name"
                filters_dict.setdefault(rule.restrict_based_on, []).append(rule.based_on_value)
            for f in filters_dict:
                filters[scrub(f)] = ["in", filters_dict[f]]
            filters.pop("customer", None)
            filters.pop("supplier", None)
        else:
            filters.pop("customer", None)
            filters.pop("supplier", None)

    page_len = min(int(page_len), 500)

    # ── Multi-token search ────────────────────────────────────────────────────
    # Split the search text into whitespace-separated tokens so that typing
    # "blue 1200" finds items containing both "blue" AND "1200" anywhere in
    # any of the searched fields — order of words doesn't matter.
    # Each token produces one AND block; a single token behaves like before.
    tokens = [t.strip() for t in txt.split() if t.strip()] or [""]

    token_sql_parts = []
    token_params    = {}
    for i, token in enumerate(tokens):
        key = f"tok{i}"
        token_params[key] = f"%{token}%" if token else "%"
        token_sql_parts.append(
            f"(tabItem.name            LIKE %({key})s"
            f" OR tabItem.item_name    LIKE %({key})s"
            f" OR tabItem.item_code    LIKE %({key})s"
            f" OR tabItem.item_group   LIKE %({key})s"
            f" OR tabItem.color        LIKE %({key})s"
            f" OR tabItem.custom_liner LIKE %({key})s"
            f" OR tabItem.name IN ("
            f"     SELECT parent FROM `tabItem Barcode` WHERE barcode LIKE %({key})s"
            f" ))"
        )

    search_condition = "\n            AND ".join(token_sql_parts)

    return frappe.db.sql(
        """
        SELECT
            tabItem.name,
            tabItem.item_name,
            CONCAT_WS(", ",
                NULLIF(TRIM(tabItem.color), ""),
                NULLIF(TRIM(tabItem.custom_liner), "")
            ) AS spec
        FROM `tabItem` tabItem
        WHERE
            tabItem.docstatus < 2
            AND tabItem.disabled = 0
            AND tabItem.has_variants = 0
            AND (
                tabItem.end_of_life > %(today)s
                OR IFNULL(tabItem.end_of_life, '0000-00-00') = '0000-00-00'
            )
            AND {search_condition}
            {fcond} {mcond}
        ORDER BY
            IF(LOCATE(%(_txt)s, tabItem.name),        LOCATE(%(_txt)s, tabItem.name),        99999),
            IF(LOCATE(%(_txt)s, tabItem.item_name),   LOCATE(%(_txt)s, tabItem.item_name),   99999),
            tabItem.idx DESC,
            tabItem.name,
            tabItem.item_name
        LIMIT %(start)s, %(page_len)s
        """.format(
            search_condition=search_condition,
            fcond=get_filters_cond(doctype, filters, conditions).replace("%", "%%"),
            mcond=get_match_cond(doctype).replace("%", "%%"),
        ),
        {
            "today":    nowdate(),
            "_txt":     txt.replace("%", ""),
            "start":    start,
            "page_len": page_len,
            **token_params,
        },
        as_dict=as_dict,
    )
