import frappe
from erpnext.selling.doctype.customer.customer import Customer, get_customer_outstanding


class CustomCustomer(Customer):
	def validate(self):
		# Prevent the lead_name fetch (add_fetch in customer.js) from
		# overwriting customer_name on existing records.
		if not self.is_new():
			saved_name = frappe.db.get_value("Customer", self.name, "customer_name")
			if saved_name:
				self.customer_name = saved_name
		super().validate()

	def onload(self):
		super().onload()
		_backfill_inline_fields(self)

	def after_save(self):
		try:
			_sync_addresses(self)
			_sync_contact(self)
		except Exception:
			frappe.log_error(title="IB Customer address sync failed", message=frappe.get_traceback())


# ── Backfill ──────────────────────────────────────────────────────────────────

def _backfill_inline_fields(doc):
	"""On load: populate inline custom address/contact fields from native linked docs if blank."""
	needs_billing = not doc.custom_billing
	needs_shipping = not doc.custom_shipping
	needs_contact = not doc.custom_contact_person_name

	if needs_billing or needs_shipping:
		linked_addrs = frappe.get_all(
			"Dynamic Link",
			filters={"link_doctype": "Customer", "link_name": doc.name, "parenttype": "Address"},
			fields=["parent"],
		)
		for row in linked_addrs:
			vals = frappe.db.get_value(
				"Address", row["parent"],
				["address_type", "address_line1", "city", "state", "pincode"],
			)
			if not vals:
				continue
			addr_type, line1, city, state, pincode = vals
			if needs_billing and addr_type == "Billing":
				doc.custom_billing = line1 or ""
				doc.custom_bt_city = city or ""
				doc.custom_bt_state = state or ""
				doc.custom_bt_pincode = pincode or ""
				needs_billing = False
			elif needs_shipping and addr_type == "Shipping":
				doc.custom_shipping = line1 or ""
				doc.custom_st_city = city or ""
				doc.custom_st_state = state or ""
				doc.custom_st_pincode = pincode or ""
				needs_shipping = False
			if not needs_billing and not needs_shipping:
				break

	if needs_contact:
		linked_contacts = frappe.get_all(
			"Dynamic Link",
			filters={"link_doctype": "Customer", "link_name": doc.name, "parenttype": "Contact"},
			fields=["parent"],
			limit=1,
		)
		if linked_contacts:
			try:
				contact = frappe.get_doc("Contact", linked_contacts[0]["parent"])
				doc.custom_contact_person_name = contact.first_name or ""
				for p in contact.phone_nos:
					if p.is_primary_mobile_no:
						doc.custom_primary_contact_person = p.phone
						break
				else:
					if contact.phone_nos:
						doc.custom_primary_contact_person = contact.phone_nos[0].phone
			except Exception:
				pass


# ── Sync: custom fields → native Address/Contact doctypes ─────────────────────

def _sync_addresses(doc):
	if not doc.custom_billing:
		return

	billing_name = _upsert_address(
		doc.name, doc.customer_name, "Billing",
		doc.custom_billing, doc.custom_bt_city, doc.custom_bt_state, doc.custom_bt_pincode,
	)
	frappe.db.set_value("Customer", doc.name, "customer_primary_address", billing_name)

	if doc.custom_bill_and_ship_to_same_address or not doc.custom_shipping:
		return

	_upsert_address(
		doc.name, doc.customer_name, "Shipping",
		doc.custom_shipping, doc.custom_st_city, doc.custom_st_state, doc.custom_st_pincode,
	)


def _upsert_address(customer_name, customer_display, addr_type, line1, city, state, pincode):
	"""Find or create an Address of addr_type linked to customer. Returns address name."""
	linked = frappe.get_all(
		"Dynamic Link",
		filters={"link_doctype": "Customer", "link_name": customer_name, "parenttype": "Address"},
		fields=["parent"],
	)
	existing_name = None
	for row in linked:
		t = frappe.db.get_value("Address", row["parent"], "address_type")
		if t == addr_type:
			existing_name = row["parent"]
			break

	if existing_name:
		addr = frappe.get_doc("Address", existing_name)
	else:
		addr = frappe.new_doc("Address")
		addr.address_title = f"{customer_display} - {addr_type}"
		addr.address_type = addr_type
		addr.country = "India"
		addr.append("links", {"link_doctype": "Customer", "link_name": customer_name})

	addr.address_line1 = line1 or ""
	addr.city = city or ""
	addr.state = state or ""
	addr.pincode = pincode or ""
	addr.flags.ignore_mandatory = True
	addr.save(ignore_permissions=True)
	return addr.name


def _sync_contact(doc):
	if not doc.custom_contact_person_name and not doc.custom_primary_contact_person:
		return

	linked = frappe.get_all(
		"Dynamic Link",
		filters={"link_doctype": "Customer", "link_name": doc.name, "parenttype": "Contact"},
		fields=["parent"],
		limit=1,
	)

	if linked:
		contact = frappe.get_doc("Contact", linked[0]["parent"])
	else:
		contact = frappe.new_doc("Contact")
		contact.append("links", {"link_doctype": "Customer", "link_name": doc.name})

	contact.first_name = doc.custom_contact_person_name or doc.customer_name
	contact.last_name = ""

	if doc.custom_primary_contact_person:
		contact.phone_nos = []
		contact.append("phone_nos", {
			"phone": doc.custom_primary_contact_person,
			"is_primary_mobile_no": 1,
		})

	contact.flags.ignore_mandatory = True
	contact.save(ignore_permissions=True)
	frappe.db.set_value("Customer", doc.name, "customer_primary_contact", contact.name)


# ── Whitelisted helpers ───────────────────────────────────────────────────────

@frappe.whitelist()
def get_outstanding(customer):
	company = frappe.defaults.get_global_default("company")
	return get_customer_outstanding(customer, company)
