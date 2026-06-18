"""instabiz.instabiz.report.ib_production_report.ib_production_report"""
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
		{"fieldname": "entry_date", "label": "Date", "fieldtype": "Date", "width": 100},
		{"fieldname": "name", "label": "Entry", "fieldtype": "Link", "options": "IB Production Entry", "width": 135},
		{"fieldname": "stage", "label": "Stage", "fieldtype": "Data", "width": 115},
		{"fieldname": "machine", "label": "Machine", "fieldtype": "Link", "options": "IB Machine", "width": 110},
		{"fieldname": "operator", "label": "Operator", "fieldtype": "Link", "options": "User", "width": 130},
		{"fieldname": "work_order", "label": "Work Order", "fieldtype": "Link", "options": "IB Work Order", "width": 135},
		{"fieldname": "order_sheet", "label": "Order Sheet", "fieldtype": "Link", "options": "IB Order Sheet", "width": 135},
		{"fieldname": "input_qty", "label": "Input Qty", "fieldtype": "Float", "width": 90},
		{"fieldname": "output_qty", "label": "Output Qty", "fieldtype": "Float", "width": 90},
		{"fieldname": "wastage_qty", "label": "Wastage Qty", "fieldtype": "Float", "width": 95},
		{"fieldname": "wastage_pct", "label": "Wastage %", "fieldtype": "Percent", "width": 90},
		{"fieldname": "hours_worked", "label": "Hours", "fieldtype": "Float", "width": 75},
	]


def _data(filters):
	conditions = "pe.docstatus = 1"
	params = {}
	if filters:
		if filters.get("from_date"):
			conditions += " AND pe.entry_date >= %(from_date)s"
			params["from_date"] = filters["from_date"]
		if filters.get("to_date"):
			conditions += " AND pe.entry_date <= %(to_date)s"
			params["to_date"] = filters["to_date"]
		if filters.get("stage"):
			conditions += " AND pe.stage = %(stage)s"
			params["stage"] = filters["stage"]
		if filters.get("machine"):
			conditions += " AND pe.machine = %(machine)s"
			params["machine"] = filters["machine"]
		if filters.get("operator"):
			conditions += " AND pe.operator = %(operator)s"
			params["operator"] = filters["operator"]

	return frappe.db.sql(
		f"""
		SELECT pe.name, pe.entry_date, pe.stage, pe.machine, pe.operator,
		       pe.work_order, pe.input_qty, pe.output_qty, pe.wastage_qty,
		       pe.wastage_pct, pe.hours_worked,
		       wo.order_sheet
		FROM `tabIB Production Entry` pe
		LEFT JOIN `tabIB Work Order` wo ON wo.name = pe.work_order
		WHERE {conditions}
		ORDER BY pe.entry_date DESC, pe.creation DESC
		""",
		params,
		as_dict=True,
	)


def _chart(data, filters=None):
	if not data:
		return None

	stage_output = {}
	for row in data:
		s = row.stage or "Unknown"
		stage_output[s] = flt(stage_output.get(s, 0)) + flt(row.output_qty)

	chart_type = (filters or {}).get("chart_type", "bar")
	return {
		"data": {
			"labels": list(stage_output.keys()),
			"datasets": [{"name": "Output Qty", "values": list(stage_output.values())}],
		},
		"type": chart_type,
		"fieldtype": "Float",
	}


def _summary(data):
	if not data:
		return []
	total_entries = len(data)
	total_output = sum(flt(r.output_qty) for r in data)
	avg_wastage = round(sum(flt(r.wastage_pct) for r in data) / total_entries, 1) if total_entries else 0
	total_hours = round(sum(flt(r.hours_worked) for r in data), 2)
	return [
		{"value": total_entries, "label": "Total Entries", "indicator": "blue", "datatype": "Int"},
		{"value": round(total_output, 2), "label": "Total Output Qty", "indicator": "green", "datatype": "Float"},
		{"value": avg_wastage, "label": "Avg Wastage %",
		 "indicator": "red" if avg_wastage > 5 else "orange" if avg_wastage > 2 else "green",
		 "datatype": "Percent"},
		{"value": total_hours, "label": "Total Hours", "indicator": "blue", "datatype": "Float"},
	]
