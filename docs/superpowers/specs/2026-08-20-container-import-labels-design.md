# Container Import + SKU/Item Barcode Labels — Design

## Goal
When a container of imported materials arrives, warehouse staff fill in container details (container no, supplier, warehouse, per-SKU box/qty counts), and the system generates print-ready barcode labels per SKU/box, and posts the goods into stock — one workflow instead of a separate manual Stock Entry + ad-hoc labeling.

## Scope
- New doctype `IB Container Import` (parent) + `IB Container Import Item` (child).
- Barcode generation/reuse tied to `Item.barcodes`.
- One Print Format for labels, looped per box.
- New desk page/list under Instabiz Stock workspace.
- Submit posts a Stock Entry (Material Receipt).

Out of scope: linking to Purchase Order/Receipt (this is a standalone record, not tied to procurement docs); multi-warehouse split per container (one warehouse per container import); barcode scanning/lookup UI (labels are generated for physical use, not scanned back into this doc).

## Doctype: `IB Container Import`

Naming: `IBC-.#####` series.

| Field | Type | Notes |
|---|---|---|
| `container_no` | Data | Mandatory |
| `supplier` | Link → Supplier | Optional |
| `reference_no` | Data | Invoice/BL number, optional |
| `warehouse` | Link → Warehouse | Mandatory |
| `import_date` | Date | Defaults to today |
| `remarks` | Small Text | Optional |
| `items` | Table → `IB Container Import Item` | Mandatory, ≥1 row |
| `stock_entry` | Link → Stock Entry | Read-only, set on submit |

Standard `docstatus` lifecycle: Draft (0) → Submitted (1) → Cancelled (2). No custom workflow doctype needed — plain submittable doctype, matching PO/PR/DN convention already used throughout instabiz.

## Child doctype: `IB Container Import Item`

| Field | Type | Notes |
|---|---|---|
| `item_code` | Link → Item | Mandatory |
| `item_name` | Data | Fetched from Item, read-only |
| `stock_uom` | Data | Fetched from Item, read-only |
| `no_of_boxes` | Int | Mandatory, > 0 |
| `qty_per_box` | Float | Mandatory, > 0 |
| `total_qty` | Float | Read-only, computed = `no_of_boxes * qty_per_box` |
| `barcode` | Data | Read-only, auto-filled (see below) |

## Barcode logic

On row `item_code` change (client-side fetch) confirmed server-side on save:

1. Check `Item.barcodes` child table for the item. If a row exists, reuse its `barcode` value.
2. If none exists, use `item_code` itself as the barcode value, encoded as **Code128** (alphanumeric-safe — item codes aren't guaranteed numeric, so EAN13 is not viable). Write it back onto `Item.barcodes` (`barcode: item_code, barcode_type: "Code128"`) via `item_doc.append("barcodes", {...}); item_doc.save(ignore_permissions=True)` so every future container import for that SKU reuses the same code — no dedup registry needed since `item_code` is already unique.
3. Barcode **images** are never persisted — rendered on demand at print time from the stored text value using `python-barcode` + Pillow (already installed in this bench's venv), returned as a base64 PNG data-URI through a Jinja-callable whitelisted method (`instabiz.overrides.container_import.get_barcode_data_uri(value)`), registered via `jenv.methods` in `hooks.py`. This keeps the barcode always rendered fresh from current data and avoids File/disk bloat.

## Submit behavior

`before_submit`:
- Validate every row: `no_of_boxes > 0`, `qty_per_box > 0`, `barcode` set.
- Validate `warehouse` has a mapped stock account (reuse the existing per-location stock-account check already used elsewhere in this app — see `[[project_2026_07_27_stock_accounts]]`).

`on_submit`:
- Build and submit a Stock Entry, `stock_entry_type: "Material Receipt"`, one row per child item: `t_warehouse = self.warehouse`, `qty = row.total_qty`, `item_code = row.item_code`.
- Stock Entry is created and submitted **before** the parent's own docstatus is set to Submitted (same transaction) — mirrors the PR→SLE atomicity pattern already used elsewhere in this app, so a Stock Entry failure never leaves the container doc silently submitted-but-unposted.
- Store the resulting Stock Entry name on `self.stock_entry`.

`on_cancel`:
- Cancel the linked Stock Entry first, then allow the container doc to cancel (standard Frappe linked-doc cancel ordering).

## Labels — Print Format

New Print Format `IB Container Label`, page size ~4×2in (label stock), attached to `IB Container Import`.

Template loops the child table, and **within each row, loops `range(row.no_of_boxes)`** — each iteration renders one label block (`page-break-after: always` on all but the last):

- Barcode image: `<img src="{{ get_barcode_data_uri(row.barcode) }}">`
- `item_code`, `item_name`
- `qty_per_box` (the qty this specific box holds)
- `container_no`, `import_date`

This produces exactly one physical label per physical box, which is what gets stuck on each carton.

**"Print All Labels"** — standard Frappe print button on the parent doc form (`frappe.set_route`/print dialog against this Print Format), no custom code needed beyond the format itself.

**Per-row reprint** — a small "Reprint labels" button added to each grid row (via `grid.get_field` / custom button, standard Frappe grid-row-button pattern) that calls a whitelisted method `reprint_item_labels(container_import, item_code)`. This method renders the same Jinja block scoped to just that one item's `no_of_boxes`, calls `frappe.utils.pdf.get_pdf()`, and returns the PDF for direct download — bypassing the full-document print dialog so a single damaged/miscounted label can be reprinted without regenerating the whole container's label set.

## Page / placement

- Standard Frappe desk list + form for `IB Container Import` — no custom JS shell (unlike Production/Stock dashboards) since this is a straightforward transactional document, not a live-data view.
- Workspace shortcut added to **Instabiz Stock** (alongside Live Stock Balance, Stock Entry, Item).
- Permissions: Stock User — create/read/write/submit; Stock Manager + System Manager — full incl. cancel/delete. Same role set as Stock Entry's existing permission rows.

## Error handling

- Submit blocked (validation error, not silent) if: any row missing boxes/qty, any row missing a resolvable barcode, warehouse has no mapped stock account.
- Stock Entry creation failure during `on_submit` raises and aborts the whole submit (transaction rollback) — container doc never ends up Submitted without a matching Stock Entry.
- Cancel blocked if the linked Stock Entry itself can't cancel (e.g. downstream stock already consumed) — standard Frappe linked-doc-cancel error surfaces as-is, no custom override needed.

## Testing plan

- Unit: barcode reuse (existing `Item.barcodes` row) vs generation (new value written back) vs image data-URI generation for both numeric-looking and alphanumeric `item_code` values.
- Live: create a Draft container with 2 SKUs (one with an existing Item barcode, one without), submit, verify Stock Entry posted correct qty into the right warehouse, verify GL/SLE/Bin tally (same live-verification pattern used for the per-location stock accounts work — `[[project_2026_07_27_stock_accounts]]`).
- Print: verify "Print All Labels" produces `sum(no_of_boxes)` label blocks across all rows, each with a scannable barcode; verify per-row reprint produces only that item's boxes.
- Permission: verify a non-Stock-User role cannot create/submit; verify Stock User cannot cancel (Manager/System Manager only).
