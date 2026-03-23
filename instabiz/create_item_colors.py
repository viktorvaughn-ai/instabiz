import frappe

ITEM_COLORS = [
    "ANTI RUST BROWN",
    "BLACK",
    "BLACK / GLOW IN DARK",
    "BLACK / GLOW STRIP",
    "BLACK / REFLECTIVE STRIP",
    "BLACK / WHITE",
    "BLUE",
    "BRIGHT CHROME",
    "BRIGHT GOLD",
    "BRIGHT ZINC",
    "BROWN",
    "CANARY YELLOW",
    "CHAMP GOLD",
    "CLAY YELLOW",
    "CLEAN",
    "CLEAR",
    "CONS",
    "COPPER",
    "CREAM WHITE",
    "CREME",
    "DEEP GREY",
    "DEEP YELLOW",
    "DUCT GRADE",
    "FOAM GRADE",
    "GLOSS BLACK",
    "GLOSS LACQUER",
    "GLOSS WHITE",
    "GLOW IN DARK",
    "GRASS GREEN",
    "GREEN",
    "GREEN / WHITE",
    "GREEN GOLD",
    "GREY",
    "ISUZU BLUE",
    "JIALING RED",
    "LABEL GRADE",
    "LIGHT BROWN",
    "LIGHT GREEN",
    "LIGHT PINK",
    "LIGHT SKY BLUE",
    "MARS RED",
    "MATT DARK GREY",
    "MATT LACQUER",
    "MATT LIGHT GREY",
    "MATTE BLACK",
    "MATTE WHITE",
    "MEDIUM PURPLE",
    "MEDIUM VIOLET",
    "MEDIUM YELLOW",
    "METALLIC BRONZE",
    "METALLIC COPPER",
    "METALLIC GOLD",
    "METALLIC SILVER",
    "MISSION BROWN",
    "OLIVE GREEN",
    "ORANGE",
    "ORANGE YELLOW",
    "PEACH RED",
    "RED",
    "RED / WHITE",
    "ROSE GOLD",
    "ROSE PINK",
    "SCARLET RED",
    "SEIMENS GREY",
    "SHIFENG BLUE",
    "SILVER",
    "SILVER GREY",
    "SMOKE GREY",
    "SUPER TRANSPARENT",
    "SUZUKI RED",
    "TRANSPARENT",
    "TUSK IVORY",
    "WHITE",
    "YELLOW",
    "YELLOW / BLACK",
]


def create_all():
    created = 0
    skipped = 0

    for color in ITEM_COLORS:
        if frappe.db.exists("Item Color", color):
            print(f"  SKIP  {color}")
            skipped += 1
            continue

        doc = frappe.get_doc({
            "doctype": "Item Color",
            "color_name": color,
        })
        doc.insert(ignore_permissions=True)
        print(f"  OK    {color}")
        created += 1

    frappe.db.commit()
    print(f"\nDone — {created} created, {skipped} already existed.")


create_all()