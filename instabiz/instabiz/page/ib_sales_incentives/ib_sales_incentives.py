import frappe
from frappe.utils import nowdate, getdate, get_first_day, get_last_day, add_months, flt


def get_context(context):
	context.no_cache = 1


def _load_slabs():
	"""Return {designation: [sorted slabs]} from IB Incentive Slab."""
	rows = frappe.db.get_all(
		"IB Incentive Slab",
		filters={"is_active": 1},
		fields=["designation", "slab_label", "from_pct", "to_pct", "commission_pct"],
		order_by="designation, from_pct asc",
	)
	out = {}
	for r in rows:
		out.setdefault(r.designation, []).append(r)
	return out


def _get_slab_designation(user):
	"""Map a user to 'Sales Manager' or 'Sales User' based on their Frappe roles."""
	roles = set(frappe.get_roles(user))
	return "Sales Manager" if "Sales Manager" in roles else "Sales User"


def _apply_slab(collected, pct, designation, slabs_by_desig):
	"""Return (commission_amount, slab_label) for the given achievement %."""
	if pct is None or pct < 0:
		return 0.0, None
	candidates = slabs_by_desig.get(designation) or slabs_by_desig.get("Sales User") or []
	for slab in candidates:
		lo = flt(slab.from_pct)
		hi = flt(slab.to_pct)
		if pct >= lo and (hi == 0 or pct < hi):
			commission = flt(collected) * flt(slab.commission_pct) / 100
			return round(commission, 2), slab.slab_label
	return 0.0, None


def _load_team_map():
	"""Return {user: {team_name, team_leader}} from Lead Sales Team."""
	rows = frappe.db.sql(
		"""
		SELECT lstm.user, lst.name AS team_name, lst.team_leader
		FROM `tabLead Sales Team Member` lstm
		INNER JOIN `tabLead Sales Team` lst ON lst.name = lstm.parent
		""",
		as_dict=True,
	)
	return {r.user: {"team_name": r.team_name, "team_leader": r.team_leader} for r in rows}


@frappe.whitelist()
def get_sales_reps_for_targets(month=None):
	"""All active Sales Users with team, current month target, last month target, MTD collected."""
	from frappe.utils import get_first_day, get_last_day, getdate, nowdate as _now, add_months

	month_first = get_first_day(getdate(month) if month else getdate(_now()))
	month_last  = get_last_day(month_first)
	prev_first  = get_first_day(add_months(month_first, -1))

	team_map = _load_team_map()

	users = frappe.db.sql(
		"""
		SELECT DISTINCT u.name AS user, u.full_name
		FROM `tabUser` u
		INNER JOIN `tabHas Role` hr ON hr.parent = u.name
		WHERE hr.role = 'Sales User' AND u.enabled = 1 AND u.name != 'Administrator'
		ORDER BY u.full_name
		""",
		as_dict=True,
	)

	def _target_map(mf):
		return {
			t.sales_user: flt(t.target_amount)
			for t in frappe.db.get_all(
				"IB Sales Target",
				filters={"month": mf},
				fields=["sales_user", "target_amount"],
			)
		}

	targets      = _target_map(month_first)
	prev_targets = _target_map(prev_first)

	# MTD collected for each rep this month
	collected_rows = frappe.db.sql(
		"""
		SELECT custom_sales_person_user AS sp_user,
			   COALESCE(SUM(grand_total - outstanding_amount), 0) AS collected,
			   COALESCE(SUM(grand_total), 0) AS revenue
		FROM `tabSales Invoice`
		WHERE docstatus = 1 AND is_return = 0
		  AND posting_date BETWEEN %s AND %s
		  AND custom_sales_person_user IS NOT NULL AND custom_sales_person_user != ''
		GROUP BY custom_sales_person_user
		""",
		(month_first, month_last),
		as_dict=True,
	)
	collected_map = {r.sp_user: {"collected": flt(r.collected), "revenue": flt(r.revenue)} for r in collected_rows}

	result = []
	for u in users:
		team_info = team_map.get(u.user, {})
		perf = collected_map.get(u.user, {"collected": 0, "revenue": 0})
		cur_target  = targets.get(u.user, 0)
		prev_target = prev_targets.get(u.user, 0)
		collected   = perf["collected"]
		pct = round(collected / cur_target * 100) if cur_target else None
		result.append({
			"sp_user":     u.user,
			"sp_name":     u.full_name or u.user,
			"team_name":   team_info.get("team_name") or "",
			"target":      cur_target,
			"prev_target": prev_target,
			"collected":   collected,
			"revenue":     perf["revenue"],
			"pct":         pct,
		})

	result.sort(key=lambda r: (r["team_name"] or "\xff", r["sp_name"]))
	return result


@frappe.whitelist()
def get_incentives_data(month=None):
	today = getdate(nowdate())
	month_date = getdate(month) if month else today
	month_start = get_first_day(month_date)
	month_end = get_last_day(month_date)

	slabs_by_desig = _load_slabs()
	team_map = _load_team_map()

	# ── Per-salesperson billing ───────────────────────────────────────────────
	by_sp = frappe.db.sql("""
		SELECT
			si.custom_sales_person_user as sp_user,
			COALESCE(u.full_name, si.custom_sales_person_user) as sp_name,
			COUNT(si.name) as invoice_count,
			COALESCE(SUM(si.grand_total), 0) as revenue,
			COALESCE(SUM(si.outstanding_amount), 0) as outstanding,
			COALESCE(SUM(si.grand_total - si.outstanding_amount), 0) as collected
		FROM `tabSales Invoice` si
		LEFT JOIN `tabUser` u ON u.name = si.custom_sales_person_user
		WHERE si.docstatus=1 AND si.is_return=0
		AND si.posting_date BETWEEN %s AND %s
		AND si.custom_sales_person_user IS NOT NULL
		AND si.custom_sales_person_user != ''
		GROUP BY si.custom_sales_person_user, u.full_name
		ORDER BY revenue DESC
	""", (month_start, month_end), as_dict=True)

	# ── Targets ───────────────────────────────────────────────────────────────
	targets = frappe.db.sql("""
		SELECT sales_user, target_amount, month
		FROM `tabIB Sales Target`
		WHERE month BETWEEN %s AND %s
	""", (month_start, month_end), as_dict=True)
	target_map = {t.sales_user: flt(t.target_amount) for t in targets}

	# Include reps with a target but no invoices this month (visible as zero-billing)
	billed_users = {r.sp_user for r in by_sp}
	for user, amt in target_map.items():
		if user not in billed_users:
			full_name = frappe.db.get_value("User", user, "full_name") or user
			by_sp.append(frappe._dict(
				sp_user=user, sp_name=full_name,
				invoice_count=0, revenue=0, outstanding=0, collected=0,
			))

	for row in by_sp:
		target = target_map.get(row.sp_user, 0)
		row.target = target

		# Achievement % based on collected (not billed)
		row.pct = round(flt(row.collected) / target * 100, 1) if target else None
		row.gap = max(0, target - flt(row.collected)) if target else None
		row.collection_pct = round(flt(row.collected) / flt(row.revenue) * 100, 1) if row.revenue else 0

		# Incentive calculation
		desig = _get_slab_designation(row.sp_user)
		row.slab_designation = desig
		commission, slab_label = _apply_slab(row.collected, row.pct, desig, slabs_by_desig)
		row.commission = commission
		row.slab_earned = slab_label

		# Team context
		team_info = team_map.get(row.sp_user, {})
		row.team_name = team_info.get("team_name") or ""
		row.team_leader = team_info.get("team_leader") or ""

	# Sort: by team, then by collected desc within team
	by_sp.sort(key=lambda r: (r.team_name or "\xff", -flt(r.collected)))

	# ── Team totals ───────────────────────────────────────────────────────────
	total_revenue = sum(flt(r.revenue) for r in by_sp)
	total_target = sum(r.target for r in by_sp)
	total_collected = sum(flt(r.collected) for r in by_sp)
	total_commission = sum(flt(r.commission) for r in by_sp)

	# ── Monthly trend per top 3 SPs ───────────────────────────────────────────
	# Fetch top 3 SP users first — MariaDB doesn't support LIMIT in IN-subquery
	top3_rows = frappe.db.sql("""
		SELECT custom_sales_person_user FROM `tabSales Invoice`
		WHERE docstatus=1 AND is_return=0 AND posting_date BETWEEN %s AND %s
		AND custom_sales_person_user IS NOT NULL AND custom_sales_person_user != ''
		GROUP BY custom_sales_person_user ORDER BY SUM(grand_total) DESC LIMIT 3
	""", (month_start, month_end), as_list=True)
	top3 = [r[0] for r in top3_rows]

	if top3:
		placeholders = ",".join(["%s"] * len(top3))
		trend = frappe.db.sql(f"""
			SELECT
				si.custom_sales_person_user as sp_user,
				COALESCE(u.full_name, si.custom_sales_person_user) as sp_name,
				DATE_FORMAT(si.posting_date,'%%b %%Y') as label,
				DATE_FORMAT(si.posting_date,'%%Y-%%m') as ym,
				COALESCE(SUM(si.grand_total - si.outstanding_amount),0) as collected
			FROM `tabSales Invoice` si
			LEFT JOIN `tabUser` u ON u.name = si.custom_sales_person_user
			WHERE si.docstatus=1 AND si.is_return=0
			AND si.custom_sales_person_user IN ({placeholders})
			AND si.posting_date >= DATE_SUB(%s, INTERVAL 5 MONTH)
			GROUP BY sp_user, sp_name, ym, label
			ORDER BY ym, collected DESC
		""", top3 + [month_start], as_dict=True)
	else:
		trend = []

	# ── Customer-wise top 10 ──────────────────────────────────────────────────
	top_customers = frappe.db.sql("""
		SELECT si.custom_sales_person_user as sp_user,
			   si.customer_name,
			   COALESCE(SUM(si.grand_total - si.outstanding_amount), 0) as collected
		FROM `tabSales Invoice` si
		WHERE si.docstatus=1 AND si.is_return=0
		AND si.posting_date BETWEEN %s AND %s
		AND si.custom_sales_person_user IS NOT NULL
		GROUP BY si.custom_sales_person_user, si.customer_name
		ORDER BY collected DESC LIMIT 20
	""", (month_start, month_end), as_dict=True)

	return {
		"month": str(month_start),
		"by_sp": by_sp,
		"total_revenue": total_revenue,
		"total_target": total_target,
		"total_collected": total_collected,
		"total_commission": total_commission,
		"team_pct": round(total_collected / total_target * 100, 1) if total_target else None,
		"trend": trend,
		"top_customers": top_customers,
	}
