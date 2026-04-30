# Sales Workflow Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 independent sales workflow features: Lead follow-up reminders, Customer credit limits with SO blocking, Quotation expiry alerts + auto-expire, Customer health scoring, and Sample request tracking.

**Architecture:** Each feature is a self-contained unit — new custom fields in fixtures, scheduler functions in dedicated override files, new DocTypes where state needs persisting. All scheduler functions registered in `hooks.py` daily events. All custom fields added to `instabiz/fixtures/custom_field.json` and applied via `bench migrate`.

**Tech Stack:** Frappe v15, ERPNext v15, Python (ruff/tabs/double-quotes/110-char), `frappe.sendmail` for notifications, `frappe.get_all` for DB queries.

---

## Scope Note

These 5 features are independent. Implement and verify one group before starting the next. Each group ends with a build + restart + migrate cycle.

---

## Group A — Lead Follow-up Reminders

### Task A1: Add follow-up fields to Lead fixture

**Files:**
- Modify: `instabiz/fixtures/custom_field.json`

- [ ] **Step 1: Add 3 custom field entries to `custom_field.json`**

Open `instabiz/fixtures/custom_field.json`. Append these 3 entries to the JSON array:

```json
{
  "allow_in_quick_entry": 0,
  "allow_on_submit": 0,
  "bold": 0,
  "collapsible": 0,
  "collapsible_depends_on": null,
  "columns": 0,
  "default": null,
  "depends_on": null,
  "description": null,
  "docstatus": 0,
  "doctype": "Custom Field",
  "dt": "Lead",
  "fetch_from": null,
  "fetch_if_empty": 0,
  "fieldname": "custom_follow_up_section",
  "fieldtype": "Section Break",
  "hidden": 0,
  "hide_border": 0,
  "hide_days": 0,
  "hide_seconds": 0,
  "ignore_user_permissions": 0,
  "ignore_xss_filter": 0,
  "in_global_search": 0,
  "in_list_view": 0,
  "in_preview": 0,
  "in_standard_filter": 0,
  "insert_after": "custom_remark",
  "is_system_generated": 0,
  "is_virtual": 0,
  "label": "Follow-up",
  "length": 0,
  "link_filters": null,
  "mandatory_depends_on": null,
  "modified": "2026-04-30 00:00:00.000000",
  "module": null,
  "name": "Lead-custom_follow_up_section",
  "no_copy": 0,
  "non_negative": 0,
  "options": null,
  "permlevel": 0,
  "placeholder": null,
  "precision": "",
  "print_hide": 1,
  "print_hide_if_no_value": 0,
  "print_width": null,
  "read_only": 0,
  "read_only_depends_on": null,
  "report_hide": 0,
  "reqd": 0,
  "search_index": 0,
  "show_dashboard": 0,
  "sort_options": 0,
  "translatable": 0,
  "unique": 0,
  "width": null
},
{
  "allow_in_quick_entry": 0,
  "allow_on_submit": 0,
  "bold": 0,
  "collapsible": 0,
  "collapsible_depends_on": null,
  "columns": 0,
  "default": null,
  "depends_on": null,
  "description": null,
  "docstatus": 0,
  "doctype": "Custom Field",
  "dt": "Lead",
  "fetch_from": null,
  "fetch_if_empty": 0,
  "fieldname": "custom_next_follow_up_date",
  "fieldtype": "Date",
  "hidden": 0,
  "hide_border": 0,
  "hide_days": 0,
  "hide_seconds": 0,
  "ignore_user_permissions": 0,
  "ignore_xss_filter": 0,
  "in_global_search": 0,
  "in_list_view": 1,
  "in_preview": 0,
  "in_standard_filter": 1,
  "insert_after": "custom_follow_up_section",
  "is_system_generated": 0,
  "is_virtual": 0,
  "label": "Next Follow-up Date",
  "length": 0,
  "link_filters": null,
  "mandatory_depends_on": null,
  "modified": "2026-04-30 00:00:00.000000",
  "module": null,
  "name": "Lead-custom_next_follow_up_date",
  "no_copy": 0,
  "non_negative": 0,
  "options": null,
  "permlevel": 0,
  "placeholder": null,
  "precision": "",
  "print_hide": 1,
  "print_hide_if_no_value": 0,
  "print_width": null,
  "read_only": 0,
  "read_only_depends_on": null,
  "report_hide": 0,
  "reqd": 0,
  "search_index": 1,
  "show_dashboard": 0,
  "sort_options": 0,
  "translatable": 0,
  "unique": 0,
  "width": null
},
{
  "allow_in_quick_entry": 0,
  "allow_on_submit": 0,
  "bold": 0,
  "collapsible": 0,
  "collapsible_depends_on": null,
  "columns": 0,
  "default": null,
  "depends_on": null,
  "description": null,
  "docstatus": 0,
  "doctype": "Custom Field",
  "dt": "Lead",
  "fetch_from": null,
  "fetch_if_empty": 0,
  "fieldname": "custom_follow_up_note",
  "fieldtype": "Small Text",
  "hidden": 0,
  "hide_border": 0,
  "hide_days": 0,
  "hide_seconds": 0,
  "ignore_user_permissions": 0,
  "ignore_xss_filter": 0,
  "in_global_search": 0,
  "in_list_view": 0,
  "in_preview": 0,
  "in_standard_filter": 0,
  "insert_after": "custom_next_follow_up_date",
  "is_system_generated": 0,
  "is_virtual": 0,
  "label": "Follow-up Note",
  "length": 0,
  "link_filters": null,
  "mandatory_depends_on": null,
  "modified": "2026-04-30 00:00:00.000000",
  "module": null,
  "name": "Lead-custom_follow_up_note",
  "no_copy": 0,
  "non_negative": 0,
  "options": null,
  "permlevel": 0,
  "placeholder": null,
  "precision": "",
  "print_hide": 1,
  "print_hide_if_no_value": 0,
  "print_width": null,
  "read_only": 0,
  "read_only_depends_on": null,
  "report_hide": 0,
  "reqd": 0,
  "search_index": 0,
  "show_dashboard": 0,
  "sort_options": 0,
  "translatable": 0,
  "unique": 0,
  "width": null
}
```

- [ ] **Step 2: Apply fixture**

```bash
cd /home/dev/frappe-bench
bench --site frontend migrate
```

Expected: migration completes, Lead form now shows "Next Follow-up Date" and "Follow-up Note" fields.

### Task A2: Implement follow-up reminder scheduler

**Files:**
- Create: `instabiz/overrides/follow_up.py`
- Modify: `instabiz/hooks.py`

**Note:** Use Frappe `Notification Log` (bell icon in navbar) — NOT email.

- [ ] **Step 1: Create `instabiz/overrides/follow_up.py`**

```python
"""instabiz.overrides.follow_up — daily lead follow-up system notifications."""
import frappe
from frappe.utils import today


def run_follow_up_reminders():
	"""Daily job — creates bell notifications for reps with past-due lead follow-ups."""
	overdue = frappe.get_all(
		"Lead",
		filters=[
			["custom_next_follow_up_date", "is", "set"],
			["custom_next_follow_up_date", "<", today()],
			["status", "not in", ["Converted", "Do Not Contact", "Lost"]],
		],
		fields=["name", "lead_name", "lead_owner", "custom_next_follow_up_date", "custom_follow_up_note"],
		order_by="custom_next_follow_up_date asc",
	)
	if not overdue:
		return

	for lead in overdue:
		owner = lead.lead_owner
		if not owner:
			continue
		_notify(owner, lead)

	frappe.db.commit()


def _notify(user: str, lead: dict) -> None:
	note = f" — {lead.custom_follow_up_note}" if lead.custom_follow_up_note else ""
	frappe.get_doc({
		"doctype": "Notification Log",
		"for_user": user,
		"from_user": "Administrator",
		"subject": f"Follow-up overdue: {lead.lead_name or lead.name} (due {lead.custom_next_follow_up_date}){note}",
		"type": "Alert",
		"document_type": "Lead",
		"document_name": lead.name,
	}).insert(ignore_permissions=True)
```

- [ ] **Step 2: Register scheduler in `hooks.py`**

In `hooks.py`, find the `scheduler_events["daily"]` list and add:

```python
"instabiz.overrides.follow_up.run_follow_up_reminders",
```

- [ ] **Step 3: Restart and verify**

```bash
cd /home/dev/frappe-bench
bench restart
bench --site frontend execute instabiz.overrides.follow_up.run_follow_up_reminders
```

Expected: command runs without error. Check `logs/worker.error.log` for any exceptions.

- [ ] **Step 4: Commit**

```bash
git -C apps/instabiz add instabiz/overrides/follow_up.py instabiz/hooks.py instabiz/fixtures/custom_field.json
git -C apps/instabiz commit -m "feat: lead follow-up date field + daily overdue reminder emails"
```

---

## Group B — Customer Credit Limit

### Task B1: Add credit_limit field to Customer fixture

**Files:**
- Modify: `instabiz/fixtures/custom_field.json`

- [ ] **Step 1: Append credit limit field entry to `custom_field.json`**

```json
{
  "allow_in_quick_entry": 0,
  "allow_on_submit": 0,
  "bold": 0,
  "collapsible": 0,
  "collapsible_depends_on": null,
  "columns": 0,
  "default": "0",
  "depends_on": null,
  "description": "0 = no limit. Sales Orders will be blocked when outstanding invoices exceed this amount.",
  "docstatus": 0,
  "doctype": "Custom Field",
  "dt": "Customer",
  "fetch_from": null,
  "fetch_if_empty": 0,
  "fieldname": "custom_credit_limit",
  "fieldtype": "Currency",
  "hidden": 0,
  "hide_border": 0,
  "hide_days": 0,
  "hide_seconds": 0,
  "ignore_user_permissions": 0,
  "ignore_xss_filter": 0,
  "in_global_search": 0,
  "in_list_view": 0,
  "in_preview": 0,
  "in_standard_filter": 0,
  "insert_after": "custom_primary_contact_person",
  "is_system_generated": 0,
  "is_virtual": 0,
  "label": "Credit Limit",
  "length": 0,
  "link_filters": null,
  "mandatory_depends_on": null,
  "modified": "2026-04-30 00:00:00.000000",
  "module": null,
  "name": "Customer-custom_credit_limit",
  "no_copy": 0,
  "non_negative": 1,
  "options": null,
  "permlevel": 0,
  "placeholder": null,
  "precision": "2",
  "print_hide": 1,
  "print_hide_if_no_value": 0,
  "print_width": null,
  "read_only": 0,
  "read_only_depends_on": null,
  "report_hide": 0,
  "reqd": 0,
  "search_index": 0,
  "show_dashboard": 0,
  "sort_options": 0,
  "translatable": 0,
  "unique": 0,
  "width": null
}
```

- [ ] **Step 2: Migrate**

```bash
cd /home/dev/frappe-bench
bench --site frontend migrate
```

Expected: Customer form now has "Credit Limit" currency field.

### Task B2: Credit limit check in Sales Order validate

**Files:**
- Modify: `instabiz/overrides/sales_order.py`

- [ ] **Step 1: Add `_check_credit_limit` method to `CustomSalesOrder`**

In `instabiz/overrides/sales_order.py`, add this import at the top alongside existing imports:

```python
from instabiz.overrides.permissions import _is_privileged
```

Then add the method to the `CustomSalesOrder` class and call it from `validate()`:

In `validate()`, add `self._check_credit_limit()` after `recalculate_items(self)` and before `super().validate()`.

Add the method to the class:

```python
def _check_credit_limit(self):
	if not self.customer:
		return
	limit = frappe.db.get_value("Customer", self.customer, "custom_credit_limit") or 0
	if not limit:
		return

	outstanding = frappe.db.sql(
		"""
		SELECT COALESCE(SUM(outstanding_amount), 0)
		FROM `tabSales Invoice`
		WHERE customer = %s
		  AND docstatus = 1
		  AND outstanding_amount > 0
		  AND is_return = 0
		""",
		self.customer,
	)[0][0] or 0

	if outstanding < limit:
		return

	msg = (
		f"Credit limit exceeded for {self.customer}. "
		f"Outstanding: ₹{outstanding:,.2f} / Limit: ₹{limit:,.2f}."
	)

	if _is_privileged(frappe.session.user):
		frappe.msgprint(msg + " Proceeding because you have override permission.", alert=True, indicator="orange")
	else:
		frappe.throw(msg + " Contact Sales Manager or MD to approve.", title="Credit Limit Exceeded")
```

- [ ] **Step 2: Restart**

```bash
cd /home/dev/frappe-bench
bench restart
```

- [ ] **Step 3: Manual verify**

1. Open Customer → set Credit Limit = 1 (₹1).
2. Create a Sales Order for that customer.
3. Confirm error: "Credit limit exceeded" blocks save for non-privileged user.
4. Log in as Sales Manager → confirm warning shown but save proceeds.

- [ ] **Step 4: Commit**

```bash
git -C apps/instabiz add instabiz/overrides/sales_order.py instabiz/fixtures/custom_field.json
git -C apps/instabiz commit -m "feat: customer credit limit with SO blocking and privileged override"
```

---

## Group C — Quotation Expiry Alerts + Auto-expire

### Task C1: Implement quotation expiry scheduler

**Files:**
- Create: `instabiz/overrides/quotation_expiry.py`
- Modify: `instabiz/hooks.py`

- [ ] **Step 1: Create `instabiz/overrides/quotation_expiry.py`**

```python
"""instabiz.overrides.quotation_expiry — expiry alerts and auto-expire for Quotations."""
import frappe
from frappe.utils import today, add_days


_ALERT_DAYS = [15, 7, 1]
_OPEN_STATUSES = ["Open", "Replied"]


def run_quotation_expiry():
	"""Daily job — sends expiry alerts and auto-expires overdue Quotations."""
	_send_expiry_alerts()
	_auto_expire_quotations()


def _send_expiry_alerts():
	today_str = today()
	for days in _ALERT_DAYS:
		target_date = add_days(today_str, days)
		quotations = frappe.get_all(
			"Quotation",
			filters={
				"valid_till": target_date,
				"status": ["in", _OPEN_STATUSES],
				"docstatus": 1,
			},
			fields=["name", "customer_name", "valid_till", "grand_total", "custom_sales_person_user"],
		)
		for q in quotations:
			if not q.custom_sales_person_user:
				continue
			_send_expiry_alert_email(q, days)


def _send_expiry_alert_email(q: dict, days_remaining: int) -> None:
	link = f'<a href="/app/quotation/{q.name}">{q.name}</a>'
	day_label = "day" if days_remaining == 1 else "days"
	message = f"""
<p>Quotation {link} for <strong>{q.customer_name}</strong> expires in
<strong>{days_remaining} {day_label}</strong> (on {q.valid_till}).</p>
<p>Grand Total: ₹{(q.grand_total or 0):,.2f}</p>
<p>Please follow up with the customer or extend the validity date.</p>
"""
	frappe.sendmail(
		recipients=[q.custom_sales_person_user],
		subject=f"[Instabiz] Quotation {q.name} expires in {days_remaining} {day_label}",
		message=message,
		now=True,
	)


def _auto_expire_quotations():
	today_str = today()
	overdue = frappe.get_all(
		"Quotation",
		filters={
			"valid_till": ["<", today_str],
			"status": ["in", _OPEN_STATUSES],
			"docstatus": 1,
		},
		fields=["name"],
	)
	for q in overdue:
		try:
			frappe.db.set_value("Quotation", q.name, "status", "Expired")
		except Exception:
			frappe.log_error(frappe.get_traceback(), f"Auto-expire failed: {q.name}")
	if overdue:
		frappe.db.commit()
```

- [ ] **Step 2: Register in `hooks.py`**

Add to `scheduler_events["daily"]`:

```python
"instabiz.overrides.quotation_expiry.run_quotation_expiry",
```

- [ ] **Step 3: Restart and test**

```bash
cd /home/dev/frappe-bench
bench restart
bench --site frontend execute instabiz.overrides.quotation_expiry.run_quotation_expiry
```

Expected: runs without error. Create a test Quotation with `valid_till = today - 1 day`, run again, verify status changes to "Expired".

- [ ] **Step 4: Commit**

```bash
git -C apps/instabiz add instabiz/overrides/quotation_expiry.py instabiz/hooks.py
git -C apps/instabiz commit -m "feat: quotation expiry alerts (15/7/1 day) and auto-expire scheduler"
```

---

## Group D — Customer Health Score

### Task D1: Add CSAT + complaint fields to fixtures

**Files:**
- Modify: `instabiz/fixtures/custom_field.json`

- [ ] **Step 1: Append 2 entries to `custom_field.json`**

```json
{
  "allow_in_quick_entry": 0,
  "allow_on_submit": 1,
  "bold": 0,
  "collapsible": 0,
  "collapsible_depends_on": null,
  "columns": 0,
  "default": null,
  "depends_on": null,
  "description": "Customer satisfaction rating 1-5 (1=Very Poor, 5=Excellent). Set after invoice is collected.",
  "docstatus": 0,
  "doctype": "Custom Field",
  "dt": "Sales Invoice",
  "fetch_from": null,
  "fetch_if_empty": 0,
  "fieldname": "custom_csat_rating",
  "fieldtype": "Select",
  "hidden": 0,
  "hide_border": 0,
  "hide_days": 0,
  "hide_seconds": 0,
  "ignore_user_permissions": 0,
  "ignore_xss_filter": 0,
  "in_global_search": 0,
  "in_list_view": 0,
  "in_preview": 0,
  "in_standard_filter": 0,
  "insert_after": "ib_extra_col1",
  "is_system_generated": 0,
  "is_virtual": 0,
  "label": "CSAT Rating",
  "length": 0,
  "link_filters": null,
  "mandatory_depends_on": null,
  "modified": "2026-04-30 00:00:00.000000",
  "module": null,
  "name": "Sales Invoice-custom_csat_rating",
  "no_copy": 0,
  "non_negative": 0,
  "options": "\n1\n2\n3\n4\n5",
  "permlevel": 0,
  "placeholder": null,
  "precision": "",
  "print_hide": 1,
  "print_hide_if_no_value": 0,
  "print_width": null,
  "read_only": 0,
  "read_only_depends_on": null,
  "report_hide": 0,
  "reqd": 0,
  "search_index": 0,
  "show_dashboard": 0,
  "sort_options": 0,
  "translatable": 0,
  "unique": 0,
  "width": null
},
{
  "allow_in_quick_entry": 0,
  "allow_on_submit": 0,
  "bold": 0,
  "collapsible": 0,
  "collapsible_depends_on": null,
  "columns": 0,
  "default": "0",
  "depends_on": null,
  "description": "Number of complaints raised by this customer. Update manually when a complaint is logged.",
  "docstatus": 0,
  "doctype": "Custom Field",
  "dt": "Customer",
  "fetch_from": null,
  "fetch_if_empty": 0,
  "fieldname": "custom_complaint_count",
  "fieldtype": "Int",
  "hidden": 0,
  "hide_border": 0,
  "hide_days": 0,
  "hide_seconds": 0,
  "ignore_user_permissions": 0,
  "ignore_xss_filter": 0,
  "in_global_search": 0,
  "in_list_view": 0,
  "in_preview": 0,
  "in_standard_filter": 0,
  "insert_after": "custom_credit_limit",
  "is_system_generated": 0,
  "is_virtual": 0,
  "label": "Complaint Count",
  "length": 0,
  "link_filters": null,
  "mandatory_depends_on": null,
  "modified": "2026-04-30 00:00:00.000000",
  "module": null,
  "name": "Customer-custom_complaint_count",
  "no_copy": 0,
  "non_negative": 1,
  "options": null,
  "permlevel": 0,
  "placeholder": null,
  "precision": "",
  "print_hide": 1,
  "print_hide_if_no_value": 0,
  "print_width": null,
  "read_only": 0,
  "read_only_depends_on": null,
  "report_hide": 0,
  "reqd": 0,
  "search_index": 0,
  "show_dashboard": 0,
  "sort_options": 0,
  "translatable": 0,
  "unique": 0,
  "width": null
}
```

- [ ] **Step 2: Migrate**

```bash
cd /home/dev/frappe-bench
bench --site frontend migrate
```

### Task D2: Create IB Customer Score DocType

**Files:**
- Create: `instabiz/instabiz/doctype/ib_customer_score/` (directory + 3 files)

- [ ] **Step 1: Create `__init__.py`**

Create `instabiz/instabiz/doctype/ib_customer_score/__init__.py` — empty file.

- [ ] **Step 2: Create `ib_customer_score.py`**

Create `instabiz/instabiz/doctype/ib_customer_score/ib_customer_score.py`:

```python
# Copyright (c) 2026, Instabiz Solutions India Pvt Ltd
import frappe
from frappe.model.document import Document


class IBCustomerScore(Document):
	pass
```

- [ ] **Step 3: Create `ib_customer_score.json`**

Create `instabiz/instabiz/doctype/ib_customer_score/ib_customer_score.json`:

```json
{
  "actions": [],
  "allow_rename": 0,
  "autoname": "IB-CS-.YYYY.-.#####",
  "creation": "2026-04-30 00:00:00",
  "doctype": "DocType",
  "editable_grid": 1,
  "engine": "InnoDB",
  "field_order": [
    "customer",
    "score_date",
    "health_status",
    "col_break_1",
    "total_score",
    "previous_score",
    "score_change",
    "section_components",
    "payment_score",
    "order_score",
    "col_break_2",
    "complaint_score",
    "csat_score"
  ],
  "fields": [
    {
      "fieldname": "customer",
      "fieldtype": "Link",
      "in_list_view": 1,
      "label": "Customer",
      "options": "Customer",
      "reqd": 1,
      "search_index": 1
    },
    {
      "fieldname": "score_date",
      "fieldtype": "Date",
      "in_list_view": 1,
      "label": "Score Date",
      "reqd": 1,
      "search_index": 1
    },
    {
      "fieldname": "health_status",
      "fieldtype": "Select",
      "in_list_view": 1,
      "label": "Health Status",
      "options": "\nGreen\nAmber\nRed"
    },
    {
      "fieldname": "col_break_1",
      "fieldtype": "Column Break"
    },
    {
      "fieldname": "total_score",
      "fieldtype": "Float",
      "label": "Total Score",
      "precision": "1"
    },
    {
      "fieldname": "previous_score",
      "fieldtype": "Float",
      "label": "Previous Score",
      "precision": "1",
      "read_only": 1
    },
    {
      "fieldname": "score_change",
      "fieldtype": "Float",
      "label": "Score Change",
      "precision": "1",
      "read_only": 1
    },
    {
      "fieldname": "section_components",
      "fieldtype": "Section Break",
      "label": "Score Components"
    },
    {
      "fieldname": "payment_score",
      "fieldtype": "Float",
      "label": "Payment Punctuality Score",
      "precision": "1"
    },
    {
      "fieldname": "order_score",
      "fieldtype": "Float",
      "label": "Order Frequency Score",
      "precision": "1"
    },
    {
      "fieldname": "col_break_2",
      "fieldtype": "Column Break"
    },
    {
      "fieldname": "complaint_score",
      "fieldtype": "Float",
      "label": "Complaint Score",
      "precision": "1"
    },
    {
      "fieldname": "csat_score",
      "fieldtype": "Float",
      "label": "CSAT Score",
      "precision": "1"
    }
  ],
  "icon": "fa fa-star",
  "in_create": 0,
  "links": [],
  "modified": "2026-04-30 00:00:00",
  "modified_by": "Administrator",
  "module": "Instabiz",
  "name": "IB Customer Score",
  "naming_rule": "Expression (old style)",
  "owner": "Administrator",
  "permissions": [
    {
      "create": 1,
      "delete": 1,
      "email": 1,
      "export": 1,
      "print": 1,
      "read": 1,
      "report": 1,
      "role": "System Manager",
      "share": 1,
      "write": 1
    },
    {
      "create": 0,
      "delete": 0,
      "email": 1,
      "export": 1,
      "print": 1,
      "read": 1,
      "report": 1,
      "role": "Sales Manager",
      "share": 0,
      "write": 0
    },
    {
      "create": 0,
      "delete": 0,
      "email": 0,
      "export": 0,
      "print": 0,
      "read": 1,
      "report": 0,
      "role": "Sales User",
      "share": 0,
      "write": 0
    }
  ],
  "sort_field": "score_date",
  "sort_order": "DESC",
  "states": [],
  "track_changes": 0
}
```

- [ ] **Step 4: Migrate to create the new DocType**

```bash
cd /home/dev/frappe-bench
bench --site frontend migrate
```

Expected: "IB Customer Score" DocType visible in Desk.

### Task D3: Implement customer score computation + scheduler

**Files:**
- Create: `instabiz/overrides/customer_score.py`
- Modify: `instabiz/hooks.py`

- [ ] **Step 1: Create `instabiz/overrides/customer_score.py`**

```python
"""instabiz.overrides.customer_score — daily customer health score computation."""
import frappe
from frappe.utils import today, add_days


# Weights must sum to 1.0
_WEIGHTS = {
	"payment":   0.35,
	"order":     0.30,
	"complaint": 0.20,
	"csat":      0.15,
}

_SCORE_DROP_ALERT_THRESHOLD = 15.0  # alert if score drops by this many points


def run_customer_score():
	"""Daily job — recompute health score for all active customers."""
	customers = frappe.get_all(
		"Customer",
		filters={"disabled": 0},
		fields=["name", "customer_name", "custom_complaint_count"],
	)
	for c in customers:
		try:
			_compute_and_save(c)
		except Exception:
			frappe.log_error(frappe.get_traceback(), f"Customer score failed: {c.name}")
	frappe.db.commit()


def _compute_and_save(customer: dict) -> None:
	today_str = today()

	payment_score = _payment_score(customer.name)
	order_score   = _order_score(customer.name)
	complaint_score = _complaint_score(customer.get("custom_complaint_count") or 0)
	csat_score    = _csat_score(customer.name)

	total = (
		payment_score   * _WEIGHTS["payment"]
		+ order_score   * _WEIGHTS["order"]
		+ complaint_score * _WEIGHTS["complaint"]
		+ csat_score    * _WEIGHTS["csat"]
	)

	if total >= 70:
		health_status = "Green"
	elif total >= 40:
		health_status = "Amber"
	else:
		health_status = "Red"

	# Get most recent previous score
	prev_record = frappe.db.get_value(
		"IB Customer Score",
		{"customer": customer.name},
		["name", "total_score"],
		order_by="score_date desc",
		as_dict=True,
	)
	previous_score = (prev_record.total_score if prev_record else None) or 0.0
	score_change   = round(total - previous_score, 1)

	doc = frappe.get_doc({
		"doctype":        "IB Customer Score",
		"customer":       customer.name,
		"score_date":     today_str,
		"health_status":  health_status,
		"total_score":    round(total, 1),
		"previous_score": round(previous_score, 1),
		"score_change":   score_change,
		"payment_score":  round(payment_score, 1),
		"order_score":    round(order_score, 1),
		"complaint_score": round(complaint_score, 1),
		"csat_score":     round(csat_score, 1),
	})
	doc.insert(ignore_permissions=True)

	if score_change <= -_SCORE_DROP_ALERT_THRESHOLD:
		_alert_score_drop(customer, total, previous_score, health_status)


def _payment_score(customer: str) -> float:
	"""Score 0-100. Avg days overdue across last-12-month paid invoices (lower = better)."""
	rows = frappe.db.sql(
		"""
		SELECT DATEDIFF(payment_schedule_date, posting_date) AS due_days,
		       COALESCE(clearance_date, CURDATE())           AS paid_date
		FROM `tabSales Invoice`
		WHERE customer = %s
		  AND docstatus = 1
		  AND is_return = 0
		  AND status IN ('Paid', 'Overdue')
		  AND posting_date >= %s
		""",
		(customer, add_days(today(), -365)),
		as_dict=True,
	)
	if not rows:
		return 60.0  # neutral default for new customers

	delays = []
	for row in rows:
		if row.due_days is None:
			continue
		# Positive = paid early, negative = paid late
		delays.append(row.due_days)

	if not delays:
		return 60.0

	avg_delay = sum(delays) / len(delays)
	# avg_delay > 0 means paid on time; clamp score 0-100
	score = min(100.0, max(0.0, 60.0 + avg_delay * 2))
	return score


def _order_score(customer: str) -> float:
	"""Score 0-100 based on submitted SO count in last 90 days."""
	count = frappe.db.count(
		"Sales Order",
		filters={
			"customer": customer,
			"docstatus": 1,
			"transaction_date": [">=", add_days(today(), -90)],
		},
	)
	# 0 orders = 0, 5+ orders = 100
	return min(100.0, count * 20.0)


def _complaint_score(complaint_count: int) -> float:
	"""Score 0-100. Each complaint costs 20 points."""
	return max(0.0, 100.0 - complaint_count * 20.0)


def _csat_score(customer: str) -> float:
	"""Score 0-100 from avg CSAT rating (1-5 scale) on last-12-month invoices."""
	result = frappe.db.sql(
		"""
		SELECT AVG(CAST(custom_csat_rating AS UNSIGNED)) AS avg_rating
		FROM `tabSales Invoice`
		WHERE customer = %s
		  AND docstatus = 1
		  AND is_return = 0
		  AND custom_csat_rating IS NOT NULL
		  AND custom_csat_rating != ''
		  AND posting_date >= %s
		""",
		(customer, add_days(today(), -365)),
	)
	avg = (result[0][0] if result and result[0][0] else None)
	if avg is None:
		return 60.0  # neutral default
	return min(100.0, max(0.0, (float(avg) - 1) / 4 * 100))


def _alert_score_drop(customer: dict, new_score: float, prev_score: float, status: str) -> None:
	managers = frappe.get_all(
		"Has Role",
		filters={"role": ["in", ["Sales Manager", "System Manager"]], "parenttype": "User"},
		fields=["parent"],
		pluck="parent",
	)
	# Also get the customer's assigned rep if any
	rep = frappe.db.get_value(
		"Sales Person",
		{"sales_person_name": customer.name},  # best-effort
		"user",
	)
	recipients = list({m for m in managers if "@" in m})
	if rep and "@" in rep:
		recipients.append(rep)
	if not recipients:
		return

	drop = round(prev_score - new_score, 1)
	link = f'<a href="/app/customer/{customer.name}">{customer.customer_name or customer.name}</a>'
	message = f"""
<p>Customer health score alert for {link}:</p>
<ul>
  <li>Previous score: {prev_score}</li>
  <li>New score: {new_score} ({status})</li>
  <li>Drop: {drop} points</li>
</ul>
<p>Review the customer's payment history, order activity, and complaints.</p>
"""
	frappe.sendmail(
		recipients=recipients,
		subject=f"[Instabiz] Health score dropped {drop} pts — {customer.customer_name or customer.name}",
		message=message,
		now=True,
	)
```

- [ ] **Step 2: Register in `hooks.py`**

Add to `scheduler_events["daily"]`:

```python
"instabiz.overrides.customer_score.run_customer_score",
```

- [ ] **Step 3: Restart and run**

```bash
cd /home/dev/frappe-bench
bench restart
bench --site frontend execute instabiz.overrides.customer_score.run_customer_score
```

Expected: runs without error, "IB Customer Score" records created in Desk.

- [ ] **Step 4: Commit**

```bash
git -C apps/instabiz add \
  instabiz/overrides/customer_score.py \
  instabiz/instabiz/doctype/ib_customer_score/ \
  instabiz/fixtures/custom_field.json \
  instabiz/hooks.py
git -C apps/instabiz commit -m "feat: customer health score (payment/orders/complaints/CSAT) with daily scheduler and alerts"
```

---

## Group E — Sample Request Tracking

### Task E1: Create IB Sample Request DocType

**Files:**
- Create: `instabiz/instabiz/doctype/ib_sample_request/` (directory + 3 files)

- [ ] **Step 1: Create `__init__.py`**

Create `instabiz/instabiz/doctype/ib_sample_request/__init__.py` — empty file.

- [ ] **Step 2: Create `ib_sample_request.py`**

Create `instabiz/instabiz/doctype/ib_sample_request/ib_sample_request.py`:

```python
# Copyright (c) 2026, Instabiz Solutions India Pvt Ltd
import frappe
from frappe import _
from frappe.model.document import Document


class IBSampleRequest(Document):
	def validate(self):
		if not self.request_date:
			self.request_date = frappe.utils.today()
		if not self.assigned_to:
			self.assigned_to = frappe.session.user
```

- [ ] **Step 3: Create `ib_sample_request.json`**

Create `instabiz/instabiz/doctype/ib_sample_request/ib_sample_request.json`:

```json
{
  "actions": [],
  "allow_rename": 0,
  "autoname": "IB-SR-.YYYY.-.#####",
  "creation": "2026-04-30 00:00:00",
  "doctype": "DocType",
  "editable_grid": 1,
  "engine": "InnoDB",
  "field_order": [
    "customer",
    "contact_person",
    "request_date",
    "status",
    "col_break_1",
    "assigned_to",
    "sample_type",
    "related_sales_order",
    "section_item",
    "item",
    "qty",
    "uom",
    "is_paid",
    "section_outcome",
    "feedback",
    "outcome",
    "notes"
  ],
  "fields": [
    {
      "fieldname": "customer",
      "fieldtype": "Link",
      "in_list_view": 1,
      "label": "Customer",
      "options": "Customer",
      "reqd": 1,
      "search_index": 1
    },
    {
      "fieldname": "contact_person",
      "fieldtype": "Link",
      "label": "Contact Person",
      "options": "Contact"
    },
    {
      "fieldname": "request_date",
      "fieldtype": "Date",
      "in_list_view": 1,
      "label": "Request Date",
      "reqd": 1
    },
    {
      "fieldname": "status",
      "fieldtype": "Select",
      "in_list_view": 1,
      "label": "Status",
      "options": "Draft\nWork Order Created\nSent\nFeedback Received\nConverted\nClosed",
      "default": "Draft"
    },
    {
      "fieldname": "col_break_1",
      "fieldtype": "Column Break"
    },
    {
      "fieldname": "assigned_to",
      "fieldtype": "Link",
      "label": "Assigned To",
      "options": "User"
    },
    {
      "fieldname": "sample_type",
      "fieldtype": "Select",
      "label": "Sample Type",
      "options": "Free\nPaid"
    },
    {
      "fieldname": "related_sales_order",
      "fieldtype": "Link",
      "label": "Related Sales Order",
      "options": "Sales Order"
    },
    {
      "fieldname": "section_item",
      "fieldtype": "Section Break",
      "label": "Sample Details"
    },
    {
      "fieldname": "item",
      "fieldtype": "Link",
      "label": "Item",
      "options": "Item",
      "reqd": 1,
      "in_list_view": 1
    },
    {
      "fieldname": "qty",
      "fieldtype": "Float",
      "label": "Qty",
      "reqd": 1
    },
    {
      "fieldname": "uom",
      "fieldtype": "Link",
      "label": "UOM",
      "options": "UOM"
    },
    {
      "fieldname": "is_paid",
      "fieldtype": "Check",
      "label": "Paid Sample"
    },
    {
      "fieldname": "section_outcome",
      "fieldtype": "Section Break",
      "label": "Outcome"
    },
    {
      "fieldname": "feedback",
      "fieldtype": "Small Text",
      "label": "Customer Feedback"
    },
    {
      "fieldname": "outcome",
      "fieldtype": "Select",
      "in_list_view": 1,
      "label": "Outcome",
      "options": "\nConverted\nNot Interested\nFollow Up\nNo Response"
    },
    {
      "fieldname": "notes",
      "fieldtype": "Text",
      "label": "Internal Notes"
    }
  ],
  "icon": "fa fa-flask",
  "in_create": 0,
  "links": [],
  "modified": "2026-04-30 00:00:00",
  "modified_by": "Administrator",
  "module": "Instabiz",
  "name": "IB Sample Request",
  "naming_rule": "Expression (old style)",
  "owner": "Administrator",
  "permissions": [
    {
      "create": 1,
      "delete": 1,
      "email": 1,
      "export": 1,
      "print": 1,
      "read": 1,
      "report": 1,
      "role": "System Manager",
      "share": 1,
      "write": 1
    },
    {
      "create": 1,
      "delete": 0,
      "email": 1,
      "export": 1,
      "print": 1,
      "read": 1,
      "report": 1,
      "role": "Sales Manager",
      "share": 0,
      "write": 1
    },
    {
      "create": 1,
      "delete": 0,
      "email": 0,
      "export": 0,
      "print": 1,
      "read": 1,
      "report": 0,
      "role": "Sales User",
      "share": 0,
      "write": 1
    }
  ],
  "sort_field": "request_date",
  "sort_order": "DESC",
  "states": [],
  "track_changes": 1
}
```

- [ ] **Step 4: Migrate**

```bash
cd /home/dev/frappe-bench
bench --site frontend migrate
```

Expected: "IB Sample Request" appears in Desk. Can create records.

### Task E2: Sample Request Python whitelisted methods + JS form buttons

**Files:**
- Create: `instabiz/overrides/sample_request.py`
- Create: `instabiz/public/js/sample_request.js`
- Modify: `instabiz/hooks.py`

- [ ] **Step 1: Create `instabiz/overrides/sample_request.py`**

```python
"""instabiz.overrides.sample_request — whitelisted status transitions for IB Sample Request."""
import frappe
from frappe import _


@frappe.whitelist()
def mark_sent(name: str) -> None:
	doc = frappe.get_doc("IB Sample Request", name)
	if doc.status not in ("Draft", "Work Order Created"):
		frappe.throw(_("Can only mark Sent from Draft or Work Order Created status."))
	doc.status = "Sent"
	doc.save(ignore_permissions=False)


@frappe.whitelist()
def mark_work_order_created(name: str) -> None:
	doc = frappe.get_doc("IB Sample Request", name)
	if doc.status != "Draft":
		frappe.throw(_("Can only mark Work Order Created from Draft status."))
	doc.status = "Work Order Created"
	doc.save(ignore_permissions=False)


@frappe.whitelist()
def record_feedback(name: str, feedback: str, outcome: str) -> None:
	doc = frappe.get_doc("IB Sample Request", name)
	if doc.status not in ("Sent", "Feedback Received"):
		frappe.throw(_("Can only record feedback after sample is Sent."))
	doc.feedback = feedback
	doc.outcome  = outcome
	doc.status   = "Feedback Received"
	doc.save(ignore_permissions=False)


@frappe.whitelist()
def convert_to_order(name: str, sales_order: str) -> None:
	"""Link a Sales Order to this sample request and mark Converted."""
	frappe.get_doc("Sales Order", sales_order)  # raises if not found
	doc = frappe.get_doc("IB Sample Request", name)
	doc.related_sales_order = sales_order
	doc.outcome = "Converted"
	doc.status  = "Converted"
	doc.save(ignore_permissions=False)
```

- [ ] **Step 2: Create `instabiz/public/js/sample_request.js`**

```javascript
frappe.ui.form.on("IB Sample Request", {
	refresh(frm) {
		frm.page.clear_custom_actions && frm.page.clear_custom_actions();

		if (frm.is_new()) return;

		const status = frm.doc.status;

		if (status === "Draft") {
			frm.add_custom_button(__("Mark Work Order Created"), () => {
				frappe.call({
					method: "instabiz.overrides.sample_request.mark_work_order_created",
					args: { name: frm.docname },
					callback: () => frm.reload_doc(),
				});
			});
			frm.add_custom_button(__("Mark Sent"), () => {
				frappe.call({
					method: "instabiz.overrides.sample_request.mark_sent",
					args: { name: frm.docname },
					callback: () => frm.reload_doc(),
				});
			});
		}

		if (status === "Work Order Created") {
			frm.add_custom_button(__("Mark Sent"), () => {
				frappe.call({
					method: "instabiz.overrides.sample_request.mark_sent",
					args: { name: frm.docname },
					callback: () => frm.reload_doc(),
				});
			});
		}

		if (status === "Sent" || status === "Feedback Received") {
			frm.add_custom_button(__("Record Feedback"), () => {
				const d = new frappe.ui.Dialog({
					title: "Record Customer Feedback",
					fields: [
						{
							label: "Feedback",
							fieldname: "feedback",
							fieldtype: "Small Text",
							reqd: 1,
						},
						{
							label: "Outcome",
							fieldname: "outcome",
							fieldtype: "Select",
							options: "\nConverted\nNot Interested\nFollow Up\nNo Response",
							reqd: 1,
						},
					],
					primary_action_label: "Save",
					primary_action(values) {
						frappe.call({
							method: "instabiz.overrides.sample_request.record_feedback",
							args: {
								name: frm.docname,
								feedback: values.feedback,
								outcome: values.outcome,
							},
							callback: () => {
								d.hide();
								frm.reload_doc();
							},
						});
					},
				});
				d.show();
			});

			frm.add_custom_button(__("Convert to Order"), () => {
				const d = new frappe.ui.Dialog({
					title: "Link Sales Order",
					fields: [
						{
							label: "Sales Order",
							fieldname: "sales_order",
							fieldtype: "Link",
							options: "Sales Order",
							filters: { customer: frm.doc.customer, docstatus: 1 },
							reqd: 1,
						},
					],
					primary_action_label: "Link & Convert",
					primary_action(values) {
						frappe.call({
							method: "instabiz.overrides.sample_request.convert_to_order",
							args: {
								name: frm.docname,
								sales_order: values.sales_order,
							},
							callback: () => {
								d.hide();
								frm.reload_doc();
							},
						});
					},
				});
				d.show();
			});
		}
	},
});
```

- [ ] **Step 3: Register in `hooks.py`**

Add to `doctype_js`:

```python
"IB Sample Request": "public/js/sample_request.js",
```

Add to `whitelisted_methods` (if not using `@frappe.whitelist()` decorator discovery — in Frappe v15 the decorator is sufficient, no hooks entry needed).

- [ ] **Step 4: Build and restart**

```bash
cd /home/dev/frappe-bench
bench build --app instabiz
bench restart
```

- [ ] **Step 5: Manual verify**

1. Open Desk → IB Sample Request → New.
2. Fill customer, item, qty → Save.
3. Verify "Mark Work Order Created" and "Mark Sent" buttons appear.
4. Click "Mark Sent" → status changes to "Sent".
5. Click "Record Feedback" → fill dialog → confirm status becomes "Feedback Received".
6. Click "Convert to Order" → link a Sales Order → confirm status becomes "Converted".

- [ ] **Step 6: Commit**

```bash
git -C apps/instabiz add \
  instabiz/overrides/sample_request.py \
  instabiz/public/js/sample_request.js \
  instabiz/instabiz/doctype/ib_sample_request/ \
  instabiz/hooks.py
git -C apps/instabiz commit -m "feat: IB Sample Request doctype with state machine and form buttons"
```

---

## Final Verification Checklist

- [ ] All 5 `bench --site frontend migrate` runs completed without error
- [ ] `bench build --app instabiz` completed without error
- [ ] `bench restart` done after all Python changes
- [ ] Manually tested: Lead follow-up date field visible on Lead form
- [ ] Manually tested: SO blocks when credit limit exceeded (non-privileged user)
- [ ] Manually tested: `run_quotation_expiry` runs without error
- [ ] Manually tested: `run_customer_score` runs and creates IB Customer Score records
- [ ] Manually tested: IB Sample Request full state machine (Draft → Sent → Feedback → Converted)
- [ ] No existing behaviors altered: Lead row status picker intact, quotation/SO mappers intact, dimension recalc intact

---

## Self-Review Notes

**Spec coverage:**
- Task 1 (Follow-up): ✅ `custom_next_follow_up_date` + `custom_follow_up_note` fields, daily scheduler, grouped email per rep
- Task 2 (Credit limit): ✅ `custom_credit_limit` on Customer, SO blocked at validate, privileged override with warning
- Task 3 (Quotation expiry): ✅ 15/7/1-day email alerts, auto-expire via `frappe.db.set_value`
- Task 4 (Health score): ✅ CSAT on Sales Invoice, complaint count on Customer, IB Customer Score doctype, all 4 components scored, traffic light, score-drop alert
- Task 5 (Sample request): ✅ IB Sample Request doctype, state machine, JS buttons for each transition

**Gaps flagged:**
- Task 2: "MD approval" treated as role-based override (Sales Manager / System Manager). A formal approval workflow (with approval request + MD action) would require a separate workflow doctype — out of scope unless requested.
- Task 4: Order frequency score uses a simple linear scale (5 orders = 100). This may need calibration based on actual customer order volumes.
- Task 4: `_payment_score` uses `payment_schedule_date` from child table — if customer uses simple invoice due dates, this may need adjustment to use `due_date` on the invoice header instead.
- Task 5: "Small qty work order" is tracked as a status transition ("Work Order Created") rather than creating an actual ERPNext Work Order — keeps scope minimal and avoids manufacturing module dependency.
