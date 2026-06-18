"""instabiz.instabiz.report.ib_purchase_pipeline.ib_purchase_pipeline"""
import frappe
from frappe.utils import flt


def execute(filters=None):
	columns = _columns()
	data = _data(filters)
	chart = _chart(data, filters)
	summary = _summary(data)
	return columns, data, None, chart, summary


def _columns():
	return [
		{"fieldname": "name", "label": "PO#", "fieldtype": "Link", "options": "Purchase Order", "width": 155},
		{"fieldname": "supplier", "label": "Supplier", "fieldtype": "Link", "options": "Supplier", "width": 145},
		{"fieldname": "transaction_date", "label": "PO Date", "fieldtype": "Date", "width": 95},
		{"fieldname": "custom_location", "label": "Location", "fieldtype": "Data", "width": 95},
		{"fieldname": "grand_total", "label": "PO Value", "fieldtype": "Currency", "width": 115},
		{"fieldname": "grn_count", "label": "GRNs", "fieldtype": "Int", "width": 65},
		{"fieldname": "grn_status", "label": "GRN Status", "fieldtype": "Data", "width": 115},
		{"fieldname": "received_amount", "label": "Received ₹", "fieldtype": "Currency", "width": 115},
		{"fieldname": "pi_count", "label": "PIs", "fieldtype": "Int", "width": 55},
		{"fieldname": "pi_status", "label": "PI Status", "fieldtype": "Data", "width": 115},
		{"fieldname": "billed_amount", "label": "Billed ₹", "fieldtype": "Currency", "width": 115},
		{"fieldname": "outstanding", "label": "Outstanding ₹", "fieldtype": "Currency", "width": 125},
		{"fieldname": "status", "label": "PO Status", "fieldtype": "Data", "width": 125},
	]


def _data(filters):
	conditions = "po.docstatus = 1"
	params = {}
	if filters:
		if filters.get("from_date"):
			conditions += " AND po.transaction_date >= %(from_date)s"
			params["from_date"] = filters["from_date"]
		if filters.get("to_date"):
			conditions += " AND po.transaction_date <= %(to_date)s"
			params["to_date"] = filters["to_date"]
		if filters.get("supplier"):
			conditions += " AND po.supplier = %(supplier)s"
			params["supplier"] = filters["supplier"]
		if filters.get("custom_location"):
			conditions += " AND po.custom_location = %(custom_location)s"
			params["custom_location"] = filters["custom_location"]
		if filters.get("status"):
			conditions += " AND po.status = %(status)s"
			params["status"] = filters["status"]

	rows = frappe.db.sql(
		f"""
		SELECT po.name, po.supplier, po.transaction_date, po.custom_location,
		       po.grand_total, po.status, po.per_received, po.per_billed
		FROM `tabPurchase Order` po
		WHERE {conditions}
		ORDER BY po.transaction_date DESC
		""",
		params,
		as_dict=True,
	)
	if not rows:
		return []

	po_names = [r.name for r in rows]
	placeholders = ", ".join(["%s"] * len(po_names))

	grn_rows = frappe.db.sql(
		f"""
		SELECT pri.purchase_order,
		       COUNT(DISTINCT pr.name) AS grn_count,
		       SUM(pr.grand_total) AS received_amount
		FROM `tabPurchase Receipt` pr
		INNER JOIN `tabPurchase Receipt Item` pri ON pri.parent = pr.name
		WHERE pr.docstatus = 1 AND pri.purchase_order IN ({placeholders})
		GROUP BY pri.purchase_order
		""",
		tuple(po_names),
		as_dict=True,
	)
	grn_map = {r.purchase_order: r for r in grn_rows}

	pi_rows = frappe.db.sql(
		f"""
		SELECT pii.purchase_order,
		       COUNT(DISTINCT pi.name) AS pi_count,
		       SUM(pi.grand_total) AS billed_amount,
		       SUM(pi.outstanding_amount) AS outstanding
		FROM `tabPurchase Invoice` pi
		INNER JOIN `tabPurchase Invoice Item` pii ON pii.parent = pi.name
		WHERE pi.docstatus = 1 AND pii.purchase_order IN ({placeholders})
		GROUP BY pii.purchase_order
		""",
		tuple(po_names),
		as_dict=True,
	)
	pi_map = {r.purchase_order: r for r in pi_rows}

	result = []
	for r in rows:
		grn = grn_map.get(r.name)
		pi = pi_map.get(r.name)

		grn_count = grn.grn_count if grn else 0
		received_amount = flt(grn.received_amount) if grn else 0.0
		pi_count = pi.pi_count if pi else 0
		billed_amount = flt(pi.billed_amount) if pi else 0.0
		outstanding = flt(pi.outstanding) if pi else 0.0

		per_recv = flt(r.per_received)
		per_billed = flt(r.per_billed)

		if grn_count == 0:
			grn_status = "Not Received"
		elif per_recv >= 100:
			grn_status = "Fully Received"
		else:
			grn_status = f"Partial ({per_recv:.0f}%)"

		if pi_count == 0:
			pi_status = "Not Billed"
		elif per_billed >= 100:
			pi_status = "Fully Billed"
		else:
			pi_status = f"Partial ({per_billed:.0f}%)"

		result.append({
			"name": r.name,
			"supplier": r.supplier,
			"transaction_date": r.transaction_date,
			"custom_location": (r.custom_location or "").title(),
			"grand_total": flt(r.grand_total),
			"grn_count": grn_count,
			"grn_status": grn_status,
			"received_amount": received_amount,
			"pi_count": pi_count,
			"pi_status": pi_status,
			"billed_amount": billed_amount,
			"outstanding": outstanding,
			"status": r.status,
		})

	return result


def _chart(data, filters=None):
	if not data:
		return None

	suppliers = {}
	for r in data:
		s = r.get("supplier") or "Unknown"
		suppliers[s] = flt(suppliers.get(s, 0)) + flt(r.get("grand_total", 0))

	top = sorted(suppliers.items(), key=lambda x: x[1], reverse=True)[:10]
	chart_type = (filters or {}).get("chart_type", "bar")
	return {
		"data": {
			"labels": [x[0] for x in top],
			"datasets": [{"name": "PO Value", "values": [round(x[1], 2) for x in top]}],
		},
		"type": chart_type,
		"fieldtype": "Currency",
	}


def _summary(data):
	if not data:
		return []
	total_po_value = sum(flt(r.get("grand_total", 0)) for r in data)
	fully_received = sum(1 for r in data if r.get("grn_status") == "Fully Received")
	pending_grn = sum(1 for r in data if r.get("grn_status") == "Not Received")
	total_outstanding = sum(flt(r.get("outstanding", 0)) for r in data)
	return [
		{"value": len(data), "label": "Total POs", "indicator": "blue", "datatype": "Int"},
		{"value": round(total_po_value, 2), "label": "Total PO Value", "indicator": "blue", "datatype": "Currency"},
		{"value": fully_received, "label": "Fully Received", "indicator": "green", "datatype": "Int"},
		{"value": pending_grn, "label": "Pending GRN", "indicator": "orange", "datatype": "Int"},
		{"value": round(total_outstanding, 2), "label": "Outstanding Payable",
		 "indicator": "red" if total_outstanding > 0 else "green", "datatype": "Currency"},
	]
