# CLAUDE.md — instabiz Custom Frappe App

This file is the single source of truth for Claude Code sessions on this project.
Read this first before touching any file.

---

## Project Context

**App:** instabiz (`/home/dev/frappe-bench/apps/instabiz/`)
**Company:** Instabiz Solutions India Pvt Ltd — packaging/tape/foam product distribution business
**Built on:** Frappe v15 + ERPNext v15 + HRMS
**Site name:** `frontend` (use in all `bench --site` commands)
**Bench root:** `/home/dev/frappe-bench/` — ALL bench commands run from here

### 3 Locations / Warehouse Codes
| Location | Code | State |
|---|---|---|
| Maharashtra (Mumbai office) | BWD | Employees HR-EMP-00002 to 00163 |
| Chennai | CN | — |
| Gujarat (Astro warehouse) | SGM | Employees HR-EMP-00164 to 00192 |

---

## What Has Been Implemented (Status: Complete)

1. **Sales Workflow** — Q → SO → DN → SI with custom naming, dimension-based qty calc, custom mappers, row-level permissions
2. **Lead Management** — round-robin assignment via Lead Sales Team, territory mapping, India Post pincode autofill
3. **Employee Exit Handover** — scheduler creates handover docs on relieving_date, HR reassigns docs, user disabled on relieving_date+1
4. **Attendance / Check-in Portal** — employee self-service at `/checkin`, get_my_status, self_checkin, get_daily_attendance
5. **New User Onboarding** — auto-creates Sales Person, copies admin defaults/UI settings on User.after_insert
6. **Custom Masters** — IB Branding, IB Transport, Lead Sales Team (with Member + Territory child tables)
7. **Role-based Data Isolation** — non-privileged users see only their own sales docs (`custom_sales_person_user` or `owner`)
8. **HRMS Payroll** — Two salary structures (IB Payroll for Mumbai, Astro Payroll for Gujarat), March 2026 salary assignments done

## What Is Next (In Progress / Planned)

- **Sales Reports** — custom script reports showing sales person / location / item / period breakdowns
- **Inventory** — stock tracking per location, possibly custom fields on stock docs, reorder/low-stock workflows

---

## Common Commands

```bash
# ── After Python changes ──
bench restart

# ── After JS/CSS changes ──
bench build --app instabiz

# ── After editing fixture JSON (custom_field.json / property_setter.json) ──
bench --site frontend migrate

# ── Pull current schema from DB into fixture JSON files ──
bench --site frontend export-fixtures --app instabiz

# ── Run a scheduler job manually ──
bench --site frontend execute instabiz.overrides.employee_exit.run_exit_handover_daily
bench --site frontend execute instabiz.overrides.employee_exit.run_user_disable_daily

# ── Run a one-off script ──
bench --site frontend execute instabiz.scripts.create_item_colors

# ── Open bench console (Python REPL with frappe context) ──
bench --site frontend console

# ── Lint and format everything (run from apps/instabiz/) ──
cd apps/instabiz && pre-commit run --all-files

# ── Python lint only ──
cd apps/instabiz && ruff check . && ruff format .

# ── Clear cache (after hooks.py changes) ──
bench --site frontend clear-cache

# ── Check bench / site logs ──
tail -f logs/worker.error.log
tail -f logs/web.error.log
```

---

## File Map

### Entry Points
| File | Purpose |
|---|---|
| `instabiz/hooks.py` | ALL hooks: scheduler, fixtures, class overrides, doc events, permissions, whitelisted methods, assets |
| `instabiz/overrides/utils.py` | **Most important file** — shared utilities used everywhere |

### Python Overrides (`instabiz/overrides/`)
| File | What It Does |
|---|---|
| `utils.py` | IbStatusMixin, set_sales_person, sync_sales_team, recalculate_items, all map_* helpers, reopen_sales_doc, transfer_documents |
| `quotation.py` | CustomQuotation, custom_make_sales_order() |
| `sales_order.py` | CustomSalesOrder, custom_make_delivery_note() |
| `delivery_note.py` | CustomDeliveryNote, custom_make_sales_invoice() |
| `sales_invoice.py` | CustomSalesInvoice |
| `customer.py` | CustomCustomer (protects customer_name from accidental edits) |
| `lead.py` | assign_lead_owner (round-robin), get_pincode_info, transfer_leads, permission query/has_permission |
| `permissions.py` | Generic permission helpers (query conditions + has_permission) for all 4 sales doctypes |
| `naming.py` | autoname_* functions, LOCATION_CODE_MAP, get_next_dn_si_number (MySQL advisory lock) |
| `user.py` | create_sales_person_for_user, copy_admin_defaults, copy_admin_ui_settings |
| `checkin.py` | get_my_status, self_checkin, get_daily_attendance (portal API) |
| `attendance_terminal.py` | get_employees_with_status, create_checkin, mark_absent |
| `item.py` | item_query (multi-token search for item select fields) |
| `employee_exit.py` | run_exit_handover_daily, run_user_disable_daily (scheduler entry points) |

### JavaScript (`instabiz/public/js/`)
| File | Purpose |
|---|---|
| `recalc.js` | `ib_calc_qty(row)`, `ib_recalc_row(frm, cdt, cdn)` — dimension qty calc, debounced 500ms |
| `form.js` | Global handler for all 4 sales doctypes: Reopen button, hide Cancel on Draft, recalc triggers |
| `pincode.js` | `instabiz.pincode.autofill(frm, fieldname, opts)` — India Post API lookup |
| `lead.js` | Triggers pincode autofill on `custom_pincode` change |
| `ib_sales_common.js` | item_query override for Quotation and Sales Order |
| `employee_exit_handover.js` | "Quick Assign All" and "Execute Reassignment" buttons |
| `*_list.js` | List view customizations per doctype |
| `address.js` | Address form helpers |
| `customer.js` | Customer form helpers |

### Custom DocTypes (`instabiz/instabiz/doctype/`)
| DocType | Naming | Notes |
|---|---|---|
| Employee Exit Handover | EXH-.YYYY.-.##### | execute_reassignment() is a whitelisted method |
| Employee Exit Handover Item | (child) | |
| Lead Sales Team | team_name | validate() checks for duplicates |
| Lead Sales Team Member | (child) | |
| Lead Sales Team Territory | (child) | |
| IB Branding | (simple master) | `branding` field |
| IB Transport | (simple master) | `transport` field |

### Fixtures
- `instabiz/fixtures/custom_field.json` — ~85 custom fields
- `instabiz/fixtures/property_setter.json` — property overrides for Quotation, SO, Lead, DN
- Always `export-fixtures` after UI schema changes, always `migrate` after pulling fixture JSON changes

### Portal
- `instabiz/www/checkin/index.py` — employee check-in portal page

---

## Architecture Patterns

### Class Override Pattern
```python
class CustomXxx(IbStatusMixin, Xxx):
    STATUS_MAP = {"frappe_status": "IB display status", ...}
    def autoname(self): ...
    def before_insert(self): ...
    def validate(self): ...
```
Registered via `override_doctype_class` in `hooks.py`. `IbStatusMixin` (in `utils.py`) remaps status values and bypasses Frappe's select-field validation so remapped display values pass through.

### Document Chain: Q → SO → DN → SI
Each transition uses a custom mapper (registered in `override_whitelisted_methods`):
- `quotation.py → custom_make_sales_order()`
- `sales_order.py → custom_make_delivery_note()`
- `delivery_note.py → custom_make_sales_invoice()`

All call shared `map_*_fields` helpers from `utils.py`:
- `map_dimension_fields` — carries brand, branding, marking, thickness, width, length, etc.
- `map_parent_fields` — carries transport, location, custom_sales_person_user, etc.
- `map_address_contact_fields` — carries billing/shipping address + contact
- `item_postprocess` — called per item row after mapping

### Naming Pattern
- **Quotation / SO:** Frappe series via `autoname_*()` → `IB-{LOC}-Q-.#####` / `IB-{LOC}-SO-.#####`
- **DN / SI:** Global counter via `get_next_dn_si_number()` with `GET_LOCK('IB-DNSI', 5)` MySQL advisory lock → `IB-{LOC}-DN-00001` format. SI reuses DN number when created from DN.
- Location code derived from `custom_location`: `maharashtra → BWD`, `chennai → CN`, `gujarat → SGM`

### Permission Pattern
```python
# hooks.py entries:
permission_query_conditions = {"DocType": "module.path.fn"}  # returns SQL WHERE string
has_permission          = {"DocType": "module.path.fn"}  # returns bool
```
Non-privileged users: `custom_sales_person_user = '{user}' OR owner = '{user}'`
Privileged (bypass): System Manager, Sales Manager roles (`_is_privileged()` in `permissions.py`)

### Dimension-Based Qty Calculation
```
SQMT UOM:   qty = (width_mm / 1000) × length_mtr × qty_pkg × total_pkg
Other UOM:  qty = qty_pkg × total_pkg
amount      = qty × rate  (rounded to 2 decimal places)
```
Runs in `recalculate_items()` (Python, on validate) and `ib_recalc_row()` (JS, on field change).

### Exit Handover Config (`exit_handover_sources` in `hooks.py`)
Adding a new doctype to the exit handover flow requires **only** a new dict entry in `hooks.py` — no engine changes. Keys: `doctype`, `owner_field`, `display_name_field`, `title_field`, `module`, `pending_filter`.

---

## Key Custom Fields on Sales Docs

| Field | Type | Purpose |
|---|---|---|
| `custom_sales_person_user` | Data (email) | Auto-set from session user; used for permissions |
| `custom_sales_person` | Data | Display name of sales person |
| `custom_location` | Select | maharashtra / chennai / gujarat |
| `transport` | Link → IB Transport | Transporter name |
| `transport_gst` | Data | Transporter GSTIN |
| `booking_for` | Data | Booking reference |
| `ib_brand` | Link → IB Branding | Brand |
| `custom_branding` | Data | Branding details |
| `custom_marking` | Data | Marking/label details |
| `custom_thickness` | Data | Product thickness |
| `custom_specifications` | Data | Misc specs |

**Item child table fields:**
`color`, `width_mm`, `length_mtr`, `qty_pkg`, `total_pkg` (dimensions driving qty calc)

---

## HRMS / Payroll

### Salary Structures
**IB Payroll** (Mumbai — HR-EMP-00002 to 00163):
- Basic: `round(base * 2/3)`, HRA: `round(base * 0.2)`, CA: `base - B - HRA`
- PF: `round((B + CA if B + CA <= 15000 else 15000) * 0.12)` — condition: `provident_fund_account`
- ESIC: `round((B + HRA) * 0.0075)` — condition: `health_insurance_no and base <= 21000`
- PT: `175 if base <= 10000 else 200` — condition: `(gender == "Male" and base >= 7500 or gender == "Female" and base > 25000) and payment_days > 0`

**Astro Payroll** (Gujarat — HR-EMP-00164 to 00192):
- Basic (3 tiers): `round(base*2/3) if base > 21000 else (round(base*10/13) if base > 11000 else round(base*10/11))`
- HRA (3 tiers): `round(base/6) if base > 21000 else (round(base*1.5/13) if base > 11000 else round(B*0.05))`
- CA: `base - B - HRA`, PF uses B+HRA (not CA), PT flat ₹200 (Gujarat rules, no female exemption)

### March 2026 Salary Sheet Files
- `/home/dev/hrms_docs/Instabiz final salary 3-26.xls` — sheet `3-26`, 32 IB employees
- `/home/dev/hrms_docs/Astro Final Salary sheet 3-26.xls` — sheet `3-26`, 29 Astro employees
- 17 IB employees had salary increments from Jan 2025 → March 2026 — new assignments created

---

## Code Style

- **Python:** tabs, double quotes, 110-char line limit — enforced by `ruff`
- **JS:** prettier-formatted, eslint-checked
- **Pre-commit:** `pre-commit install` from `apps/instabiz/` then `pre-commit run --all-files`
- Do NOT add docstrings, type hints, or extra comments unless logic is non-obvious
- Do NOT double-register hooks for logic already in override classes (causes double execution)

## CSS Theme
- Primary color: `#d97757` (rust/burnt orange)
- File: `instabiz/public/css/instabiz.css`

---

## Frappe/ERPNext Gotchas Specific to This App

- `bench migrate` is needed after any fixture JSON change — it's not automatic
- `bench build --app instabiz` is needed after any JS/CSS change — assets are not hot-reloaded in production mode
- `bench restart` is needed after any Python change (hooks, overrides) — workers cache imported modules
- `bench clear-cache` after `hooks.py` changes in case hook lists are cached
- Advisory lock `GET_LOCK('IB-DNSI', 5)` in `naming.py` is critical for DN/SI number uniqueness — do not remove or bypass
- `recalculate_items` is called inside each override class's `validate()` — do NOT also add it as a `doc_event` in `hooks.py` (causes double execution — already fixed once, do not regress)
- `IbStatusMixin._validate_selects()` intentionally bypasses Frappe's select validation — this is by design to allow display-mapped status values
