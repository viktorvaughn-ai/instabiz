"""Item Pricing — merged Price List + Item Price History page.

No page-local whitelisted methods here. Backend RPCs stay in their original
homes (instabiz.instabiz.page.ib_price_list.ib_price_list and
instabiz.instabiz.page.ib_item_price_history.ib_item_price_history) — moving
those .py files' dotted import paths would break every frappe.call() string
in the merged JS for zero benefit, since those modules remain importable
regardless of whether their own Page route still exists.
"""
