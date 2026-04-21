/**
 * ib_color_map.js
 * Hex values for every color used in tabItem.color.
 * Keys must be lowercase — dashboard calls .toLowerCase() before lookup.
 * null = transparent / clear (renders as checkerboard).
 */
window.IB_COLOR_MAP = {
	// ── Core ──────────────────────────────────────────────────────────────────
	"transparent":       null,
	"clear":             null,
	"super transparent": null,

	"white":             "#FFFFFF",
	"gloss white":       "#FFFFFF",
	"cream white":       "#FFFEF0",
	"matte white":       "#F5F5F5",
	"tusk ivory":        "#F5ECD7",
	"creme":             "#FFFDD0",

	"black":             "#1a1a1a",
	"gloss black":       "#0D0D0D",
	"matte black":       "#222222",

	"grey":              "#9CA3AF",
	"gray":              "#9CA3AF",
	"silver grey":       "#A8A9AD",
	"smoke grey":        "#6B7280",
	"deep grey":         "#4B5563",
	"matt dark grey":    "#4B5563",
	"matt light grey":   "#D1D5DB",
	"seimens grey":      "#8C8C8C",

	"silver":            "#C0C0C0",
	"metallic silver":   "#A8A9AD",
	"bright chrome":     "#C4C4C4",
	"bright zinc":       "#A9B2BD",

	// ── Browns ────────────────────────────────────────────────────────────────
	"brown":             "#7B3F00",
	"light brown":       "#A0623A",
	"dark brown":        "#4B2500",
	"mission brown":     "#6B3A2A",
	"anti rust brown":   "#8B4513",

	// ── Yellows ───────────────────────────────────────────────────────────────
	"yellow":            "#EAB308",
	"deep yellow":       "#D4A017",
	"medium yellow":     "#F0C040",
	"clay yellow":       "#D4A843",
	"canary yellow":     "#FFEF00",
	"orange yellow":     "#F5A623",

	// ── Reds ──────────────────────────────────────────────────────────────────
	"red":               "#DC2626",
	"scarlet red":       "#FF2400",
	"mars red":          "#C1440E",
	"peach red":         "#E8735A",
	"suzuki red":        "#E30B1C",
	"jialing red":       "#CC1111",

	// ── Oranges ───────────────────────────────────────────────────────────────
	"orange":            "#EA580C",

	// ── Pinks ─────────────────────────────────────────────────────────────────
	"pink":              "#EC4899",
	"light pink":        "#FFB6C1",
	"rose pink":         "#FF91A4",
	"rose gold":         "#B76E79",

	// ── Blues ─────────────────────────────────────────────────────────────────
	"blue":              "#2563EB",
	"dark blue":         "#1E3A8A",
	"light blue":        "#60A5FA",
	"light sky blue":    "#87CEEB",
	"isuzu blue":        "#003087",
	"shifeng blue":      "#1A5EB8",

	// ── Greens ────────────────────────────────────────────────────────────────
	"green":             "#16A34A",
	"light green":       "#86EFAC",
	"olive green":       "#6B7C2E",
	"grass green":       "#3A7D44",
	"green gold":        "#A89F35",

	// ── Golds / Metallics ─────────────────────────────────────────────────────
	"gold":              "#D4AF37",
	"bright gold":       "#FFD700",
	"metallic gold":     "#D4AF37",
	"champ gold":        "#C9A84C",
	"copper":            "#B87333",
	"metallic copper":   "#B87333",
	"metallic bronze":   "#CD7F32",

	// ── Purples ───────────────────────────────────────────────────────────────
	"medium violet":     "#9370DB",
	"medium purple":     "#9370DB",

	// ── Special finish ────────────────────────────────────────────────────────
	"glow in dark":      "#CCFF66",
	"matt lacquer":      "#D4C5A9",
	"gloss lacquer":     "#E8D5A3",

	// ── Multi-color components (split by / in dashboard) ─────────────────────
	// These resolve automatically when split — no extra entries needed.
	// e.g. "YELLOW / BLACK" → ["yellow", "black"] → two dots
	"reflective strip":  "#C4C4C4",
	"glow strip":        "#CCFF66",
};
