import json
import frappe


def _user_can_see(shortcut, user_roles, is_system_manager):
    if is_system_manager:
        return True
    raw = shortcut.get("restrict_to_role") or ""
    if not raw:
        return True
    allowed_roles = {r.strip() for r in raw.split("|") if r.strip()}
    return bool(allowed_roles & user_roles)


def _filter_content(content_str, visible_labels):
    """Remove hidden shortcut blocks and orphaned section headers from content."""
    try:
        blocks = json.loads(content_str) if isinstance(content_str, str) else content_str
    except Exception:
        return content_str

    filtered = [
        b for b in blocks
        if b.get("type") != "shortcut"
        or b.get("data", {}).get("shortcut_name") in visible_labels
    ]

    cleaned = []
    for i, block in enumerate(filtered):
        if block.get("type") == "paragraph":
            has_shortcut = False
            for j in range(i + 1, len(filtered)):
                if filtered[j].get("type") == "paragraph":
                    break
                if filtered[j].get("type") == "shortcut":
                    has_shortcut = True
                    break
            if has_shortcut:
                cleaned.append(block)
        else:
            cleaned.append(block)

    return json.dumps(cleaned)


@frappe.whitelist()
def get_desktop_page(page):
    from frappe.desk.desktop import get_desktop_page as _original

    result = _original(page)

    if result and result.get("shortcuts") and result["shortcuts"].get("items"):
        user_roles = set(frappe.get_roles())
        is_sm = "System Manager" in user_roles

        visible = [
            s for s in result["shortcuts"]["items"]
            if _user_can_see(s, user_roles, is_sm)
        ]
        result["shortcuts"]["items"] = visible

        if result.get("content"):
            visible_labels = {s.get("label") for s in visible}
            result["content"] = _filter_content(result["content"], visible_labels)

    return result
