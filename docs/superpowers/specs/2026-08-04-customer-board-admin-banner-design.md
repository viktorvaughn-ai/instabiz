# Customer Board — Admin Master Control Banner

## Problem

`ib-customer-board` renders the same personal 3-column kanban (My Accounts /
Today / Tomorrow) for every role, including Sales Manager and System Manager.
Team-wide oversight already exists at `ib-assignment-admin` (roster, view-as
kanban, pool-assign, bulk reassign, team management) but it's a separate page
admins must know to navigate to manually — there's no link from Customer
Board pointing them there.

## Decision

Do not merge or duplicate Assignment Admin's functionality into Customer
Board. Instead, close the discoverability gap with a banner: admins still see
their own personal board (unchanged — some admins work accounts themselves),
plus a persistent banner pointing to the existing master-control page.

Rejected: full merge (duplicates already-built/tested logic, doubles
maintenance surface, risks the two views drifting), auto-redirect (breaks
personal-board access for admins who also work accounts), toggle switch
(added complexity for the same end result a link achieves).

## Design

**Trigger** — `this._is_manager` (Sales Manager or System Manager role),
already computed in `IBCustomerBoard` constructor. No new permission check.

**Placement** — new strip at the very top of the board, above the existing
stats row, rendered only when `_is_manager` is true. Always shown, no
dismiss/localStorage state.

**Markup** — `<div id="ib-cb-admin-banner" class="ib-cb-admin-banner">` with
an icon, message text ("Managing the team? Open Master Control for full team
oversight."), and a button ("Open Master Control →"). Follows the existing
`ib-cb-*` class naming convention.

**Behavior** — button click calls `frappe.set_route("Page", "ib-assignment-admin")`
(SPA navigation, no full page reload, matches existing in-app nav pattern).

**Backend** — none. Zero changes to `customer_assignment.py` or any
whitelisted method. No fixture/doctype changes.

## Files touched

- `instabiz/instabiz/page/ib_customer_board/ib_customer_board.js` — banner
  markup in `_build_skeleton()`, click handler in `_init()` or toolbar setup.
- `instabiz/public/css/instabiz.bundle.css` — `.ib-cb-admin-banner` styles.

## Out of scope

- Any change to `ib-assignment-admin` itself.
- Any change to non-admin (Sales User) Customer Board experience.
- Retiring/redirecting the Assignment Admin page — stays a separate,
  independently-reachable page (workspace shortcut unchanged).

## Verification

- Load Customer Board as a Sales User (no Sales Manager/System Manager role)
  — banner absent, board unchanged.
- Load Customer Board as Sales Manager / System Manager — banner visible
  above stats row, click navigates to Assignment Admin via SPA route (no
  reload), personal board still fully functional beneath it.
- `bench build --app instabiz` after JS/CSS changes per CLAUDE.md.
