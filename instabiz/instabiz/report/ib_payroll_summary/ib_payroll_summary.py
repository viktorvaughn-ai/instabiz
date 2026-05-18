import frappe
from frappe.utils import flt


def execute(filters=None):
    filters = filters or {}
    columns = _columns()
    data = _data(filters)
    return columns, data


def _columns():
    return [
        {"fieldname": "employee", "label": "Employee ID", "fieldtype": "Link", "options": "Employee", "width": 120},
        {"fieldname": "employee_name", "label": "Name", "fieldtype": "Data", "width": 160},
        {"fieldname": "designation", "label": "Designation", "fieldtype": "Data", "width": 140},
        {"fieldname": "department", "label": "Department", "fieldtype": "Data", "width": 120},
        {"fieldname": "salary_structure", "label": "Structure", "fieldtype": "Link", "options": "Salary Structure", "width": 110},
        {"fieldname": "base", "label": "CTC/mo", "fieldtype": "Currency", "width": 100},
        {"fieldname": "basic", "label": "Basic", "fieldtype": "Currency", "width": 90},
        {"fieldname": "hra", "label": "HRA", "fieldtype": "Currency", "width": 80},
        {"fieldname": "ca", "label": "CA", "fieldtype": "Currency", "width": 80},
        {"fieldname": "gross", "label": "Gross", "fieldtype": "Currency", "width": 90},
        {"fieldname": "pf", "label": "PF", "fieldtype": "Currency", "width": 80},
        {"fieldname": "esic", "label": "ESIC", "fieldtype": "Currency", "width": 75},
        {"fieldname": "pt", "label": "PT", "fieldtype": "Currency", "width": 70},
        {"fieldname": "tds", "label": "TDS", "fieldtype": "Currency", "width": 80},
        {"fieldname": "total_deductions", "label": "Deductions", "fieldtype": "Currency", "width": 100},
        {"fieldname": "net_pay", "label": "Net Pay", "fieldtype": "Currency", "width": 100},
    ]


def _calc(base, structure, pf_opt_in=True, esic_opt_in=True):
    ctx = {"base": base}

    if structure == "IB Payroll":
        B = round(base * 2 / 3)
        HRA = round(base * 0.2)
        CA = base - B - HRA
        ctx.update({"B": B, "HRA": HRA, "CA": CA})

        PF = round((min(B + CA, 15000)) * 0.12) if pf_opt_in else 0
        ESIC = round((B + HRA) * 0.0075) if (esic_opt_in and base <= 21000) else 0
        PT = 175 if base <= 10000 else 200
        taxable_annual = max(0, (B + CA) * 12 - 75000)

    elif structure == "Astro Payroll":
        if base > 21000:
            B = round(base * 2 / 3)
            HRA = round(base / 6)
        elif base > 11000:
            B = round(base * 10 / 13)
            HRA = round(base * 1.5 / 13)
        else:
            B = round(base * 10 / 11)
            HRA = round(B * 0.05)
        CA = base - B - HRA
        ctx.update({"B": B, "HRA": HRA, "CA": CA})

        PF = round((min(B + HRA, 15000)) * 0.12) if pf_opt_in else 0
        ESIC = round((B + HRA) * 0.0075) if (esic_opt_in and base <= 21000) else 0
        PT = 200
        taxable_annual = max(0, (B + HRA) * 12 - 75000)

    else:
        return None

    TDS = _calc_tds(taxable_annual)

    gross = B + HRA + CA
    total_deductions = PF + ESIC + PT + TDS
    net_pay = gross - total_deductions

    return {
        "basic": B, "hra": HRA, "ca": CA,
        "gross": gross,
        "pf": PF, "esic": ESIC, "pt": PT, "tds": TDS,
        "total_deductions": total_deductions,
        "net_pay": net_pay,
    }


def _calc_tds(annual_taxable):
    if annual_taxable <= 1200000:
        tax = 0
    else:
        tax = 0
        slabs = [(400000, 800000, 0.05), (800000, 1200000, 0.10),
                 (1200000, 1600000, 0.15), (1600000, 2000000, 0.20),
                 (2000000, 2400000, 0.25)]
        for lo, hi, rate in slabs:
            if annual_taxable > lo:
                tax += min(annual_taxable - lo, hi - lo) * rate
        if annual_taxable > 2400000:
            tax += (annual_taxable - 2400000) * 0.30
        tax *= 1.04  # cess
    return round(tax / 12)


def _data(filters):
    conditions = "AND ssa.docstatus = 1"
    if filters.get("department"):
        conditions += " AND e.department = %(department)s"
    if filters.get("salary_structure"):
        conditions += " AND ssa.salary_structure = %(salary_structure)s"

    rows = frappe.db.sql(f"""
        SELECT
            ssa.employee, ssa.employee_name, ssa.salary_structure, ssa.base,
            e.designation, e.department,
            e.provident_fund_account, e.health_insurance_no,
            ROW_NUMBER() OVER (PARTITION BY ssa.employee ORDER BY ssa.from_date DESC) AS rn
        FROM `tabSalary Structure Assignment` ssa
        JOIN `tabEmployee` e ON e.name = ssa.employee
        WHERE e.status = 'Active'
        {conditions}
    """, filters, as_dict=True)

    # Keep only latest assignment per employee
    seen = set()
    data = []
    for r in rows:
        if r.rn != 1 or r.employee in seen:
            continue
        seen.add(r.employee)

        calc = _calc(
            flt(r.base), r.salary_structure,
            pf_opt_in=bool(r.provident_fund_account),
            esic_opt_in=bool(r.health_insurance_no),
        )
        if not calc:
            continue

        data.append({
            "employee": r.employee,
            "employee_name": r.employee_name,
            "designation": r.designation,
            "department": r.department,
            "salary_structure": r.salary_structure,
            "base": flt(r.base),
            **calc,
        })

    data.sort(key=lambda x: (x.get("department") or "", x["employee_name"]))
    return data
