# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

All commands run from the bench root (`~/frappe-bench`), not from the app directory.

```bash
# Restart after Python changes
bench restart

# Rebuild JS/CSS assets after frontend changes
bench build --app instabiz

# Push fixtures to database (after editing custom_field.json / property_setter.json)
bench --site <site> migrate

# Pull fixtures from database into JSON files
bench --site <site> export-fixtures --app instabiz

# Run a scheduler job manually
bench --site <site> execute instabiz.overrides.employee_exit.run_exit_handover_daily

# Run a setup/migration script
bench --site <site> execute instabiz.scripts.create_item_colors

# Lint and format (from apps/instabiz/)
cd apps/instabiz && pre-commit run --all-files

# Lint Python only
cd apps/instabiz && ruff check . && ruff format .
```

## Architecture

### Override Pattern
All ERPNext doctype extensions live in `instabiz/overrides/`. Python overrides use class inheritance registered via `override_doctype_class` in `hooks.py`:

```python
class CustomQuotation(IbStatusMixin, Quotation):
    STATUS_MAP = {"Open": "Pending", ...}
    def autoname(self): ...
    def validate(self): ...
```

`IbStatusMixin` (in `overrides/utils.py`) remaps Frappe's internal status values to instabiz display values and bypasses Frappe's select-field validation so the remapped values pass through.

### Shared Utilities (`overrides/utils.py`)
The single most important file. Contains:
- `IbStatusMixin` — status remapping for all sales doctypes
- `set_sales_person(doc)` / `sync_sales_team(doc)` — auto-populate `custom_sales_person_user` and mirror into the `sales_team` child table
- `recalculate_items(doc)` — dimension-based qty + amount recalculation (called inside each override's `validate()`)
- `item_postprocess`, `map_dimension_fields`, `map_parent_fields`, `map_address_contact_fields` — used by all three document mappers
- `reopen_sales_doc()` — generic reopen logic (cancel → draft) with pre-checks and extra steps hooks
- `transfer_documents()` — bulk SQL reassignment used by Employee Exit Handover

### Document Chain: Q → SO → DN → SI
Each transition is handled by a custom mapper in its source override file:
- `overrides/quotation.py` → `custom_make_sales_order()`
- `overrides/sales_order.py` → `custom_make_delivery_note()`
- `overrides/delivery_note.py` → `custom_make_sales_invoice()`

These are registered via `override_whitelisted_methods` in `hooks.py`, replacing the stock ERPNext mappers. They call the shared `map_*_fields` helpers from `utils.py` to carry dimensions, parent fields, and address/contact fields across the chain.

### Naming (`overrides/naming.py`)
- Quotation and Sales Order use Frappe series (`IB-{LOC}-Q-.#####`) — `autoname_*` functions call `frappe.model.naming.make_autoname`.
- Delivery Note and Sales Invoice use a **shared global counter** (`get_next_dn_si_number()`) protected by a MySQL advisory lock (`GET_LOCK('IB-DNSI', 5)`). Sales Invoice reuses the DN number when created from a DN.
- Location codes are derived from `custom_location` (or warehouse): `maharashtra → BWD`, `chennai → CN`, `gujarat → SGM`.

### Permissions (`overrides/permissions.py` + `overrides/lead.py`)
Row-level data isolation: non-privileged users see only documents where `custom_sales_person_user = current_user` OR `owner = current_user`. System Manager and Sales Manager bypass all filters. Each doctype has two hooks in `hooks.py`: `permission_query_conditions` (list view SQL) and `has_permission` (document open check).

### Lead Round-Robin Assignment (`overrides/lead.py`)
`assign_lead_owner()` fires on `after_insert` and `on_update`. It looks up the Lead's territory in `Lead Sales Team Territory` child tables, finds the matching team, increments `rr_index` (advisory lock), and sets `lead_owner`. Manual assignments (non-empty `lead_owner`) are never overwritten.

### Employee Exit Handover (`overrides/employee_exit.py`)
Scheduler-driven workflow. `exit_handover_sources` in `hooks.py` is the config list — adding a new doctype to the handover flow requires only a new entry there, no code changes. The handover doc's `execute_reassignment()` method calls `transfer_documents()` from `utils.py` for bulk owner field updates.

### Frontend (`public/js/`)
- `recalc.js` — `ib_calc_qty(row)` and `ib_recalc_row(frm, cdt, cdn)` are the core calculation functions, debounced 500ms. SQMT: `qty = (width_mm/1000) × length_mtr × qty_pkg × total_pkg`. Other UOMs: `qty = qty_pkg × total_pkg`.
- `form.js` — global handler registered for all four sales doctypes; manages Reopen button visibility, hides Cancel on Draft, triggers recalc on dimension field changes.
- `pincode.js` — exports `instabiz.pincode.autofill(frm, fieldname, opts)` for India Post API lookups. Used by `lead.js`.

### Fixtures
Custom fields and property setters are stored in `instabiz/fixtures/`. Always run `bench export-fixtures` after making schema changes via the UI, and `bench migrate` after pulling changes that include fixture JSON edits.

## Code Style
- Python: tabs, double quotes, 110-char line limit (ruff enforced)
- JS: prettier-formatted, eslint-checked
- Pre-commit enforces all of the above — install with `pre-commit install` from `apps/instabiz/`
