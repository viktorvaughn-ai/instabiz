# Company Expense Entry — Implementation Report

## Goal
A simple, approval-gated way to record general company/operational expenses (rent, utilities, misc — not employee reimbursement) that posts real GL entries, following the exact pattern this app already uses successfully for `IB Credit Note`/`IB Debit Note`.

## Decisions locked in (asked, not guessed)
1. **General company expenses only** — rent, utilities, misc direct spend. Not employee reimbursement claims (that's a separate, differently-shaped feature — see "Explicitly out of scope" below).
2. **Approval required** before an expense counts.
3. **Real GL posting** — must show up in Trial Balance/P&L, not just a log.

## Current state (verified, not guessed)
- Native ERPNext `Expense Claim` doctype exists in this install but has **zero records ever** and no workspace shortcut anywhere — it's the reimbursement-shaped feature explicitly ruled out above, confirmed unused, left alone.
- `Journal Entry` exists and is used generically company-wide already — the raw double-entry primitive an accountant could use for this today, but it demands debit/credit account literacy from whoever enters it. Not friendly for "add a way to enter expenses" as a discoverable feature.
- The proven shape for "simple form in, correct GL entries out, no double-entry knowledge required" already exists twice in this codebase: `IB Credit Note` / `IB Debit Note` — both extend Frappe/ERPNext's `AccountsController`, both call `erpnext.accounts.general_ledger.make_gl_entries()` in `on_submit()`, both are simple forms (party, reason, amount) that produce correct GL under the hood.
- Chart of Accounts already has real Expense-type (`root_type='Expense'`) ledger accounts per company — no new master needed to categorize an expense; a real GL account IS the category.

## Proposed design

### New doctype: `IB Expense`
Naming: `IB-EXP-{YYYY}-{#####}`. Extends `AccountsController` (same base as IB Credit/Debit Note).

| Field | Type | Notes |
|---|---|---|
| `posting_date` | Date, default today | |
| `company` | Link → Company | |
| `location` | Select (maharashtra/gujarat/chennai) | drives cost center, same pattern as every other transactional doctype in this app |
| `expense_account` | Link → Account, filtered `root_type=Expense` | the actual ledger line this posts to — no separate "category" master needed, the Chart of Accounts already has the right granularity (Rent, Electricity, Office Supplies, etc. as real accounts) |
| `description` | Small Text, reqd | what the expense was for |
| `paid_to` | Data, optional | landlord/vendor/utility name — free text, not a Supplier link (most of these aren't real suppliers on file) |
| `amount` | Currency, reqd | |
| `payment_status` | Select: Paid / Unpaid, default Paid | Paid → posts against a bank/cash account immediately; Unpaid → posts against a payable account, settled later via a normal Payment Entry (same mechanism Purchase Invoice already uses) |
| `mode_of_payment` | Link → Mode of Payment, shown only when Paid | resolves to the actual bank/cash account, same as Payment Entry |
| `payable_account` | Link → Account, shown only when Unpaid, filtered to Payable-type | defaults to a company default if one exists |
| `attachment` | Attach, optional | receipt/bill photo — same pattern as the Document Attachment feature already on Q/SO/DN/SI item rows |
| `status` | Select: Draft / Approved / Rejected / Cancelled, read-only | see Approval below |
| `remarks` | Small Text, optional | approver's note |

### GL logic (on submit) — mirrors IB Credit/Debit Note exactly
```
DR expense_account                          amount
CR mode_of_payment's account (if Paid)      amount
   -- or --
CR payable_account (if Unpaid)              amount
```
One `make_gl_entries()` call, same helper the CN/DN doctypes already use. `on_cancel()` reverses the same way CN/DN already do (`ignore_linked_doctypes` for GL Entry etc., then the reversing GL pass).

### Approval — reuses this app's own established pattern, not a new mechanism
Two proven precedents already exist in this codebase for "someone drafts, someone else approves":
- **Role-gated submit** (IB Credit Note/Debit Note): creator role can create+write a Draft, a different role can Submit/Cancel/Amend — submission itself IS the approval, enforced by DocPerm, zero extra fields.
- **Explicit status + approve/reject buttons** (Advance Payment Approval, `instabiz/overrides/advance_approval.py`): a `status` field (Pending/Approved/Rejected) + a whitelisted `set_advance_approval()` method + UI buttons, used when the approval needs to be visible/trackable as its own step (not just "who has submit rights").

**Recommendation: role-gated submit**, matching CN/DN — simpler, no new whitelisted RPC, no new UI buttons to build, and this app already has the exact right role shape for it (see Permissions below). Flagging the alternative in case a visible "Approved by X on Y" audit trail is wanted instead — that's a small addition on top (explicit status/decided_by/decided_at fields + a Comment on approval, same shape as `set_advance_approval`), not a redesign, if preferred.

### Permissions
- **Accounts User**: create + write Draft only (matches Sales User's role on IB Credit Note).
- **Accounts Manager / System Manager**: full CRUD + submit/cancel/amend (the approval gate).
- No other role touches this doctype — general company expenses are Finance's own domain, unlike CN/DN which Sales also creates.

### Where it surfaces
- New "Company Expense" shortcut in **Instabiz Finance** workspace, Finance section (alongside Journal Entry/Payment Entry).
- New Script Report `IB Expense Register` (optional follow-up, not MVP) — same shape as `IB Credit Note Register`: date range, expense_account, location filters, bar chart, total.

### Explicitly out of scope for this pass
- Employee reimbursement claims (native `Expense Claim` stays unwired — a genuinely different feature: employee submits, is owed money back, needs its own approval-then-reimbursement flow via Payment Entry to the employee). Can be scoped separately if wanted later.
- A recurring/scheduled expense (e.g., auto-create monthly rent) — not asked for, would be a template-based scheduler addition on top of this doctype, not a redesign.
- Multi-line expenses (one IB Expense = one GL line pair) — if a single bill needs splitting across multiple expense accounts, that's a Journal Entry's job; IB Expense stays single-purpose/simple by design, matching the "quick to record a straightforward operational expense" goal.

## Migration & rollout
1. New doctype `IB Expense` (fixture-tracked).
2. `on_submit`/`on_cancel` GL logic in a new `instabiz/overrides/expense.py`, following `ib_credit_note.py`'s structure line-for-line where it overlaps.
3. Workspace shortcut in Instabiz Finance.
4. `bench migrate` → `bench build --app instabiz` → `bench restart`.

Zero risk to any existing doctype/flow — fully additive, no shared code paths with Sales/Purchase/Production.

## Open item before I build
**Payable account when Unpaid** — is there already a specific "Expenses Payable"-type account you use, or should it just be the same Accounts Payable used for suppliers? I don't want to guess a chart-of-accounts entry that might not match your real ledger structure.
