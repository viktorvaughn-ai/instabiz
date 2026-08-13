"""instabiz.instabiz.report.ib_production_report.ib_production_report"""
import frappe
from frappe.utils import flt


def execute(filters=None):
	"""Per-completion production report.

	Sourced from IB Work Order completions, not IB Production Entry — that
	doctype has zero rows system-wide (confirmed repeatedly elsewhere: see
	get_dpr()'s docstring in instabiz/overrides/production.py), so this
	report always returned an empty table regardless of real floor activity.
	Wastage is left out for the same reason get_dpr() leaves it out:
	IB Work Order.wastage_qty/wastage_pct are hardcoded 0.0 at WO creation
	and never written by any real completion path (Production Entry
	submission was the only place that ever set them, and it never fires) —
	showing a wastage number here would misrepresent it as measured.
	"""
	columns = _columns()
	data = _data(filters)
	chart = _chart(data, filters)
	summary = _summary(data)
	return columns, data, None, chart, summary


def _columns():
	return [
		{"fieldname": "completed_date", "label": "Date", "fieldtype": "Date", "width": 100},
		{"fieldname": "work_order", "label": "Work Order", "fieldtype": "Link", "options": "IB Work Order", "width": 135},
		{"fieldname": "item_code", "label": "Item", "fieldtype": "Link", "options": "Item", "width": 130},
		{"fieldname": "stage", "label": "Stage", "fieldtype": "Data", "width": 115},
		{"fieldname": "machine", "label": "Machine", "fieldtype": "Link", "options": "IB Machine", "width": 110},
		{"fieldname": "operator", "label": "Operator", "fieldtype": "Link", "options": "User", "width": 130},
		{"fieldname": "order_sheet", "label": "Order Sheet", "fieldtype": "Link", "options": "IB Order Sheet", "width": 135},
		{"fieldname": "sales_order", "label": "Sales Order", "fieldtype": "Link", "options": "Sales Order", "width": 135},
		{"fieldname": "customer_name", "label": "Customer", "fieldtype": "Data", "width": 150},
		{"fieldname": "output_qty", "label": "Output Qty", "fieldtype": "Float", "width": 90},
		{"fieldname": "hours", "label": "Hours", "fieldtype": "Float", "width": 75},
	]


def _data(filters):
	conditions = "wo.status = 'Completed'"
	params = {}
	if filters:
		if filters.get("from_date"):
			conditions += " AND DATE(COALESCE(wo.completed_at, wo.modified)) >= %(from_date)s"
			params["from_date"] = filters["from_date"]
		if filters.get("to_date"):
			conditions += " AND DATE(COALESCE(wo.completed_at, wo.modified)) <= %(to_date)s"
			params["to_date"] = filters["to_date"]
		if filters.get("stage"):
			conditions += " AND wo.stage = %(stage)s"
			params["stage"] = filters["stage"]
		if filters.get("machine"):
			conditions += " AND wo.machine = %(machine)s"
			params["machine"] = filters["machine"]
		if filters.get("operator"):
			conditions += " AND wo.operator = %(operator)s"
			params["operator"] = filters["operator"]

	return frappe.db.sql(
		f"""
		SELECT wo.name AS work_order, DATE(COALESCE(wo.completed_at, wo.modified)) AS completed_date,
		       wo.item_code, wo.stage, wo.machine, wo.operator, wo.order_sheet,
		       wo.sales_order, wo.completed_qty AS output_qty,
		       TIMESTAMPDIFF(MINUTE, wo.started_at, wo.completed_at) / 60.0 AS hours
		FROM `tabIB Work Order` wo
		WHERE {conditions}
		ORDER BY COALESCE(wo.completed_at, wo.modified) DESC, wo.creation DESC
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
	total_hours = round(sum(flt(r.hours) for r in data if r.hours), 2)
	return [
		{"value": total_entries, "label": "Work Orders Completed", "indicator": "blue", "datatype": "Int"},
		{"value": round(total_output, 2), "label": "Total Output Qty", "indicator": "green", "datatype": "Float"},
		{"value": total_hours, "label": "Total Hours", "indicator": "blue", "datatype": "Float"},
	]
