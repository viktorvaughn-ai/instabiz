"""
One-time backfill: create Address records from Customer.custom_billing / custom_shipping fields.
Run: bench --site frontend execute instabiz.overrides.backfill_addresses.run
"""
import frappe
from frappe.utils import now


def _insert_address_raw(name, title, atype, line1, line2, city, state, pincode, country, gstin, gst_cat, customer):
	"""Direct SQL insert — bypasses all validation hooks (india_compliance etc.)."""
	now_ts = now()
	frappe.db.sql("""
		INSERT IGNORE INTO `tabAddress`
		    (name, creation, modified, modified_by, owner, docstatus,
		     address_title, address_type, address_line1, address_line2,
		     city, state, pincode, country, gstin, gst_category)
		VALUES (%s, %s, %s, 'Administrator', 'Administrator', 0,
		        %s, %s, %s, %s,
		        %s, %s, %s, %s, %s, %s)
	""", (name, now_ts, now_ts,
	      title, atype, line1, line2,
	      city, state, pincode, country, gstin, gst_cat))

	# link to customer
	frappe.db.sql("""
		INSERT IGNORE INTO `tabDynamic Link`
		    (name, creation, modified, modified_by, owner, docstatus,
		     parent, parenttype, parentfield, link_doctype, link_name)
		VALUES (%s, %s, %s, 'Administrator', 'Administrator', 0,
		        %s, 'Address', 'links', 'Customer', %s)
	""", (f"{name}-link-{customer[:20]}", now_ts, now_ts, name, customer))


def run(dry_run=False):
	customers = frappe.db.sql("""
		SELECT c.name, c.customer_name,
		       c.custom_billing, c.custom_bt_city, c.custom_bt_state, c.custom_bt_pincode,
		       c.custom_shipping, c.custom_st_city, c.custom_st_state, c.custom_st_pincode,
		       c.gstin, c.gst_category
		FROM `tabCustomer` c
		WHERE NOT EXISTS (
		    SELECT 1 FROM `tabDynamic Link` dl
		    WHERE dl.link_doctype = 'Customer'
		      AND dl.link_name = c.name
		      AND dl.parenttype = 'Address'
		)
		AND custom_billing IS NOT NULL AND custom_billing != ''
		ORDER BY c.name
	""", as_dict=True)

	created = 0
	skipped = 0
	errors = []

	for c in customers:
		try:
			bill_text = (c.custom_billing or "").strip()
			ship_text = (c.custom_shipping or "").strip()
			same_addr = bill_text == ship_text

			# ── Billing Address ──────────────────────────────────────────────
			bill_name = f"{c.name}-Billing"
			if not frappe.db.exists("Address", bill_name):
				if not dry_run:
					frappe.flags.in_import = True
					bill_addr = frappe.get_doc({
						"doctype":       "Address",
						"address_title": c.name,
						"address_type":  "Billing",
						"address_line1": bill_text[:140],
						"address_line2": bill_text[140:280] if len(bill_text) > 140 else "",
						"city":          c.custom_bt_city or "—",
						"state":         c.custom_bt_state or "",
						"pincode":       c.custom_bt_pincode or "",
						"country":       "India",
						"gstin":         c.gstin or "",
						"gst_category":  c.gst_category or "Unregistered",
						"links": [{
							"link_doctype": "Customer",
							"link_name":    c.name,
						}],
					})
					bill_addr.name = bill_name
					bill_addr.insert(ignore_permissions=True, ignore_mandatory=True)
					frappe.flags.in_import = False
					created += 1

					# set as primary address on customer
					frappe.db.set_value("Customer", c.name, "customer_primary_address", bill_name)
				else:
					print(f"  DRY BILLING: {bill_name} | {bill_text[:60]} | {c.custom_bt_city} {c.custom_bt_state} {c.custom_bt_pincode}")
					created += 1

			# ── Shipping Address (only if different) ─────────────────────────
			if not same_addr and ship_text:
				ship_name = f"{c.name}-Shipping"
				if not frappe.db.exists("Address", ship_name):
					if not dry_run:
						frappe.flags.in_import = True
						ship_addr = frappe.get_doc({
							"doctype":       "Address",
							"address_title": c.name,
							"address_type":  "Shipping",
							"address_line1": ship_text[:140],
							"address_line2": ship_text[140:280] if len(ship_text) > 140 else "",
							"city":          c.custom_st_city or "—",
							"state":         c.custom_st_state or "",
							"pincode":       c.custom_st_pincode or "",
							"country":       "India",
							"gstin":         c.gstin or "",
							"gst_category":  c.gst_category or "Unregistered",
							"links": [{
								"link_doctype": "Customer",
								"link_name":    c.name,
							}],
						})
						ship_addr.name = ship_name
						ship_addr.insert(ignore_permissions=True, ignore_mandatory=True)
						frappe.flags.in_import = False
						created += 1
					else:
						print(f"  DRY SHIPPING: {ship_name} | {ship_text[:60]} | {c.custom_st_city}")
						created += 1

			# commit every 50 customers to avoid huge transactions
			if not dry_run and created % 50 == 0:
				frappe.db.commit()

		except Exception as e:
			if ("State is a required field" in str(e) or "valid State" in str(e)) and not dry_run:
				# india_compliance blocks empty state — insert raw SQL, user cleans state later
				try:
					bill_name = f"{c.name}-Billing"
					bill_text = (c.custom_billing or "").strip()
					ship_text = (c.custom_shipping or "").strip()
					same_addr = bill_text == ship_text
					country = "India" if (c.custom_bt_state or c.custom_bt_city) else "Other"
					if not frappe.db.exists("Address", bill_name):
						_insert_address_raw(
							bill_name, c.name, "Billing",
							bill_text[:140], bill_text[140:280] if len(bill_text) > 140 else "",
							c.custom_bt_city or "—", c.custom_bt_state or "",
							c.custom_bt_pincode or "", country,
							c.gstin or "", c.gst_category or "Unregistered", c.name,
						)
						frappe.db.set_value("Customer", c.name, "customer_primary_address", bill_name)
						created += 1
					if not same_addr and ship_text:
						ship_name = f"{c.name}-Shipping"
						if not frappe.db.exists("Address", ship_name):
							_insert_address_raw(
								ship_name, c.name, "Shipping",
								ship_text[:140], ship_text[140:280] if len(ship_text) > 140 else "",
								c.custom_st_city or "—", c.custom_st_state or "",
								c.custom_st_pincode or "", country,
								c.gstin or "", c.gst_category or "Unregistered", c.name,
							)
							created += 1
				except Exception as e2:
					errors.append(f"{c.name} (raw): {e2}")
					skipped += 1
			else:
				errors.append(f"{c.name}: {e}")
				skipped += 1

	if not dry_run:
		frappe.db.commit()

	print(f"\nDone. Created: {created} addresses | Skipped/errors: {skipped}")
	if errors:
		print("Errors:")
		for e in errors[:20]:
			print(" ", e)
