import frappe
from frappe.utils import flt
from erpnext.selling.doctype.customer.customer import Customer


def compute_customer_outstanding(customer):
	"""Sum outstanding_amount of all submitted, unpaid Sales Invoices for this customer.

	ERPNext maintains SI.outstanding_amount in real-time as Payment Entries are
	submitted / cancelled, so this is the authoritative single source of truth.
	Returns 0.0 if no open invoices exist.
	"""
	result = frappe.db.sql(
		"SELECT COALESCE(SUM(outstanding_amount), 0) FROM `tabSales Invoice`"
		" WHERE customer = %s AND docstatus = 1 AND outstanding_amount > 0",
		customer,
	)
	return flt(result[0][0] if result else 0)


def refresh_customer_outstanding(customer):
	"""Compute and persist custom_outstanding_amount to the Customer record."""
	value = compute_customer_outstanding(customer)
	frappe.db.set_value("Customer", customer, "custom_outstanding_amount", value)


def update_customer_outstanding_on_si(doc, method=None):
	"""doc_event handler: SI on_submit / on_cancel."""
	if doc.customer:
		refresh_customer_outstanding(doc.customer)


class CustomCustomer(Customer):
	def before_insert(self):
		# Auto-assign creating user as the Handled By sales person if not already set.
		# Skip for Administrator and system users who create customers on behalf of others.
		if (
			not self.get("custom_sales_person_user")
			and frappe.session.user not in ("Administrator", "Guest")
		):
			from instabiz.overrides.utils import set_sales_person
			set_sales_person(self)

	def validate(self):
		# Prevent the lead_name fetch (add_fetch in customer.js) from
		# overwriting customer_name on existing records.
		if not self.is_new():
			saved_name = frappe.db.get_value("Customer", self.name, "customer_name")
			if saved_name:
				self.customer_name = saved_name
		_sync_territory_from_billing_state(self)
		super().validate()

	def onload(self):
		super().onload()
		_backfill_inline_fields(self)
		# Always show live outstanding on form load — no DB write needed here;
		# SI and PE events keep the persisted value current for list views.
		self.custom_outstanding_amount = compute_customer_outstanding(self.name)

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


# ── Territory sync from billing state ────────────────────────────────────────

# Handles common abbreviations and alternate spellings in billing state field
_STATE_ALIASES = {
	"tamilnadu": "Tamil Nadu",
	"tn": "Tamil Nadu",
	"mh": "Maharashtra",
	"gj": "Gujarat",
	"gujrat": "Gujarat",
	"wb": "West Bengal",
	"ap": "Andhra Pradesh",
	"ka": "Karnataka",
	"kl": "Kerala",
	"up": "Uttar Pradesh",
	"mp": "Madhya Pradesh",
	"rj": "Rajasthan",
	"hr": "Haryana",
	"pb": "Punjab",
	"ts": "Telangana",
	"od": "Odisha",
	"uk": "Uttarakhand",
	"hp": "Himachal Pradesh",
	"jh": "Jharkhand",
	"ga": "Goa",
	"dl": "Delhi",
	"dd": "Daman & Diu",
	"dn": "Dadra & Nagar",
	"dadra and nagar haveli and daman and diu": "Daman & Diu",
	"dadra & nagar haveli": "Dadra & Nagar",
}


def _sync_territory_from_billing_state(doc):
	"""Derive territory from billing state and set it on the Customer.

	Fires in validate() so territory is always consistent with billing address.
	Skips if billing state is blank. Falls back to alias map for common
	abbreviations/variations before giving up.
	"""
	state = (doc.custom_bt_state or "").strip()
	if not state:
		return

	# Exact match against Territory names (case-insensitive)
	territory = frappe.db.get_value("Territory", {"name": state})
	if not territory:
		# Try case-insensitive exact match via SQL
		rows = frappe.db.sql(
			"SELECT name FROM `tabTerritory` WHERE LOWER(name) = LOWER(%s) AND is_group = 0 LIMIT 1",
			state,
		)
		territory = rows[0][0] if rows else None

	if not territory:
		# Alias fallback
		canonical = _STATE_ALIASES.get(state.lower())
		if canonical:
			territory = frappe.db.get_value("Territory", canonical) or canonical

	if territory and territory != doc.territory:
		doc.territory = territory


@frappe.whitelist()
def backfill_territory_from_billing_state():
	"""One-time or on-demand fix: set territory = billing state for all
	customers where they differ. Sales Manager / System Manager only."""
	from instabiz.overrides.permissions import _PRIVILEGED_ROLES
	if not (_PRIVILEGED_ROLES & set(frappe.get_roles())):
		frappe.throw(frappe._("Not permitted"), frappe.PermissionError)

	customers = frappe.db.sql(
		"""
		SELECT name, territory, custom_bt_state
		FROM `tabCustomer`
		WHERE custom_bt_state IS NOT NULL AND custom_bt_state != ''
		AND (territory IS NULL OR territory = ''
		     OR LOWER(territory) != LOWER(custom_bt_state))
		""",
		as_dict=True,
	)

	updated = []
	skipped = []
	for c in customers:
		state = (c.custom_bt_state or "").strip()
		territory = frappe.db.get_value("Territory", {"name": state})
		if not territory:
			rows = frappe.db.sql(
				"SELECT name FROM `tabTerritory` WHERE LOWER(name) = LOWER(%s) AND is_group = 0 LIMIT 1",
				state,
			)
			territory = rows[0][0] if rows else None
		if not territory:
			canonical = _STATE_ALIASES.get(state.lower())
			if canonical:
				territory = frappe.db.get_value("Territory", canonical) or None

		if territory:
			frappe.db.set_value("Customer", c.name, "territory", territory, update_modified=False)
			updated.append({"customer": c.name, "old": c.territory, "new": territory})
		else:
			skipped.append({"customer": c.name, "bt_state": c.custom_bt_state})

	frappe.db.commit()
	return {"updated": len(updated), "skipped": len(skipped), "details": updated, "unresolved": skipped}


# ── Whitelisted helpers ───────────────────────────────────────────────────────

@frappe.whitelist()
def get_outstanding(customer):
	return compute_customer_outstanding(customer)


@frappe.whitelist()
def clear_overdue_block(customer):
	"""Manually lift the overdue block flag. Sales Manager / System Manager only."""
	from instabiz.overrides.permissions import _PRIVILEGED_ROLES
	if not (_PRIVILEGED_ROLES & set(frappe.get_roles())):
		frappe.throw(frappe._("Not permitted"), frappe.PermissionError)
	frappe.db.set_value("Customer", customer, "custom_overdue_block", 0, update_modified=False)
	actor = frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user
	frappe.get_doc({
		"doctype": "Comment",
		"comment_type": "Info",
		"reference_doctype": "Customer",
		"reference_name": customer,
		"content": f"Overdue block manually cleared by {actor}.",
		"owner": frappe.session.user,
	}).insert(ignore_permissions=True)
	return "ok"


@frappe.whitelist()
def log_customer_activity(customer, activity_type, outcome, notes):
	"""Log a call/meeting/WA/email/visit activity on a Customer timeline."""
	if not frappe.has_permission("Customer", "write", customer):
		frappe.throw(frappe._("Not permitted"), frappe.PermissionError)

	VALID_TYPES = {"Call", "Meeting", "WhatsApp", "Email", "Visit"}
	VALID_OUTCOMES = {"Interested", "Not Interested", "Follow Up", "No Response"}
	if activity_type not in VALID_TYPES:
		frappe.throw(frappe._("Invalid activity type"))
	if outcome not in VALID_OUTCOMES:
		frappe.throw(frappe._("Invalid outcome"))

	actor = frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user
	icon_map = {"Call": "📞", "Meeting": "🤝", "WhatsApp": "💬", "Email": "📧", "Visit": "📍"}

	parts = [f"{icon_map[activity_type]} <b>{activity_type}</b> — Outcome: <b>{outcome}</b>"]
	if notes:
		parts.append(frappe.utils.escape_html(notes).replace("\n", "<br>"))
	parts.append(f"<i>Logged by {actor}</i>")

	frappe.get_doc({
		"doctype": "Comment",
		"comment_type": "Info",
		"reference_doctype": "Customer",
		"reference_name": customer,
		"content": "<br>".join(parts),
		"owner": frappe.session.user,
	}).insert(ignore_permissions=True)

	return "ok"


@frappe.whitelist()
def get_customer_phones(customers):
	import json
	names = json.loads(customers)
	if not names:
		return {}
	rows = frappe.db.sql(
		"""
		SELECT dl.link_name AS customer, cp.phone
		FROM `tabContact Phone` cp
		JOIN `tabDynamic Link` dl ON dl.parent = cp.parent
		WHERE dl.link_doctype = 'Customer'
		  AND dl.link_name IN %(names)s
		ORDER BY cp.is_primary_mobile_no DESC, cp.idx ASC
		""",
		{"names": names},
		as_dict=True,
	)
	# Keep first phone per customer
	result = {}
	for r in rows:
		if r.customer not in result:
			result[r.customer] = (r.phone or "").strip()
	return result
