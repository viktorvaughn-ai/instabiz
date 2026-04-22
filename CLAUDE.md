# CLAUDE.md — instabiz

Single source of truth for all Claude Code sessions. Read this before touching any file.

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

### Custom Pages (`instabiz/instabiz/page/`)
| Page | Files | Notes |
|---|---|---|
| `ib-stock-dashboard` | `ib_stock_dashboard.js`, `ib_stock_dashboard.py` | See Stock Dashboard section below |

### Fonts (`instabiz/public/fonts/`)
| File | Notes |
|---|---|
| `InterVariable.woff2` | Inter v4.0 variable font — weights 100–900; applied globally via instabiz.css |
| `InterVariable-Italic.woff2` | Italic variant |

### Custom DocTypes (`instabiz/instabiz/doctype/`)
| DocType | Naming | Notes |
|---|---|---|
| Employee Exit Handover | EXH-.YYYY.-.##### | execute_reassignment() is whitelisted |
| Employee Exit Handover Item | (child) | |
| Lead Sales Team | team_name | validate() checks duplicates |
| Lead Sales Team Member | (child) | |
| Lead Sales Team Territory | (child) | |
| IB Branding | (simple master) | |
| IB Transport | (simple master) | |

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

---

## Frappe / ERPNext Gotchas

- `bench migrate` required after any fixture JSON change
- `bench build --app instabiz` required after any JS/CSS change
- `bench restart` required after any Python change
- `bench clear-cache` after `hooks.py` changes
- Advisory lock `GET_LOCK('IB-DNSI', 5)` in `naming.py` is critical for DN/SI uniqueness — never remove
- `recalculate_items` runs inside override `validate()` — do NOT also add as doc_event (double execution)
- `IbStatusMixin._validate_selects()` intentionally bypasses Frappe's select validation — by design
