> **ALWAYS activate superpowers and caveman before any work.** Invoke `superpowers:using-superpowers` and `caveman:caveman` skills at session start, before reading any file or writing any code.

# CLAUDE.md — instabiz

Single source of truth for all Claude Code sessions. Read this before touching any file.

---

## Agent Operating Rules (STRICT, ALWAYS FOLLOW)

These rules are mandatory for all agents working on this repo. Do not skip them.

### 1) No Assumptions, Ever
- Never guess fieldnames, doctype behavior, filters, hooks, or API contracts.
- Verify from source first:
  - `instabiz/fixtures/custom_field.json`
  - `instabiz/fixtures/property_setter.json`
  - actual file implementation in `instabiz/public/js/*` or `instabiz/overrides/*`.
- If evidence is missing or ambiguous, ask the user before implementing.

### 2) Ask Questions Before Major Work
- Before any **big feature rewrite**, **new enhancement**, or **cross-file behavioral change**:
  - ask clarifying questions,
  - confirm assumptions explicitly,
  - confirm scope boundaries (what must not change),
  - confirm rollout order and acceptance criteria.
- Do not proceed on inferred intent for high-impact changes.

### 3) Verify-First Workflow (Required)
- Before presenting or coding a solution:
  1. inspect current behavior in code,
  2. validate dependencies and touch points,
  3. identify risk areas and fallback path.
- Before declaring work complete:
  1. lint affected files,
  2. run required build/restart/migrate per change type,
  3. report what was verified and what was not.

### 4) Production Safety Rules
- Treat all work as production-sensitive unless user says otherwise.
- Prefer minimal diffs and targeted edits over broad refactors.
- Preserve existing working behavior unless user explicitly approves change.
- If an existing behavior (e.g. status picker, list action, print action) might be impacted, call it out before editing.
- Never remove or alter a feature silently.

### 5) Scope Control and Change Isolation
- Implement one logical unit at a time (e.g. Lead first, then Quotation, then SO).
- For multi-doctype work, complete and verify one doctype before cloning pattern to others.
- Keep unrelated files untouched.
- Do not “cleanup” or refactor adjacent code unless requested.

### 6) UI + Backend Sync Discipline
- For filter/UI changes:
  - ensure control value format matches backend expectation (e.g. `in` + array).
  - ensure clear/reset actions sync UI state and filter state.
  - ensure route/filter state restoration is consistent.
- If frontend-only phase is requested, do not call backend beyond agreed scope.

### 7) Preserve and Respect Existing Custom Patterns
- Lead row status picker is a protected behavior and must remain unless explicitly requested otherwise.
- Existing custom list actions/formatters/print behavior must be preserved unless requested.
- Do not re-enable native behavior that user asked to disable.

### 8) Mandatory Communication Pattern
- Before implementation: state understanding + first verification step.
- During implementation: provide short progress updates for major steps.
- After implementation: provide exact files changed, behavior changed, and verification performed.
- If user asks “ask questions, don’t assume,” always ask first for ambiguous decisions.

### 9) Command and Environment Discipline
- Run commands from bench root: `/home/dev/frappe-bench/`.
- Use site `frontend` for all `bench --site` operations.
- After JS/CSS changes: `bench build --app instabiz`.
- After Python changes: `bench restart`.
- After fixture updates: `bench --site frontend migrate`.
- After hooks changes: `bench --site frontend clear-cache`.

### 10) No Silent Risk Escalation
- If something appears risky, conflicting, or unexpected, stop and ask.
- If local observations differ from user expectations, report discrepancy before editing.
- If rollback may be needed, mention rollback approach in advance.

### 11) Completion Checklist (must satisfy before handoff)
- [ ] User-requested scope only.
- [ ] Existing critical behavior preserved.
- [ ] No guessed metadata/fieldnames.
- [ ] Lint/build/restart/migrate run as required.
- [ ] Clear verification summary provided.
- [ ] Open questions/limitations listed explicitly.

---

## Project

**App:** instabiz — `/home/dev/frappe-bench/apps/instabiz/`  
**Stack:** Frappe v15 + ERPNext v15 + HRMS  
**Site:** `frontend` — use in all `bench --site` commands  
**Bench root:** `/home/dev/frappe-bench/` — run all bench commands from here

### Locations & Warehouse Codes
| Location | Doc Code |
|---|---|
| Maharashtra (Mumbai) | BWD |
| Chennai | CN |
| Gujarat | SGM |

---

## Features Implemented

1. **Sales Workflow** — Q → SO → DN → SI; location-aware naming; dimension-based qty calc; custom mappers; row-level permissions
2. **Lead Management** — round-robin assignment via Lead Sales Team; territory mapping; India Post pincode autofill
3. **Employee Exit Handover** — scheduler creates handover docs on relieving_date; HR reassigns; user disabled on relieving_date+1
4. **Attendance / Check-in Portal** — employee self-service at `/checkin`
5. **New User Onboarding** — auto-creates Sales Person; copies admin defaults/UI settings on User.after_insert
6. **Custom Masters** — IB Branding, IB Transport, Lead Sales Team (with Member + Territory child tables)
7. **Role-based Data Isolation** — non-privileged users see only their own sales docs
8. **HRMS Payroll** — two salary structures (IB Payroll / Astro Payroll); salary assignments done
9. **IB Stock Dashboard** — custom page (`ib-stock-dashboard`); live stock across 3 warehouses; filter chips; multi-token search + highlight; breakdown popover; CSV export; WebSocket live-updates
10. **IB Customer Board** — sales pipeline state machine; `ib-customer-board` (4-column kanban: Dormant/Regular/Today/Tomorrow); `ib-assignment-admin` (roster + view-as kanban + pool assign); 12am scheduler auto-assigns tomorrow's batch per user territory; SO submit auto-marks assignment done; `IB Customer Assignment` doctype + `IB Assignment Config` singleton
11. **Instabiz Workspace** — sidebar workspace with shortcuts: Customer Board, Stock Dashboard, Assignment Admin, Attendance Terminal, Employee Check-in
12. **IB Item Price List** — custom page `ib-price-list` (NOT the doctype list); table with search, spec rendering (identical to stock dashboard: color dots, spec tags, UOM chips), row click popover showing rates; workspace shortcut points to the page; doctype list view redirects to the page via `ib_item_price_list_list.js`
13. **Dormant Customer Detection** — `instabiz/overrides/dormant.py`; daily scheduler; customers with no submitted SO in 60+ days → ToDo assigned to sales person + bell Notification Log with wa.me deep-link; dedup via `[ib-dormant-reminder]` marker in ToDo description; uses `transaction_date` not `posting_date`
14. **Sales Target Setting** — `IB Sales Target` doctype (sales_user, month, target_amount); `instabiz/overrides/sales_target.py`; `get_my_target()` / `get_all_targets()` whitelisted; Customer Board shows target progress card for current month (hidden when no target set); Assignment Admin roster shows Sales Target bar per user; daily scheduler sends bell notifications at 50%/75% month elapsed if behind pace + end-of-month if target not met; Sales Manager+ creates/edits targets
15. **Customer Health Score** — `instabiz/overrides/customer_score.py`; daily scheduler (`run_customer_score`); computes weighted score per active customer: payment punctuality 35%, order frequency 30%, complaint count 20%, CSAT rating 15%; stores in `IB Customer Score` doctype; status: Green ≥70, Amber ≥40, Red <40; if score drops ≥15 pts, emails all Sales Manager/System Manager; skips customers already scored today
16. **IB Sample Request** — doctype `IB Sample Request` (IB-SR-.YYYY.-#####); tracks sample dispatch lifecycle; fields: customer, contact_person, request_date, status (Draft/Work Order Created/Sent/Feedback Received/Converted/Closed), assigned_to, sample_type (Free/Paid), related_sales_order, item, qty, uom, is_paid, feedback, outcome (Converted/Not Interested/Follow Up/No Response), notes; validate() defaults request_date=today, assigned_to=session user

---

## Common Commands

```bash
# After Python changes
bench restart

# After JS/CSS changes
bench build --app instabiz

# After editing fixture JSON
bench --site frontend migrate

# Pull current schema into fixture JSON
bench --site frontend export-fixtures --app instabiz

# Run scheduler job manually
bench --site frontend execute instabiz.overrides.employee_exit.run_exit_handover_daily

# Bench console (Python REPL)
bench --site frontend console

# Lint / format (from apps/instabiz/)
cd apps/instabiz && pre-commit run --all-files
cd apps/instabiz && ruff check . && ruff format .

# Clear cache (after hooks.py changes)
bench --site frontend clear-cache

# Logs
tail -f logs/worker.error.log
tail -f logs/web.error.log
```

---

## File Map

### Config
| File | Purpose |
|---|---|
| `instabiz/hooks.py` | All hooks: scheduler, fixtures, class overrides, doc events, permissions, whitelisted methods, assets |
| `instabiz/overrides/utils.py` | Shared utilities used everywhere — most important file |

### Python Overrides (`instabiz/overrides/`)
| File | What It Does |
|---|---|
| `utils.py` | IbStatusMixin, set_sales_person, sync_sales_team, recalculate_items, map_*_fields, reopen_sales_doc, transfer_documents |
| `quotation.py` | CustomQuotation, custom_make_sales_order() |
| `sales_order.py` | CustomSalesOrder, custom_make_delivery_note() |
| `delivery_note.py` | CustomDeliveryNote, custom_make_sales_invoice() |
| `sales_invoice.py` | CustomSalesInvoice |
| `customer.py` | CustomCustomer — protects customer_name from edits |
| `lead.py` | Round-robin assignment, pincode lookup, transfer_leads, permissions |
| `permissions.py` | Query conditions + has_permission for all 4 sales doctypes |
| `naming.py` | autoname_* functions, LOCATION_CODE_MAP, get_next_dn_si_number (MySQL advisory lock) |
| `user.py` | create_sales_person_for_user, copy_admin_defaults, copy_admin_ui_settings |
| `checkin.py` | get_my_status, self_checkin, get_daily_attendance |
| `attendance_terminal.py` | get_employees_with_status, create_checkin, mark_absent |
| `item.py` | item_query — multi-token search for item select fields |
| `employee_exit.py` | run_exit_handover_daily, run_user_disable_daily |
| `stock_events.py` | publish_stock_update — fires `ib_stock_update` realtime event on Bin changes |
| `dormant.py` | run_dormant_check — daily; flags customers with no SO in 60+ days; creates ToDo + Notification Log with wa.me link; dedup via `[ib-dormant-reminder]` marker |
| `sales_target.py` | get_my_target(month), get_all_targets(month), get_target_map(month_first), run_target_notifications — daily milestone alerts at 50%/75% elapsed + end-of-month |
| `customer_score.py` | run_customer_score — daily; computes weighted health score (payment 35%, order 30%, complaint 20%, CSAT 15%); saves IB Customer Score; emails managers on ≥15pt drop |

### JavaScript (`instabiz/public/js/`)
| File | Purpose |
|---|---|
| `recalc.js` | ib_calc_qty, ib_recalc_row — dimension qty calc, debounced 500ms |
| `form.js` | Global sales doc handlers: Reopen button, hide Cancel on Draft, recalc triggers |
| `pincode.js` | instabiz.pincode.autofill() — India Post API lookup |
| `lead.js` | Pincode autofill on custom_pincode change |
| `ib_sales_common.js` | item_query override for Quotation and Sales Order |
| `employee_exit_handover.js` | Quick Assign All, Execute Reassignment |
| `*_list.js` | List view customizations per doctype |
| `ib_color_map.js` | window.IB_COLOR_MAP — color name → hex (70+ entries); null = transparent/checkerboard; loaded globally |
| `ib_item_price_list_list.js` | Doctype list view for IB Item Price List — immediately redirects to `ib-price-list` page |

### SO List total bar
- `sales_order_list.js` has a sticky selection total bar (`ib-so-total-bar`) appended to `body`.
- `onload` fires only once. Navigate away → `frappe.router.on("change")` removes bar. Navigate back → Frappe calls `listview.refresh()`.
- Fix: patch `listview.refresh` in `onload` to re-call `ib_setup_so_total_bar(listview)` when bar is missing.
- **Do NOT use `before_render`** in `frappe.listview_settings` — `this` context is the settings object, not the listview; accessing `this.$result` throws and breaks all rendering.

### Latest list-view update (2026-04)
- Lead, Quotation, and Sales Order list views now use a **custom compact MultiSelectList status filter** in the standard filter row.
- Existing native status filter fields are hidden in UI and replaced by helper controls:
  - Lead uses `custom_status`
  - Quotation uses `status`
  - Sales Order uses `status`
- Multi-select values are applied via list filters using `in` operator (array values), then list is refreshed.
- Existing row-level status picker behavior on Lead remains intact.
- UI details: no visible label (`only_input: true`), compact width (`140px`), control inserted in standard filter section (not right-corner page form fallback unless needed).

### Lead row status picker (must preserve)
- File: `instabiz/public/js/lead_list.js`
- Lead list indicator pill is clickable and opens a floating status picker (`.ib-status-picker`) near the pill.
- Selecting a status updates UI optimistically and calls backend method:
  - `instabiz.overrides.lead.set_lead_status`
  - args: `{ lead, status }`
- Picker behavior:
  - closes on outside click
  - repositions on window/list scroll
  - unbinds listeners on cleanup
- This row-level picker is separate from the top-row multi-select filter and must not be removed when changing filter UX.

### Custom Pages (`instabiz/instabiz/page/`)
| Page slug | JS / PY files | Purpose |
|---|---|---|
| `ib-stock-dashboard` | `ib_stock_dashboard.js`, `ib_stock_dashboard.py` | Live stock across 3 warehouses — see Stock Dashboard section |
| `ib-stock-ledger` | `ib_stock_ledger.js`, `ib_stock_ledger.py` | Filterable stock ledger per item/warehouse/date range; deep-links from stock dashboard |
| `ib-customer-board` | `ib_customer_board.js`, `ib_customer_board.py` | 4-column kanban (Dormant / Regular / Today / Tomorrow) for sales users; date picker; add/remove with undo toast; current-month sales target card in stats row |
| `ib-assignment-admin` | `ib_assignment_admin.js`, `ib_assignment_admin.py` | Manager view: roster overview (avatar + stats + progress + sales target bar), view-as-user kanban, customer pool assign panel with server-side pagination |
| `attendance-terminal` | `attendance_terminal.js`, `attendance_terminal.py` | Bulk check-in/absent marking; factory vs office filter |
| `ib-price-list` | `ib_price_list.js`, `ib_price_list.py` | Item price list table; spec rendering (color dots, spec tags, UOM chips); row click popover with rates; search with multi-token highlight; manager can edit via toolbar button |

#### IB Stock Ledger (`ib-stock-ledger`)
- Backend: `get_ledger(item_code, warehouse, from_date, to_date, ...)` — @whitelist
- Queries `tabStock Ledger Entry` with party lookup via `_PARTY_MAP` (DN/SI/SO/PR/PI/PO)
- Warehouse short labels: `MAHARASHTRA - IB → MH`, `CHENNAI - IB → CN`, `GUJARAT - IB → GJ`
- Deep-linked from stock dashboard via `frappe.route_options = { item_code }`

#### IB Customer Board (`ib-customer-board`)
- Backend lives in `instabiz/overrides/customer_assignment.py` (not in the page py)
- Key whitelisted methods: `get_customer_board_data(date)`, `add_customer_to_today(customer, date, target_user)`, `remove_assignment(assignment_id, force)`, `get_customer_pool(territory, pool_type, date, limit, offset, search)`
- Columns: Dormant pool → Regular pool → Today → Tomorrow
- Undo toast: 5s window to re-add removed card

#### IB Assignment Admin (`ib-assignment-admin`)
- Backend methods (all in `customer_assignment.py`): `get_admin_overview(date, territory, view_as_user)`, `get_active_sales_users()`, `get_customer_pool(...)` with server-side pagination (50/page)
- `_require_manager()` guards all admin-facing methods (Sales Manager or System Manager role)
- Roster: avatar color = team-based (hash of team name → 10-color palette); no team → `var(--ib-primary)`
- View-as: loads full 4-column kanban for any user; manager can add/remove on their behalf
- Pool assign panel: always visible; Assign button enabled only when user + date + customers all selected

### Fonts (`instabiz/public/fonts/`)
| File | Notes |
|---|---|
| `InterVariable.woff2` | Inter v4.0 variable font — weights 100–900; applied globally via instabiz.css |
| `InterVariable-Italic.woff2` | Italic variant |

### Custom DocTypes (`instabiz/instabiz/doctype/`)
| DocType | Naming | Notes |
|---|---|---|
| Employee Exit Handover | EXH-.YYYY.-.##### | execute_reassignment() is whitelisted |
| Employee Exit Handover Item | (child) | child of Employee Exit Handover |
| Employee Document | (child, istable=1) | child used for storing employee files; options: PANCARD, AADHAR CARD, Passport, Education Certificate, Experience Letter, Offer Letter, Relieving Letter, Salary Slip, Bank Passbook, Other |
| Lead Sales Team | team_name | validate() checks duplicates |
| Lead Sales Team Member | (child) | fields: user (Link→User), parent = team name — used for avatar color grouping |
| Lead Sales Team Territory | (child) | |
| IB Branding | (simple master) | |
| IB Transport | (simple master) | |
| IB Assignment Config | (singleton) | fields: assignments_per_day (Int), dormant_threshold_days (Int), dormant_ratio (Percent) |
| IB Customer Assignment | ICA-.YYYY.-.##### | fields: customer, assigned_to (User), assigned_date, status (Pending/Contacted/Order Placed/Skipped/Rolled Over), source_pool (Dormant/Regular), territory, notes, outcome (Interested/Not Interested/Follow Up/No Response), completed_at |
| IB Sales Target | IB-ST-.YYYY.-.##### | fields: sales_user (Link→User), month (Date — always first of month, normalized in validate()), target_amount (Currency); unique on (sales_user, month) enforced in validate(); Sales Manager+ create/edit, Sales User read-only |
| IB Item Price List | (simple master) | fields: item_code, item_name, uom, rate1–4, specification (computed read-only); validate() computes specification from linked Item; doctype list view redirects to `ib-price-list` page |
| IB Customer Score | IB-CS-.YYYY.-.##### | daily health score per customer; fields: customer, score_date, health_status (Green/Amber/Red), total_score, previous_score, score_change, payment_score, order_score, complaint_score, csat_score |
| IB Sample Request | IB-SR-.YYYY.-.##### | sample dispatch tracker; status: Draft→Work Order Created→Sent→Feedback Received→Converted/Closed; outcome: Converted/Not Interested/Follow Up/No Response; validate() defaults date + assigned_to |

### Fixtures
- `instabiz/fixtures/custom_field.json` — ~85 custom fields
- `instabiz/fixtures/property_setter.json` — property overrides for Quotation, SO, Lead, DN
- Always `export-fixtures` after UI schema changes; always `migrate` after pulling fixture JSON

### Portal
- `instabiz/www/checkin/index.py` — employee check-in portal context

---

## Architecture Patterns

### Class Override Pattern
```python
class CustomXxx(IbStatusMixin, Xxx):
    STATUS_MAP = {"frappe_status": "IB display status", ...}
    def autoname(self): ...
    def validate(self): ...
```
Registered in `override_doctype_class` in `hooks.py`. `IbStatusMixin` remaps status values and bypasses Frappe's select validation so display values pass through.

### Document Chain: Q → SO → DN → SI
Custom mappers registered in `override_whitelisted_methods`. Each calls shared helpers from `utils.py`:
- `map_dimension_fields` — brand, branding, marking, thickness, width, length
- `map_parent_fields` — transport, location, custom_sales_person_user
- `map_address_contact_fields` — billing/shipping address + contact
- `item_postprocess` — per-row post-processing after mapping

### Naming Pattern
- **Q / SO:** Frappe series → `IB-{LOC}-Q-.#####` / `IB-{LOC}-SO-.#####`
- **DN / SI:** Global counter via MySQL advisory lock `GET_LOCK('IB-DNSI', 5)` → `IB-{LOC}-DN-00001`. SI reuses DN number when created from DN.
- `custom_location` → code: `maharashtra → BWD`, `chennai → CN`, `gujarat → SGM`

### Permission Pattern
Non-privileged: filter by `custom_sales_person_user = '{user}' OR owner = '{user}'`  
Privileged (bypass): System Manager, Sales Manager — checked by `_is_privileged()` in `permissions.py`

### Dimension-Based Qty
```
SQMT:  qty = (width_mm / 1000) × length_mtr × qty_pkg × total_pkg
Other: qty = qty_pkg × total_pkg
amount = qty × rate  (2 dp)
```
Runs in `recalculate_items()` (Python, on validate) and `ib_recalc_row()` (JS, on field change).

### Exit Handover Config
To add a doctype to the exit flow: append one dict to `exit_handover_sources` in `hooks.py`. No engine changes needed. Keys: `doctype`, `owner_field`, `display_name_field`, `title_field`, `module`, `pending_filter`.

---

## Key Custom Fields on Sales Docs

| Field | Purpose |
|---|---|
| `custom_sales_person_user` | Email — auto-set from session user; drives permissions |
| `custom_sales_person` | Display name of sales person |
| `custom_location` | maharashtra / chennai / gujarat |
| `transport` | Link → IB Transport |
| `ib_brand` | Link → IB Branding |
| `custom_branding`, `custom_marking`, `custom_thickness`, `custom_specifications` | Product details |

**Item child table:** `color`, `width_mm`, `length_mtr`, `qty_pkg`, `total_pkg`

---

## IB Stock Dashboard

**Page:** `ib-stock-dashboard` | **Files:** `ib_stock_dashboard.js` (~850 lines), `ib_stock_dashboard.py`

### Backend (`ib_stock_dashboard.py`)
- `get_stock_data(item_group, uom, warehouse, hide_zero_stock, show_zero_only)` — @whitelist
- Queries tabItem + tabBin (3 warehouse LEFT JOINs) + tabItem Reorder
- Returns per-item: actual qty + reserved qty per warehouse; reorder_level; low_stock flag
- Spec fields: `spec_width`, `spec_length`, `spec_thickness`, `spec_color`, `spec_liner`, `specification`
- `_build_spec()`: SQMT → "WxL | thickness | color with liner"; PCS → color; KG → adhesive_type

### Frontend features
- **Filter chips** — Item Group (dynamic), UOM (SQMT/PCS/KG — color-coded), Warehouse, Hide Zero / Show Zero Only
- **Multi-token search** — splits on spaces; all tokens must match; 160ms debounce on native input event; highlights matches with `<mark class="ib-search-hl">`
- **Color dots** — `_color_dots()` splits color string on `/`, `&`, `+`, ` and `; looks up `window.IB_COLOR_MAP`; null = checkerboard dot
- **Breakdown popover** — status line (Healthy/Low/Over-reserved/No Stock), per-warehouse visual bars, reserved %, clickable item code link, spec tags, UOM badge; smart positioning (flips left if needed)
- **CSV export** — individual columns: Width, Length, Thickness, Color, Liner (not a combined Specification column)
- **WebSocket live-updates** — subscribes to Bin doctype; listens for `ib_stock_update`; flashes changed rows
- **State persistence** — filters, sort, page size saved to localStorage
- **Cleanup** — `on_page_hide` calls `_stop_live()` and `_stop_auto_refresh()`

### Real-time pipeline
`hooks.py` doc_events → `stock_events.publish_stock_update` on SO/DN/Stock Entry/Stock Reconciliation submit/cancel  
→ `frappe.publish_realtime("ib_stock_update", {}, doctype="Bin", after_commit=True)`

### Color Map (`ib_color_map.js`)
`window.IB_COLOR_MAP` — 70+ entries; keys lowercase; `null` = transparent/checkerboard.  
Loaded globally via `app_include_js` in `hooks.py`.

---

## CSS

**Primary color:** `#d97757` (rust/burnt orange)  
**File:** `instabiz/public/css/instabiz.css`

### Global vars (`:root`)
- `--ib-primary` / `--ib-primary-dark` / `--ib-primary-xdark` — orange scale
- `--ib-brand` / `--ib-brand-strong` — aliases for primary (used by pages + popovers)
- `--ib-surface` / `--ib-border-soft` — aliases for `var(--card-bg)` / `var(--border-color)` — **must stay on `:root`** so fixed-position popovers (outside `.ib-sd-page`) inherit them

### IB Shared Utilities (use in any new custom page)
| Class | Purpose |
|---|---|
| `.ib-card` | Bordered card container — `card-bg`, `border-color`, `6px` radius |
| `.ib-action-btn` | Neutral button, orange on hover — same as `.ib-sd-action-btn` / `.ib-sl-action-btn` |
| `.ib-svg-icon` | SVG icon helper — same as `.ib-sd-svg-icon` / `.ib-sl-svg-icon` |
| `.ib-refresh-time` | Refresh timestamp — same as `.ib-sd-refresh-time` / `.ib-sl-refresh-time` |

> The existing page-scoped class names (`.ib-sd-*`, `.ib-sl-*`) are in the same multi-selectors — no JS changes needed. New pages use the `.ib-*` names.

### Key classes
- `.ib-color-dot` / `.ib-color-dot--checker` — color swatches in spec cells
- `.ib-chip--uom-sqmt/pcs/kg` — UOM chip colors (orange/blue/green)
- `mark.ib-search-hl` — search term highlight
- `.ib-status--good/warn/danger/none` — breakdown popover status
- `.ib-bd-bar`, `.ib-bd-bar-stock`, `.ib-bd-bar-res` — warehouse bars in popover
- Inter font applied globally: `body, .frappe-app, input, select, textarea, button`

---

## Code Style

- **Python:** tabs, double quotes, 110-char line limit — enforced by ruff
- **JS:** prettier + eslint
- No docstrings, type hints, or extra comments unless logic is non-obvious
- Do NOT double-register hooks for logic already in override classes (causes double execution)
- For list/filter work: **never guess fieldnames**. Verify from fixtures (`custom_field.json`, `property_setter.json`) before implementation.

---

## Frappe / ERPNext Gotchas

- `bench migrate` required after any fixture JSON change
- `bench build --app instabiz` required after any JS/CSS change
- `bench restart` required after any Python change
- `bench clear-cache` after `hooks.py` changes
- Advisory lock `GET_LOCK('IB-DNSI', 5)` in `naming.py` is critical for DN/SI uniqueness — never remove
- `recalculate_items` runs inside override `validate()` — do NOT also add as doc_event (double execution)
- `IbStatusMixin._validate_selects()` intentionally bypasses Frappe's select validation — by design