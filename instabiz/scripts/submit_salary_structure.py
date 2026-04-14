import frappe

def run():
	doc = frappe.get_doc("Salary Structure", "IB Payroll")
	doc.submit()
	frappe.db.commit()
	print(f"Submitted: {doc.name} (docstatus={doc.docstatus})")
