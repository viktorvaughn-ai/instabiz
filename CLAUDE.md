> **ALWAYS caveman before any work.** Invoke 
`caveman:caveman` skills at session start, before reading any file or writing any code.

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
**Stack:** Frappe v15 + ERPNext v15 + HRMS + Raven v2.8.11 (internal chat, installed 2026-07-02) + Frappe Drive  
**Site:** `frontend` — use in all `bench --site` commands  
**Bench root:** `/home/dev/frappe-bench/` — run all bench commands from here

### Raven (internal chat, installed 2026-07-02)
Stock Raven app, no custom instabiz code. All 22 System Users + Administrator have: `Raven User` role (Administrator also has `Raven Admin`), a `Raven Workspace Member` row on the `Raven` workspace, and a `Raven Channel Member` row on `Raven-general`. **Role Profile gotcha**: 5 users (`hr@`, `rutuja.dipak@`, `pooja.doliya@`, `amira.shaikh@`, `sales1@`) have a `role_profile_name` set (Sales/Sales Manager/HR Manager) — Frappe re-syncs `roles` to match the Role Profile on every save, silently dropping any role not in the profile. Adding `Raven User` directly to those users' `roles` table gets wiped on next save; had to add `Raven User` to the **Role Profile itself** (`Sales`, `Sales Manager`, `HR Manager`) for it to persist. If any user still can't see Raven, check `role_profile_name` first before re-adding the role. Server-side caches: `raven:workspace_members:{id}` and `raven:channel_members:{id}` (redis, via `raven.utils.delete_workspace_members_cache`/`delete_channel_members_cache`) — direct `frappe.get_doc(...).insert()` on `Raven Workspace Member`/`Raven Channel Member` (bypassing Raven's own API) does not invalidate these; call the delete helpers manually after bulk inserts.

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
3. **Employee Exit Handover** — scheduler creates handover docs on relieving_date; HR reassigns; user disabled on relieving_date+1. `run_exit_handover_daily()` filters `relieving_date <= today()` with **no status filter** (fixed 2026-07-02 — HR normally sets `status='Left'` at the same time as `relieving_date`, often backdated, so an exact-date + `status='Active'` filter silently missed 5 of 7 real exits; now mirrors the retry-safe pattern in `run_user_disable_daily`)
4. **Attendance / Check-in Portal** — employee self-service at `/checkin`
5. **New User Onboarding** — auto-creates Sales Person; copies admin defaults/UI settings on User.after_insert
6. **Custom Masters** — IB Branding, IB Transport, Lead Sales Team (with Member + Territory child tables)
7. **Role-based Data Isolation** — non-privileged users see only their own sales docs
8. **HRMS Payroll** — two salary structures (IB Payroll / Astro Payroll); Monthly frequency; PF/ESIC/PT deductions; salary assignments done. **Opt-in/out:** PF via `Employee.provident_fund_account` (blank = skipped), ESIC via `Employee.health_insurance_no` (blank = skipped; also auto-skips if `base > 21000`). **IB Payroll formulas:** B=`base×2/3`, HRA=`base×0.2`, CA=`base−B−HRA`; PF=`min(B+CA,15000)×12%`; ESIC=`(B+HRA)×0.75%` if base≤21000; PT=₹175 if base≤10000 else ₹200 (Male only, base≥7500). **Astro Payroll formulas:** 3 tiers — base>21k: B=`base×2/3`, HRA=`base/6`; base>11k: B=`base×10/13`, HRA=`base×1.5/13`; base≤11k: B=`base×10/11`, HRA=`B×5%`; CA=remainder; PF=`min(B+HRA,15000)×12%`; ESIC=`(B+HRA)×0.75%`; PT=₹200 flat (Male, gross≥10000).
9. **IB Stock Dashboard** — custom page (`ib-stock-dashboard`); live stock across 3 warehouses; filter chips; multi-token search + highlight; breakdown popover; CSV export; WebSocket live-updates
10. **IB Customer Board** — sales pipeline state machine; `ib-customer-board` (4-column kanban: Dormant/Regular/Today/Tomorrow); `ib-assignment-admin` (roster + view-as kanban + pool assign); 12am scheduler auto-assigns tomorrow's batch per user territory; SO submit auto-marks assignment done; `IB Customer Assignment` doctype + `IB Assignment Config` singleton
11. **Instabiz Workspaces (role-scoped, as of 2026-07-01)** — split into 5 separate Workspace docs, each restricted via Has Role: **`Instabiz`** (Sales User, Sales Manager, System Manager) — Dashboard, Business Pulse, Analytics Hub, Customer Board, Customer Health, Leads Pipeline, Sales Incentives, Quotation, Sales Order, Customer Master, IB Rate Card, Assignment Admin, Lead, Sales Invoice, Sample Request, Delivery Note, Live Stock Balance, AI Inbox/Actions/Agent Logs, n8n Console, sales reports (Daily Sales, Sales KPIs, Sales Person, Lost Deals, Territory, SKU Sales, Gross Margin, Collections, Credit/Debit Notes register, Activity Log, Dispatch), Knowledge Base. **`Instabiz Finance`** (Accounts User/Manager, Purchase User/Manager, System Manager) — Finance/Procurement/Collections Dashboards, Bank Import, Purchase Invoice/Order/Receipt, Payment Entry, PDC Cheques, IB Credit Note, IB Debit Note, Sales Invoice, Chart of Accounts, Journal Entry, Cost Center, General Ledger, Trial Balance, Accounts Dashboard, AR/AP Aging, Cash Flow, Bank Recon, Collections Report, Purchase Pipeline, Credit/Debit Notes register, Knowledge Base. **`Instabiz HR`** (HR User, HR Manager, HR Attendance Terminal User, System Manager) — HR Dashboard, Employees, Attendance Terminal, Org Chart, Leave Applications, Salary Slips, Overtime Requests, F&F Settlement, WA Broadcast, Payroll Summary, My HR, Knowledge Base. **`Instabiz Production`** (Factory Production, Factory Management, System Manager) — Production Dashboard/Stages, DPR Report, Work Orders, Machines, Order Sheets, Live Stock Balance, Stock Ledger, Production Report, Knowledge Base. **`Instabiz Stock`** (Stock User, Stock Manager, System Manager) — Live Stock Balance, Stock Ledger, Stock Ageing, Item, Material Request, Stock Entry, Knowledge Base. Files: `instabiz/instabiz/workspace/{instabiz,instabiz_finance,instabiz_hr,instabiz_production,instabiz_stock}/`. **Native ERPNext workspaces hidden** (is_hidden=1, everyone) to remove duplication: Stock, HR, Payroll, Accounting, Financial Reports, Payables, Receivables — their functionality is fully covered by the 5 Instabiz workspaces above. Left untouched (not duplicated): GST India, Tools, Users, Home, Welcome Workspace, Drive. **CRM was NOT actually hidden despite this entry previously claiming it was** — found live 2026-07-15: the native ERPNext CRM workspace had been renamed to "Instabiz CRM" (same underlying doc, `creation: 2020-01-23`, module `CRM`) but `is_hidden` was never set, so it sat visible (Sales User/Manager/System Manager) duplicating Lead/Quotation/Sales Order/Customer/Opportunity shortcuts already better-covered by the real `Instabiz` workspace. Hidden 2026-07-15. See item 96 for the full list of workspace/dashboard/production fixes from that session.
12. **IB Rate Card** — custom page `ib-price-list`; two tabs: Jumbo Roll (face_price / last_price) and Cut Pack (slab1–slab5); multi-token search, colour dots, spec tags, UOM chips; data source is `IB Rate Card Entry` doctype (track_changes=1); Sales Managers: Add Entry (toolbar), Edit row (✏ icon → dialog), view price History (🕐 icon → timeline); System Manager: Delete (🗑 icon); Cut Pack auto-syncs face_price=slab1 / last_price=slab5 on save; all price edits logged via Frappe Version (`get_price_history` reads _PRICE_FIELDS: face_price, last_price, slab1–5); dead code removed: old `get_item_price_list`, `_build_spec`, `_RATE_FIELDS`, `_parse_rate`, `_fmt_qty` (previously targeted unused `IB Item Price List` doctype — that doctype still exists with rate1–4 fields but the page no longer uses it)
13. **Dormant Customer Detection** — `instabiz/overrides/dormant.py`; daily scheduler; customers with no submitted SO in 60+ days → ToDo assigned to sales person + bell Notification Log with wa.me deep-link; dedup via `[ib-dormant-reminder]` marker in ToDo description; uses `transaction_date` not `posting_date`
14. **Sales Target Setting** — `IB Sales Target` doctype (sales_user, month, target_amount); `instabiz/overrides/sales_target.py`; `get_my_target()` / `get_all_targets()` whitelisted; Customer Board shows target progress card for current month (hidden when no target set); Assignment Admin roster shows Sales Target bar per user; daily scheduler sends bell notifications at 50%/75% month elapsed if behind pace + end-of-month if target not met; Sales Manager+ creates/edits targets
15. **Customer Health Score** — `instabiz/overrides/customer_score.py`; daily scheduler (`run_customer_score`); computes weighted score per active customer: payment punctuality 35%, order frequency 30%, complaint count 20%, CSAT rating 15%; stores in `IB Customer Score` doctype; status: Green ≥70, Amber ≥40, Red <40; if score drops ≥15 pts, emails all Sales Manager/System Manager; skips customers already scored today
16. **IB Sample Request** — doctype `IB Sample Request` (IB-SR-.YYYY.-#####); tracks sample dispatch lifecycle; fields: customer, contact_person, request_date, status (Draft/Work Order Created/Sent/Feedback Received/Converted/Closed), assigned_to, sample_type (Free/Paid), related_sales_order, item, qty, uom, is_paid, feedback, outcome (Converted/Not Interested/Follow Up/No Response), notes; validate() defaults request_date=today, assigned_to=session user
17. **Rate Contracts** — uses native ERPNext **Pricing Rules** (no custom code); one rule per customer+item; set "Applicable For = Customer", "Apply On = Item Code", "Price or Discount = Rate", valid_from/valid_upto for contract period; auto-applies on Quotation and SO in browser; `recalculate_items()` is safe — reads row rate as-is, never overwrites it; Q→SO mapper copies rate from Q row (if contract rate changes after Q submission, SO carries old rate — user must correct manually)
18. **Lead Scoring** — `instabiz/overrides/lead.py` `compute_lead_score()`; fires on Lead before_insert + on_update; score 0–100 from temperature (0/30/60) + status bonus (up to 30) + mobile/email/POI/follow-up date presence; stored in `custom_lead_score`
19. **Lead → Customer Conversion** — `custom_make_customer()` in lead.py overrides ERPNext make_customer; carries territory, custom_pincode→custom_bt_pincode, city, custom_district, lead_owner→custom_sales_person_user to new Customer; wired via override_whitelisted_methods
20. **Lead Status Change Audit** — `set_lead_status()` now logs Comment (type=Info) on every status change: "Status changed: old → new by actor"; visible on Lead timeline
21. **Fulfillment SLA** — `instabiz/overrides/fulfillment_sla.py`; daily scheduler; finds submitted SOs with no linked submitted DN after 48h; sends Notification Log to custom_sales_person_user; dedup via `[ib-sla-alert]` marker
22. **Win-back Nudges** — `instabiz/overrides/winback.py`; daily scheduler; (1) Open/Replied quotations with no activity in 14+ days → alert rep; (2) Leads in Cold/Contacted/Warm status with no activity in 30+ days → alert lead_owner; dedup via `[ib-winback]` marker
23. **IB Sales KPIs Report** — Script Report; per-rep metrics: Leads, Quotations, Orders, Lead→Q%, Q→SO%, Lead→SO%, Revenue, Avg Deal Size, Lost Deals; bar chart + summary cards; filters: date range, territory, sales person; NULL custom_sales_person_user rows excluded
24. **IB Daily Sales Report** — Script Report; single-date filter (default today); per-rep breakdown: New Leads, Quotations (count+value), Orders (count+value), Dispatches (count+value), MTD Revenue, MTD Target, MTD %; summary cards: Orders Today, Order Value, Dispatched Today, Collections Today (company-wide from Payment Entry), New Leads, Order Backlog (outstanding SO value), MTD Revenue, MTD vs Target %; bar chart top reps by order value; `instabiz/instabiz/report/ib_daily_sales_report/`
25. **IB Lost Deal Analysis Report** — Script Report; pulls lost Leads (custom_status=Lost) and lost Quotations (status=Lost); columns: source, loss_reason, sales_person, territory, month, count, value_lost, doc link; chart by loss reason; filters: date range, source, loss_reason, territory, sales person; date filter uses `DATE(l.modified)` not raw `l.modified` (datetime vs date comparison fix)
25. **SO Cancellation Enforcement** — `CustomSalesOrder.before_cancel()` throws if `custom_cancel_reason` is blank; field is Small Text, allow_on_submit=1, visible when docstatus≥1
26. **Margin % on Quotation** — `custom_valuation_rate` (hidden) + `custom_margin_pct` (read-only Percent) on Quotation Item; JS in form.js fetches valuation_rate from Item on item_code change, recomputes margin on rate change: `(rate - cost)/rate * 100`
27. **Floor Price Enforcement** — `_check_floor_price()` in utils.py; fires in Quotation.validate() + Sales Order.validate(); per-row: fetches `valuation_rate` + `custom_min_margin_pct` from Item; floor = valuation_rate × (1 + min_margin/100); Sales Manager/System Manager → msgprint warning; Sales User → frappe.throw blocks save
28. **Item Reorder Alert** — `instabiz/overrides/reorder_alert.py`; daily scheduler; queries tabBin vs tabItem Reorder (per-warehouse level) or Item.reorder_level; sends Notification Log to all Purchase Manager/Purchase User/System Manager users; dedup via `[ib-reorder]` marker, 7-day cooldown
29. **E-Way Bill Auto-Generate** — `instabiz/overrides/ewaybill.py`; fires on Delivery Note submit via doc_events; `_is_ewb_configured()` checks GST Settings API enabled + `enable_e_waybill` + `enable_e_waybill_from_dn` flags; `_sync_transporter_fields()` maps `custom_lr_number → lr_no`, IB Transport `custom_transport_gst → gst_transporter_id`; `run_ewaybill_on_submit(doc)` non-blocking — warns if not configured, skips DN returns, logs errors without throwing. `custom_generate_e_waybill` whitelisted override accepts `transaction_type` (int 1–4), `bill_from_address`, `dispatch_from_address`, `ship_to_address` (all Address link names); patches `EWaybillData.set_party_address_details` to override ship_from with warehouse address per `LOCATION_WAREHOUSE` mapping and apply explicit address overrides per txn type. E-waybill dialog (via `list_utils.js`): persistent `frappe.call` interceptor injects txn_type + address args on every `generate_e_waybill` call; Transaction Type selector (Regular/Bill To-Ship To/Bill From-Dispatch From/Combination) injected into dialog; conditional address fields (Bill From Address, Dispatch From Address, Ship To Address) rendered as native Frappe controls, shown/hidden per txn type selection, stacked vertically above Self Pickup checkbox. `LOCATION_WAREHOUSE` in `utils.py`: maharashtra→"MAHARASHTRA - IB", gujarat→"GUJARAT - IB", chennai→"CHENNAI - IB".
30. **PO Follow-Up Alert** — `instabiz/overrides/po_followup.py`; daily scheduler; finds submitted POs with no linked GRN (Purchase Receipt) after 7 days; sends Notification Log to Purchase Manager/Purchase User roles; dedup via `[ib-po-followup]` marker in Notification Log subject
31. **Auto-Absent Marking** — `instabiz/overrides/auto_absent.py`; daily scheduler; marks yesterday's active employees Absent if no Attendance record exists; skips weekends (weekday 5/6), skips holidays (checks `Holiday` child rows per employee's holiday_list), skips approved Leave Applications
32. **IB Overtime Request** — doctype `IB Overtime Request` (IB-OT-{YYYY}-{#####}); fields: employee (Link), employee_name (fetch), date, shift (Link→Shift Type), overtime_hours (Float), status (Draft/Pending Approval/Approved/Rejected), reason, approved_by (Link→User, read-only), approver_notes; validate() defaults date=today, throws if overtime_hours ≤ 0; roles: Employee create/write, HR Manager full
33. **IB Full Final Settlement** — doctype `IB Full Final Settlement` (IB-FFS-{YYYY}-{#####}); auto-computes on validate: `years_of_service` (date_diff/365), `gratuity_amount` (if ≥5 yrs: `(basic/26)*15*yos`, else 0), `leave_encashment` (if not manually set: `(basic/26)*pending_leaves`), `total_payable` (leave_encashment + gratuity + pending_expenses); status: Draft/In Review/Approved/Paid/Cancelled; roles: HR Manager create/write, HR User write/read
34. **Batch Tracking Auto-Set** — `instabiz/overrides/item.py` `set_batch_no_for_fg()`; fires on Item before_insert + before_save; sets `has_batch_no=1` when `item_group` is in `{BOPP, CLOTH, FOAM, SPECIALTY}`; 127 existing items backfilled via direct SQL on deploy
35. **Employee Custom Fields** — added to Employee via `custom_field.json`: `custom_emergency_contact` (Data), `custom_emergency_phone` (Data), `custom_notice_period_days` (Int, default=30), `custom_previous_employer` (Data), `custom_previous_ctc` (Currency), `custom_current_ctc` (Currency), `custom_location_state` (Select: Maharashtra/Tamil Nadu/Gujarat, in_standard_filter=1); all in IB section on Employee form
36. **Batch Expiry Alert** — `instabiz/overrides/expiry_alert.py`; daily scheduler; finds batches with expiry_date within 30 days where item has_expiry_date=1 and batch_qty > 0; sends Notification Log to Warehouse Manager/Stock User/Purchase Manager roles; dedup via `[ib-expiry]` marker, 7-day cooldown
37. **Comment Notification on Q/SO** — `instabiz/overrides/comment.py`; fires on Comment.after_insert; when a Comment is added to a Quotation or Sales Order, sends in-app Notification Log to the `custom_sales_person_user` of that doc; skips if commenter is the same person as the doc owner
38. **Dispatch Notification** — `instabiz/overrides/dispatch_notification.py`; fires on DN on_submit; sends bell notification to `custom_sales_person_user` with DN name, LR number (custom_lr_number or lr_no), and transporter name
39. **Quotation Expiry** — `instabiz/overrides/quotation_expiry.py`; daily scheduler; (1) sends expiry-warning notifications at 15/7/1 days before `valid_till` for Open/Replied quotations; (2) auto-expires quotations past `valid_till` (sets status=Expired if no conversion); dedup via doc-level marker
40. **Follow-Up Reminders** — `instabiz/overrides/follow_up.py`; daily scheduler; finds Leads with `custom_next_follow_up_date` < today in non-terminal status; sends bell notification to lead_owner; appends `custom_follow_up_note` if set
41. **IB Sample Request Transitions** — `instabiz/overrides/sample_request.py`; whitelisted methods for status machine: `mark_work_order_created`, `mark_sent`, `record_feedback`, `close_request`, `convert_to_order`; each validates state before transition
42. **Employee Setup Script** — `instabiz/overrides/create_employees.py`; one-time bench execute; creates HRMS Employee records from ERPNext Users; respects USER_OVERRIDE map for custom designations; dry_run mode supported
43. **M6 HR Masters** — configured directly in DB (not fixtures): **Departments** (IB-suffixed): Administration, HR, Despatch, Factory Management, Factory Production, Factory Administration, Warehouse, Engineering, Admin, Quality, Digital Marketing; **Shifts**: Morning, Afternoon, Night, General, Factory Shift, Standard Shift; **Leave Types**: Casual Leave, Sick Leave, Privilege Leave, Compensatory Off, Leave Without Pay, Maternity Leave, Paternity Leave; **HRMS Payroll**: IB Payroll and Astro Payroll salary structures with Basic/HRA/CA earnings + PF/ESIC/PT deductions — all components built and formula-driven (see feature #8 for formulas)
44. **Item Lifecycle (Discontinued)** — `custom_is_discontinued` (Check) field on Item via `custom_field.json`; `_check_item_lifecycle()` in `utils.py` fires in Quotation + Sales Order `validate()`; throws if any row's item_code has `custom_is_discontinued=1`; blocks both Q and SO from saving
45. **IB Jumbo Roll** — doctype for RM traceability; fields: supplier (Link), received_date, status (Select), batch_no, adhesive_lot, gsm, width_mm, length_mtr, liner_type (Select), notes; tracks each jumbo roll from receipt through production to consumption
46. **Packaging Specification on Item** — custom fields via `custom_field.json`: `custom_rolls_per_box` (Int), `custom_carton_weight_kg` (Float), `custom_carton_marking` (Text — printed on carton label); used for packing list on DN
47. **State-wise Holiday Lists** — three lists in HRMS: "Holiday List 2026 - Maharashtra", "Holiday List 2026 - Tamil Nadu", "Holiday List 2026 - Gujarat"; assign per employee by `holiday_list` field; `auto_absent.py` respects these when skipping absences
48. **Customer Credit Limit Enforcement** — `_check_credit_limit()` in `instabiz/overrides/sales_order.py`; fires on `CustomSalesOrder.before_submit`; reads `Customer Credit Limit` child table (credit_limit, bypass_credit_limit_check, custom_days); blocks SO submit only when BOTH conditions hold simultaneously: total outstanding > credit_limit AND oldest unpaid invoice older than custom_days; `bypass_credit_limit_check` skips the check per customer; error message includes formatted outstanding, limit, and days overdue
49. **Employee Drive Sync** — `instabiz/overrides/employee_drive.py`; Employee `after_save` enqueues background job; creates "HR Documents" Drive Team (once) + auto-adds all HR Manager/System Manager users as members; creates "Employee Documents" root folder → per-employee subfolder `{employee_name} ({employee_id})`; copies each `Employee Document` child row's attached file into the subfolder via `shutil.copy2`; stores Drive File entity name in `drive_file_id` field on child row (dedup guard); deleting row from ERPNext leaves Drive file intact; Employee form gets Drive → "Open in Drive" button (`instabiz/public/js/employee.js`) linking to `/drive/d/{folder_name}`; `get_employee_drive_folder()` whitelisted method powers the button; Drive hierarchy: HR Documents team → Employee Documents → {name} folder → {doc_type} - {filename}; **name change handling**: `_rename_employee_folder()` fires when `employee_name` changes on save — detects via `get_doc_before_save()`, enqueues background rename of Drive File title from old to new name
50. **Lead Activity Log** — `log_lead_activity(lead, activity_type, outcome, notes, next_follow_up_date)` whitelisted in `instabiz/overrides/lead.py`; validates type (Call/Meeting/WhatsApp/Email/Visit) and outcome (Positive/Neutral/Negative/No Answer); inserts Comment (type=Info) on Lead timeline with icon + outcome + notes + actor; optionally sets `custom_next_follow_up_date`; `instabiz/public/js/lead.js` refresh hook adds "Log Activity" button (hidden on new docs) → `frappe.ui.Dialog` with all 4 fields → calls whitelisted method → reloads form
51. **Lead Source Filter on IB Sales KPIs** — `source` filter (Link → Lead Source) added to `ib_sales_kpis.js`; `_data()` in `ib_sales_kpis.py` applies `l.source = %(source)s` to the leads query when filter is set; narrows per-rep conversion/revenue metrics to leads from that source
52. **IB Packing List** — Jinja print format on Delivery Note (`instabiz/instabiz/print_format/ib_packing_list/`); per-item: item_code, qty, uom, rolls/box (`Item.custom_rolls_per_box`), no. of boxes, carton weight (`custom_carton_weight_kg`), total weight, carton marking (`custom_carton_marking`); LR number in header; totals row; three signature lines footer
53. **IB Stock Ageing Report** — Script Report (`instabiz/instabiz/report/ib_stock_ageing/`); per-item/warehouse: qty, first receipt date (earliest SLE), age days, buckets 0-30/31-60/61-90/90+, valuation rate, stock value; bar chart by bucket; summary cards; filters: warehouse, item group; age column color-coded red/orange/yellow/green
54. **IB Dispatch Report** — Script Report (`instabiz/instabiz/report/ib_dispatch_report/`); per-DN for a date: customer, location, transporter, LR number, items summary, qty, value, sales person; bar chart by transporter; summary: dispatch count, total qty, total value, transporter count; filters: date, warehouse, sales person; location derived from `dn.set_warehouse` via `_location_from_warehouse()` using `LOCATION_CODE_MAP` (DN has no `custom_location` field — only Q and SO do)
55. **Vendor Payment Due Alert** — `instabiz/overrides/vendor_payment_alert.py`; daily scheduler `run_vendor_payment_alert()`; queries `tabPayment Schedule` rows on submitted POs with `due_date` within 7 days and `outstanding > 0`; sends Notification Log to Purchase Manager/Purchase User/System Manager; dedup via `[ib-vendor-pay-{po}-{date}]` marker in subject
56. **E-Invoice (IRN) Auto-Generate** — `instabiz/overrides/einvoice.py`; fires on Sales Invoice `on_submit` via doc_events; checks `india_compliance` `is_api_enabled` + `enable_e_invoice`; skips returns, debit notes, B2C (no GSTIN), already-IRN docs; calls `generate_e_invoice(docname, throw=False)`; non-blocking — warns on failure, logs to error log
57. **Overdue Invoice Alerts** — `instabiz/overrides/overdue_alert.py`; daily scheduler `run_overdue_alert()`; 3 tiers: 7d → bell to `custom_sales_person_user`; 15d → bell to rep + Sales Manager/System Manager; 30d → bell + sets `Customer.custom_overdue_block=1`; `_check_overdue_block()` in `sales_order.py` `before_submit` throws if flag set; dedup via `[ib-overdue-7/15/30-{name}]` markers; `custom_overdue_block` Check field added to Customer via fixtures
58. **IB AR Aging Report** — Script Report `instabiz/instabiz/report/ib_ar_aging/`; outstanding Sales Invoices bucketed 0-30/31-60/61-90/90+ days per invoice; bar chart; summary: count, customers, total outstanding, 90+ value; filters: customer, territory, sales person; age + 90+ bucket color-coded
59. **IB AP Aging Report** — Script Report `instabiz/instabiz/report/ib_ap_aging/`; outstanding Purchase Invoices bucketed 0-30/31-60/61-90/90+ days; bar chart; summary: count, suppliers, total payable, 90+ value; filter: supplier
60. **IB PDC Doctype** — `IB PDC` (IB-PDC-.YYYY.-.#####); fields: customer, customer_name (fetch), cheque_no, cheque_date, amount, bank_name, status (Pending/Presented/Cleared/Bounced/Cancelled), received_date, sales_invoice (Link), sales_person_user (auto-filled from SI); Roles: Sales User create/write, Sales Manager/Accounts User/System Manager full
61. **PDC Presentation Alert** — `instabiz/overrides/pdc_alert.py`; daily scheduler `run_pdc_alert()`; finds IB PDC with `cheque_date = today+3` and `status=Pending`; sends Notification Log to Accounts User/Manager, Sales Manager, System Manager, and linked `sales_person_user`; dedup via `[ib-pdc-{name}]` marker
62. **IB Territory Report** — Script Report `instabiz/instabiz/report/ib_territory_report/`; per-territory: leads, quotations, orders, revenue, avg_deal, conv_pct (Lead→SO %, color-coded green/orange/red), lost_leads; bar chart with Revenue + Orders datasets; summary: territories, total leads, orders, revenue; filters: from_date, to_date
63. **IB SKU Report** — Script Report `instabiz/instabiz/report/ib_sku_report/`; per-item: item_code, item_name, item_group, uom, orders, qty_sold, revenue, avg_rate, customers; bar chart top 10 by revenue; summary: SKUs sold, total orders, total qty, revenue; filters: from_date, to_date, territory, item_group
64. **IB Gross Margin Report** — Script Report `instabiz/instabiz/report/ib_gross_margin/`; per-item: qty_sold, revenue, cogs (qty×`i.valuation_rate` from Item master — NOT `soi.valuation_rate` which is always 0), gross_profit, margin_pct (color-coded green ≥30%/orange ≥15%/red <15%); bar chart Revenue vs Gross Profit top 10; summary: SKUs, revenue, gross profit, avg margin %; filters: from_date, to_date, territory, item_group, sales_person_user; revenue/cogs/gross_profit rounded to avoid float precision noise in chart tooltips
65. **Attendance Terminal Late/Early Reason** — `instabiz/instabiz/page/attendance_terminal/attendance_terminal.js`; `show_reason_dialog()` + `_is_late_in()` + `_is_early_out()` already existed with `custom_late_reason` on Employee Checkin (in fixtures + DB); fixed: dialog was showing for ALL check-ins (preventing data capture); now only fires when actually late (past shift_start + 10min grace) or early (before shift_end − 10min grace); normal check-in/out proceeds immediately; reason stored in `custom_late_reason` on Employee Checkin for analytics; employees without `default_shift` never trigger late/early detection
66. **Payment Entry Notification** — `instabiz/overrides/payment_entry.py` `_notify_accounts()`; fires on PE `on_submit` for both Receive and Pay types; bell notification to all enabled Accounts User / Accounts Manager / System Manager users; content: party name, formatted amount, reference no, doc name; dedup via `[ib-payment-{name}]` marker in subject
67. **Payment Entry Auto-Reconcile** — `instabiz/overrides/payment_entry.py` `_auto_reconcile()`; fires in `before_submit`; only for Receive PEs with empty references and party_type=Customer; finds open SIs for the customer (outstanding_amount > 0, docstatus=1), allocates FIFO oldest-first until PE amount exhausted; appends rows to `doc.references` then calls `doc.set_amounts()`; PEs already linked to invoices are skipped entirely
68. **Advance Payment Tracking on SO** — `custom_advance_paid` (Currency, read-only, allow_on_submit=1) on Sales Order after native `advance_paid`; label "Advance Received"; `_update_so_advance()` in `payment_entry.py` fires on PE `on_submit` + `on_cancel`; sums all submitted Receive PEs referencing that SO via `tabPayment Entry Reference`; use by creating PE with `reference_doctype=Sales Order` before raising SI
69. **IB Collections Report** — Script Report `instabiz/instabiz/report/ib_collections_report/`; per-rep: invoice count, invoiced ₹, collected ₹ (grand_total − outstanding_amount), outstanding ₹, collection % (color-coded green ≥75%/orange ≥40%/red <40%); 3-dataset bar chart (Invoiced/Collected/Outstanding); summary: total invoiced, collected, outstanding, overall collection %; filters: from_date (default month start), to_date (default today), territory, sales_person_user, chart_type
70. **IB Tax Invoice Print Format** — Jinja2 print format at `instabiz/instabiz/print_format/ib_tax_invoice/`; 2-page output: Page 1 = Tax Invoice (IRN+QR block via `get_qr_code(einv.signed_qr_code)`, company+consignee+buyer left, meta-grid right, items table with per-row GST rate from `item_tax_rate` JSON, CGST/SGST/IGST tax rows, grand total, amount in words, declaration+bank+signature); Page 2 = e-Way Bill (QR via `get_e_waybill_qr_code(ewbNo,userGstin,ewayBillDate)`, 5 sections: EWB details, address details From/To + Dispatch/ShipTo, goods table from `ewb.itemList`, transport details, vehicle details); e-Waybill Log fetched from `e-Waybill Log` doctype via `reference_name=doc.name` (SI), falls back to linked DN; bank details hardcoded (HDFC, A/c 50200023672503, IFSC HDFC0000627); Prev Balance = sum of other outstanding SIs for customer; `frappe.utils.fmt_money(v, precision=2)` for Indian comma format; `frappe.utils.formatdate(d, "dd-MMM-yy")` for date display
71. **IB Credit Note Register** — Script Report `instabiz/instabiz/report/ib_credit_note_register/`; all submitted SI returns (is_return=1); columns: date, credit note, original invoice, customer, territory, sales person, items (concatenated), return value (ABS grand_total), custom_return_reason, status; bar chart top 10 customers by return value; summary: count, total value, unique customers, avg return value; filters: from_date, to_date, customer, territory, sales_person_user
72. **IB Payroll Summary** — Script Report `instabiz/instabiz/report/ib_payroll_summary/`; per-employee payroll breakdown using latest Salary Structure Assignment; mirrors IB Payroll / Astro Payroll formulas (same as feature #8) to compute Basic/HRA/CA/Gross/PF/ESIC/PT/Net; when `payroll_month` filter set: prorates all amounts by present_days/days_in_month (IB Payroll: 2-day leave credit reduces effective absent days); absent_days sourced from submitted Salary Slips first, falls back to Attendance records; filters: payroll_month, emp_category (All/Factory/Office), salary_structure; Factory = department LIKE '%%Factory%%'
73. **IB Sales Person Summary** — Script Report `instabiz/instabiz/report/ib_sales_person_summary/`; per-rep: order count, total revenue, avg order value, max order value from submitted SOs; sales person display resolves custom_sales_person → User.full_name → custom_sales_person_user; filters: from_date, to_date, sales_person_user, status, territory; bar chart + summary (sales persons, total orders, total revenue)
74. **Bank Account Master** — two HDFC bank accounts configured in DB: `GUJARAT & MAHARASHTRA - HDFC` (A/c 50200023672503, IFSC HDFC0000627) linked to GL `50200023672503 - HDFC - MH & GJ - IB`; `CHENNAI - HDFC` (A/c 50200044619421) linked to GL `50200044619421 - HDFC - Chennai - IB`; both `is_company_account=1`; `default_bank_account` set to `GUJARAT & MAHARASHTRA - HDFC` on Company master (set 2026-05-25)
75. **IB Bank Reconciliation** — Script Report `instabiz/instabiz/report/ib_bank_reconciliation/`; shows submitted Payment Entries for IB bank GL accounts (MH+GJ and Chennai) in date range; resolved bank account via GL account reverse-map; `clearance_date` set by ERPNext native bank recon tool when Bank Transaction matched to PE; columns: date, PE name, type, party, bank account, amount, ref no, clearance date, status (Cleared/Uncleared), days pending; bar chart Cleared vs Uncleared; summary: total entries, cleared count, uncleared count, uncleared amount, uncleared >7 days; filters: bank_account, from_date (default month start), to_date (default today), show_cleared, chart_type; ERPNext native bank recon tool at Accounts → Banking and Payments → Bank Reconciliation Tool handles actual statement import + matching
76. **GSTR-1 (india_compliance)** — native india_compliance tool, no custom code. Two interfaces: (1) `GSTR-1 Beta` (Single Doctype at `/app/gstr-1-beta`) — select Company + GSTIN + Year + Month → click Recompute → generates B2B/CDNR/HSN/Document Issued summary from submitted SIs; uses `GST Return Log` as cache (key: `GSTR1-{period}-{gstin}`); supports Download Excel, Download JSON, Upload to GST portal (requires `enable_gstr_1_api=1` in GST Settings — already enabled); (2) `GSTR-1` Script Report (older interface, same data). Accessible via GST India workspace. Tested 2026-05-25: MH GSTIN May 2026 → 2 B2B docs, taxable ₹5,43,600, IGST ₹97,848 — correct. `enable_gstr_1_api=1`, `enable_api=1`, `sandbox_mode=0` in GST Settings.
77. **GSTR-3B (india_compliance)** — native india_compliance tool, no custom code. `GSTR 3B Report` Doctype: create with Company + GSTIN + Year + Month → generates JSON (key `GSTR3B-{Month}-{Year}-{gstin}`) with outward supply details (sup_details), ITC eligibility (itc_elg), inter-state supplies (inter_sup), inward supplies (inward_sup); table has 20 columns, `generation_status` field shows "Generated" on success; HTML form renders the 3B layout; can download JSON for portal upload. `GSTR-3B Details` Script Report also available (older interface). Accessible via GST India workspace → GSTR-3B shortcut. Tested 2026-05-25: MH GSTIN May 2026 → osup_det txval ₹5,43,600 IGST ₹97,848 — matches GSTR-1 exactly.
78. **GSTR-2B Download & Match (india_compliance)** — native `Purchase Reconciliation Tool` (Single Doctype at `/app/purchase-reconciliation-tool`). Two download paths: (1) API download via `download_gstr_2b()` — fetches from GST portal using stored credentials (MH 27AAECI3431Q1Z8 live; GJ/TN pending NIC registration); (2) Manual JSON upload via `upload_gstr()` — download JSON from GST portal manually and upload. Downloaded data stored in `GST Inward Supply` (61-col table). Auto-matches against submitted Purchase Invoices. `enable_auto_reconciliation=1`, `reconcile_for_b2b=1` in GST Settings already set. `GSTR Import Log` table tracks download history. Accessible via GST India workspace → Purchase Reconciliation Tool shortcut. Currently 0 purchase invoices + 0 GST Inward Supply rows (AP module not yet set up); tool will populate once PIs are entered and GSTR-2B downloaded for the period.
80. **IB Cash Flow Statement** — Script Report `instabiz/instabiz/report/ib_cash_flow_statement/`; GL-entry based (queries `tabGL Entry` for all bank/cash accounts: HDFC MH+GJ, HDFC Chennai, Cash - IB); filters `is_cancelled=0` to exclude reversal entries; LEFT JOIN `tabPayment Entry` for party info on PE-type vouchers; columns: date, category, voucher type, voucher (dynamic link), party, description, inflow, outflow, running balance; opening balance computed from all GL entries before from_date; categorization: PE+Customer→"Customer Collections", PE+Supplier→"Vendor Payments", PE+Employee→"Salary & Wages"; JE categorized by keyword scan on `remarks` (salary/payroll, rent/travel/marketing→"Operating Expenses", loan/od/drawdown→"Financing", tax/gst/tds→"Tax Payments", cash deposit/contra/inter→"Inter-account"); formatter colors inflow green, outflow red, negative balance red; bar chart inflow vs outflow by category; summary cards: Opening Balance, Total Inflows, Total Outflows, Net Cash Flow, Closing Balance; filters: bank_account (Link, optional — blank = all 3 accounts), from_date (default month start), to_date (default today), chart_type. Tested 2026-05-25: 19 rows, inflows ₹10,47,747 outflows ₹5,31,000 net ₹5,16,747 closing ₹5,16,747 — correct.
79. **IB Bank Statement Import** — custom page `ib-bank-statement-import` at `instabiz/instabiz/page/ib_bank_statement_import/`; accepts HDFC NetBanking CSV format; two backend methods: `preview_statement(bank_account, csv_text)` → parses and returns rows for client preview; `import_statement(bank_account, csv_text)` → creates submitted `Bank Transaction` records. Parser handles: HDFC header junk (finds row with "Date"+"Narration" to skip account-info lines), Indian number format (commas in amounts like "1,80,000.00"), DD/MM/YYYY dates, multiple date formats, trailing summary rows (skips rows where deposit=0 AND withdrawal=0). Duplicate guard: checks bank_account + date + deposit + withdrawal + reference_number before insert. Frontend: drag-and-drop upload zone, preview table with deposit/withdrawal summary chips, Import button, result card with created/skipped counts + link to native Bank Reconciliation Tool. Roles: Accounts User, Accounts Manager, System Manager. **Full recon chain**: Import CSV → `Bank Transaction` records created (status=Unreconciled) → user goes to native Bank Reconciliation Tool (`/app/bank-reconciliation-tool`) → matches Bank Transactions to Payment Entries → sets `pe.clearance_date` → IB Bank Reconciliation report (feature 75) shows those PEs as Cleared. Tested 2026-05-25: imported 10-row HDFC statement, 10 Bank Transactions created (ACC-BTN-2026-00001 to -00010); duplicate re-import correctly skipped all 10.
81. **Purchase Module Overrides** — `instabiz/overrides/purchase_order.py`, `purchase_receipt.py`, `purchase_invoice.py`; custom naming: `IB-{LOC}-PO-#####`, `IB-{LOC}-GRN-#####`, `IB-{LOC}-PINV-#####`; auto GST template swap based on company vs supplier GSTIN state (in-state/out-state/RCM); templates: `Input GST In-state - IB`, `Input GST Out-state - IB`, `Input GST RCM In-state - IB`, `Input GST RCM Out-state - IB`; `custom_location` auto-set from set_warehouse; cost center set per-row from location; cancel requires `custom_cancel_reason`; SQMT rate recalc on PO items via `ib_purchase_common.js` (Rate/SQMT → Rate per ROLL = sqmt_rate × conversion_factor); JS auto-selects GST template on supplier/address/GSTIN change.
82. **Salary Slip Override** — `instabiz/overrides/salary_slip.py` `CustomSalarySlip`; overrides `calculate_net_pay` for IB Payroll only: credits 2 days (`_MONTHLY_LEAVE_CREDIT=2.0`) back to `payment_days` when employee has absent/LWP days (reduces deduction by 2 days max). Other salary structures use standard HRMS logic.
83. **WhatsApp Integration** — `instabiz/overrides/whatsapp.py`; uses OpenWA (local WA gateway at `frappe.conf.openwa_url`); `IB WA Session` doctype (session_id, phone, status: Connected/Disconnected/QR Pending); `IB WA Template` doctype (template message with `{customer}`, `{name}`, `{territory}`, `{contact}`, `{last_order}` vars); `IB WA Log` doctype (customer, phone, template, message, status, ref doc); whitelisted: `send_whatsapp(customer, template_name, ref_doctype, ref_docname)` — sends text + optional PDF attachment; `get_session_qr(session_id)` — creates/starts session, returns QR base64; `sync_session_status(session_id)` — polls OpenWA for Connected/Disconnected state; daily scheduler `run_wa_dormant_blast()` — sends WA re-engagement to customers with no SO in 30+ days via assigned rep's session (30-day dedup); print format per doctype: DN → IB Packing List, SI → IB GST Tax Invoice; `ib_wa_session.js` on WA Session form; `whatsapp_dialog.js` loaded globally — `ib_show_wa_dialog()` UI.
84. **Production Module** — `instabiz/overrides/production.py`; doctypes: `IB Machine` (machine_type, status: Active/Inactive/Maintenance, location), `IB Work Order` (order_sheet, sales_order, item_code, stage, priority, status: Pending/In Progress/Completed/On Hold, machine, operator, target_qty, completed_qty, wastage_qty, started_at, completed_at), `IB Production Entry` (production log), `IB Order Sheet` (sales_order link, items table, status, priority); stages: Coating → Slitting → Rewinding → Cutting → Packing → Ready to Deliver → Delivered; whitelisted: `get_production_dashboard()` (summary KPIs + stage pipeline + priority_overview + avg_wastage + recent_entries), `get_stage_pipeline()`, `get_recent_entries()`, `create_order_sheet(sales_order)`, `update_work_order_stage(name, stage, machine, notes)`, `complete_work_order(name, completed_qty, wastage_qty, notes)`, `get_dpr_data(date)` (DPR = Daily Production Report); pages: `ib-production-dashboard`, `ib-production-stages`, `ib-dpr`, `ib-org-chart`; report: `ib_production_report`; daily scheduler `run_daily_production_snapshot()` — **not a placeholder** (corrected 2026-07-15; this entry previously said "reserved for future DPR caching," which was wrong): runs nightly at 00:01, finds submitted SOs from the last 30 days with no Order Sheet yet, derives priority from delivery urgency (≤2d Urgent, ≤5d High, ≤10d Normal, >10d Low), and calls `create_order_sheet()` per SO — which itself calls `auto_create_all_stage_wos()` and assigns the first-stage machine. Verified live 2026-07-15: 15 Order Sheets + full WO chains auto-created overnight, 7/7 recent Scheduled Job Log runs Complete, zero errors. Latent unfixed risk: if WO auto-creation fails partway through for one SO, the Order Sheet is already committed (insert+commit happens before the WO auto-create call) and gets permanently excluded from the next night's re-scan (`WHERE so.name NOT IN (SELECT sales_order FROM tabIB Order Sheet ...)`) — no reconciliation exists for a partially-orphaned Order Sheet. Not observed in practice as of this check. **Model clarified**: `IB Order Sheet` = one per Sales Order, the unit users create/open (production job ticket, header + item list). `IB Work Order` = one per item-per-stage, auto-created in full chain by `create_order_sheet()` → `auto_create_all_stage_wos()` (route-aware via `_get_stage_route`, skips inapplicable stages); `sales_order` on WO is a read-only fetch from `order_sheet.sales_order` (now shown `in_list_view`). Users should not need to open the raw WO list — the **"Work Orders" DocType shortcut was removed from Instabiz Production workspace** (2026-07-01); Production Stages page (`ib-production-stages`, tabs: pipeline/item_wise/order_wise/machine_wise/job_bundles) is the single entry point for all WO-level work; Order Sheets list stays as the shortcut for the header unit. Machine efficiency: `_assign_machine_load_balanced()` auto-assigns least-loaded machine per stage on WO creation/advance; `get_job_bundles()` groups Pending WOs sharing item+stage across order sheets so multiple SOs can be batch-run on one machine (`batch_assign_machine()`). **Icon rendering bug fixed** (2026-07-01, extended 2026-07-02): several pages called `frappe.utils.icon()` (Frappe's own ~178-symbol sprite, e.g. `add`/`expand`/`filter`) with Lucide icon names (`layers`/`check-circle`/`settings-2`/etc.) that don't exist in that sprite → blank icons. Fixed in `ib_production_dashboard.js`, `ib_production_stages.js`, `ib_dpr.js`, and `ib_org_chart.js` (2026-07-02 — 4 toolbar buttons: Expand All/Collapse All/Export PNG/Fit to Screen) by switching to `<iconify-icon icon="lucide:...">`. **Test data reset** (2026-07-01): all WO/Order Sheet data wiped and rebuilt from 10 curated real SOs spanning both locations (MAHARASHTRA/GUJARAT) × item-count extremes (1 to 24 lines) × qty extremes (1 to 143375) — production is still in testing, not live. **Two severe bugs fixed 2026-07-02** (found via deep bug-hunt re-audit, see `instabiz/overrides/production.py`): (1) `complete_work_order()`/`advance_to_next_stage()` passed raw `doc.completed_qty` (always 0 — `IB Production Entry` is intentionally unused, see item 84a below) into `_update_order_sheet_item()` instead of falling back to `target_qty`; result: **0 Order Sheet Items and 0 Order Sheets had ever reached "Completed" status**, verified against 47 real Completed WOs. Now falls back to `target_qty` and persists it onto the WO's own `completed_qty` too. (2) `complete_work_order()`, `advance_to_next_stage()`, `start_work_order()`, `put_on_hold()`, and `_update_order_sheet_progress()` all used `frappe.db.set_value()` to change status — **this bypasses Frappe Document events entirely** (confirmed via Frappe core docstring: "will not call Document events"). The `IB Work Order.on_update` hook (wired to `on_work_order_update_notify` — the Ready-to-Deliver bell to the sales person — and n8n's `on_work_order_update` webhook) never fired from any real production-completion path; verified 25 WOs had reached Ready-to-Deliver+Completed with **0 RTD notifications ever sent**, and n8n never received `work_order_started`/`work_order_stage_completed`/`work_order_rtd`/`order_sheet_completed` events despite `n8n_webhook_url` being live-configured. Fixed by explicitly calling `on_work_order_update_notify()` / `n8n_hooks.on_work_order_update()` / `n8n_hooks.on_order_sheet_updated()` at every `frappe.db.set_value` status-transition call site. Also fixed: advisory lock (`GET_LOCK('IB-OS-{so}')`) in `create_order_sheet()` was only released in the duplicate-check exception branch — any later failure (SO fetch, doc.insert, WO auto-create) leaked the lock for the life of the DB connection; now wrapped in try/finally.
85. **IB Activity Log Report** — Script Report `instabiz/instabiz/report/ib_activity_log/`; pulls all Lead timeline Comments (type=Info) as activity log; columns: date, lead, customer, activity_type, outcome, notes, actor, next_follow_up; filters: from_date, to_date, sales_person_user, activity_type, outcome; 378 rows as of June 2026.
86. **IB Purchase Pipeline Report** — Script Report `instabiz/instabiz/report/ib_purchase_pipeline/`; submitted POs with status/receipt/invoice linkage; filters: from_date, to_date.
87. **Broadcast** — `instabiz/overrides/broadcast.py` + `ib-broadcast` page + `IB Broadcast Log` + `IB Broadcast Ack` doctypes; `broadcast.js` on frontend; System Manager only; sends bulk messages/announcements to users.
88. **IB Customer Item Spec** — doctype tracking customer-specific item specifications; links customer + item + spec details.
89. **AI Agents + AI Inbox** — `instabiz/overrides/ai_agents.py`; 6 human-in-the-loop AI agents powered by Claude (claude-haiku-4-5-20251001); agents write pending `IB AI Action` docs; human approves/rejects in AI Inbox page (`ib-ai-inbox`). Agents: (1) `auto_quote` — qualified leads (score>30, **`custom_product_of_interest`** set) → draft Quotation (uses `quotation_to="Lead"` with lead name as `party_name`); (2) `demand_forecast` — 12-week SI item velocity → 4-week SKU forecast card (reference_doctype=None to avoid link validation); (3) `smart_reorder` — joins `tabItem Reorder` child table (`warehouse_reorder_level`) — **NOT `tabItem.reorder_level`** which doesn't exist — finds items where actual_qty ≤ reorder level → draft Material Request with all required fields (`company`, `transaction_date`, `stock_uom`, `uom`, `conversion_factor`, `warehouse` from Stock Settings); (4) `collections` — overdue SI (outstanding > 0, due_date < today) → Claude-toned WhatsApp dunning message; (5) `istix_enforcer` — IB Work Orders in-progress ≥ 8h without completion → escalation bell notification; (6) `buying_dna` — customers last ordered > 1.2× avg cycle days ago → CRM follow-up suggestion. On approval: auto_quote creates draft Quotation (Lead party); smart_reorder creates draft Material Request with full item fields; collections sends WA message via OpenWA; istix_enforcer sends Notification Log bell. All agents: dedup (one pending per agent+reference per day), audit trail in `IB Agent Run Log`. Daily scheduler: `run_daily_agents`. Manual: `run_all_agents()` / `run_agent(agent_code)`. LLM wrapper: `instabiz/overrides/llm.py` (gracefully returns None if no key or no credits → deterministic fallback always works). **Doctypes**: `IB AI Action` (IB-AIA-.YYYY.-.#####; fields: agent, action_type, status, title, summary, draft_json, reference_doctype, reference_name, ai_generated, decided_by, decided_at), `IB Agent Run Log` (IB-ARL-.YYYY.-.#####; fields: agent_code, trigger_type, status, run_at, duration_seconds, records_processed, actions_taken, summary_json, error_details). **Whitelisted**: `run_all_agents`, `run_agent(agent_code)`, `get_ai_actions(status, agent)`, `approve_action(name)`, `reject_action(name)`, `get_ai_status`. **Config** (site_config.json): `anthropic_api_key` = Claude API key; `n8n_webhook_url` = n8n webhook URL. Workspace shortcuts: AI Inbox (Page), AI Actions (IB AI Action list), Agent Logs (IB Agent Run Log list). AI Inbox shows: agent badge, Claude badge if AI-generated, approve/reject buttons, draft JSON preview, reference link, decision audit.
90. **n8n Workflow Automation** — n8n v2.26.9 installed globally via npm; PM2-managed at `/home/dev/n8n-data/ecosystem.config.js`; port 5678; n8n UI at `http://localhost:5678`. Integration module: `instabiz/overrides/n8n_hooks.py`; doc_events on `IB Work Order.on_update` and `IB Order Sheet.after_insert` fire webhook POST to `frappe.conf.n8n_webhook_url`; payload: event name + doc fields + site name; fire-and-forget (5s timeout, logs error if fails). To wire: set `n8n_webhook_url` in site_config.json to n8n's "Webhook" node URL; create n8n workflow with Webhook → process → optional Frappe API callback. PM2 start: `pm2 start /home/dev/n8n-data/ecosystem.config.js`. Env: `N8N_PORT=5678`, `GENERIC_TIMEZONE=Asia/Kolkata`.
91. **IB Knowledge Base** — Interactive in-app knowledge base at page `ib-knowledge-base` (`instabiz/instabiz/page/ib_knowledge_base/`); searchable cards for all 90+ features; clickable Sales Workflow steps (Q→SO→DN→SI→Payment) open step-by-step how-to panels; feature sections with expand/collapse, action links, step lists, notes/tips; full-text multi-token search with highlight; quick-link grid to key pages; PDF download button links to `/files/instabiz_knowledge_base.pdf`; workspace shortcut added in "HELP & KNOWLEDGE BASE" section at bottom of Instabiz workspace. PDF generated via wkhtmltopdf at `apps/instabiz/instabiz_knowledge_base.html` → `sites/frontend/public/files/instabiz_knowledge_base.pdf`. All roles can access.
92. **Lead Territory Auto-Derivation (Enhanced)** — `instabiz/overrides/lead.py`; `set_territory_from_pincode()` enhanced: (1) if `custom_gstin` is set on Lead, extracts first 2 digits, maps via `_GSTIN_STATE_MAP` dict (27→Maharashtra, 33→Tamil Nadu, 24→Gujarat, etc.) to Frappe Territory — overrides any existing wrong territory; (2) if no GSTIN, falls back to pincode API (only if territory not already set); `_territory_from_gstin(gstin)` and `_territory_from_pincode(pincode)` as reusable helpers. Bulk fix: `rectify_lead_territories(dry_run=True)` @whitelist — scans all non-converted non-junk leads, re-derives territory using GSTIN→pincode priority, returns list of changes; dry_run=1 (default) only reports without writing; dry_run=0 writes updates. Call from bench console: `frappe.call("instabiz.overrides.lead.rectify_lead_territories", {"dry_run": 0})`.
93. **IB Credit Note** — Custom doctype `IB Credit Note` (IB-CN-{YYYY}-{#####}) in module `Instabiz`; replaces the old `cn_dn_manager` external app (uninstalled 2026-06-26); customer-side credit for Sales Return / Rate Difference / Post Sale Discount. Fields: company, customer, posting_date, status, reason_code, against_sales_invoice, items (Table→IB Credit Note Item), taxes_and_charges (Link→Sales Taxes and Charges Template), total_taxes_and_charges (computed), total, grand_total, outstanding_amount, remarks, amended_from. Child table `IB Credit Note Item`: item_code, item_name, qty, rate, amount, warehouse, income_account, against_si_item. **Validation**: qty>0 enforced; income_account required; `against_sales_invoice` mandatory for Sales Return; sum of all submitted CNs against one SI cannot exceed SI grand_total (0.01 tolerance for rounding); per-SI-item duplicate check (same `against_si_item` row → only one submitted CN). **Tax calc**: `_set_taxes()` expands Sales Taxes and Charges Template — On Net Total rows: `total × rate / 100`; Actual rows: as-is; `grand_total = total + total_taxes_and_charges`. **GL on submit**: per item: DR income_account / CR AR; per tax row: DR tax_account / CR AR. **SLE on submit** (Sales Return only): stock received back at item `valuation_rate`; actual_qty positive. **JS** (`public/js/ib_credit_note.js`): on `against_sales_invoice` change → auto-fills customer, taxes_and_charges, and items from SI; live tax preview via `frappe.db.get_doc`; `item_code` change → auto-fetches income_account from Item Default. **Roles**: Sales User (create/write/draft), Sales Manager + Accounts Manager + System Manager (submit/cancel/amend). Workspace Finance section: "Credit Note" shortcut → IB Credit Note list.
94. **IB Debit Note** — Custom doctype `IB Debit Note` (IB-DBN-{YYYY}-{#####}) in module `Instabiz`; supplier-side debit for Purchase Return / Rate Difference / Post Purchase Discount. Fields mirror IB Credit Note but for supplier: company, supplier, posting_date, status, reason_code, against_purchase_invoice, items (Table→IB Debit Note Item), taxes_and_charges (Link→Purchase Taxes and Charges Template), total_taxes_and_charges, total, grand_total, outstanding_amount, remarks, amended_from. Child table `IB Debit Note Item`: item_code, item_name, qty, rate, amount, warehouse, expense_account, against_pi_item. **Validation**: same as CN but against Purchase Invoice and supplier match. **Tax calc**: same pattern using Purchase Taxes and Charges Template. **GL on submit**: per item: DR AP / CR expense_account; per tax row: DR AP / CR tax_account (ITC reversal). **SLE on submit** (Purchase Return only): stock sent back, actual_qty negative. **JS** (`public/js/ib_debit_note.js`): on `against_purchase_invoice` change → auto-fills supplier, taxes_and_charges, and items from PI. **Roles**: Purchase User (create/write/draft), Purchase Manager + Accounts Manager + System Manager (submit/cancel/amend). Naming uses `IB-DBN-` prefix (NOT `IB-DN-`) to avoid visual confusion with Delivery Note `IB-{LOC}-DN-` series. Workspace Finance section: "Debit Note" shortcut → IB Debit Note list.
95. **IB Debit Note Register** — Script Report `instabiz/instabiz/report/ib_debit_note_register/`; queries `tabIB Debit Note` (docstatus=1); columns: posting_date, name, against_purchase_invoice, supplier, reason_code, items (GROUP_CONCAT), total, total_taxes_and_charges, grand_total, status; bar chart top 10 suppliers by debit value (orange); summary: count, total value, unique suppliers, avg debit value; filters: from_date, to_date, supplier, reason_code, chart_type. Workspace: "Debit Notes" report shortcut in REPORTS — SALES section beside "Credit Notes".
96. **Production/HR/Dashboard bug-fix + Cutting Seat Map session (2026-07-15)** — Large multi-part session. **Workspace fixes** (all verified live in DB, all 5 workspace JSONs — note: Workspace docs require `bench import-doc <path>` to force-resync after edit, `bench migrate` alone silently no-ops if the JSON's `modified` timestamp isn't bumped): removed dead "Work Orders" raw-list shortcut from Instabiz Production (contradicted item 84's own "single entry point" claim — had regressed back in); fixed Instabiz HR's "Attendance Terminal" shortcut which pointed to the wrong thing entirely (native `Employee Attendance Tool` doctype instead of the real custom page `attendance-terminal`) — the `HR Attendance Terminal User` role had zero path to its own feature; added "Biometric Import" and direct "Attendance" list shortcuts to HR workspace; hid "PDC Cheques"/"Credit Note" shortcuts in Finance workspace from roles with no actual doctype permission on them (`restrict_to_role`); renamed Sales workspace's "Collections" report shortcut → "Collections Report" (was colliding in label with Finance's separate "Collections" dashboard page); added missing "Lead Sales Team"/"Sales Target" masters to Sales workspace and "Jumbo Rolls" to Stock workspace (both had real DB permissions but zero nav path anywhere); added System Manager permission rows to `IB Overtime Request`/`IB Full Final Settlement` doctypes (both missing it entirely, unlike every other custom doctype in the app); deleted a stray empty `page/customer_assignment/` dir. Hid the **"Instabiz CRM" workspace** (see item 11 amendment) — the native ERPNext CRM workspace, renamed but never actually hidden despite item 11 previously claiming it was. **Dashboard bugs fixed**: `ib_hrms_dashboard.py` `get_hrms_data()` had no role check at all (any logged-in user could pull company-wide salary data) — added `frappe.only_for(["HR Manager","HR User","Factory Management","System Manager"])`; added `by_designation` (job-role headcount) query, previously entirely missing; JS had `absent_today` computed server-side but never rendered, and the department-breakdown bars were commented out — both fixed, plus a new Absent-Today KPI card; "Present Today" card routed to `List, "Attendance Terminal"` (a Page slug, not a doctype — dead link) → fixed to `List, "Attendance"`. `get_production_dashboard()`'s `wastage_today`/`recent_entries` queried `IB Production Entry`, confirmed to have **zero rows ever** (see below) — repointed to source from `IB Work Order` instead (real data). `ib_main_dashboard.py` and `ib_business_pulse.py` both had a "Low / Zero Stock" card whose query required `reserved_qty > 0`, silently excluding plain zero-stock items with no open reservation and any genuinely-low-but-positive stock — both fixed to match the real reorder-level definition already used in `reorder_alert.py` (`actual_qty <= tabItem Reorder.warehouse_reorder_level`). **Production race conditions fixed** in `production.py`: `start_work_order`, `complete_work_order`, `put_on_hold`, `advance_to_next_stage` now hold a `GET_LOCK('IB-WO-{name}', 5)` advisory lock (same pattern as `create_order_sheet`'s existing OS-level lock) so two concurrent calls on the same WO can't both pass a status check before either write lands; `link_jumbo_roll_to_wo` had a genuine TOCTOU double-link race (check-then-set with no lock) — same fix, keyed `IB-JR-{roll}`. `batch_assign_machine` previously had **no capacity check at all** (unlike the separate `_assign_machine_load_balanced` suggestion function) — now throws if assigning would exceed `IB Machine.capacity`. `create_work_orders_for_item` and `get_job_bundles` were whitelisted with no `_require_production_role()` check — `get_job_bundles` was leaking cross-customer sales data to any logged-in user; both fixed. **Attendance root-cause fix** (real bug, not the biometric-import theory originally suspected): 4 office/Sales employees (`HR-EMP-00193`, `-00195`, `-00198`, +1 already self-corrected) had no `Employee.default_shift` → their real daily terminal punches resolved `shift=NULL, offshift=1` in HRMS's own `EmployeeCheckin.fetch_shift()` → invisible to HRMS's auto-attendance job → `instabiz/overrides/auto_absent.py` saw "no Attendance record" and marked them Absent despite clean punches, confirmed live. Backfilled `default_shift="Standard Shift"` (matches all 13 other Sales-dept employees) for the 3 still missing it. `auto_absent.py` hardened: per-employee `frappe.db.savepoint()`/`rollback(save_point=...)` isolation + `frappe.log_error` (previously one bad record could silently zero out the whole night's run with no trace, deferred single commit at the end); and — the real fix — it now skips marking anyone Absent if a real `Employee Checkin` IN-punch exists that day, regardless of whether HRMS's shift resolution ever converted it to Present. **Factory attendance**: confirmed all 28 active Factory employees already have `default_shift` set correctly, but **zero** Attendance Terminal punches in 14 days and **zero** biometric-CSV-import rows ever (`device_id='biometric-import'`), despite both capture paths being fully built and working in code (the earlier working theory that the biometric-import "unmatched" UI was silently dropping rows was wrong — it's fully wired, including the `get_unmatched_employees()`/`save_biometric_id()` mapping flow; the real issue is nobody has ever fed it real data). Per user decision: disabled `enable_auto_attendance` on the **"Factory Shift" Shift Type** (was HRMS's native job auto-marking all 28 Factory employees Absent every day with no digital capture happening at all) rather than building more code against a pure data-entry gap. **New schema for the Cutting-stage seat map** (approved by user before building — greenfield until this session, confirmed via full grep: no width/GSM/layout concept existed anywhere): `Item.gsm` (Float, custom field, mirrors existing `width_mm`/`length_mtr` pattern); `IB Machine.machine_width_mm` + `IB Machine.knife_positions` (new "Spatial Capacity" section); `IB Production Entry`'s existing-but-dead Cutting section gained `roll_width_mm` and now exposes `parent_roll_id_cut` in the capture dialog (both were schema-only before, never surfaced in `ib_production_stages.js`'s "Log Entry" dialog). **New "Seat Map" tab** in `ib-production-stages` (alongside pipeline/item_wise/order_wise/machine_wise/job_bundles): `production.py` `get_cutting_slot_map()` — 50mm-per-seat occupancy per active Slitting/Cutting machine with `machine_width_mm` set, width sourced from the latest submitted `IB Production Entry.roll_width_mm` when logged, else falls back to `Item.width_mm` (so it's useful immediately, not blocked on Log Entry adoption); `get_cutting_fit_suggestions(machine)` — pending unassigned WOs whose Item width fits the machine's free space, widest-first. Frontend: literal seat-grid UI (colored cells = booked, click → opens WO; dashed gray cells = free, click → dialog of fitting pending jobs with an "Assign here" button wired to the existing `assign_machine` endpoint). **Needs real data to populate**: none of the 3 real Slitting/Cutting machines (`CT-01`, `CT-02`, `SM-01`) have `Machine Width (MM)` set yet — deliberately left blank rather than guessed; set it on each machine to activate the tab. **`get_job_bundles()` gap** (exact `item_code`+`stage` match only, no width/GSM awareness) addressed for Slitting/Cutting specifically via the new fit-suggestions endpoint above; left as-is for Coating/Rewinding/Packing where width isn't the efficiency axis. **Still open / not built this session**: a live all-7-stage machine occupancy view (today's `machine_wise` tab is a WO-list grouped by machine, not spatial/real-time — the Stock Dashboard's `frappe.publish_realtime` pattern is the intended template); Quotation confirm/revert WhatsApp reply-tracking loop (outbound Q PDF+WA already worked before this session via `whatsapp.py` `on_quotation_submit` — inbound reply handling was approved in scope but not started); historical false-Absent Attendance records for the 4 office/Sales employees fixed above were **not** retroactively cancelled (touches payroll-adjacent submitted docs, needs explicit sign-off, not done); Raven AI bots for Sales/Accounts and a wider knowledge-base/FAQ refresh were requested but not yet scoped/built as of this entry. **Addendum, same session**: user reviewed the Seat Map + Live Floor tabs after they were built and asked to remove both — done; `_load_seat_map`/`_render_seat_map`/`_seat_color`/`_show_seat_fit_dialog`/`_load_live_floor`/`_render_live_floor` and their toolbar buttons + dispatch cases are gone from `ib_production_stages.js`, but the backend (`get_cutting_slot_map`, `get_cutting_fit_suggestions`, `get_live_floor_status`, `_notify_floor_update` + its call sites scattered through `start_work_order`/`complete_work_order`/`put_on_hold`/`advance_to_next_stage`/`assign_machine`/`batch_assign_machine`/`move_work_order_stage`) was deliberately left in `production.py`, unused/unwired — cheap to reactivate, flagged not removed. The `Item.gsm`/`IB Machine.machine_width_mm`/`machine_width_mm`/`knife_positions`/`IB Production Entry.roll_width_mm` schema additions remain (harmless, reusable if the seat-map idea comes back). **Job Bundles tab made collapsible**: each bundle card's WO table is now collapsed by default (click the header chevron to expand); the "Batch Assign" button uses `stopPropagation` so it doesn't trigger the collapse toggle. **n8n integration investigated and fixed**: user asked whether Frappe's native `Workflow` doctype could replace n8n — answer is no, they solve different problems (Workflow = in-app state/permission machine for one doctype; n8n = external HTTP orchestration) and Workflow wouldn't touch the actual custom Kanban/pipeline UI that already drives WO status today. More importantly, live-checked n8n itself: **process not running** (`pm2 list`/`ps aux` empty), and n8n's own sqlite DB (`/home/dev/n8n-data/.n8n/database.sqlite`) shows both its workflows `active=0`, with 4182 historical executions from 2026-07-01 to 2026-07-09 (nothing since) at a **90%+ failure rate** (3763 errored, 5 crashed, 414 succeeded) — n8n was never a working part of this stack, it was abandoned mid-testing. Concrete live bug this caused: `notify_n8n()` (`instabiz/overrides/ai_agents.py`) was firing a **synchronous inline `requests.post` with a 5s timeout** on every single WO status change (`on_work_order_update` fires from `IB Work Order.on_update` doc_event, plus explicit calls from all 4 status-transition RPC methods) — meaning every Start/Complete/Hold/Next-Stage click was paying up to 5 dead seconds hitting an unreachable `localhost:5678`. Fixed: `notify_n8n()` now does `frappe.enqueue("instabiz.overrides.ai_agents._post_to_n8n", queue="short", enqueue_after_commit=True, ...)` instead of calling `requests.post` inline — the actual HTTP call (still 5s timeout, now harmless) moved into a new `_post_to_n8n()` function that only runs in a background worker. Verified live: call now returns in ~0.007s versus the previous ~5s block; confirmed a `bench worker` process is running to actually drain the queue. n8n itself is still dead — this only stops it from blocking users, doesn't fix or remove the integration itself (that was explicitly deferred, user chose "make non-blocking" over "remove outright"). **Further addendum, same session**: linked the remaining orphaned doctypes flagged earlier but not yet acted on — `IB Branding`, `IB Transport`, `IB Customer Item Spec`, `IB Customer Share` added to Sales workspace's MASTERS section (restrict_to_role Sales Manager); new WHATSAPP section added to Sales workspace with `IB WA Session`/`IB WA Template`/`IB WA Log` shortcuts (same restriction); `IB Agent Definition` added to the existing AI AGENTS section (restrict_to_role System Manager, since only System Manager has write access — HR/Sales/Accounts/Purchase/Manufacturing Managers only have read on it per its own permissions and aren't all in the Sales workspace's role list, so this is a partial fix, not full cross-workspace coverage). `IB Debit Note`'s Accounts User dead-click (flagged earlier) is still **not** fixed — 3 valid Finance-workspace roles have real permission on it (Purchase User, Purchase Manager, Accounts Manager) so `restrict_to_role`'s single-value field can't cleanly express "hide only from Accounts User"; left as a known gap rather than guess-granting a new permission, documented in the Knowledge Base FAQ instead. **Knowledge Base content updated** (`ib_knowledge_base.js`, `ib-knowledge-base` page): PROD-12 (Job Bundles) now documents the collapsible-by-default cards; PROD-16 (auto-scheduler) now states it was verified live and working, not just described; PROD-20/PROD-22 (n8n integration) rewritten to state n8n is not running (with the same live evidence as above) and that the webhook calls are now backgrounded — previous copy read as if n8n were an actively working part of the stack, which was never re-verified since it was originally written. New **FAQ section** added (7 entries, `cat: "faq"`) covering: why someone might have been marked Absent, where Seat Map/Live Floor went, whether n8n actually works, why a workspace shortcut might be missing, how SO→production automation works, the known Debit Note permission gap, and why "Instabiz CRM" disappeared. All of this is grounded in facts verified during the session, not generic filler. **Final addendum, same session**: historical false-Absent Attendance cleanup was executed (previously deferred pending sign-off) — dry-run found **124 wrongly-marked-Absent submitted records** across the 3 employees fixed earlier (`HR-EMP-00193`: 59, `HR-EMP-00195`: 30, `HR-EMP-00198`: 35), each with a matching real `Employee Checkin` IN-punch that day, dating back to 2026-04-18. Confirmed zero submitted Salary Slips exist for any of the 3 (no payroll lock). Per user decision, all 124 were cancelled via `doc.cancel()` (not replaced with Present records — those days now correctly show no Attendance rather than a wrong one, matching how the hardened `auto_absent.py` behaves going forward). Zero errors. **Deep dashboard re-audit** (Analytics Hub + Finance/Procurement/Stock, explicitly flagged as not-yet-covered by the earlier dashboard pass) found 4 more real bugs, all fixed: (1) `ib_analytics_hub.py`'s `_my_work_sales()` `advance_collected` summed the Payment Entry parent's full `paid_amount` once per joined `Payment Entry Reference` row instead of `per.allocated_amount` — a PE split across multiple SOs inflated this KPI, a fan-out bug the app's own `payment_entry.py` `_update_so_advance()` had already solved correctly elsewhere but wasn't reused here; fixed to sum `allocated_amount`. (2) same file's "me" tab Revenue MTD `delta` is actually `target_attainment_pct - 100`, not period-over-period growth, but the JS rendered every KPI's delta generically as "vs last period" — a rep at 60% of target saw "▼ 40% vs last period", reading as a revenue drop instead of a target shortfall; fixed by adding a `delta_label` field ("vs target") read by the JS instead of the hardcoded string. (3) `get_analytics_data()` had no role check on any tab except the self-scoped "me" one — any authenticated user could call `tab=finance`/`tab=hr` directly via the API and pull company-wide AR/AP/payroll/revenue, same class of bug already fixed in `ib_hrms_dashboard.py` but not backported here; fixed with `frappe.only_for([...])` gating every tab except "me". (4) same gap independently confirmed in `ib_finance_dashboard.get_finance_data()` and `ib_procurement_dashboard.get_procurement_data()` — both whitelisted with zero internal role check despite their Pages restricting nav; both fixed the same way. `ib_stock_dashboard.py` has the same missing-role-check shape but was left alone — company-wide stock visibility is plausibly intentional per the app's own stock-dashboard design, flagged as lower-confidence not a confirmed bug. All 4 fixes smoke-tested live as Administrator post-fix, all return correctly. **Infra + leave-setup addendum, same session**: user deleted their own test Attendance data — 3 records dated today (2026-07-15) or later (one dated 2026-07-17), all owned by Administrator, cancelled + hard-deleted; zero remain at/after today. **OpenWA gateway brought back online**: was completely down (pm2 had no process registered at all, `pm2 ping` showed the daemon alive but `openwa doesn't exist`) — started via `cd /home/dev/openwa && pm2 start ecosystem.config.js`, confirmed listening (`🚀 OpenWA is running on: http://localhost:2785`), then `pm2 save` for reboot persistence. **Important**: the gateway process being up does NOT mean WhatsApp is usable — its own startup log showed `"Reset 1 session(s) to disconnected on startup"` and historical logs show a `LOGOUT` event, meaning the actual phone-paired session is gone. Ran the existing `instabiz.overrides.whatsapp.sync_session_status()` against all 3 `IB WA Session` records (was stale, DB said `Administrator` session = Connected when the real gateway had already reset it) — now correctly shows all 3 Disconnected. **A human needs to open `http://localhost:2886` (OpenWA's own dashboard) and re-scan a QR code** before any WA send (Quotation auto-send, dormant blast, broadcast) will actually work again — this is not something fixable via code. n8n was deliberately left down (see earlier addendum — abandoned, 90% historical failure, not an active business feature); can be started the same way (`cd /home/dev/n8n-data && pm2 start ecosystem.config.js`) if ever wanted. **Leave Allocation system was completely unset up** — found while investigating a "leave balance not working" report: `frappe.db.count("Leave Allocation")` was **zero, ever**, same for `Leave Policy`/`Leave Policy Assignment`; most `Leave Type` masters (Casual Leave, Sick Leave, Privilege Leave, Compensatory Off) had `max_leaves_allowed=0`. This meant every Leave Application (4 exist, 3 submitted/approved, e.g. `HR-LAP-2026-00004`) had been approved with zero allocated balance behind it the entire time — not a code bug, a missing setup step. Per user decision (accepted standard defaults, not company-specific real numbers — flag if these turn out wrong): bulk-created **171 Leave Allocation records** (57 active employees × 3 leave types) for FY 2026-04-01 to 2027-03-31 — Casual Leave 12, Sick Leave 12, Privilege Leave 15 (Compensatory Off intentionally left at 0/unallocated — earned per approved instance, not annually granted; Maternity 182 / Paternity 15 / LWP unlimited were already correctly set on the Leave Type masters and untouched). Updated the 3 Leave Type masters' `max_leaves_allowed` to match. Verified live: `get_leave_balance_on()` now returns 12/12/15 correctly instead of 0/erroring. **n8n restarted too** (user asked directly after the OpenWA fix) — same `pm2 start ecosystem.config.js` pattern from `/home/dev/n8n-data`, `healthz` returns `{"status":"ok"}`, `pm2 save`d. Its 2 saved workflows are still `active=0` (from the abandoned-testing state documented earlier) — process running doesn't mean anything will actually fire; needs someone to review and reactivate in the n8n UI, not done automatically given the 90% historical failure rate. **UI-polish pass** (survey-then-fix, per user's "find where you can add or remove excess" request): survey agent found most custom pages already well-instrumented (existing patterns: server-side pagination in AI Inbox/Assignment Admin, client-side pagination in 3 of 4 Production Stages tabs + Price List, backend LIMIT caps in n8n Console/HRMS Dashboard/Analytics Hub). Fixed the 3 real gaps found: (1) `ib_production_dashboard.js` `_render_plan()` rendered up to 25 Order Sheets each with a fully-open item table (100+ always-visible rows) — made collapsible reusing the Job Bundles chevron-toggle pattern, default-collapsed for sheets with 3+ items, small ones stay open. (2) `production.py` `get_order_sheets()` had **no LIMIT at all** while its own UI already paginates client-side at 20/page — confirmed live-active risk, not hypothetical (467 Order Sheets already exist); added `limit_page_length=500`. Found and fixed a second, independent bug in the same function while touching it: the customer-name lookup query reused a `placeholders` string sized to `len(sheet_names)` for a differently-sized tuple (`[s.customer for s in sheets if s.customer]`) — a SQL parameter-count mismatch that would crash the whole endpoint the first time any Order Sheet had a blank customer; gave it its own correctly-sized placeholder string. (3) `ib_analytics_hub.js` had 3 tables with no deep-link where every sibling table on the same page had one: "Outstanding" collections (added a link to the filtered Sales Invoice list by customer_name — note the row's `customer` field is `customer_name`, not the Customer doctype's `name`/ID, so linking to a Customer record directly would be unsafe/wrong; routing to the invoice list instead avoids that mismatch), "Revenue by Item Group" (added a link to Item list filtered by item_group), "Recent Stock Movements" (added a direct link to the Item form). All fixes syntax-checked, built, and `get_order_sheets()` smoke-tested live post-fix (467 rows returned correctly, well under the new cap).

97. **Workspace Reorg — Procurement split, Misc workspace, register dedup (2026-07-24)** — commit `fd1ef89`. New **`Instabiz Procurement`** workspace (Purchase User/Manager + System Manager): Purchase Order/Receipt/Invoice, Debit Note + register, AP Aging, Purchase Pipeline, native Purchase Register / Item-wise Purchase Register. **`Instabiz Finance`**: all purchase-side shortcuts + Purchase User/Manager roles removed (now Procurement's job); added **Party Outstanding Summary** report shortcut (see item 99); Chart of Accounts/Cost Center moved to Misc. **`Instabiz`** (Sales): dropped vendor-side Debit Notes register (no sales relevance) and admin/infra shortcuts (Agent Definitions, n8n Console, System Health → Misc); added native Sales Register / Item-wise Sales Register. New **`Instabiz Misc`** workspace (System Manager only): Chart of Accounts, Cost Center, Agent Definitions, n8n Console, System Health — home for admin/rarely-used shortcuts that don't belong on a role-specific workspace. **`Instabiz Stock`**: added "Inward Stock Transfer" shortcut (Stock Entry list pre-filtered to `purpose=Material Transfer`) as a direct, clearly-labeled entry point for internal warehouse moves that never touch billing. Live Stock Balance / Stock Ledger left duplicated across Instabiz/Production/Stock deliberately — each workspace's role list is disjoint, so removing either copy would cut off that persona's only path to it. Files touched: all 5 pre-existing workspace JSONs + 2 new (`instabiz_procurement`, `instabiz_misc`).
98. **Sales User Restricted on IB Transport / IB Branding (2026-07-24)** — commit `a0e38d3`. Both doctypes' permission tables: Sales User now `create=1, write=0, delete=0` (was previously full write/delete); Sales Manager/Accounts User/Stock User keep full write+delete. Sales reps can still add a new transporter/branding record inline (e.g. from an e-way bill dialog) but can't edit or delete an existing one.
99. **IB Party Outstanding Summary Report** — Script Report `instabiz/instabiz/report/ib_party_outstanding_summary/`; company-wide party-wise Debit/Credit ledger from submitted Sales Invoices, matching the sundry-debtor balance-confirmation format (S.No, Party, Debit, Credit, Grand Total); filters: territory, sales_person_user, min_balance; wired as "Party Outstanding Summary" shortcut in Instabiz Finance workspace (item 97). **Open gap**: `Report.roles` is empty (no role restriction on the report record itself) — anyone with Sales Invoice read access can run it; not yet locked down.
100. **Cascading Price-Slab Edits — IB Rate Card (2026-07-24)** — commit `f6540de`, `instabiz/instabiz/page/ib_price_list/ib_price_list.py` `save_rate_card_entry()`. Editing exactly one price field on a row (Jumbo Roll: face_price/last_price; Cut Pack: slab1–5) now shifts every *other* peer price field on that row by the same delta — e.g. slab1 90→100 nudges slab2–5 by +10 each, preserving relative spacing instead of leaving them stale. Only fires when exactly one price field changed in that save; multi-field edits in one save are left as entered (ambiguous which is "the" reference price). Existing Cut Pack `face_price=slab1`/`last_price=slab5` sync still runs after the shift. Verified live against a real row.
101. **E-Way Bill → IB Transport GSTIN/Location Sync (2026-07-24)** — commit `e337cd7`. New `IBTransport.before_save()` (`instabiz/instabiz/doctype/ib_transport/ib_transport.py`) calls `territory_from_gstin()` (reused from lead.py's GSTIN-state-map pattern, `instabiz/overrides/utils.py`) whenever `custom_transport_gst` is set, auto-filling new field **`custom_transport_state`** (Link → Territory, label "Location", description notes it's auto-derived/editable). `get_transport_gstin(transport_name)` in `ewaybill.py`: priority is IB Transport's own `custom_transport_gst` → local DB search (Address/Supplier tables) → GST public API name search; a newly-resolved GSTIN is saved back via `doc.save()` (not `db.set_value`, so `before_save` still derives the location) — future e-way bills for the same transporter skip the search entirely.
102. **Item Price History Page — SKU Price Lookup (2026-07-24)** — commit `ee0701c`. New page `ib-item-price-history`: pick an Item (+ optional Customer) → lists every past **submitted Sales Order** line for it (date, SO link, customer, location, sales person, qty/uom/rate/amount), newest first, plus last/lowest/highest rate summary cards — lets a rep check what an item actually sold for before quoting again. Sourced from Sales Order not Sales Invoice (matches app's current SO-basis for "what was sold" — billing isn't live yet, see item 89afaeb). Non-privileged users see only their own orders (`_is_privileged()` row-level rule, same as rest of app). Shortcut added next to IB Rate Card in the Instabiz (Sales) workspace.
103. **Per-Row Document Attachment on Item Tables (2026-07-24)** — commit `0311cf5`. New `custom_attachment` (Attach, `allow_on_submit=1`, `in_list_view=1`) added via `custom_field.json` to **Quotation Item, Sales Order Item, Delivery Note Item, Sales Invoice Item** — lets a reference doc (artwork proof, packing photo, PO copy, etc.) be attached against a specific line item anywhere in the Q→SO→DN→SI chain, including after submit. These are shared ERPNext child tables (instabiz has no doctype-owned copies), so fixture Custom Field is the same pattern already used for color/width_mm/etc. **Unverified**: with `in_list_view=1` the field shows as a compact grid column, but the actual Attach control only renders when a row is expanded to its full edit form (native grid behavior for uncommon fieldtypes) rather than as an always-visible upload button in the collapsed row — never checked in an actual browser session; worth a visual pass before assuming it's obvious to end users.
104. **Advance Payment Approval Workflow (found built-but-uncommitted 2026-07-25, verified working)** — `instabiz/overrides/advance_approval.py` (untracked). Gate: a Sales Order still in Draft that has an advance payment collected (`custom_advance_paid > 0` via a submitted Receive Payment Entry referencing it) cannot be submitted/confirmed until approved. Approver is hardcoded `APPROVER_EMAIL = "idris@instabizsolutions.com"` (System Manager also allowed) via `_is_advance_approver()`. New fields on Sales Order: `custom_advance_approval_status` (Select: blank/Pending/Approved/Rejected, `depends_on: custom_advance_paid > 0`), `custom_advance_approval_remarks` (Small Text) — both in `custom_field.json`, already migrated into DB. `payment_entry.py _maybe_flag_advance_pending()` (called from `_update_so_advance()`, wired on PE `on_submit`/`on_cancel`) sets status to Pending the *first* time an advance lands on a still-Draft SO (`docstatus==0 and not custom_advance_approval_status` — won't re-flag an already Approved/Rejected order if more advance arrives later). `CustomSalesOrder.before_submit()` calls `check_advance_approval(doc)` which throws if `custom_advance_paid > 0 and status != "Approved"`. Whitelisted `set_advance_approval(sales_order, status, remarks)` — permission-checked *before* fetching the doc, throws if SO isn't still Draft or has no advance recorded, writes via `db_set` (bypasses the fields' own `read_only=1`), adds a timeline Comment, sends a bell Notification Log to `custom_sales_person_user`. UI: `ib_sales_common.js` adds Approve/Reject buttons on the Sales Order form, visible only when `docstatus==0 && custom_advance_approval_status=="Pending"` and the viewer is the approver or System Manager. Orders where the advance arrives *after* submission are untouched — the gate is pre-confirmation only. **Not committed to git as of 2026-07-25** — ask before committing (also uncommitted in the same working tree: `sales_order.py`, `payment_entry.py`, `custom_field.json`, `ib_sales_common.js`).
105. **Sales Target / Customer Board Actuals — Field & Date-Basis Consistency (2026-07-25)** — `instabiz/overrides/sales_target.py` `_get_actuals()`. Two rounds of fixes after live SO-list-vs-board mismatches were reported for multiple reps: (1) switched the summed field from `grand_total` to `rounded_total` to match the SO list view's own sticky total bar (`sales_order_list.js ib_update_so_total_bar`) — was off by ~₹1 per large batch of orders, pure rounding drift, not the main issue; (2) switched the date basis from `transaction_date` to `DATE(creation)` — **explicit user decision 2026-07-25**, so board and the SO list (which defaults to filtering on `creation`, not `transaction_date`) always agree by definition. Tradeoff knowingly accepted: "this month's sales" now means *when the order was entered into the system*, not the date printed on the order — a backdated/late-entered order counts toward the month it was typed in. `ib_customer_board.js`'s target-card deep-link updated to match (`creation` between filter on Sales Order list, not the old Sales Invoice/`posting_date` link which was pointing at the wrong doctype entirely). Verified against all 16 reps holding a July `IB Sales Target` — zero mismatches — plus live browser spot-checks (Sales Order list sticky total bar) for 3 reps. If this basis ever needs reverting to `transaction_date`, both `_get_actuals()` and the board JS deep-link need to change together.
106. **List View Date-Range Filter — `Between` not raw `>=`/`<=` (2026-07-25)** — `instabiz/public/js/list_utils.js` `ib_setup_list_date_filter()`. The shared DateRange control (used by Lead, Quotation, Sales Order, Delivery Note, Sales Invoice list views) was building two separate filters (`field >= from`, `field <= to`) instead of one `Between` filter. For a *datetime* field like `creation` (the default date field on all 5 of these lists), a raw `<=` compares against midnight, silently excluding every document created later that same day — Frappe's own `get_between_date_filter` (`frappe/model/db_query.py`) auto-extends `Between`'s end bound to `23:59:59.999999` for Date/Datetime fields, which the hand-rolled `>=`/`<=` pair bypassed entirely. This was the root cause of at least one live reported "wrong order count" (Junaid Sayed: 61 shown vs 63 actual for the same day-range). Fixed by emitting a single `[doctype, dateField, "Between", [val[0], val[1]]]` filter.
107. **List View Custom Filter Ordering — `_ib_chain_anchor` (2026-07-25)** — `instabiz/public/js/list_utils.js`. All the custom filter-setup helpers (`ib_setup_status_multiselect`, `ib_setup_list_sales_user_filter`, `ib_setup_list_date_filter`, `ib_setup_list_team_filter`) previously each used their own ad-hoc CSS-class lookup to decide where to insert themselves in the standard filter row — fragile, and the direct cause of a real bug: Sales Order had its own duplicate sales-person-filter function (`ib_setup_so_sales_user_filter`, now deleted) using a mismatched class name (`ib-so-sales-user-filter` instead of the slug-based `ib-sales-order-sales-user-filter`), so the date filter's lookup for it silently failed and the whole SO filter row rendered in the wrong order (Status, Date, Team, Sales Person instead of the intended sequence). Replaced all of it with one helper, `_ib_chain_anchor(listview, $wrapper, fallbackAnchor)`, that threads filters together in whatever order their setup functions are *called* in `onload()` — self-healing across re-renders (a stale/removed node fails the `closest("body")` check and falls through cleanly to a fresh anchor). Per-doctype call order now mirrors each list's actual row/column layout: **Quotation & Sales Order** row shows Customer → Amount → Sales Person → Status → (Delivery Date) → ID, so `onload()` now calls the Sales Person filter setup *before* Status (previously always Status-first); **Delivery Note & Sales Invoice** have no Sales Person column in the row at all, so their call order (Status before Sales Person) was left unchanged. Lead uses its own fully-native filter set (no `ib_setup_*` helpers) and was untouched. Verified live for all 4 doctypes via browser DOM inspection after the change. **Gotcha hit during verification**: `cdp("Page.reload", {ignoreCache: true})` did NOT bust Chrome's cache for the `<script src>` tag itself — had to also call `cdp("Network.setCacheDisabled", {cacheDisabled: true})` before reloading to get a genuinely fresh script load; `fetch(..., {cache:"no-store"})` from inside the page is a fast way to confirm the *server* has the right file when the live page's `typeof someNewFunction` still says `undefined`.

---

## GST & NIC API Configuration State (as of 2026-05-18)

### Credentials in GST Settings (tabGST Credential)
| GSTIN | State | Username | Service |
|-------|-------|----------|---------|
| 27AAECI3431Q1Z8 | Maharashtra | API_Instabiz | e-Waybill / e-Invoice |
| 24AAECI3431Q1ZE | Gujarat | API_instabizguj | e-Waybill / e-Invoice |
| 33AAECI3431Q1ZF | Tamil Nadu | API_INSTABIZCHENNAI | e-Waybill / e-Invoice |

### GST Settings flags
- `enable_api=1`, `enable_e_invoice=1`, `auto_generate_e_invoice=1`
- `generate_e_waybill_with_e_invoice=1`, `e_invoice_applicable_from=2026-03-14`
- `sandbox_mode=0` (production)

### NIC Portal Setup (Adaequare GSP)
GSP = **Adaequare Info Private Limited** (Resilient Tech routes through Adaequare).
On einvoice1.gst.gov.in → Registration → For GSP → select Adaequare → create sub-user.

| GSTIN | NIC Sub-User | Status |
|-------|-------------|--------|
| 27AAECI3431Q1Z8 MH | API_instabiz676 | LIVE — IRN tested 2026-05-18 |
| 24AAECI3431Q1ZE GJ | API_instabizguj | Pending NIC portal registration |
| 33AAECI3431Q1ZF TN | API_INSTABIZCHENNAI | Pending NIC portal registration |

### Production test result (2026-05-18)
- **IRN generation + cancellation**: WORKING. Tested on IB-SGM-INV-00002.
- **E-Waybill generation + cancellation**: WORKING. EWB 252204142107 with Part B (vehicle MH43AJ5555).
- HSN 76071990 rejected by NIC — corrected to 76072090 on item master.
- `generate_e_waybill_with_e_invoice=1` fires both together on SI submit.


## xlsx Status Discrepancies

No outstanding discrepancies.

---

## External Services Configuration

### site_config.json keys (`sites/frontend/site_config.json`)
| Key | Purpose |
|---|---|
| `openwa_url` | OpenWA gateway URL — `http://localhost:2785` |
| `openwa_api_key` | OpenWA session API key |
| `anthropic_api_key` | Claude API key — needed for AI agent LLM features; agents fall back to deterministic mode if blank |
| `n8n_webhook_url` | n8n Webhook node URL — set to trigger work order processing flows; blank = webhooks silently skip |

### Running Services (PM2)
| Service | PM2 Name | Port | Start |
|---|---|---|---|
| OpenWA (WhatsApp) | `openwa` | 2785 | `pm2 start /home/dev/openwa/ecosystem.config.js` |
| n8n | `n8n` | 5678 | `pm2 start /home/dev/n8n-data/ecosystem.config.js` |

n8n UI: `http://localhost:5678` — create workflows, wire Webhook node URL → paste into `n8n_webhook_url` in site_config.

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

## Report Conventions

### Chart Type Filter (all custom reports)
All 11 Script Reports have a `chart_type` filter (Select: `bar/pie/donut/line/percentage`, default `bar`). Python `_chart(data, filters=None)` reads `filters.get("chart_type")`. All report JS files have `after_render` hook that applies `flex-wrap` to `.chart-legend` so pie/donut legends wrap to multiple lines instead of overflowing.

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
| `sales_order.py` | CustomSalesOrder, custom_make_delivery_note(); `_check_credit_limit()` fires on before_submit — blocks if outstanding > limit AND oldest invoice overdue > custom_days |
| `delivery_note.py` | CustomDeliveryNote, custom_make_sales_invoice() |
| `sales_invoice.py` | CustomSalesInvoice |
| `customer.py` | CustomCustomer — protects customer_name from edits |
| `lead.py` | Round-robin assignment, pincode lookup, transfer_leads, permissions; `rectify_lead_territories(dry_run)` bulk fix; `_GSTIN_STATE_MAP` (27 state codes → Territory names); `_territory_from_gstin()` / `_territory_from_pincode()` helpers |
| `permissions.py` | Query conditions + has_permission for all 4 sales doctypes |
| `naming.py` | autoname_* functions, LOCATION_CODE_MAP, get_next_dn_si_number (MySQL advisory lock) |
| `user.py` | create_sales_person_for_user, copy_admin_defaults, copy_admin_ui_settings |
| `checkin.py` | get_my_status, self_checkin, get_daily_attendance |
| `attendance_terminal.py` | get_employees_with_status, create_checkin, mark_absent |
| `item.py` | `item_query` — multi-token search for item select fields; `set_batch_no_for_fg` — auto has_batch_no=1 for BOPP/CLOTH/FOAM/SPECIALTY on before_insert/before_save |
| `employee_exit.py` | run_exit_handover_daily, run_user_disable_daily |
| `stock_events.py` | publish_stock_update — fires `ib_stock_update` realtime event on Bin changes |
| `dormant.py` | run_dormant_check — daily; flags customers with no SO in 60+ days; creates ToDo + Notification Log with wa.me link; dedup via `[ib-dormant-reminder]` marker |
| `sales_target.py` | get_my_target(month), get_all_targets(month), get_target_map(month_first), run_target_notifications — daily milestone alerts at 50%/75% elapsed + end-of-month |
| `customer_score.py` | run_customer_score — daily; computes weighted health score (payment 35%, order 30%, complaint 20%, CSAT 15%); saves IB Customer Score; emails managers on ≥15pt drop |
| `ewaybill.py` | run_ewaybill_on_submit — fires on DN submit; auto-generates e-way bill via india_compliance; non-blocking. `custom_generate_e_waybill` — whitelist override with txn_type + address overrides; `_patch_ship_from`, `_addr_fields`, `_apply_addr` helpers |
| `po_followup.py` | run_po_followup — daily; POs with no GRN after 7 days → Notification Log to Purchase roles; dedup via `[ib-po-followup]` |
| `auto_absent.py` | run_auto_absent — daily; marks yesterday Absent for employees with no attendance; skips weekends, holidays, approved leaves |
| `expiry_alert.py` | run_expiry_alert — daily; batch expiry within 30 days → Notification Log to Warehouse/Stock/Purchase roles; dedup via `[ib-expiry]`, 7-day cooldown |
| `comment.py` | notify_owner_on_comment — Comment.after_insert; alerts custom_sales_person_user on Q/SO comments; skips self-comments |
| `employee_drive.py` | sync_employee_docs_to_drive — Employee after_save enqueues `_do_sync`; creates HR Documents Drive Team + employee folders; copies files to Drive storage; `get_employee_drive_folder()` whitelisted for form button |
| `dispatch_notification.py` | run_dispatch_notification — DN on_submit; bell notification to sales person with LR + transporter details |
| `quotation_expiry.py` | run_quotation_expiry — daily; expiry alerts at 15/7/1 days; auto-expires past valid_till Open/Replied quotations |
| `follow_up.py` | run_follow_up_reminders — daily; overdue lead follow-up dates → bell notification to lead_owner |
| `sample_request.py` | Whitelisted state machine methods for IB Sample Request: mark_work_order_created, mark_sent, record_feedback, close_request, convert_to_order |
| `create_employees.py` | One-time bench execute; creates Employee records from Users; USER_OVERRIDE map for custom designations; supports dry_run |
| `payment_entry.py` | `before_submit` → `_auto_reconcile` (Receive, no refs → link open SIs FIFO); `on_submit` → `_notify_accounts` (bell to Accounts roles), `_update_so_advance` (recompute custom_advance_paid on linked SOs); `on_cancel` → `_update_so_advance` |
| `llm.py` | Claude API wrapper — `complete(system, prompt)` → text or None; `is_enabled()` → bool; uses `anthropic_api_key` from site_config; model default: `claude-haiku-4-5-20251001`; `frappe.log_error("IB LLM", str(e))` — title must be ≤140 chars; all log_error calls use short title as arg 1 |
| `ai_agents.py` | All 6 AI agents + approval engine; `run_daily_agents()` scheduler entry; whitelisted: `run_all_agents`, `run_agent`, `get_ai_actions`, `approve_action`, `reject_action`, `get_ai_status`; `notify_n8n()` fires webhook to n8n on events |
| `n8n_hooks.py` | doc_event handlers for n8n integration: `on_work_order_update` (IB Work Order), `on_order_sheet_created` (IB Order Sheet); calls `notify_n8n()` |

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
| `list_utils.js` | Shared list view helpers: `ib_extract_filter_values`, `ib_setup_status_multiselect`, `ib_disable_status_click_filter` — loaded globally via `app_include_js` |

### SO List total bar
- `sales_order_list.js` has a sticky selection total bar (`ib-so-total-bar`) appended to `body`.
- `onload` fires only once. Navigate away → `frappe.router.on("change")` removes bar. Navigate back → Frappe calls `listview.refresh()`.
- Fix: patch `listview.refresh` in `onload` to re-call `ib_setup_so_total_bar(listview)` when bar is missing.
- **Do NOT use `before_render`** in `frappe.listview_settings` — `this` context is the settings object, not the listview; accessing `this.$result` throws and breaks all rendering.

### Latest list-view update (2026-04 / 2026-05)
- Lead, Quotation, Sales Order, **Delivery Note**, and **Sales Invoice** list views all use a **custom compact MultiSelectList status filter** in the standard filter row.
- Existing native status filter fields are hidden in UI and replaced by helper controls:
  - Lead uses `custom_status`
  - Quotation uses `status`
  - Sales Order uses `status`
  - Delivery Note uses `status` (statuses: Draft, Pending, Confirmed, Return Issued, Cancelled)
  - Sales Invoice uses `status` (statuses: Draft, Unpaid, Overdue, Paid, Return, Cancelled)
- Multi-select values are applied via list filters using `in` operator (array values), then list is refreshed.
- Existing row-level status picker behavior on Lead remains intact.
- UI details: no visible label (`only_input: true`), compact width (`140px`), control inserted in standard filter section (not right-corner page form fallback unless needed).
- **Shared helpers** live in `public/js/list_utils.js` (loaded globally via `app_include_js`):
  - `ib_extract_filter_values(value)` — extracts selected values from a MultiSelectList control
  - `ib_setup_status_multiselect(listview, doctype, statuses)` — parameterised setup for any doctype
  - `ib_disable_status_click_filter(listview)` — disables indicator pill click-to-filter
  - `quotation_list.js` and `sales_order_list.js` refactored to call these instead of local copies

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
| `ib-price-list` | `ib_price_list.js`, `ib_price_list.py` | Rate card page; Jumbo Roll / Cut Pack tabs; `IB Rate Card Entry` data; multi-token search; spec rendering (color dots, spec tags, UOM chips); managers: Add Entry, ✏ Edit dialog, 🕐 History timeline per row; admin: 🗑 Delete; Cut Pack slab1–5, auto-syncs face/last price; all edits tracked via Frappe Version; `get_price_history(name)` whitelisted |
| `ib-ai-inbox` | `ib_ai_inbox.js`, `ib_ai_inbox.py` | AI agent action approval inbox; filter by status/agent; shows agent badge (color-coded per agent), Claude badge if AI-generated, draft JSON preview; Approve → applies action + marks approved; Reject → marks rejected; Run All Agents button triggers all 6 agents manually; status bar shows Claude enabled/disabled + pending count |
| `ib-main-dashboard` | `ib_main_dashboard.js`, `ib_main_dashboard.py` | Main business dashboard; 4 KPI cards (Revenue MTD → SI list, Outstanding AR → SI list, Open Quotations → Quotation list, Low/Zero Stock → stock dashboard); all cards clickable deep-links; Revenue Trend chart (6-month) + Top Customers bar chart; Recent Invoices table with SI deep-links; Quick Actions grid |
| `ib-production-dashboard` | `ib_production_dashboard.js`, `ib_production_dashboard.py` | Production KPIs (4 cards, all clickable: Active WO → IB Work Order list, Pending → filtered list, Completed Today → filtered list, Machines Active → IB Machine list); stage pipeline cards → ib-production-stages; priority strip; wastage card; active plan table; recent entries |
| `ib-hrms-dashboard` | `ib_hrms_dashboard.js`, `ib_hrms_dashboard.py` | HR KPIs (4 cards, all clickable: Active Employees → Employee list, Present Today → Attendance list today, Pending Leaves → Leave Application list, Payroll MTD → Salary Slip list); tabs: Attendance/Leaves/Payroll/Statutory; approve/reject leaves inline; salary slip list; department headcount bars |
| `ib-finance-dashboard` | `ib_finance_dashboard.js`, `ib_finance_dashboard.py` | Finance KPIs all clickable; SI/PI/Payment Entry drill-downs; outstanding AR/AP tables; recent SI list with status badges |
| `ib-procurement-dashboard` | `ib_procurement_dashboard.js`, `ib_procurement_dashboard.py` | Procurement KPIs all clickable; PO/PR/PI drill-downs; top suppliers bar chart; recent POs table |
| `ib-knowledge-base` | `ib_knowledge_base.js`, `ib_knowledge_base.py` | Interactive knowledge base; searchable feature cards (12 sections, 90+ features); clickable sales workflow (Q→SO→DN→SI→Payment) panels; PDF download button → `/files/instabiz_knowledge_base.pdf`; all roles |

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
| IB Overtime Request | IB-OT-{YYYY}-{#####} | employee overtime tracking; fields: employee, employee_name, date, shift (Link→Shift Type), overtime_hours, status (Draft/Pending Approval/Approved/Rejected), reason, approved_by (read-only), approver_notes; Employee can create/write, HR Manager full access |
| IB Full Final Settlement | IB-FFS-{YYYY}-{#####} | employee F&F settlement; auto-computes years_of_service, gratuity (≥5 yrs: basic/26×15×yos), leave_encashment (basic/26×pending_leaves if not set), total_payable; status: Draft/In Review/Approved/Paid/Cancelled |
| IB AI Action | IB-AIA-.YYYY.-.##### | AI agent action queue; fields: agent (Select: auto_quote/demand_forecast/smart_reorder/collections/istix_enforcer/buying_dna), action_type (Data), status (pending/approved/rejected), title, summary, draft_json (Code/JSON), reference_doctype, reference_name, ai_generated (Check), decided_by (User), decided_at (Datetime); Roles: System Manager/Sales Manager/Accounts Manager read+write; auto-populated by agents, approved/rejected via AI Inbox page |
| IB Agent Run Log | IB-ARL-.YYYY.-.##### | AI agent run audit trail; fields: agent_code, trigger_type (schedule/manual/event), status (running/success/failed/partial), run_at (Datetime), duration_seconds, records_processed, actions_taken, summary_json (Code/JSON), error_details; one row per agent execution |

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
- **DN / SI:** Global counter via MySQL advisory lock `GET_LOCK('IB-DNSI', 5)` → `IB-{LOC}-DN-00001`. SI reuses DN number when created from DN (`IB-{LOC}-INV-00001`).
- Both DN and SI autoname loop `get_next_dn_si_number()` until a free slot is found — no Frappe `-1` dedup suffix ever appended.
- SI from DN: extracts `num_str` via `dn_name.split("-DN-")[-1].split("-")[0]` — strips any Frappe dedup suffix before building candidate (e.g. `IB-BWD-DN-00006-1` → `num_str="00006"` → candidate `IB-BWD-INV-00006`).
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
- **`frappe.db.set_value()` does NOT fire Document events** (`on_update`, doc_events in hooks.py) — Frappe's own docstring says so explicitly. Any status-transition endpoint that uses it directly instead of `doc.save()` will silently skip every `doc_events` hook wired to that doctype (bell notifications, n8n webhooks, etc.) with no error. Bit us in `production.py` on 2026-07-02 (see feature 84) — RTD notifications + n8n webhooks were dead since inception. When adding a new status-transition whitelisted method that should trigger notifications/webhooks, either use `doc.save()` or call the hook function explicitly.
- Daily-scheduler filters that match on an exact date (`field = today()`) plus a mutable status field (`status = 'Active'`) are fragile — if the record's status can change before the job runs (e.g. HR sets `status='Left'` at data-entry time, same moment as `relieving_date`), the exact-date match is missed forever. Prefer `field <= today()` (catch-up window) with idempotency checks, not exact-date matches on a single field. See `run_user_disable_daily` (correct pattern) vs the pre-2026-07-02 `run_exit_handover_daily` (buggy pattern, fixed — feature 3).