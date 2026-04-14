import frappe

COMPANY = "Instabiz Solutions India Pvt Ltd"

def run():
	for fy_name in ["2025-2026", "2026-2027"]:
		doc = frappe.get_doc("Fiscal Year", fy_name)
		already = any(c.company == COMPANY for c in doc.companies)
		if not already:
			doc.append("companies", {"company": COMPANY})
			doc.save(ignore_permissions=True)
			print(f"  ✓ Linked {fy_name} → {COMPANY}")
		else:
			print(f"  · Already linked: {fy_name}")
	frappe.db.commit()
	print("Done.")
