// ─────────────────────────────────────────────
// Unified pattern library rows.
//
// The library is ONE list of { subject, patterns } rows. Community rows come
// from the public catalog; private rows are the signed-in user's own uploads
// converted to the same shape, tagged by `source`. Every count, filter and
// grid in the library derives from this list, so a number can never promise a
// pattern the user can't reach.
//
// A private upload is a single outline that can fit several models, years and
// trims (and several zones). It is expanded into one row per make/model/year/
// trim so the make → model → trim browser finds it everywhere it applies —
// which means the SAME pattern id appears in many rows. Callers therefore
// count distinct ids (`distinctCount`, `countRows`) and de-duplicate cards
// (`uniquePatterns`) instead of summing `pats.length`.
// ─────────────────────────────────────────────

import type { Pattern, PatternZone, ProjectType, UserPattern, VehicleEntry } from "$lib/types";
import { slug } from "./vehicleCatalog";

export type LibrarySource = "all" | "community" | "private";
export type ShareStatus = "unshared" | "pending" | "published" | "rejected";

export interface LibPattern extends Pattern {
	source: "community" | "private";
	/** Private only: every zone this one outline covers (mirror pairs etc.). */
	zones?: PatternZone[];
	customZoneLabels?: string[];
	/** Private only: the owner's record — status, edit/delete, mirror-add. */
	up?: UserPattern;
}

export interface LibRow {
	v: VehicleEntry;
	pats: LibPattern[];
}

/** Where a private pattern stands. "unshared" = only the owner can see it. */
export function shareStatusOf(p: Pick<UserPattern, "isPublished" | "status">): ShareStatus {
	if (p.isPublished) return "published";
	if (p.status === "pending") return "pending";
	if (p.status === "rejected") return "rejected";
	return "unshared";
}

/** A UserPattern as the canvas-ready Pattern the Studio expects. */
export function userPatternToPattern(up: UserPattern): Pattern {
	const zone = up.zones[0] ?? "custom";
	return {
		id: up.id,
		vehicleId: up.vehicleId ?? `user_${up.ownerId}`,
		projectType: up.projectType,
		category: up.category,
		zone,
		customZoneLabel: zone === "custom" ? up.customZoneLabels?.[0] : undefined,
		name: up.name,
		coverage: up.coverage,
		svgPath: up.svgPath,
		widthInches: up.widthInches,
		heightInches: up.heightInches,
		revision: new Date(up.createdAt).toISOString().slice(0, 7),
		notes: up.notes,
		isPublished: up.isPublished,
		createdAt: up.createdAt,
		updatedAt: up.updatedAt,
	};
}

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;
/** A typo like "1-9999" must not mint thousands of rows. */
export const MAX_YEARS_PER_PATTERN = 60;
const MAX_LIST = 12;

/** ["2018", "2020-2024"] → [2024, 2023, 2022, 2021, 2020, 2018]. Bad tokens are skipped. */
export function expandYears(years: string[] | undefined): number[] {
	const out = new Set<number>();
	for (const raw of years ?? []) {
		const m = /^\s*(\d{4})\s*(?:[-–—]\s*(\d{4}))?\s*$/.exec(raw ?? "");
		if (!m) continue;
		const lo = Number(m[1]);
		const hi = m[2] ? Number(m[2]) : lo;
		if (lo < MIN_YEAR || hi > MAX_YEAR || hi < lo) continue;
		for (let y = lo; y <= hi && out.size < MAX_YEARS_PER_PATTERN; y++) out.add(y);
	}
	return [...out].sort((a, b) => b - a);
}

const clean = (list: string[] | undefined) =>
	[...new Set((list ?? []).map((s) => (s ?? "").trim()).filter(Boolean))].slice(0, MAX_LIST);

const iso = (d: Date | string | undefined) => {
	const t = d ? new Date(d) : new Date();
	return Number.isNaN(t.getTime()) ? new Date().toISOString() : t.toISOString();
};

/** What a non-vehicle pattern's subject is called ("Smith Residence"). */
export function privateSubjectLabel(up: UserPattern): string {
	return up.propertyLabel?.trim() || up.patternName?.trim() || up.address?.trim() || up.name?.trim() || "Untitled";
}

/**
 * The user's uploads as library rows.
 * - Vehicles: one row per model × trim × year the pattern fits. A missing make
 *   or model files under "Unsorted" / "Unspecified" rather than vanishing, so
 *   the Private total always equals what's reachable.
 * - Property / custom: patterns sharing a label collect under one subject,
 *   the way the community catalog groups them.
 */
export function privateRows(ups: UserPattern[]): LibRow[] {
	const rows: LibRow[] = [];
	const subjects = new Map<string, LibRow>();

	for (const up of ups) {
		const pat: LibPattern = {
			...userPatternToPattern(up),
			source: "private",
			zones: up.zones,
			customZoneLabels: up.customZoneLabels,
			up,
		};
		const type: ProjectType = up.projectType ?? "vehicle";
		const updatedAt = iso(up.updatedAt);

		if (type !== "vehicle") {
			const label = privateSubjectLabel(up);
			const key = `${type}:${slug(label)}`;
			let row = subjects.get(key);
			if (!row) {
				row = {
					v: {
						id: `upsubj:${key}`,
						projectType: type,
						propertyLabel: label,
						address: up.address || undefined,
						tags: [],
						status: "published",
						updatedAt,
					},
					pats: [],
				};
				subjects.set(key, row);
				rows.push(row);
			}
			row.pats.push(pat);
			if (updatedAt > row.v.updatedAt) row.v.updatedAt = updatedAt;
			continue;
		}

		const make = up.make?.trim() || "Unsorted";
		const models = clean(up.models);
		const trims = clean(up.trims);
		const years = expandYears(up.years);
		for (const model of models.length ? models : [""]) {
			for (const trim of trims.length ? trims : [""]) {
				for (const year of years.length ? years : [undefined]) {
					rows.push({
						v: {
							id: `up:${up.id}:${slug(model)}:${slug(trim)}:${year ?? "any"}`,
							projectType: "vehicle",
							make,
							model: model || "Unspecified",
							trim: trim || undefined,
							year,
							bodyStyle: up.bodyStyle,
							tags: [],
							status: "published",
							updatedAt,
						},
						pats: [pat],
					});
				}
			}
		}
	}
	return rows;
}

/** The public catalog as rows: published subjects that have published patterns. */
export function communityRows(
	vehicles: VehicleEntry[],
	getPatterns: (vehicleId: string) => Pattern[],
): LibRow[] {
	return vehicles
		.filter((v) => v.status === "published")
		.map((v) => ({ v, pats: getPatterns(v.id).map((p): LibPattern => ({ ...p, source: "community" })) }))
		.filter((r) => r.pats.length > 0);
}

/**
 * Rows for a source filter. Approving a submission COPIES it into the public
 * catalog and keeps the owner's record (no link between the two), so "All"
 * leaves the owner's already-published uploads out — the community copy is
 * what shows — while "Private" lists them with their Published status.
 */
export function rowsForSource(source: LibrarySource, community: LibRow[], priv: LibRow[]): LibRow[] {
	if (source === "community") return community;
	if (source === "private") return priv;
	const unpublished = priv
		.map((r) => ({ v: r.v, pats: r.pats.filter((p) => !p.up?.isPublished) }))
		.filter((r) => r.pats.length > 0);
	return [...community, ...unpublished];
}

/** Each pattern once, in first-seen order. */
export function uniquePatterns<T extends { id: string }>(pats: T[]): T[] {
	const seen = new Set<string>();
	return pats.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

/** Distinct patterns across rows. */
export function distinctCount(rows: { pats: { id: string }[] }[]): number {
	const seen = new Set<string>();
	for (const r of rows) for (const p of r.pats) seen.add(p.id);
	return seen.size;
}
