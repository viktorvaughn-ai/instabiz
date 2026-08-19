# Cross-Department Follow-Ups Tool — Design

## Goal
A single page where any user, in any department, can pick a document they own/are assigned/are responsible for and log a follow-up against it (note, outcome, optional next-follow-up date) — generalizing the pattern already used on Lead ("Log Activity") across Sales, Purchase, and HR documents, presented as a live dashboard (summary counts + a list) rather than a per-document button.

## Scope
- New doctype `IB Follow Up` — one row per logged follow-up, linked generically to any supported document.
- A doctype-registry config (mirrors the existing `exit_handover_sources` pattern in `hooks.py`) naming which doctypes participate and how "my documents" is resolved for each.
- New page `ib-follow-ups`: doctype picker, "my documents" list with follow-up status, log-follow-up dialog, summary cards.
- Added to every workspace (Instabiz, Finance, HR, Production, Stock, Procurement) — this is explicitly a cross-department tool, same reasoning as Analytics Hub's universal placement (`[[project_2026_08_20_container_import_session]]`-adjacent precedent, see CLAUDE.md item 116).

Out of scope for this pass: a manager/company-wide view (every user only ever sees their own scoped documents); real-time cross-user push (a save refreshes the acting user's own view via a normal AJAX re-fetch, not a websocket broadcast to other sessions); editing/deleting past follow-up entries (append-only log, matching Lead's existing Comment-based pattern); email/WhatsApp reminders on `next_follow_up_date` (a natural future extension, not built now — Lead already has its own separate `follow_up.py` scheduler for its own doctype, untouched by this feature).

## Doctype: `IB Follow Up`

Naming: `IB-FU-.YYYY.-.#####`.

| Field | Type | Notes |
|---|---|---|
| `reference_doctype` | Link → DocType | e.g. "Sales Order" |
| `reference_name` | Dynamic Link (options: `reference_doctype`) | the specific document |
| `follow_up_type` | Select | Call / Meeting / WhatsApp / Email / Visit / Other — same option set as Lead's `log_lead_activity` |
| `outcome` | Select | Positive / Neutral / Negative / No Answer — same as Lead |
| `notes` | Small Text | optional |
| `next_follow_up_date` | Date | optional |

No `status`/workflow — this is an append-only log, same as Lead's activity Comments. Standard `owner`/`creation` fields (not `is_submittable`) record who logged it and when.

On insert (server-side, in the doctype's own `after_insert`): posts an Info Comment onto the target document's timeline — `"Follow-up ({type}): {notes}"` — the same visible-on-the-document behavior Lead's `log_lead_activity` already gives, so a user opening the Sales Order/Purchase Invoice/etc directly still sees the follow-up trail without needing this new page.

## Doctype registry — "my documents" resolution

New `FOLLOW_UP_SOURCES` dict in `hooks.py` (or a dedicated `overrides/follow_ups.py` if it grows large), one entry per supported doctype:

```python
FOLLOW_UP_SOURCES = {
    "Quotation":                  {"owner_field": "custom_sales_person_user"},
    "Sales Order":                {"owner_field": "custom_sales_person_user"},
    "Delivery Note":              {"owner_field": "custom_sales_person_user"},
    "Sales Invoice":              {"owner_field": "custom_sales_person_user"},
    "Purchase Order":             {"owner_field": None},
    "Purchase Receipt":           {"owner_field": None},
    "Purchase Invoice":           {"owner_field": None},
    "Leave Application":         {"owner_field": "employee_user_id"},   # resolved via Employee.user_id
    "IB Overtime Request":        {"owner_field": "employee_user_id"},
    "IB Full Final Settlement":   {"owner_field": "employee_user_id"},
    "Employee Exit Handover":     {"owner_field": "employee_user_id"},
}
```

A document counts as "mine" for the current session user if **any** of:
1. `doc.owner == session.user`
2. A `ToDo` assigns it to `session.user` (standard Frappe Assign-To)
3. The doctype's own `owner_field` (if set) matches — `custom_sales_person_user` directly, or for the `employee_user_id` marker, resolved via that doc's `employee` link → `Employee.user_id`.

Purchase docs have no per-rep owner field in this app today (confirmed: `owner_field: None` — falls back to condition 1+2 only, i.e. creator or explicit assignment). This mirrors reality: Purchase Order/Receipt/Invoice aren't currently attributed to a buyer the way sales docs are attributed to a rep.

## Page: `ib-follow-ups`

Standard Frappe custom page (no tab-shell needed — one screen, one doctype picker, not a multi-view merge like Item Pricing/Stock).

**Layout:**
- **Summary cards** (top row): Total My Docs, Followed Up, Pending (no follow-up logged yet), Overdue (has a `next_follow_up_date` in the past with no later follow-up logged since) — scoped to the currently-selected doctype, recomputed on load and after every save.
- **Doctype picker**: dropdown of the `FOLLOW_UP_SOURCES` keys.
- **Document list**: table of the user's own documents for the selected doctype (name, key summary fields already used elsewhere for that doctype — e.g. customer/grand_total for sales docs, supplier for purchase docs, employee_name for HR docs), a status chip (Never / Followed Up / Overdue), last-follow-up date, search box.
- **Log Follow-Up dialog**: opened by clicking a row — Type, Outcome, Notes, Next Follow-up Date, Save. On save: inserts `IB Follow Up`, closes dialog, re-fetches the list + summary cards for the current doctype (plain `frappe.call` + re-render, matching every other custom page in this app — no realtime/websocket).

**Backend** (new `overrides/follow_ups.py`, whitelisted):
- `get_my_documents(doctype)` — resolves "my" documents per the registry rule above, LEFT JOINs the latest `IB Follow Up` per document for status/last-date.
- `get_follow_up_summary(doctype)` — the 4 summary counts.
- `log_follow_up(reference_doctype, reference_name, follow_up_type, outcome, notes, next_follow_up_date)` — validates `reference_doctype` is in the registry and the document actually belongs to the caller (re-runs the same "mine" check server-side — never trust the client-side list), then inserts.

## Permissions

New Page `ib-follow-ups`: no `roles` restriction (every authenticated desk user) — matches the "for everyone" requirement. `IB Follow Up` doctype: every role can create+read; no update/delete role at all (append-only, enforced by having no UI path to edit/delete rather than a permission table entry — same "dormant not deleted" precedent this app uses elsewhere, simpler than fighting Frappe's default document permissions for a no-edit invariant). All three whitelisted RPCs independently re-verify document ownership server-side regardless of what the page requested — the page-level "everyone" access only grants the ability to see and log against **your own** documents, never anyone else's, closing the same class of gap already fixed twice this app (Batch 16/20's whitelisted-function role-check sweeps).

## Error handling

- `log_follow_up` throws if the caller doesn't actually own/isn't assigned the target document (re-checked server-side) — the page should never let this happen via normal use, but a direct API call must still be blocked.
- `log_follow_up` throws if `reference_doctype` isn't a `FOLLOW_UP_SOURCES` key — closes off logging follow-ups against arbitrary/unsupported doctypes.
- A document with zero `IB Follow Up` rows renders as "Never" status, not an error — the common case for anything not yet followed up.

## Testing plan

- Live: as a real Sales User, verify the document list only shows their own Q/SO/DN/SI (not another rep's); log a follow-up, verify the Comment appears on the actual Sales Order's timeline and the dashboard's Followed Up count increments immediately.
- Live: as a real HR user, verify Leave Application scoping resolves correctly via `Employee.user_id` (not `doc.owner`, which would be whoever submitted the leave on the employee's behalf).
- Permission: verify `log_follow_up` rejects a follow-up against a document that isn't the caller's, called directly via `frappe.call` bypassing the UI.
- Overdue calculation: create a follow-up with `next_follow_up_date` in the past, confirm it shows Overdue; log a fresh follow-up with a future date, confirm it clears to Followed Up (not Overdue).
