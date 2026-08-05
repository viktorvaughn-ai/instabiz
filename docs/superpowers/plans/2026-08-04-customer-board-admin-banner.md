# Customer Board Admin Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Sales Manager / System Manager a persistent banner on Customer Board linking to the existing Assignment Admin (master control) page.

**Architecture:** Pure frontend change to one existing custom page. No backend, no doctype, no fixture changes. The banner renders conditionally off the already-computed `this._is_manager` flag and navigates via `frappe.set_route`.

**Tech Stack:** Frappe v15 custom page (vanilla JS + jQuery), existing `instabiz.bundle.css`.

**Note on testing:** This codebase has no JS test harness for custom pages (`ib-*` pages have no `.test.js` files, no jest config). Following existing project convention, verification here is manual (role-based load + click-through), matching how other custom pages (`ib-stock-dashboard`, `ib-assignment-admin`, etc.) are verified per `CLAUDE.md`'s Verify-First Workflow.

---

### Task 1: Add banner markup + click handler

**Files:**
- Modify: `instabiz/instabiz/page/ib_customer_board/ib_customer_board.js:96-180` (`_build_skeleton()`)

- [ ] **Step 1: Add the conditional banner markup**

In `_build_skeleton()`, immediately before the `this.$main.html(...)` call (i.e. right above line 97 `this.$main.html(\``), add:

```javascript
const admin_banner = this._is_manager ? `
    <div id="ib-cb-admin-banner" class="ib-cb-admin-banner">
        ${IB_ICONS.svg("users", 14)}
        <span class="ib-cb-admin-banner-text">Managing the team? Open Master Control for full team oversight.</span>
        <button class="btn btn-xs btn-primary ib-cb-admin-banner-btn" id="ib-cb-admin-banner-btn">Open Master Control &rarr;</button>
    </div>
` : "";
```

Then change the opening of the template literal from:

```javascript
this.$main.html(`
    <div class="ib-cb-board">
        <div class="ib-cb-stats-row">
```

to:

```javascript
this.$main.html(`
    <div class="ib-cb-board">
        ${admin_banner}
        <div class="ib-cb-stats-row">
```

- [ ] **Step 2: Bind the click handler**

At the end of `_build_skeleton()`, where the existing "Load more" binding lives:

```javascript
$("#ib-cb-dormant-more").off("click").on("click", () => this._load_more_my_accounts());
```

add directly below it:

```javascript
$("#ib-cb-admin-banner-btn").off("click").on("click", () => {
    frappe.set_route("Page", "ib-assignment-admin");
});
```

(This selector is a no-op when the banner wasn't rendered — `_is_manager` false — since the element won't exist. No guard needed.)

- [ ] **Step 3: Manual verification — element presence**

Run: `bench build --app instabiz` (from `/home/dev/frappe-bench`)

Then in the browser as a **Sales User** (no Sales Manager/System Manager role): open Customer Board, confirm `#ib-cb-admin-banner` is absent (check via browser devtools: `document.getElementById('ib-cb-admin-banner')` returns `null`).

Then as a **Sales Manager or System Manager**: open Customer Board, confirm the banner renders above the stats row, and clicking "Open Master Control →" navigates to `/app/ib-assignment-admin` without a full page reload (URL bar updates via SPA route, no browser loading spinner).

---

### Task 2: Style the banner

**Files:**
- Modify: `instabiz/public/css/instabiz.bundle.css:2054-2056`

- [ ] **Step 1: Add the CSS block**

Immediately after line 2056 (`.ib-cb-board { padding: 16px 0; overflow: hidden; }`), add:

```css
.ib-cb-admin-banner {
    display: flex; align-items: center; gap: 10px;
    background: var(--card-bg); border: 1px solid var(--border-color);
    border-radius: 8px; padding: 10px 14px; margin-bottom: 14px;
}
.ib-cb-admin-banner-text {
    flex: 1; font-size: 12.5px; color: var(--text-muted);
}
.ib-cb-admin-banner-btn { flex-shrink: 0; }
```

This follows the existing token convention used by `.ib-cb-target-card` (same file, `var(--card-bg)`, `var(--border-color)`, `8px` radius).

- [ ] **Step 2: Rebuild and visually verify**

Run: `bench build --app instabiz`

In the browser as Sales Manager/System Manager, confirm the banner is a single thin card-styled strip (not full-bleed, not clashing with the stats row below it), readable in both light states the app supports (this app is light-mode only per project convention — no dark-mode check needed).

---

### Task 3: Commit

**Files:** none (git only)

- [ ] **Step 1: Review the diff**

```bash
git diff instabiz/instabiz/page/ib_customer_board/ib_customer_board.js instabiz/public/css/instabiz.bundle.css
```

Confirm only the banner markup, click handler, and CSS block are present — no unrelated changes.

- [ ] **Step 2: Commit**

```bash
git add instabiz/instabiz/page/ib_customer_board/ib_customer_board.js instabiz/public/css/instabiz.bundle.css
git commit -m "feat(customer-board): add admin banner linking to Assignment Admin"
```

---

## Self-Review Notes

- **Spec coverage:** Trigger (`_is_manager`) ✓ Task 1. Placement/markup ✓ Task 1. Behavior (SPA route) ✓ Task 1. Styling ✓ Task 2. No backend/doctype changes ✓ (none introduced). Always-shown, no dismiss ✓ (no dismiss logic written). Verification per spec ✓ Task 1 Step 3 / Task 2 Step 2.
- **No placeholders:** all steps show exact code/commands.
- **Type/name consistency:** `#ib-cb-admin-banner-btn` id used identically in JS bind (Task 1 Step 2) and referenced nowhere else; `.ib-cb-admin-banner` class used identically in JS markup (Task 1 Step 1) and CSS (Task 2 Step 1).
