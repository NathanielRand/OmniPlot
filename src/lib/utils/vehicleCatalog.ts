// ─────────────────────────────────────────────
// Vehicle catalog tree — make → model → trim/variant.
//
// The library stores one VehicleEntry per make/model/year(/trim). The vehicle
// browser shows them as a drill-down, so this folds the flat list into a tree
// and answers "which entries are under this make/model/trim?". Pure functions:
// no Firestore, no DOM — everything the UI counts comes from here.
// ─────────────────────────────────────────────

import type { VehicleEntry, VehicleMedia } from "$lib/types";

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

export function mediaFor(
	media: Record<string, VehicleMedia>,
	make: string,
	model?: string,
	trim?: string,
): VehicleMedia | undefined {
	return media[mediaId(make, model, trim)];
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
				count: tRows.reduce((n, r) => n + r.count, 0),
				entries: tRows.length,
				years: yearsOf(tRows),
			}));
			// Base first, then alphabetical.
			trimNodes.sort((a, b) => (a.key === "" ? -1 : b.key === "" ? 1 : byLabel(a, b)));

			modelNodes.push({
				key: ok,
				label: mode(oRows.map((r) => r.v.model?.trim())) ?? ok,
				count: oRows.reduce((n, r) => n + r.count, 0),
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
			count: mRows.reduce((n, r) => n + r.count, 0),
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
