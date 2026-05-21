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


@frappe.whitelist()
def get_outstanding(customer):
    company = frappe.defaults.get_global_default("company")
    return get_customer_outstanding(customer, company)
