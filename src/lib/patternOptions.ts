// ─────────────────────────────────────────────
// OmniPlot — PATTERN OPTIONS (zones, categories, body styles)
// ─────────────────────────────────────────────
// Built-in option lists live here, in code, so existing patterns keep resolving
// and the app works with no network. Admins can ADD to them (Admin → Patterns →
// Options, stored at settings/patternOptions); `mergeOptions` layers those on
// top. Pure — no stores, no Firestore — so the server validates with it too.

import type { PatternCategory, PatternZone, ProjectType } from "$lib/types";

// Maps PatternZone values to human-readable group names (used for zone filter).
export const TINT_ZONE_GROUP: Partial<Record<PatternZone, string>> = {
	windshield:           "Windshield",
	"windshield-strip":   "Windshield",
	"rear-windshield":    "Rear Window",
	sunroof:              "Sunroof",
	moonroof:             "Sunroof",
	"window-front-left":  "Side Windows",
	"window-front-right": "Side Windows",
	"window-rear-left":   "Side Windows",
	"window-rear-right":  "Side Windows",
	"quarter-window-left":  "Quarter / Vent",
	"quarter-window-right": "Quarter / Vent",
	"vent-window-left":   "Quarter / Vent",
	"vent-window-right":  "Quarter / Vent",
};

export const PPF_ZONE_GROUP: Partial<Record<PatternZone, string>> = {
	hood: "Hood", "hood-edge-left": "Hood", "hood-edge-right": "Hood",
	"bumper-front": "Bumpers", "bumper-rear": "Bumpers",
	"fender-front-left": "Fenders", "fender-front-right": "Fenders",
	"fender-rear-left": "Fenders", "fender-rear-right": "Fenders",
	"door-front-left": "Doors", "door-front-right": "Doors",
	"door-rear-left": "Doors", "door-rear-right": "Doors",
	"rocker-left": "Rocker Panels", "rocker-right": "Rocker Panels",
	"mirror-left": "Mirrors", "mirror-right": "Mirrors",
	roof: "Roof", "a-pillar-left": "Roof", "a-pillar-right": "Roof",
	trunk: "Trunk",
	"headlight-left": "Lights", "headlight-right": "Lights",
	"foglight-left": "Lights", "foglight-right": "Lights",
};

export const PPF_ZONES_LIST: Array<{ value: PatternZone; label: string }> = [
	{ value: "hood",              label: "Hood" },
	{ value: "hood-edge-left",    label: "Hood Edge Left" },
	{ value: "hood-edge-right",   label: "Hood Edge Right" },
	{ value: "bumper-front",      label: "Front Bumper" },
	{ value: "bumper-rear",       label: "Rear Bumper" },
	{ value: "fender-front-left", label: "Fender Front Left" },
	{ value: "fender-front-right",label: "Fender Front Right" },
	{ value: "fender-rear-left",  label: "Fender Rear Left" },
	{ value: "fender-rear-right", label: "Fender Rear Right" },
	{ value: "door-front-left",   label: "Door Front Left" },
	{ value: "door-front-right",  label: "Door Front Right" },
	{ value: "door-rear-left",    label: "Door Rear Left" },
	{ value: "door-rear-right",   label: "Door Rear Right" },
	{ value: "rocker-left",       label: "Rocker Left" },
	{ value: "rocker-right",      label: "Rocker Right" },
	{ value: "mirror-left",       label: "Mirror Left" },
	{ value: "mirror-right",      label: "Mirror Right" },
	{ value: "a-pillar-left",     label: "A-Pillar Left" },
	{ value: "a-pillar-right",    label: "A-Pillar Right" },
	{ value: "roof",              label: "Roof" },
	{ value: "trunk",             label: "Trunk" },
	{ value: "headlight-left",    label: "Headlight Left" },
	{ value: "headlight-right",   label: "Headlight Right" },
	{ value: "foglight-left",     label: "Foglight Left" },
	{ value: "foglight-right",    label: "Foglight Right" },
	{ value: "custom",            label: "Custom" },
];

// Mirror pairs — selecting one side suggests adding the other.
// Only zones that have a geometric mirror are listed; symmetric zones (hood, roof, etc.) are absent.
export const MIRROR_PAIRS: Partial<Record<PatternZone, PatternZone>> = {
	"hood-edge-left":       "hood-edge-right",
	"hood-edge-right":      "hood-edge-left",
	"fender-front-left":    "fender-front-right",
	"fender-front-right":   "fender-front-left",
	"fender-rear-left":     "fender-rear-right",
	"fender-rear-right":    "fender-rear-left",
	"door-front-left":      "door-front-right",
	"door-front-right":     "door-front-left",
	"door-rear-left":       "door-rear-right",
	"door-rear-right":      "door-rear-left",
	"rocker-left":          "rocker-right",
	"rocker-right":         "rocker-left",
	"mirror-left":          "mirror-right",
	"mirror-right":         "mirror-left",
	"a-pillar-left":        "a-pillar-right",
	"a-pillar-right":       "a-pillar-left",
	"headlight-left":       "headlight-right",
	"headlight-right":      "headlight-left",
	"foglight-left":        "foglight-right",
	"foglight-right":       "foglight-left",
	"window-front-left":    "window-front-right",
	"window-front-right":   "window-front-left",
	"window-rear-left":     "window-rear-right",
	"window-rear-right":    "window-rear-left",
	"quarter-window-left":  "quarter-window-right",
	"quarter-window-right": "quarter-window-left",
	"vent-window-left":     "vent-window-right",
	"vent-window-right":    "vent-window-left",
};

export const TINT_ZONES_LIST: Array<{ value: PatternZone; label: string }> = [
	{ value: "windshield",          label: "Windshield (Full)" },
	{ value: "windshield-strip",    label: "Windshield Strip" },
	{ value: "window-front-left",   label: "Front Driver Window" },
	{ value: "window-front-right",  label: "Front Passenger Window" },
	{ value: "window-rear-left",    label: "Rear Driver Window" },
	{ value: "window-rear-right",   label: "Rear Passenger Window" },
	{ value: "rear-windshield",     label: "Rear Windshield" },
	{ value: "sunroof",             label: "Sunroof / Panoramic Roof" },
	{ value: "moonroof",            label: "Moonroof / Rear Panel" },
	{ value: "quarter-window-left", label: "Quarter Window Left" },
	{ value: "quarter-window-right",label: "Quarter Window Right" },
	{ value: "vent-window-left",    label: "Vent Window Left" },
	{ value: "vent-window-right",   label: "Vent Window Right" },
	{ value: "custom",              label: "Custom" },
];

export const RESIDENTIAL_ZONES_LIST: Array<{ value: PatternZone; label: string }> = [
	{ value: "res-picture-window",     label: "Picture Window" },
	{ value: "res-living-room-window", label: "Living Room Window" },
	{ value: "res-bedroom-window",     label: "Bedroom Window" },
	{ value: "res-kitchen-window",     label: "Kitchen Window" },
	{ value: "res-bathroom-window",    label: "Bathroom Window" },
	{ value: "res-sunroom-window",     label: "Sunroom Window" },
	{ value: "res-basement-window",    label: "Basement Window" },
	{ value: "res-garage-window",      label: "Garage Window" },
	{ value: "res-skylight",           label: "Skylight" },
	{ value: "res-sliding-glass-door", label: "Sliding Glass Door" },
	{ value: "res-front-door-glass",   label: "Front Door Glass" },
	{ value: "res-front-door-sidelight", label: "Front Door Sidelight" },
	{ value: "custom",                 label: "Custom" },
];

export const COMMERCIAL_ZONES_LIST: Array<{ value: PatternZone; label: string }> = [
	{ value: "com-storefront-window",       label: "Storefront Window" },
	{ value: "com-display-window",          label: "Display Window" },
	{ value: "com-entry-door-glass",        label: "Entry Door Glass" },
	{ value: "com-lobby-window",            label: "Lobby Window" },
	{ value: "com-office-window",           label: "Office Window" },
	{ value: "com-conference-room-window",  label: "Conference Room Window" },
	{ value: "com-curtain-wall",            label: "Curtain Wall Panel" },
	{ value: "com-transom-window",          label: "Transom Window" },
	{ value: "com-skylight",                label: "Skylight" },
	{ value: "custom",                      label: "Custom" },
];

// Categories with no dedicated zone taxonomy yet (vinyl, HTV, gasket, stencil,
// signage) — every piece is "custom" until zone-specific values are added.
export const CUSTOM_ZONES_LIST: Array<{ value: PatternZone; label: string }> = [
	{ value: "custom", label: "Custom" },
];

// ─── Category metadata (labels + icon + zone list) for CRUD UI ───
// Icons are single-path 0-24 viewBox glyphs, drawn with stroke=currentColor at
// call sites so they inherit each card's accent color.
export interface PatternCategoryMeta {
	value: PatternCategory;
	label: string;
	shortLabel: string;
	description: string;
	icon: string; // svg path `d`
	accent: string; // CSS color used for icon/active-state tint
}

export const PATTERN_CATEGORIES: PatternCategoryMeta[] = [
	{
		value: "ppf", label: "Paint Protection Film", shortLabel: "PPF",
		description: "Clear film panels for paint",
		icon: "M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z",
		accent: "#00e5ff",
	},
	{
		value: "window-tint", label: "Window Tint", shortLabel: "Tint",
		description: "Precut glass films",
		icon: "M3 4h18v16H3z M3 12h18 M9 4v16 M15 4v16",
		accent: "#0070ff",
	},
	{
		value: "vinyl", label: "Vinyl Wrap", shortLabel: "Vinyl",
		description: "Full/partial body wraps",
		icon: "M12 2a10 10 0 100 20 10 10 0 000-20z M12 9a3 3 0 100 6 3 3 0 000-6z",
		accent: "#a855f7",
	},
	{
		value: "htv", label: "Heat Transfer Vinyl", shortLabel: "HTV",
		description: "Apparel & garment cuts",
		icon: "M12 2c-1.2 3.6-5 5-5 9a5 5 0 0010 0c0-1.8-.8-2.8-1.7-3.7.1 1.8-.8 2.7-1.8 1.9.9-1.8-.1-4.7-1.5-7.2z",
		accent: "#f97316",
	},
	{
		value: "gasket", label: "Gasket", shortLabel: "Gasket",
		description: "Seals & rings",
		icon: "M12 2a10 10 0 100 20 10 10 0 000-20z M12 8a4 4 0 100 8 4 4 0 000-8z",
		accent: "#94a3b8",
	},
	{
		value: "stencil", label: "Stencil", shortLabel: "Stencil",
		description: "Paint & spray masks",
		icon: "M9 3h6v4H9z M7 7h10l1 14H6z M9 12h6 M9 16h6",
		accent: "#22c55e",
	},
	{
		value: "signage", label: "Signage", shortLabel: "Signage",
		description: "Storefront & display signs",
		icon: "M4 4h16v12H4z M9 20h6 M12 16v4 M8 9h4 M8 12h8",
		accent: "#eab308",
	},
];


// ─── Body styles ("vehicle types") ────────────
export const BODY_STYLES: Array<{ value: string; label: string }> = [
	{ value: "sedan", label: "Sedan" },
	{ value: "coupe", label: "Coupe" },
	{ value: "suv", label: "SUV / Crossover" },
	{ value: "truck", label: "Truck" },
	{ value: "convertible", label: "Convertible" },
	{ value: "wagon", label: "Wagon" },
	{ value: "hatchback", label: "Hatchback" },
];

// ─── Admin-added options ──────────────────────
// What Admin → Patterns → Options stores at settings/patternOptions: entries an
// admin ADDED, plus per-id overrides (rename / hide) of the built-in ones. Ids are
// permanent — a pattern saved with one keeps it — so built-ins can be renamed or
// hidden but not removed, and an added entry can only be deleted while unused.

export type NonVehicleProject = Exclude<ProjectType, "vehicle">;

export interface AdminZone {
	id: string;
	label: string;
	/** Pick-list it joins: a category's zones (vehicle subjects)… */
	category?: string;
	/** …or a residential / commercial / custom subject's zones. Exactly one of the two. */
	projectType?: NonVehicleProject;
	/** Library zone-filter group (e.g. "Doors"); defaults to the zone's own label. */
	group?: string;
	/** Left/right partner (built-in or admin zone id) — the pair mirrors in the upload form. */
	mirrorOf?: string;
	hidden?: boolean;
}
export interface AdminBodyStyle { id: string; label: string; hidden?: boolean }
export interface AdminCategory {
	id: string;
	label: string;
	shortLabel: string;
	description: string;
	accent: string;
	hidden?: boolean;
}
/** What an admin changed about a built-in entry. Zones and vehicle types use only label / hidden. */
export interface BuiltinOverride {
	label?: string;
	shortLabel?: string;
	description?: string;
	accent?: string;
	hidden?: boolean;
}
export type OverrideMap = Record<string, BuiltinOverride>;
export interface PatternOptionsDoc {
	zones: AdminZone[];
	bodyStyles: AdminBodyStyle[];
	categories: AdminCategory[];
	overrides: { zones: OverrideMap; bodyStyles: OverrideMap; categories: OverrideMap };
}
export const EMPTY_OPTIONS: PatternOptionsDoc = {
	zones: [], bodyStyles: [], categories: [],
	overrides: { zones: {}, bodyStyles: {}, categories: {} },
};

export const DEFAULT_CATEGORY_ICON = "M12 2l9 5v10l-9 5-9-5V7z";
const NON_VEHICLE: NonVehicleProject[] = ["residential", "commercial", "custom"];

const ALL_BUILTIN_ZONE_LISTS = [PPF_ZONES_LIST, TINT_ZONES_LIST, RESIDENTIAL_ZONES_LIST, COMMERCIAL_ZONES_LIST, CUSTOM_ZONES_LIST];
export const BUILTIN_ZONE_IDS: ReadonlySet<string> = new Set(ALL_BUILTIN_ZONE_LISTS.flatMap((l) => l.map((z) => z.value)));
export const BUILTIN_CATEGORY_IDS: ReadonlySet<string> = new Set(PATTERN_CATEGORIES.map((c) => c.value));
export const BUILTIN_BODY_STYLE_IDS: ReadonlySet<string> = new Set(BODY_STYLES.map((b) => b.value));

/** Id for a new entry, from its label: "Side Skirt" → "side-skirt". */
export function slugify(label: string): string {
	return label.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ─── Normalization ────────────────────────────
// Built-in names are Title Case ("Fender Front Left", "Paint Protection Film"),
// acronyms stay upper ("SUV", "PPF"), descriptions are sentence case. Every
// admin-entered name goes through these on the client AND the server, so what
// is stored never depends on how someone happened to type it.
const MINOR_WORDS = new Set(["a", "an", "and", "or", "of", "the", "in", "on", "for", "to", "at", "by"]);

function titleWord(w: string, first: boolean): string {
	if (!w) return w;
	// Mixed case ("McLaren", "A-Pillar" parts) or a short all-caps acronym ("SUV", "PPF") is deliberate — keep it.
	if (/[A-Z]/.test(w.slice(1)) && !(w.length > 3 && w === w.toUpperCase())) return w;
	const lower = w.toLowerCase();
	if (!first && MINOR_WORDS.has(lower)) return lower;
	if (w.length <= 3 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w;
	return lower.replace(/[a-z0-9]/, (m) => m.toUpperCase());
}

/** Title Case for a name: trims, collapses spaces, capitalizes each word (and each side of a hyphen). */
export function normalizeLabel(raw: unknown, max = 60): string {
	const clean = (typeof raw === "string" ? raw : "").replace(/\s+/g, " ").trim().slice(0, max).trim();
	return clean
		.split(" ")
		.map((word, i) => word.split("-").map((part, j) => titleWord(part, i === 0 && j === 0)).join("-"))
		.join(" ");
}

/** Sentence case for a description: first letter up, the rest as typed, no trailing period noise. */
export function normalizeSentence(raw: unknown, max = 80): string {
	const clean = (typeof raw === "string" ? raw : "").replace(/\s+/g, " ").trim().slice(0, max).trim().replace(/[.\s]+$/, "");
	return clean ? clean[0].toUpperCase() + clean.slice(1) : "";
}

/** A name needs at least one letter or digit — "—" or "..." isn't a name. */
export const hasText = (s: string) => /[a-zA-Z0-9]/.test(s);

/** Which pick-list a built-in zone id belongs to ("c:ppf", "p:residential"…), or undefined for "custom". */
function builtinZoneScope(id: string): string | undefined {
	if (id === "custom") return undefined;
	if (PPF_ZONES_LIST.some((z) => z.value === id)) return "c:ppf";
	if (TINT_ZONES_LIST.some((z) => z.value === id)) return "c:window-tint";
	if (RESIDENTIAL_ZONES_LIST.some((z) => z.value === id)) return "p:residential";
	if (COMMERCIAL_ZONES_LIST.some((z) => z.value === id)) return "p:commercial";
	return undefined;
}
const zoneScope = (z: { category?: string; projectType?: string }) => (z.category ? `c:${z.category}` : `p:${z.projectType}`);

export type OptionsResult = { ok: true; doc: PatternOptionsDoc } | { ok: false; error: string };

/**
 * Validates what an admin submits and returns the clean document. Rejects ids
 * that collide with a built-in (or each other), zones with no / two scopes,
 * and mirror partners that don't exist. Never trusts the client's shape.
 */
export function sanitizePatternOptions(raw: unknown): OptionsResult {
	const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
	const arr = (v: unknown) => (Array.isArray(v) ? v : []);
	const fail = (error: string): OptionsResult => ({ ok: false, error });

	const categories: AdminCategory[] = [];
	for (const c of arr(r.categories)) {
		const id = str(c?.id, 48), label = normalizeLabel(c?.label, 40);
		if (!hasText(label)) return fail("Every category needs a name.");
		if (!ID_RE.test(id)) return fail(`"${label}" has an invalid id.`);
		if (BUILTIN_CATEGORY_IDS.has(id) || categories.some((x) => x.id === id)) return fail(`A category with the id "${id}" already exists.`);
		categories.push({
			id, label,
			shortLabel: normalizeLabel(c?.shortLabel, 16) || label.slice(0, 16).trim(),
			description: normalizeSentence(c?.description, 80),
			accent: COLOR_RE.test(c?.accent) ? c.accent : "#64748b",
			...(c?.hidden ? { hidden: true } : {}),
		});
	}

	const bodyStyles: AdminBodyStyle[] = [];
	for (const b of arr(r.bodyStyles)) {
		const id = str(b?.id, 48), label = normalizeLabel(b?.label, 40);
		if (!hasText(label)) return fail("Every vehicle type needs a name.");
		if (!ID_RE.test(id)) return fail(`"${label}" has an invalid id.`);
		if (BUILTIN_BODY_STYLE_IDS.has(id) || bodyStyles.some((x) => x.id === id)) return fail(`A vehicle type with the id "${id}" already exists.`);
		bodyStyles.push({ id, label, ...(b?.hidden ? { hidden: true } : {}) });
	}

	const categoryIds = new Set<string>([...BUILTIN_CATEGORY_IDS, ...categories.map((c) => c.id)]);
	const zones: AdminZone[] = [];
	const zoneIds = new Set<string>(BUILTIN_ZONE_IDS);
	for (const z of arr(r.zones)) {
		const id = str(z?.id, 48), label = normalizeLabel(z?.label, 60);
		if (!hasText(label)) return fail("Every zone needs a name.");
		if (!ID_RE.test(id)) return fail(`"${label}" has an invalid id.`);
		if (zoneIds.has(id)) return fail(`A zone with the id "${id}" already exists.`);
		const category = str(z?.category, 48) || undefined;
		const projectType = NON_VEHICLE.find((p) => p === z?.projectType);
		if (!category === !projectType) return fail(`"${label}" must belong to a category or to a residential / commercial / custom list — one of the two.`);
		if (category && !categoryIds.has(category)) return fail(`"${label}" is in a category that doesn't exist.`);
		const group = normalizeLabel(z?.group, 40);
		zoneIds.add(id);
		zones.push({
			id, label,
			...(category ? { category } : {}),
			...(projectType ? { projectType } : {}),
			...(group ? { group } : {}),
			...(str(z?.mirrorOf, 48) ? { mirrorOf: str(z?.mirrorOf, 48) } : {}),
			...(z?.hidden ? { hidden: true } : {}),
		});
	}
	for (const z of zones) {
		if (z.mirrorOf && (z.mirrorOf === z.id || !zoneIds.has(z.mirrorOf))) return fail(`"${z.label}" mirrors a zone that doesn't exist.`);
		if (z.mirrorOf && MIRROR_PAIRS[z.mirrorOf as PatternZone]) return fail(`"${z.label}" can't pair with a zone that already has a mirror.`);
	}

	// Overrides of built-ins: only ids that exist, never "custom"; names normalized, empty entries dropped.
	const overrides = { zones: {} as OverrideMap, bodyStyles: {} as OverrideMap, categories: {} as OverrideMap };
	const ov = (r.overrides && typeof r.overrides === "object" ? r.overrides : {}) as Record<string, unknown>;
	const readOverrides = (kind: keyof typeof overrides, known: (id: string) => boolean, full: boolean, nameMax: number): string | null => {
		const src = (ov[kind] && typeof ov[kind] === "object" ? ov[kind] : {}) as Record<string, any>;
		for (const [id, o] of Object.entries(src)) {
			if (!known(id)) return `"${id}" isn't a built-in option.`;
			const out: BuiltinOverride = {};
			if (o?.label !== undefined && o.label !== "") {
				const label = normalizeLabel(o.label, nameMax);
				if (!hasText(label)) return "A name needs at least one letter or number.";
				out.label = label;
			}
			if (full) {
				if (o?.shortLabel) out.shortLabel = normalizeLabel(o.shortLabel, 16);
				if (o?.description !== undefined && o.description !== "") out.description = normalizeSentence(o.description, 80);
				if (COLOR_RE.test(o?.accent)) out.accent = o.accent;
			}
			if (o?.hidden) out.hidden = true;
			if (Object.keys(out).length) overrides[kind][id] = out;
		}
		return null;
	};
	const ovError =
		readOverrides("zones", (id) => id !== "custom" && BUILTIN_ZONE_IDS.has(id), false, 60)
		?? readOverrides("bodyStyles", (id) => BUILTIN_BODY_STYLE_IDS.has(id), false, 40)
		?? readOverrides("categories", (id) => BUILTIN_CATEGORY_IDS.has(id), true, 40);
	if (ovError) return fail(ovError);

	// One name per pick-list, case-insensitively — built-ins count under their (possibly renamed) label.
	const clash = (entries: Array<{ scope: string; label: string }>, what: string): string | null => {
		const seen = new Set<string>();
		for (const e of entries) {
			const key = `${e.scope}|${e.label.toLowerCase()}`;
			if (seen.has(key)) return `A ${what} named "${e.label}" already exists${what === "zone" ? " in that list" : ""}.`;
			seen.add(key);
		}
		return null;
	};
	const builtinZoneEntries = ALL_BUILTIN_ZONE_LISTS.flat().flatMap((z) => {
		const scope = builtinZoneScope(z.value);
		return scope ? [{ scope, label: overrides.zones[z.value]?.label ?? z.label }] : [];
	});
	const clashError =
		clash([...builtinZoneEntries, ...zones.map((z) => ({ scope: zoneScope(z), label: z.label }))], "zone")
		?? clash([...BODY_STYLES.map((b) => ({ scope: "b", label: overrides.bodyStyles[b.value]?.label ?? b.label })), ...bodyStyles.map((b) => ({ scope: "b", label: b.label }))], "vehicle type")
		?? clash([...PATTERN_CATEGORIES.map((c) => ({ scope: "k", label: overrides.categories[c.value]?.label ?? c.label })), ...categories.map((c) => ({ scope: "k", label: c.label }))], "category");
	if (clashError) return fail(clashError);

	return { ok: true, doc: { zones, bodyStyles, categories, overrides } };
}

/** Tolerant read of a stored doc — bad or missing data degrades to "no additions". */
export function readPatternOptions(raw: unknown): PatternOptionsDoc {
	const res = sanitizePatternOptions(raw);
	return res.ok ? res.doc : EMPTY_OPTIONS;
}

// ─── Merging admin entries over the built-ins ─
type ZoneOption = { value: PatternZone; label: string };

/** Built-in zones for a pick-list with the admin's visible additions inserted before "custom". */
export function withAdminZones(builtin: ZoneOption[], extras: AdminZone[], includeHidden = false, overrides: OverrideMap = {}): ZoneOption[] {
	const base = builtin
		.filter((z) => includeHidden || !overrides[z.value]?.hidden)
		.map((z) => (overrides[z.value]?.label ? { ...z, label: overrides[z.value].label! } : z));
	const add = extras.filter((z) => includeHidden || !z.hidden).map((z) => ({ value: z.id, label: z.label }));
	if (!add.length) return base;
	const at = base.findIndex((z) => z.value === "custom");
	return at < 0 ? [...base, ...add] : [...base.slice(0, at), ...add, ...base.slice(at)];
}

/** A built-in category with the admin's overrides applied. */
export function withCategoryOverride(meta: PatternCategoryMeta, o?: BuiltinOverride): PatternCategoryMeta {
	if (!o) return meta;
	return { ...meta, label: o.label ?? meta.label, shortLabel: o.shortLabel ?? meta.shortLabel, description: o.description ?? meta.description, accent: o.accent ?? meta.accent };
}

/** Every pair, both directions: admin pairs are stored once but mirror both ways. */
export function mirrorPairs(doc: PatternOptionsDoc): Partial<Record<PatternZone, PatternZone>> {
	const out: Record<string, PatternZone | undefined> = { ...MIRROR_PAIRS };
	for (const z of doc.zones) {
		if (!z.mirrorOf) continue;
		out[z.id] = z.mirrorOf;
		out[z.mirrorOf] = z.id;
	}
	return out;
}

export function categoryMetaOf(c: AdminCategory): PatternCategoryMeta {
	return { value: c.id, label: c.label, shortLabel: c.shortLabel, description: c.description, icon: DEFAULT_CATEGORY_ICON, accent: c.accent };
}
