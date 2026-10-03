// Admin → Catalog: editing and deleting a whole layer of the vehicle pipeline
// (make → model → trim → generation), not just one model year.
//
// Pure planning, no Firestore: given the catalog, a layer and what to do with it,
// this returns exactly what would be written and the counts a confirm dialog
// needs. The caller applies it (commitLayerChange) in an order that is safe to
// retry.
//
// The thing that makes this more than a find-and-replace: generations and images
// live on `vehicleMedia` docs whose ids are built from slugs of the names
// (`toyota__camry__se__~g-gen-1`). Renaming a layer changes those slugs, so the
// docs have to MOVE with it or the generations and images silently vanish.

import type { Generation, Pattern, UserPattern, VehicleEntry, VehicleMedia } from "$lib/types";
import { generationKey, makeKey, mediaId, targetId, trimKey } from "$lib/utils/vehicleCatalog";
import { demandModelKey } from "$lib/utils/demand";
import { linkedPatterns, ownersToReset } from "$lib/utils/publishPlan";

export type LayerRef =
	| { level: "make"; make: string }
	| { level: "model"; make: string; model: string }
	/** `trim: ""` is the base — the entries with no trim. */
	| { level: "trim"; make: string; model: string; trim: string };

type BodyStyle = NonNullable<VehicleEntry["bodyStyle"]>;
const isVehicle = (v: VehicleEntry) => (v.projectType ?? "vehicle") === "vehicle" && !!v.make && !!v.model;

/**
 * The entries under a layer, found by the library's own grouping keys — so a model
 * row that holds "GR-86" and "GR86" (or "Chevy" and "Chevrolet") edits them all.
 */
export function scopeOf(ref: LayerRef, vehicles: VehicleEntry[]): VehicleEntry[] {
	return vehicles.filter(
		(v) =>
			isVehicle(v) &&
			makeKey(v.make) === makeKey(ref.make) &&
			(ref.level === "make" || demandModelKey(v.make, v.model) === demandModelKey(ref.make, ref.model)) &&
			(ref.level !== "trim" || trimKey(v.trim) === trimKey(ref.trim)),
	);
}

const hasContent = (d: VehicleMedia | undefined) => !!(d && (d.logoUrl || d.imageUrl || d.generations?.length));
/** The same stored content — so a half-finished rename that is run again isn't mistaken for a clash. */
const sameContent = (a: VehicleMedia | undefined, b: VehicleMedia) =>
	!!a && a.logoUrl === b.logoUrl && a.imageUrl === b.imageUrl && JSON.stringify(a.generations ?? []) === JSON.stringify(b.generations ?? []);
const underPrefix = (id: string, prefix: string) => id === prefix || id.startsWith(`${prefix}__`);
const idsUnder = (prefixes: string[], media: Record<string, VehicleMedia>) =>
	Object.keys(media).filter((id) => prefixes.some((p) => underPrefix(id, p)));

/** Media-doc id prefix per spelling in scope, with a representative entry to build the new one from. */
function prefixesOf(ref: LayerRef, scope: VehicleEntry[]): Map<string, VehicleEntry> {
	const out = new Map<string, VehicleEntry>();
	for (const v of scope) {
		const p =
			ref.level === "make" ? makeKey(v.make)
			: ref.level === "model" ? mediaId(v.make!, v.model)
			: mediaId(v.make!, v.model, v.trim);
		if (!out.has(p)) out.set(p, v);
	}
	return out;
}

export interface MediaMove {
	from: string;
	to: string;
	/** The doc as it must exist at `to`. */
	doc: VehicleMedia;
}

export interface EditPlan {
	error?: string;
	/** Entries to change (only those that actually differ). */
	patches: { id: string; patch: Partial<VehicleEntry> }[];
	/** Media docs to write at a new id (or update in place when from === to). */
	moves: MediaMove[];
	/** Old media docs to remove after their moves (and empty ones a rename leaves behind). */
	removeMedia: string[];
	/** Entries under the layer. */
	entries: number;
}

export interface EditInput {
	ref: LayerRef;
	/** New name for the layer. Not available for the base (no-trim) entries. */
	name?: string;
	/** Models only: set every entry's body style. */
	bodyStyle?: BodyStyle;
	/** Set every entry's status. */
	status?: VehicleEntry["status"];
	vehicles: VehicleEntry[];
	media: Record<string, VehicleMedia>;
}

const dupKey = (v: Pick<VehicleEntry, "make" | "model" | "trim" | "year">) =>
	`${makeKey(v.make)}|${demandModelKey(v.make, v.model)}|${trimKey(v.trim)}|${v.year}`;

export function planLayerEdit(i: EditInput): EditPlan {
	const none: EditPlan = { patches: [], moves: [], removeMedia: [], entries: 0 };
	const scope = scopeOf(i.ref, i.vehicles);
	if (!scope.length) return { ...none, error: "Nothing in the catalog is under this." };
	const name = i.name?.trim();
	if (i.name !== undefined && !name) return { ...none, entries: scope.length, error: "Enter a name." };
	if (name && i.ref.level === "trim" && i.ref.trim === "") {
		return { ...none, entries: scope.length, error: "The base entries have no trim name to change. Add a trim instead." };
	}

	const field = i.ref.level === "make" ? "make" : i.ref.level === "model" ? "model" : "trim";
	const patches: EditPlan["patches"] = [];
	for (const v of scope) {
		const patch: Partial<VehicleEntry> = {};
		if (name && v[field] !== name) patch[field] = name;
		if (i.ref.level === "model" && i.bodyStyle && v.bodyStyle !== i.bodyStyle) patch.bodyStyle = i.bodyStyle;
		if (i.status && v.status !== i.status) patch.status = i.status;
		if (Object.keys(patch).length) patches.push({ id: v.id, patch });
	}
	const base: EditPlan = { ...none, patches, entries: scope.length };

	// A rename must not land two entries on the same make / model / trim / year.
	if (name) {
		const patched = new Map(patches.map((p) => [p.id, p.patch]));
		const inScope = new Set(scope.map((v) => v.id));
		const seen = new Map<string, VehicleEntry>();
		for (const v of i.vehicles.filter(isVehicle)) {
			const after = { ...v, ...(patched.get(v.id) ?? {}) };
			const k = dupKey(after);
			const prior = seen.get(k);
			if (prior && (inScope.has(v.id) || inScope.has(prior.id))) {
				const label = [after.year, after.make, after.model, after.trim].filter(Boolean).join(" ");
				return { ...base, error: `“${name}” would put two entries on ${label}. Delete or rename one of them first.` };
			}
			seen.set(k, after);
		}
	}

	// Media docs travel with a rename.
	const moves: MediaMove[] = [];
	const removeMedia: string[] = [];
	if (name) {
		const prefixes = prefixesOf(i.ref, scope);
		const targets = new Map<string, string>();
		for (const [oldPrefix, rep] of prefixes) {
			const newPrefix =
				i.ref.level === "make" ? makeKey(name)
				: i.ref.level === "model" ? mediaId(rep.make!, name)
				: mediaId(rep.make!, rep.model, name);
			for (const from of idsUnder([oldPrefix], i.media)) {
				const old = i.media[from];
				const to = newPrefix + from.slice(oldPrefix.length);
				if (!hasContent(old)) { if (to !== from) removeMedia.push(from); continue; }
				const doc: VehicleMedia = {
					...old,
					id: to,
					...(i.ref.level === "make" ? { make: name } : {}),
					...(i.ref.level === "model" && old.model ? { model: name } : {}),
					...(i.ref.level === "trim" && old.trim ? { trim: name } : {}),
				};
				if (to === from && doc.make === old.make && doc.model === old.model && doc.trim === old.trim) continue;
				if (to !== from) removeMedia.push(from);
				moves.push({ from, to, doc });
				if (targets.has(to)) return { ...base, error: "Two image / generation records would end up with the same name. Rename them one at a time." };
				targets.set(to, from);
			}
		}
		const sources = new Set(moves.map((m) => m.from));
		for (const m of moves) {
			if (m.to !== m.from && hasContent(i.media[m.to]) && !sources.has(m.to) && !sameContent(i.media[m.to], m.doc)) {
				return { ...base, error: `There are already images or generations saved under “${name}”. Remove them first, or pick another name.` };
			}
		}
		// A destination is never also something to delete.
		const dest = new Set(moves.map((m) => m.to));
		for (let n = removeMedia.length - 1; n >= 0; n--) if (dest.has(removeMedia[n])) removeMedia.splice(n, 1);
	}
	return { ...base, moves, removeMedia };
}

export interface DeleteInput {
	ref: LayerRef;
	vehicles: VehicleEntry[];
	media: Record<string, VehicleMedia>;
	patternsOf: (vehicleId: string) => Pattern[];
	/** Every catalog pattern — to tell which submitters lose their last live copy. */
	allPatterns: Pattern[];
	submissions: Pick<UserPattern, "id" | "vehicleId" | "svgPath" | "isPublished">[];
}

export interface DeletePlan {
	subjects: VehicleEntry[];
	/** A subject with its patterns, so a chunk never strands one without the other. */
	groups: { subjectId: string; patternIds: string[] }[];
	patterns: Pattern[];
	/** Submitters whose published copy goes back to private. */
	resets: Pick<UserPattern, "id" | "vehicleId" | "svgPath" | "isPublished">[];
	removeMedia: string[];
	/** Base (no-trim) deletes keep the model doc's image but drop its generations. */
	clearGenerations: string[];
	/** Uploaded files behind the removed media docs. */
	storagePaths: string[];
	images: number;
	generations: number;
}

export function planLayerDelete(i: DeleteInput): DeletePlan {
	const subjects = scopeOf(i.ref, i.vehicles);
	let removeMedia: string[] = [];
	const clearGenerations: string[] = [];
	if (i.ref.level === "trim" && i.ref.trim === "") {
		// Base entries: their generations sit on the model doc, their generation / year
		// images on `<model>__~…` docs. The model's own image and every trim's stay.
		const modelPrefixes = [...new Set(subjects.map((v) => mediaId(v.make!, v.model)))];
		removeMedia = Object.keys(i.media).filter((id) => modelPrefixes.some((p) => id.startsWith(`${p}__~`)));
		for (const p of modelPrefixes) if (i.media[p]?.generations?.length) clearGenerations.push(p);
	} else {
		removeMedia = idsUnder([...prefixesOf(i.ref, subjects).keys()], i.media);
	}
	return finishDelete(subjects, removeMedia, clearGenerations, i);
}

/** Delete a hand-picked set of entries (e.g. a trim's uncategorized years): each one's own year image goes with it, nothing else. */
export function planEntriesDelete(i: Omit<DeleteInput, "ref"> & { subjects: VehicleEntry[] }): DeletePlan {
	return finishDelete(i.subjects, i.subjects.flatMap((v) => entryMediaIds(v, i.media)), [], i);
}

function finishDelete(
	subjects: VehicleEntry[],
	removeMedia: string[],
	clearGenerations: string[],
	i: Omit<DeleteInput, "ref">,
): DeletePlan {
	const groups = subjects.map((v) => ({ subjectId: v.id, patternIds: i.patternsOf(v.id).map((p) => p.id) }));
	const patterns = subjects.flatMap((v) => i.patternsOf(v.id));
	const gone = new Set(patterns.map((p) => p.id));
	const remaining = i.allPatterns.filter((p) => !gone.has(p.id));
	const resets = ownersToReset(patterns, remaining, i.submissions);
	// A delete that stopped part-way and is run again no longer sees the patterns it already removed.
	// A published copy filed under one of these subjects with nothing left in the catalog still has to go private.
	const subjectIds = new Set(subjects.map((v) => v.id));
	const handled = new Set(resets.map((r) => r.id));
	for (const sub of i.submissions) {
		if (sub.isPublished && !handled.has(sub.id) && sub.vehicleId && subjectIds.has(sub.vehicleId) && !linkedPatterns(sub, remaining).length) {
			resets.push(sub);
		}
	}
	const storagePaths = removeMedia.flatMap((id) => [i.media[id]?.logoPath, i.media[id]?.imagePath]).filter((p): p is string => !!p && p.startsWith("vehicle-media/"));
	return {
		subjects, groups, patterns, resets, removeMedia, clearGenerations, storagePaths,
		images: removeMedia.filter((id) => i.media[id]?.logoUrl || i.media[id]?.imageUrl).length,
		generations: [...removeMedia, ...clearGenerations].reduce((n, id) => n + (i.media[id]?.generations?.length ?? 0), 0),
	};
}

/** The year image doc of one entry — removed with the entry. */
export function entryMediaIds(v: VehicleEntry, media: Record<string, VehicleMedia>): string[] {
	if (!v.make || !v.model || !v.year) return [];
	const id = targetId({ kind: "year", make: v.make, model: v.model, trim: v.trim || undefined, year: v.year });
	return media[id] ? [id] : [];
}

export interface GenerationRow extends Generation {
	/** The name this row had when the dialog opened — how a rename is told from a delete. */
	orig?: string;
}

export interface GenerationChange {
	error?: string;
	moves: MediaMove[];
	removeMedia: string[];
	storagePaths: string[];
	/** Generations dropped (not renamed) and ones renamed — for the confirm. */
	removed: string[];
	renamed: [string, string][];
}

/** What saving a trim's generation list does to those generations' images. */
export function planGenerationChange(i: {
	make: string;
	model: string;
	trim?: string;
	previous: Generation[];
	next: GenerationRow[];
	media: Record<string, VehicleMedia>;
}): GenerationChange {
	const idOf = (label: string) => targetId({ kind: "generation", make: i.make, model: i.model, trim: i.trim || undefined, generation: label });
	const out: GenerationChange = { moves: [], removeMedia: [], storagePaths: [], removed: [], renamed: [] };
	const claimed = new Set<string>();
	for (const row of i.next) if (row.orig) claimed.add(generationKey({ label: row.orig }));
	for (const p of i.previous) {
		const from = idOf(p.label);
		const doc = i.media[from];
		const row = i.next.find((r) => r.orig && generationKey({ label: r.orig }) === generationKey(p));
		if (!row) {
			out.removed.push(p.label);
			if (doc) {
				out.removeMedia.push(from);
				for (const path of [doc.logoPath, doc.imagePath]) if (path?.startsWith("vehicle-media/")) out.storagePaths.push(path);
			}
			continue;
		}
		if (generationKey(row) === generationKey(p)) continue;
		out.renamed.push([p.label, row.label.trim()]);
		if (!hasContent(doc)) continue;
		const to = idOf(row.label.trim());
		if (hasContent(i.media[to]) && !claimed.has(generationKey({ label: row.label }))) {
			return { ...out, error: `There's already an image saved for “${row.label.trim()}”.` };
		}
		out.moves.push({ from, to, doc: { ...doc, id: to, generation: row.label.trim() } });
		out.removeMedia.push(from);
	}
	return out;
}

/**
 * A rename also has to reach the submissions that were published from the renamed
 * entries. The Repair flow matches a submission to the catalog by its own make /
 * models / trims, so one still saying "Toyota" after the catalog says "Lexus" would
 * look half-published and be offered for repair, rebuilding the old name.
 */
export function planSubmissionRename(i: {
	ref: LayerRef;
	name: string;
	/** Patterns on the entries being renamed. */
	scopePatterns: Pattern[];
	submissions: UserPattern[];
}): { id: string; patch: Partial<UserPattern> }[] {
	const name = i.name.trim();
	const sources = new Set(i.scopePatterns.map((p) => p.sourcePatternId).filter(Boolean));
	const out: { id: string; patch: Partial<UserPattern> }[] = [];
	const swap = (list: string[], match: (x: string) => boolean) => {
		const seen = new Set<string>();
		return list.map((x) => (match(x) ? name : x)).filter((x) => (seen.has(x.toLowerCase()) ? false : (seen.add(x.toLowerCase()), true)));
	};
	for (const sub of i.submissions) {
		if (!(sources.has(sub.id) || linkedPatterns(sub, i.scopePatterns).length)) continue;
		const patch: Partial<UserPattern> = {};
		if (i.ref.level === "make" && makeKey(sub.make) === makeKey(i.ref.make) && sub.make !== name) patch.make = name;
		if (i.ref.level === "model") {
			const models = swap(sub.models ?? [], (m) => demandModelKey(sub.make, m) === demandModelKey(i.ref.make, (i.ref as { model: string }).model));
			if (models.join("|") !== (sub.models ?? []).join("|")) patch.models = models;
		}
		if (i.ref.level === "trim") {
			const trims = swap(sub.trims ?? [], (t) => trimKey(t) === trimKey((i.ref as { trim: string }).trim));
			if (trims.join("|") !== (sub.trims ?? []).join("|")) patch.trims = trims;
		}
		if (Object.keys(patch).length) out.push({ id: sub.id, patch });
	}
	return out;
}

/** Editing one entry's make / model / trim / year moves its own year image to the new id. */
export function planEntryMove(
	before: VehicleEntry,
	after: VehicleEntry,
	media: Record<string, VehicleMedia>,
): { moves: MediaMove[]; removeMedia: string[] } {
	const none = { moves: [], removeMedia: [] };
	const [from] = entryMediaIds(before, media);
	if (!from || !after.make || !after.model || !after.year) return none;
	const to = targetId({ kind: "year", make: after.make, model: after.model, trim: after.trim || undefined, year: after.year });
	if (to === from || hasContent(media[to])) return none;
	const doc: VehicleMedia = { ...media[from], id: to, make: after.make, model: after.model, trim: after.trim || undefined, year: after.year };
	return { moves: [{ from, to, doc }], removeMedia: [from] };
}
