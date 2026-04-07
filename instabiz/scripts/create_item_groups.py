"""
Run with:
    bench --site your-site-name execute instabiz.scripts.create_item_groups
Or directly:
    bench --site your-site-name execute create_item_groups.create_all

Or just paste into bench console:
    bench --site your-site-name console
    then: exec(open('create_item_groups.py').read())
"""

import frappe

ITEM_GROUPS = [
    # Tape / Roll products (Sheet 1)
    "CLOTH - COTTON",
    "CLOTH - FIBERGLASS",
    "CLOTH - FLEECE",
    "CLOTH - POLYESTER",
    "CLOTH - PTFE",
    "FOAM - ACRYLIC",
    "FOAM - EVA",
    "FOAM - PE",
    "FOAM - PU",
    "FOAM - PVC",
    "FOIL - ALUMINIUM",
    "FOIL - ALUMINIUM RFD",
    "FOIL - COPPER",
    "PAPER - CCK",
    "PAPER - CREPE",
    "PAPER - KRAFT",
    "PAPER - RICE",
    "PAPER - TISSUE",
    "PAPER - TRANSFER",
    "PLASTIC - BOPP",
    "PLASTIC - FIBERGLASS",
    "PLASTIC - MOPP",
    "PLASTIC - PC",
    "PLASTIC - PE",
    "PLASTIC - POLYESTER",
    "PLASTIC - POLYMIDE",
    "PLASTIC - PVC",
    "REFLECTIVE - GLOW",
    "REFLECTIVE - RADIUM",
    "REFLECTIVE - RETRO",
    "SELF - RUBBER",
    # Aerosol / Consumable products (Sheet 2)
    "AEROSOL - SPRAY PAINT",
    "AEROSOL - PU FOAM",
    "AEROSOL - LUBRICANT",
    "AEROSOL - ADHESIVE",
    "AEROSOL - CLEANER",
    "AEROSOL - SEALANT",
]


def create_all():
    created = 0
    skipped = 0

    for group_name in ITEM_GROUPS:
        if frappe.db.exists("Item Group", group_name):
            print(f"  SKIP  {group_name}")
            skipped += 1
            continue

        doc = frappe.get_doc({
            "doctype": "Item Group",
            "item_group_name": group_name,
            "parent_item_group": "All Item Groups",
            "is_group": 0,
        })
        doc.insert(ignore_permissions=True)
        print(f"  OK    {group_name}")
        created += 1

    frappe.db.commit()
    print(f"\nDone — {created} created, {skipped} already existed.")


create_all()