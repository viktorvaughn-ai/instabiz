import frappe
from frappe import _
from frappe.utils import getdate


def execute(filters=None):
	filters = filters or {}
	_validate(filters)
	columns = _columns()
	data = _data(filters)
	return columns, data, None, _chart(data, filters), _summary(data)


def _validate(filters):
	if filters.get("from_date") and filters.get("to_date"):
		if getdate(filters["from_date"]) > getdate(filters["to_date"]):
			frappe.throw(_("From Date cannot be after To Date."))


def _columns():
	return [
		{"label": _("Sales Person"), "fieldname": "sales_person", "fieldtype": "Data", "width": 220},
		{"label": _("Orders"), "fieldname": "order_count", "fieldtype": "Int", "width": 90},
		{"label": _("Total Amount"), "fieldname": "total_amount", "fieldtype": "Currency", "width": 160},
		{"label": _("Avg Order"), "fieldname": "avg_amount", "fieldtype": "Currency", "width": 150},
		{"label": _("Max Order"), "fieldname": "max_amount", "fieldtype": "Currency", "width": 150},
	]


def _data(filters):
	conditions = []
	values = {
		"from_date": filters.get("from_date"),
		"to_date": filters.get("to_date"),
	}

	if filters.get("sales_person_user"):
		full_name = frappe.db.get_value("User", filters["sales_person_user"], "full_name") or ""
		conditions.append(
			"COALESCE(NULLIF(so.custom_sales_person,''), NULLIF(u.full_name,''), so.custom_sales_person_user, 'Unassigned')"
			" = %(sales_person_display)s"
		)
		values["sales_person_display"] = full_name

	if filters.get("status"):
		conditions.append("so.status = %(status)s")
		values["status"] = filters["status"]

	if filters.get("territory"):
		conditions.append("so.territory = %(territory)s")
		values["territory"] = filters["territory"]

	where_extra = ("AND " + " AND ".join(conditions)) if conditions else ""

	return frappe.db.sql(
		f"""
		SELECT
			COALESCE(NULLIF(so.custom_sales_person,''), u.full_name, so.custom_sales_person_user) AS sales_person,
			COUNT(so.name)          AS order_count,
			SUM(so.rounded_total)   AS total_amount,
			AVG(so.rounded_total)   AS avg_amount,
			MAX(so.rounded_total)   AS max_amount
		FROM `tabSales Order` so
		INNER JOIN `tabUser` u ON u.name = so.custom_sales_person_user
		WHERE so.docstatus = 1
		  AND so.transaction_date BETWEEN %(from_date)s AND %(to_date)s
		  AND u.enabled = 1
		  AND u.name != 'Administrator'
		  {where_extra}
		GROUP BY COALESCE(NULLIF(so.custom_sales_person,''), u.full_name, so.custom_sales_person_user)
		ORDER BY total_amount DESC
		""",
		values,
		as_dict=True,
	)


def _chart(data, filters=None):
	if not data:
		return None
	chart_type = (filters or {}).get("chart_type") or "bar"
	return {
		"data": {
			"labels": [r.sales_person for r in data],
			"datasets": [{"name": _("Total Amount"), "values": [r.total_amount or 0 for r in data]}],
		},
		"type": chart_type,
		"colors": ["#d97757"],
		"barOptions": {"stacked": 0},
	}


def _summary(data):
	if not data:
		return None
	total_orders = sum(r.order_count or 0 for r in data)
	total_amount = sum(r.total_amount or 0 for r in data)
	return [
		{"value": len(data), "label": _("Sales Persons"), "datatype": "Int", "indicator": "orange"},
		{"value": total_orders, "label": _("Total Orders"), "datatype": "Int", "indicator": "blue"},
		{"value": total_amount, "label": _("Total Revenue"), "datatype": "Currency", "indicator": "green"},
	]
