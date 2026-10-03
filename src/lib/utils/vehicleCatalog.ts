// ─────────────────────────────────────────────
// Vehicle catalog tree — make → model → trim/variant.
//
// The library stores one VehicleEntry per make/model/year(/trim). The vehicle
// browser shows them as a drill-down, so this folds the flat list into a tree
// and answers "which entries are under this make/model/trim?". Pure functions:
// no Firestore, no DOM — everything the UI counts comes from here.
// ─────────────────────────────────────────────

import type { Generation, VehicleEntry, VehicleMedia } from "$lib/types";

/** Label for entries that have no trim recorded. */
export const BASE_TRIM_LABEL = "Base / all trims";

export function slug(s: string | undefined | null): string {
	return (s ?? "")
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** Common short names → the make as it should be grouped. Matching is by slug. */
const MAKE_ALIASES: Record<string, string> = {
	chevy: "chevrolet",
	vw: "volkswagen",
	merc: "mercedes-benz",
	mercedes: "mercedes-benz",
	"mercedes-benz": "mercedes-benz",
	landrover: "land-rover",
	alfa: "alfa-romeo",
};

const words = (s: string) => slug(s).split("-").filter(Boolean);

/**
 * Library search. Every word of the query must appear somewhere in the text,
 * in any order, ignoring case, accents and punctuation — "ford raptor", "f150"
 * and "F-150 Ford" all find a Ford F-150 Raptor. Make nicknames count ("chevy").
 */
export function matchesQuery(text: string, query: string): boolean {
	const terms = words(query).map((t) => (MAKE_ALIASES[t] ? words(MAKE_ALIASES[t]).join("") : t));
	if (!terms.length) return true;
	const hay = words(text);
	const spaced = hay.join(" ");
	const joined = hay.join("");
	return terms.every((t) => spaced.includes(t) || joined.includes(t));
}

/** Grouping key for a make — "Chevy", "chevrolet " and "Chevrolet" share one. */
export function makeKey(make: string | undefined | null): string {
	const s = slug(make);
	return MAKE_ALIASES[s] ?? s;
}

export const modelKey = (model: string | undefined | null) => slug(model);
export const trimKey = (trim: string | undefined | null) => slug(trim);

/**
 * Firestore doc id for a make / model / trim's imagery. Always built from the
 * grouping keys, so "Chevy" and "Chevrolet" resolve to the same logo.
 */
export function mediaId(make: string, model?: string, trim?: string): string {
	return [makeKey(make), model ? modelKey(model) : "", model && trim ? trimKey(trim) : ""]
		.filter(Boolean)
		.join("__");
}

/** Media doc id for a residential / commercial / custom subject. */
export function subjectMediaId(projectType: string, label: string): string {
	return `${projectType}__${slug(label)}`;
}

/** What a media slot belongs to — the single description both client and server derive the doc id from. */
export interface MediaTarget {
	kind: "make" | "model" | "trim" | "subject" | "generation" | "year";
	make?: string;
	model?: string;
	trim?: string;
	projectType?: string;
	label?: string;
	/** kind "generation": the generation's name. */
	generation?: string;
	/** kind "year": the model year. */
	year?: number;
}

export function targetId(t: MediaTarget): string {
	if (t.kind === "subject") return subjectMediaId(t.projectType ?? "custom", t.label ?? "");
	// "~" never appears in a slug, so these can't collide with a trim's id.
	// Generations belong to a trim (or to the base, no-trim, entries), so their images do too.
	if (t.kind === "generation") return `${mediaId(t.make ?? "", t.model, t.trim)}__~g-${slug(t.generation)}`;
	if (t.kind === "year") return `${mediaId(t.make ?? "", t.model, t.trim)}__~y-${Math.floor(Number(t.year))}`;
	if (t.kind === "make") return mediaId(t.make ?? "");
	if (t.kind === "model") return mediaId(t.make ?? "", t.model);
	return mediaId(t.make ?? "", t.model, t.trim);
}

export function mediaFor(
	media: Record<string, VehicleMedia>,
	make: string,
	model?: string,
	trim?: string,
): VehicleMedia | undefined {
	return media[mediaId(make, model, trim)];
}

/**
 * The picture for a vehicle at whatever depth is being shown. The most specific
 * image an admin set wins, so a view shows its year's photo, else its generation's,
 * else the trim's, else the model's. With no year or generation in play (a model
 * tile) it is the model's image, else the newest generation's that has one.
 * Generations come from the model's own record.
 */
export function vehicleImage(
	media: Record<string, VehicleMedia>,
	make: string,
	model: string,
	ctx: { trim?: string; year?: number; generation?: string } = {},
): string | undefined {
	const img = (t: MediaTarget) => media[targetId(t)]?.imageUrl || undefined;
	const trim = ctx.trim || undefined;
	const gens = generationsFor(media, make, model, trim);
	const genName = ctx.generation ?? generationOf(ctx.year, gens)?.label;
	return (
		(ctx.year ? img({ kind: "year", make, model, trim, year: ctx.year }) : undefined) ??
		(genName ? img({ kind: "generation", make, model, trim, generation: genName }) : undefined) ??
		(trim ? img({ kind: "trim", make, model, trim }) : undefined) ??
		img({ kind: "model", make, model }) ??
		(ctx.year || genName ? undefined : [...gens].sort((a, b) => b.to - a.to).map((g) => img({ kind: "generation", make, model, trim, generation: g.label })).find(Boolean))
	);
}

/** "GM" / "BM" / "Toyota" → two-letter monogram for a make with no logo yet. */
export function monogram(name: string): string {
	const words = name.trim().split(/[\s-]+/).filter(Boolean);
	if (!words.length) return "?";
	if (words.length === 1) return words[0].slice(0, words[0].length <= 3 ? words[0].length : 2).toUpperCase();
	return (words[0][0] + words[1][0]).toUpperCase();
}

export interface CatalogRow {
	v: VehicleEntry;
	/** Patterns that count toward this entry (already scoped to category etc.). */
	count: number;
	/**
	 * Ids of those patterns. When given, node totals count DISTINCT ids — one
	 * pattern that fits several models/years/trims is expanded into several
	 * rows but must still count once. Rows without ids just add `count`.
	 */
	ids?: string[];
}

/** Total patterns across rows: distinct ids where known, else summed counts. */
export function countRows(rows: CatalogRow[]): number {
	const seen = new Set<string>();
	let n = 0;
	for (const r of rows) {
		if (r.ids) for (const id of r.ids) seen.add(id);
		else n += r.count;
	}
	return n + seen.size;
}

export interface TrimNode {
	key: string; // "" for base
	label: string;
	count: number;
	entries: number;
	years: number[];
}
export interface ModelNode {
	key: string;
	label: string;
	count: number;
	entries: number;
	years: number[];
	bodyStyle?: VehicleEntry["bodyStyle"];
	trims: TrimNode[];
}
export interface MakeNode {
	key: string;
	label: string;
	count: number;
	entries: number;
	models: ModelNode[];
}

/** Most common non-empty value, ties broken by first seen. */
function mode<T>(values: (T | undefined)[]): T | undefined {
	const tally = new Map<T, number>();
	for (const v of values) if (v !== undefined && v !== "") tally.set(v, (tally.get(v) ?? 0) + 1);
	let best: T | undefined, n = 0;
	for (const [v, c] of tally) if (c > n) { best = v; n = c; }
	return best;
}

const byLabel = (a: { label: string }, b: { label: string }) =>
	a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });

/** Folds vehicle entries into make → model → trim. Non-vehicle rows must be filtered out first. */
export function buildTree(rows: CatalogRow[]): MakeNode[] {
	const makes = new Map<string, { rows: CatalogRow[] }>();
	for (const r of rows) {
		const k = makeKey(r.v.make);
		if (!k) continue;
		(makes.get(k) ?? makes.set(k, { rows: [] }).get(k)!).rows.push(r);
	}

	const out: MakeNode[] = [];
	for (const [mk, { rows: mRows }] of makes) {
		const models = new Map<string, CatalogRow[]>();
		for (const r of mRows) {
			const k = modelKey(r.v.model);
			if (!k) continue;
			(models.get(k) ?? models.set(k, []).get(k)!).push(r);
		}

		const modelNodes: ModelNode[] = [];
		for (const [ok, oRows] of models) {
			const trims = new Map<string, CatalogRow[]>();
			for (const r of oRows) {
				const k = trimKey(r.v.trim);
				(trims.get(k) ?? trims.set(k, []).get(k)!).push(r);
			}
			const trimNodes: TrimNode[] = [...trims].map(([tk, tRows]) => ({
				key: tk,
				label: tk ? mode(tRows.map((r) => r.v.trim?.trim())) ?? tk : BASE_TRIM_LABEL,
				count: countRows(tRows),
				entries: tRows.length,
				years: yearsOf(tRows),
			}));
			// Base first, then alphabetical.
			trimNodes.sort((a, b) => (a.key === "" ? -1 : b.key === "" ? 1 : byLabel(a, b)));

			modelNodes.push({
				key: ok,
				label: mode(oRows.map((r) => r.v.model?.trim())) ?? ok,
				count: countRows(oRows),
				entries: oRows.length,
				years: yearsOf(oRows),
				bodyStyle: mode(oRows.map((r) => r.v.bodyStyle)),
				trims: trimNodes,
			});
		}
		modelNodes.sort(byLabel);

		out.push({
			key: mk,
			label: mode(mRows.map((r) => r.v.make?.trim())) ?? mk,
			count: countRows(mRows),
			entries: mRows.length,
			models: modelNodes,
		});
	}
	return out.sort(byLabel);
}

function yearsOf(rows: CatalogRow[]): number[] {
	return [...new Set(rows.map((r) => r.v.year).filter((y): y is number => !!y))].sort((a, b) => b - a);
}

/** "2018–2024" for a contiguous-ish span, "2019" for one year, "" for none. */
export function yearSpan(years: number[]): string {
	if (!years.length) return "";
	const hi = Math.max(...years), lo = Math.min(...years);
	return hi === lo ? String(hi) : `${lo}–${hi}`;
}

// ─── Generations ──────────────────────────────
// An admin groups a model's years into named runs ("Gen 3: 2015–2020"). They're
// ranges on the model, not labels on each year entry, so a year added later
// (bulk add, an approved submission, a private upload) lands in its generation
// by itself. Years in no range simply stay as individual years.

/**
 * A trim's generations. They live on the trim's own record; the base entries (no
 * trim) use the model's. A trim never borrows another's.
 */
export function generationsFor(media: Record<string, VehicleMedia>, make: string, model: string, trim?: string): Generation[] {
	return media[mediaId(make, model, trim)]?.generations ?? [];
}

export const genSpan = (g: Pick<Generation, "from" | "to">) => (g.from === g.to ? String(g.from) : `${g.from}–${g.to}`);
export const generationKey = (g: Pick<Generation, "label">) => slug(g.label);

/** Stored/typed generations → valid ones, newest first. Bad rows are dropped, bounds swapped if reversed. */
export function cleanGenerations(raw: unknown): Generation[] {
	if (!Array.isArray(raw)) return [];
	const out: Generation[] = [];
	for (const g of raw) {
		const label = typeof g?.label === "string" ? g.label.trim() : "";
		const a = Math.floor(Number(g?.from)), b = Math.floor(Number(g?.to));
		if (!label || !a || !b) continue;
		out.push({ label, from: Math.min(a, b), to: Math.max(a, b) });
	}
	return out.sort((x, y) => y.to - x.to || y.from - x.from);
}

/** Why a list can't be saved, or null. Checked as typed, before cleaning. */
export function generationError(list: Generation[]): string | null {
	const gens = list.map((g) => ({ label: String(g.label ?? "").trim(), from: Math.floor(Number(g.from)), to: Math.floor(Number(g.to)) }));
	for (const g of gens) {
		if (!g.label) return "Name every generation.";
		if (!g.from || !g.to || g.from < 1900 || g.to > 2100) return `“${g.label}” needs a first and last year.`;
		if (g.to < g.from) return `“${g.label}” ends before it starts.`;
	}
	const keys = new Set<string>();
	for (const g of gens) {
		const k = slug(g.label);
		if (keys.has(k)) return `Two generations are called “${g.label}”.`;
		keys.add(k);
	}
	const sorted = [...gens].sort((a, b) => a.from - b.from);
	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i].from <= sorted[i - 1].to) return `“${sorted[i - 1].label}” and “${sorted[i].label}” share a year.`;
	}
	return null;
}

export function generationOf(year: number | undefined, gens: Generation[]): Generation | undefined {
	return year ? gens.find((g) => year >= g.from && year <= g.to) : undefined;
}

/** Rows split into their generations (only ones with a row) and the years that sit in none. */
export function groupByGeneration<T extends { v: Pick<VehicleEntry, "year"> }>(
	rows: T[],
	gens: Generation[],
): { groups: { gen: Generation; rows: T[] }[]; loose: T[] } {
	const byKey = new Map<string, { gen: Generation; rows: T[] }>();
	const loose: T[] = [];
	for (const r of rows) {
		const gen = generationOf(r.v.year, gens);
		if (!gen) { loose.push(r); continue; }
		const k = generationKey(gen);
		(byKey.get(k) ?? byKey.set(k, { gen, rows: [] }).get(k)!).rows.push(r);
	}
	return { groups: [...byKey.values()].sort((a, b) => b.gen.to - a.gen.to), loose };
}

/** Years as short labels: a generation whose years are all there collapses to its name; the rest stay single. Newest first. */
export function groupYearLabels(years: number[], gens: Generation[], available?: number[]): { label: string; to: number; isGen: boolean }[] {
	const set = new Set(years);
	const used = new Set<number>();
	const out: { label: string; to: number; isGen: boolean }[] = [];
	for (const g of gens) {
		const have = [...set].filter((y) => y >= g.from && y <= g.to);
		if (!have.length) continue;
		// "All of it" = every year that could have been picked (the available ones, else the whole range).
		const need = available ? available.filter((y) => y >= g.from && y <= g.to) : null;
		const full = need ? need.length > 0 && need.every((y) => set.has(y)) : have.length === g.to - g.from + 1;
		if (!full) continue;
		out.push({ label: g.label, to: g.to, isGen: true });
		have.forEach((y) => used.add(y));
	}
	for (const y of set) if (!used.has(y)) out.push({ label: String(y), to: y, isGen: false });
	return out.sort((a, b) => b.to - a.to);
}

export interface YearOption { key: string; label: string; from: number; to: number; isGen: boolean }

/**
 * The year filter: each generation that has entries (full-width, with its span),
 * then any year in no generation on its own. Newest first.
 */
export function yearOptions(entries: { v: Pick<VehicleEntry, "year"> }[], gens: Generation[]): YearOption[] {
	const years = [...new Set(entries.map((x) => x.v.year).filter((y): y is number => !!y))].sort((a, b) => b - a);
	const { groups } = groupByGeneration(years.map((year) => ({ v: { year } })), gens);
	const opts: YearOption[] = groups.map(({ gen }) => ({ key: `g:${generationKey(gen)}`, label: gen.label, from: gen.from, to: gen.to, isGen: true }));
	for (const y of years) if (!generationOf(y, gens)) opts.push({ key: String(y), label: String(y), from: y, to: y, isGen: false });
	return opts.sort((a, b) => b.to - a.to);
}

/** Entries under a make / model / trim path. Any level left undefined matches all. */
export function entriesUnder<T extends { v: VehicleEntry }>(
	rows: T[],
	path: { make?: string; model?: string; trim?: string },
): T[] {
	return rows.filter(({ v }) => {
		if (path.make !== undefined && makeKey(v.make) !== path.make) return false;
		if (path.model !== undefined && modelKey(v.model) !== path.model) return false;
		if (path.trim !== undefined && trimKey(v.trim) !== path.trim) return false;
		return true;
	});
}

/** Outline used as the model-image fallback, keyed by body style (24×14 viewBox). */
export const BODY_STYLE_PATH: Record<string, string> = {
	sedan:       "M2 14 L6 8 L18 8 L22 14 Z",
	coupe:       "M3 14 L7 7 L17 7 L21 14 Z",
	suv:         "M2 14 L4 6 L20 6 L22 14 Z",
	truck:       "M2 14 L4 8 L12 8 L12 6 L20 6 L22 14 Z",
	hatchback:   "M2 14 L5 8 L19 8 L22 11 L22 14 Z",
	wagon:       "M2 14 L4 7 L20 7 L22 14 Z",
	convertible: "M3 14 L8 10 L16 10 L21 14 Z",
};

/** URL sentinels for the trim level. Slugs never contain "~", so they can't collide. */
export const TRIM_BASE = "~base";
export const TRIM_ALL = "~all";

/** URL trim value → the `trim` argument for entriesUnder (undefined = every trim). */
export function trimFilter(t: string | undefined): string | undefined {
	if (t === undefined || t === TRIM_ALL) return undefined;
	return t === TRIM_BASE ? "" : t;
}
