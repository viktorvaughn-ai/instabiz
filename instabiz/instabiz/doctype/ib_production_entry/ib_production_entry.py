import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, time_diff_in_hours


class IBProductionEntry(Document):
	def validate(self):
		self._compute_hours()
		self._compute_wastage_pct()
		self._compute_sqm()
		self._compute_total_pieces()

	def _compute_hours(self):
		if self.start_time and self.end_time:
			try:
				self.hours_worked = round(time_diff_in_hours(self.end_time, self.start_time), 2)
			except Exception:
				pass

	def _compute_wastage_pct(self):
		total_in = flt(self.input_qty)
		wastage = flt(self.wastage_qty)
		if total_in > 0 and wastage > 0:
			self.wastage_pct = round(wastage / total_in * 100, 2)
		else:
			self.wastage_pct = 0

	def _compute_sqm(self):
		if self.stage != "Coating":
			return
		if self.jumbo_roll and not self.sqm_produced:
			jr_sqm = frappe.db.get_value("IB Jumbo Roll", self.jumbo_roll, "sqm")
			if jr_sqm:
				self.sqm_produced = flt(jr_sqm)
				return
		if self.jumbo_roll_width and self.jumbo_roll_length:
			self.sqm_produced = round((flt(self.jumbo_roll_width) / 1000) * flt(self.jumbo_roll_length), 4)

	def _compute_total_pieces(self):
		if self.stage == "Cutting" and self.pieces_per_log and self.no_of_logs:
			self.total_pieces = int(flt(self.pieces_per_log) * flt(self.no_of_logs))

	def on_submit(self):
		self._update_work_order(factor=1)
		self._update_jumbo_roll_status()
		self._check_wastage_alert()

	def on_cancel(self):
		self._update_work_order(factor=-1)
		self._restore_jumbo_roll_status()

	def _update_jumbo_roll_status(self):
		"""Mark the linked JR as Consumed when a Coating entry is submitted."""
		if self.stage != "Coating" or not self.jumbo_roll:
			return
		frappe.db.set_value("IB Jumbo Roll", self.jumbo_roll, "status", "Consumed")

	def _restore_jumbo_roll_status(self):
		"""Revert JR to In Production if Coating entry is cancelled."""
		if self.stage != "Coating" or not self.jumbo_roll:
			return
		frappe.db.set_value("IB Jumbo Roll", self.jumbo_roll, "status", "In Production")

	def _update_work_order(self, factor=1):
		if not self.work_order:
			return
		# Row-level lock prevents concurrent PE submissions from racing on the same WO
		frappe.db.sql(
			"SELECT name FROM `tabIB Work Order` WHERE name = %s FOR UPDATE",
			self.work_order,
		)
		wo = frappe.get_doc("IB Work Order", self.work_order)
		wo.completed_qty = max(0, flt(wo.completed_qty) + factor * flt(self.output_qty))
		wo.wastage_qty   = max(0, flt(wo.wastage_qty)   + factor * flt(self.wastage_qty))
		total_in = flt(wo.completed_qty) + flt(wo.wastage_qty)
		wo.wastage_pct = round(flt(wo.wastage_qty) / total_in * 100, 2) if total_in else 0
		wo.save(ignore_permissions=True)

	def _check_wastage_alert(self):
		if not self.wastage_pct or not self.machine:
			return
		norm = frappe.db.get_value("IB Machine", self.machine, "wastage_norm_pct") or 0
		if flt(self.wastage_pct) <= flt(norm):
			return
		recipients = frappe.db.sql(
			"""SELECT DISTINCT u.name FROM `tabUser` u
			   INNER JOIN `tabHas Role` hr ON hr.parent = u.name
			   WHERE hr.role IN ('Factory Management', 'System Manager') AND u.enabled = 1""",
			as_dict=True,
		)
		for r in recipients:
			frappe.get_doc({
				"doctype": "Notification Log",
				"subject": f"Wastage Alert: {self.name} — {self.wastage_pct:.1f}% (norm {norm}%) [ib-wastage-{self.name}]",
				"email_content": (
					f"Production entry {self.name} recorded wastage of {self.wastage_pct:.1f}%, "
					f"exceeding machine norm of {norm}%. "
					f"Stage: {self.stage}, Machine: {self.machine or '—'}, "
					f"Reason: {self.wastage_reason or '—'}"
				),
				"for_user": r.name,
				"type": "Alert",
				"document_type": "IB Production Entry",
				"document_name": self.name,
			}).insert(ignore_permissions=True)
