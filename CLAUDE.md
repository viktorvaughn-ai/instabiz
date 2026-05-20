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
8. **HRMS Payroll** — two salary structures (IB Payroll / Astro Payroll); Monthly frequency; PF/ESIC/PT/TDS deductions; salary assignments done. **Opt-in/out:** PF via `Employee.provident_fund_account` (blank = skipped), ESIC via `Employee.health_insurance_no` (blank = skipped; also auto-skips if `base > 21000`). **IB Payroll formulas:** B=`base×2/3`, HRA=`base×0.2`, CA=`base−B−HRA`; PF=`min(B+CA,15000)×12%`; ESIC=`(B+HRA)×0.75%` if base≤21000; PT=₹175 if base≤10000 else ₹200 (Male only, base≥7500); TDS=new regime slabs on `(B+CA)×12−75000`÷12+4%cess. **Astro Payroll formulas:** 3 tiers — base>21k: B=`base×2/3`, HRA=`base/6`; base>11k: B=`base×10/13`, HRA=`base×1.5/13`; base≤11k: B=`base×10/11`, HRA=`B×5%`; CA=remainder; PF=`min(B+HRA,15000)×12%`; ESIC=`(B+HRA)×0.75%`; PT=₹200 flat (Male, gross≥10000); TDS=same lambda on `(B+HRA)×12−75000`. **TDS slabs (new regime FY25-26):** 0–4L: 0%, 4–8L: 5%, 8–12L: 10%, 12–16L: 15%, 16–20L: 20%, 20–24L: 25%, >24L: 30%; +4% cess; rebate u/s 87A: tax=0 if taxable≤12L.
9. **IB Stock Dashboard** — custom page (`ib-stock-dashboard`); live stock across 3 warehouses; filter chips; multi-token search + highlight; breakdown popover; CSV export; WebSocket live-updates
10. **IB Customer Board** — sales pipeline state machine; `ib-customer-board` (4-column kanban: Dormant/Regular/Today/Tomorrow); `ib-assignment-admin` (roster + view-as kanban + pool assign); 12am scheduler auto-assigns tomorrow's batch per user territory; SO submit auto-marks assignment done; `IB Customer Assignment` doctype + `IB Assignment Config` singleton
11. **Instabiz Workspace** — sidebar workspace with shortcuts: Customer Board, Stock Dashboard, Assignment Admin, Attendance Terminal, Employee Check-in
12. **IB Item Price List** — custom page `ib-price-list` (NOT the doctype list); table with search, spec rendering (identical to stock dashboard: color dots, spec tags, UOM chips), row click popover showing rates; workspace shortcut points to the page; doctype list view redirects to the page via `ib_item_price_list_list.js`
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
43. **M6 HR Masters** — configured directly in DB (not fixtures): **Departments** (IB-suffixed): Administration, HR, Despatch, Factory Management, Factory Production, Factory Administration, Warehouse, Engineering, Admin, Quality, Digital Marketing; **Shifts**: Morning, Afternoon, Night, General, Factory Shift, Standard Shift; **Leave Types**: Casual Leave, Sick Leave, Privilege Leave, Compensatory Off, Leave Without Pay, Maternity Leave, Paternity Leave; **HRMS Payroll**: IB Payroll and Astro Payroll salary structures with Basic/HRA/CA earnings + PF/ESIC/PT/TDS deductions — all components built and formula-driven (see feature #8 for formulas)
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

---

## xlsx Status Discrepancies

No outstanding discrepancies.

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
| `lead.py` | Round-robin assignment, pincode lookup, transfer_leads, permissions |
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
| `ib-price-list` | `ib_price_list.js`, `ib_price_list.py` | Item price list table; spec rendering (color dots, spec tags, UOM chips); row click popover with rates; search with multi-token highlight; manager can edit via toolbar button; Rate 1–4 columns color-coded (blue/purple/orange/teal) in headers + values; item code is a same-tab SPA link (`/app/item/...`) with hover underline; click stopPropagation prevents popover opening |

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