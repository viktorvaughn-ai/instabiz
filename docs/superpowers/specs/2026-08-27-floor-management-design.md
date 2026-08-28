# Floor Management Master — Implementation Report

## Goal
Give Gujarat (the only real factory) a "Floor Management" master where warehouses/sub-warehouses/floors can be created and configured, so `IB Machine` can be assigned to a specific floor and Production's auto machine-assignment respects which stages each floor is actually equipped for — supporting future factory expansion without touching the sales-side location model.

## Current state (verified against live data, not guessed)

- **Floors already exist as real data.** `Warehouse` already has a live 2-level tree for Gujarat:
  `GUJARAT - IB` (is_group=1) → `Ground Floor - GUJARAT - IB`, `First Floor - GUJARAT - IB`, `Second Floor - GUJARAT - IB` (all is_group=0). 2 of the 3 already have real Bin/stock activity. Frappe's native Warehouse doctype is the right tree to build on — no reason to duplicate it with a parallel hierarchy.
- **Nothing in Production knows these floors exist.** All 8 real `IB Machine` records are tagged with the flat 3-value `location` Select (`maharashtra` / `gujarat` / `chennai`) — all 8 are `gujarat`, none reference a specific floor.
- **`Sales Order.custom_location`** is the same flat 3-value Select, and is load-bearing well beyond Production: GST/e-way bill GSTIN resolution (`LOCATION_WAREHOUSE` in `utils.py`), naming series codes (BWD/CN/SGM), and `_get_stage_route()`'s warehouse-only-vs-factory branch all key off it directly. **Per your decision, this stays untouched** — floor granularity is added only at the Machine/Work-Order level, not the Sales Order level.
- **Real production stages are 5, not 7.** `STAGES` in `production.py` = Coating, Slitting, Rewinding, Cutting, Packing — each maps 1:1 to an `IB Machine.machine_type`. "Ready to Deliver" and "Delivered" are administrative stages with no machine (`_STAGE_MACHINE_TYPE` has no entry for them) and are unaffected by floor logic.
- **Auto machine-assignment today** (`_assign_machine_load_balanced(stage, location)`): filters candidate machines by `machine_type` + `status=Active`, prefers same-`location` machines, then picks the least-loaded by open Work Order count, with a `capacity` cutoff. This is the one function that needs to become floor-aware.

## Decisions locked in (asked, not guessed)

1. **Floor = a Link to the real Warehouse tree**, not a parallel data model.
2. **Additive only** — `Sales Order.custom_location` and every one of its ~15 existing call sites (GST, naming, stage-route warehouse-only branch) stay exactly as they are today. Only `IB Machine` (and, downstream, Work Order machine-assignment) gains floor awareness.
3. **Floor drives which stages/machines are available** — a floor with no Cutting machine on it should never have a Cutting-stage Work Order auto-assigned to a machine on that floor.
4. **Scoped to Gujarat only for now** — Maharashtra/Chennai stay warehouse-only, no floor concept needed until one of them actually becomes a factory.

## Proposed design

### New doctype: `IB Production Floor`
The "master" itself — a plain doctype list+form, same pattern as `IB Branding`/`IB Transport`/`IB Assignment Config` (no new custom Page needed; Frappe's native list/form view is the management UI).

| Field | Type | Notes |
|---|---|---|
| `warehouse` | Link → Warehouse | must be a leaf warehouse (`is_group=0`); one `IB Production Floor` per warehouse (unique) |
| `location` | Select (maharashtra/gujarat/chennai), read-only | auto-derived from the warehouse's top-level parent on save — this is what lets the new logic plug into `_get_stage_route()`'s existing `location` string without changing that function's signature |
| `floor_name` | Data, read-only, fetched from `warehouse.warehouse_name` | display convenience |
| `allowed_stages` | Table MultiSelect (Coating/Slitting/Rewinding/Cutting/Packing) | which of the 5 machine-driven stages this floor is actually equipped to run — **you fill this in per floor**, not guessed here |
| `is_active` | Check, default 1 | lets a floor be temporarily taken out of assignment rotation (maintenance, reflow) without deleting it |

`validate()`: derives `location` from `frappe.db.get_value("Warehouse", warehouse, "parent_warehouse")`'s own top-level ancestor, resolved against the same lowercase 3-value set `_WAREHOUSE_ONLY_LOCATIONS`/`_get_stage_route` already use — throws if the warehouse isn't under one of the 3 known top-level location warehouses (MAHARASHTRA - IB / GUJARAT - IB / CHENNAI - IB), so a floor can never silently attach to an unrelated tree.

### `IB Machine` gets one new field: `floor`
`floor` — Link → `IB Production Floor`, **optional**. Blank means "not yet migrated to floor-level tracking" — falls back to today's location-only behavior exactly as-is. All 8 existing machines stay blank (and fully functional) until you assign them; nothing breaks on day one.

### `_assign_machine_load_balanced()` becomes floor-aware, backward compatibly
Current candidate filter: `machine_type` + `status=Active`, prefer same-`location`.
New candidate filter, additive:
1. Fetch candidates as today (`machine_type` + `status=Active`).
2. For any candidate that **has** a `floor` set: only keep it if that floor's `allowed_stages` includes the stage being assigned. A Cutting-stage assignment will skip a machine sitting on a Coating-only floor.
3. Candidates with **no** `floor` set are never filtered by this rule (unmigrated machines keep working exactly as today).
4. Same-location preference + load-balancing-by-open-WO-count logic is unchanged after the floor filter narrows the pool.

This is the one behavioral change in `production.py` itself — everywhere else (`_get_stage_route`, naming, GST) is untouched, matching decision 2.

### Where floor surfaces in the UI
- **Edit Machine dialog** (`ib_production_dashboard.js`, the merged Production page): new optional Floor field, filtered to `IB Production Floor` records under the machine's own location.
- **Machine-wise tab**: floor name shown alongside each machine card's header (next to location).
- **New Floor filter**, alongside the existing Location filter (`localStorage["ib_prod_location"]`, same pattern) on Order-wise/Item-wise/Stage-wise/Machine-wise — lets a factory manager scope the whole page to "just the Ground Floor" the same way Location scoping already works today. Populated only when the selected Location has at least one `IB Production Floor` (i.e. shows up for Gujarat, stays absent for Maharashtra/Chennai — no dead dropdown for locations with no floors).
- **`IB Production Floor` list** itself is the "master" — reachable from the Instabiz Production workspace (new shortcut, same MASTERS-style placement as `IB Jumbo Roll`).

### Explicitly out of scope for this pass
- No change to `Sales Order.custom_location`, GST/e-way bill resolution, or naming series — confirmed by decision 2.
- No revival of the old Seat Map/Live Floor UI (removed deliberately in items 96/123 — a floor-level occupancy visualization is a different, larger feature and wasn't asked for here).
- No floor concept for Maharashtra/Chennai — confirmed by decision 4. Extending later means: create their location's Warehouse sub-tree (doesn't exist yet for either), then `IB Production Floor` records against it — no code change needed, the doctype's own `location` derivation already generalizes to all 3.
- No change to item-group-based stage **routing** (`_get_stage_route`) — an item's required stages are still decided by item group as today; floor only constrains *which machine* can execute a stage that route already calls for. If a route calls for Cutting and no active floor on that location has Cutting in its `allowed_stages`, assignment correctly returns no machine (same "no machine available" outcome `_assign_machine_load_balanced` already produces today when a machine_type has zero Active machines) — a data/config gap to flag to the user at that point, not a new failure mode.

## Migration & rollout (additive, zero data risk)

1. Create `IB Production Floor` doctype (fixture-tracked, like every other custom doctype).
2. Add `floor` field to `IB Machine` via `custom_field.json`.
3. Create 3 `IB Production Floor` records against the 3 existing Gujarat sub-warehouses — **`allowed_stages` per floor needs your input**, not invented here (I don't know which of Coating/Slitting/Rewinding/Cutting/Packing physically sits on Ground vs First vs Second Floor).
4. Wire `_assign_machine_load_balanced()`'s floor filter (additive, guarded by "only applies if `floor` is set").
5. Add Floor field to Edit Machine dialog; assign real floors to the 8 existing machines (also needs your input — same reason as #3).
6. Add Floor filter to the 4 Production Stages sub-tabs + Machine-wise card header.
7. Add workspace shortcut.
8. `bench migrate` (fixture) → `bench build --app instabiz` (JS) → `bench restart` (Python) — standard order, no data touched, existing machines keep working throughout since every new field is optional and every new filter is additive.

## Open items I need from you before/while building
- **Which stages does each of the 3 existing floors actually have machines for?** (Ground / First / Second Floor - GUJARAT). Determines `allowed_stages` on each `IB Production Floor` record.
- **Which floor is each of the 8 existing machines (CM-01, CT-01, CT-02, DS-01, PK-01, PK-02, RW-01, SM-01) physically on?** Determines the `floor` value to backfill on each machine. DS-01 (Despatch) has no stage role in the routing model at all (per items 96/123) — floor assignment for it is optional/cosmetic only.

Once you confirm those two data points (or say "leave machines unassigned for now, I'll do it myself from the UI"), I'll build this end to end.
