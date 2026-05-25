"""IB Bank Statement Import — parses HDFC CSV and creates Bank Transaction records."""
import csv
import io
import re
from datetime import datetime

import frappe
from frappe import _
from frappe.utils import flt, getdate, nowdate


def _parse_amount(val):
	"""Remove Indian-format commas and return float."""
	if not val:
		return 0.0
	return flt(re.sub(r",", "", str(val).strip()))


def _parse_date(val):
	"""DD/MM/YYYY → YYYY-MM-DD."""
	val = str(val).strip()
	for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d"):
		try:
			return datetime.strptime(val, fmt).strftime("%Y-%m-%d")
		except ValueError:
			continue
	frappe.throw(_(f"Cannot parse date: {val}"))


def _find_header_row(lines):
	"""Return index of the CSV header row (contains 'Date' and 'Narration' or 'Description')."""
	for i, line in enumerate(lines):
		low = line.lower()
		if ("date" in low) and ("narration" in low or "description" in low or "particulars" in low):
			return i
	frappe.throw(_("Could not find header row in CSV. Expected columns: Date, Narration, Withdrawal, Deposit."))


def _parse_csv(csv_text):
	"""
	Parse HDFC-format CSV. Returns list of dicts:
	  date, description, reference_number, withdrawal, deposit
	"""
	lines = [l for l in csv_text.splitlines()]
	hdr_idx = _find_header_row(lines)
	data_lines = lines[hdr_idx:]

	reader = csv.DictReader(io.StringIO("\n".join(data_lines)))

	# Normalise column names: lower + strip
	def _col(row, *candidates):
		for k in row:
			kl = k.lower().strip()
			for c in candidates:
				if c in kl:
					return row[k]
		return ""

	rows = []
	for row in reader:
		raw_date = _col(row, "date", "value dt")
		if not raw_date or raw_date.strip() in ("", "nan"):
			continue
		# Skip summary/footer rows (non-date first cell)
		try:
			date = _parse_date(raw_date)
		except Exception:
			continue

		description  = _col(row, "narration", "description", "particulars").strip()
		reference_no = _col(row, "chq", "ref", "cheque", "reference").strip()
		withdrawal   = _parse_amount(_col(row, "withdrawal", "debit", "dr"))
		deposit      = _parse_amount(_col(row, "deposit", "credit", "cr"))

		if withdrawal == 0 and deposit == 0:
			continue

		rows.append({
			"date":             date,
			"description":      description,
			"reference_number": reference_no,
			"withdrawal":       withdrawal,
			"deposit":          deposit,
		})

	return rows


@frappe.whitelist()
def preview_statement(bank_account, csv_text):
	"""Return parsed rows for client-side preview table."""
	frappe.has_permission("Bank Transaction", "create", throw=True)
	rows = _parse_csv(csv_text)
	return {
		"rows":          rows,
		"count":         len(rows),
		"total_deposit": sum(r["deposit"] for r in rows),
		"total_withdrawal": sum(r["withdrawal"] for r in rows),
	}


@frappe.whitelist()
def import_statement(bank_account, csv_text):
	"""
	Parse CSV and create Bank Transaction records.
	Skips rows where (bank_account + date + reference_number + deposit + withdrawal)
	already exists to prevent duplicates.
	"""
	frappe.has_permission("Bank Transaction", "create", throw=True)

	company = frappe.db.get_value("Bank Account", bank_account, "company")
	if not company:
		frappe.throw(_(f"Bank Account {bank_account} not found or has no company."))

	rows = _parse_csv(csv_text)
	created = 0
	skipped = 0
	errors  = []

	for r in rows:
		# Duplicate check: same bank_account + date + deposit + withdrawal + reference_number
		filters = {
			"bank_account": bank_account,
			"date":         r["date"],
			"deposit":      r["deposit"],
			"withdrawal":   r["withdrawal"],
		}
		if r["reference_number"]:
			filters["reference_number"] = r["reference_number"]

		if frappe.db.exists("Bank Transaction", filters):
			skipped += 1
			continue

		try:
			bt = frappe.new_doc("Bank Transaction")
			bt.bank_account      = bank_account
			bt.company           = company
			bt.date              = r["date"]
			bt.description       = r["description"]
			bt.reference_number  = r["reference_number"]
			bt.deposit           = r["deposit"]
			bt.withdrawal        = r["withdrawal"]
			bt.currency          = frappe.db.get_value("Company", company, "default_currency") or "INR"
			bt.status            = "Pending"
			bt.insert(ignore_permissions=True)
			bt.submit()
			created += 1
		except Exception as e:
			errors.append({"row": r, "error": str(e)})

	frappe.db.commit()
	return {"created": created, "skipped": skipped, "errors": errors}
