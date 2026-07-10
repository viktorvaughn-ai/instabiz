"""One-time script to add performance indexes. Run via bench execute."""
import frappe


def add_performance_indexes():
	def _idx_exists(table, index_name):
		return frappe.db.sql(
			"SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s AND INDEX_NAME=%s LIMIT 1",
			(table, index_name),
		)

	INDEXES = [
		("tabSales Invoice", "idx_si_sp_user", ["custom_sales_person_user"]),
		("tabSales Invoice", "idx_si_ds_return_date", ["docstatus", "is_return", "posting_date"]),
		("tabSales Invoice", "idx_si_sp_date", ["custom_sales_person_user", "posting_date"]),
		("tabCustomer", "idx_cust_sp_user", ["custom_sales_person_user"]),
		("tabCustomer", "idx_cust_territory", ["territory"]),
		("tabLead", "idx_lead_custom_status", ["custom_status"]),
		("tabLead", "idx_lead_last_activity", ["custom_last_activity_at"]),
		("tabIB Customer Score", "idx_score_customer", ["customer"]),
	]

	created = 0
	for table, name, cols in INDEXES:
		if not _idx_exists(table, name):
			col_list = ", ".join(f"`{c}`" for c in cols)
			frappe.db.sql(f"ALTER TABLE `{table}` ADD INDEX `{name}` ({col_list})")
			print(f"  Created: {name} on {table}({col_list})")
			created += 1
		else:
			print(f"  Exists:  {name}")

	frappe.db.commit()
	print(f"\nDone. {created} new indexes created.")
