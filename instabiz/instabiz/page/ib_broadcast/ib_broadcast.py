import frappe


def get_context(context):
	frappe.only_for("System Manager")
