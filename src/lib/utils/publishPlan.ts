// ─────────────────────────────────────────────
// Publishing a community submission, as a pure plan.
//
// A submission is ONE outline that can fit several models, years, trims and
// zones; the catalog stores one subject per make/model/year/trim and one
// pattern per subject × zone. Approving used to publish only the first of
// each, silently dropping the rest. This computes everything an approval
// must write — so the admin can see the exact count before confirming, and so
// it can be committed in one atomic batch — with no Firestore or DOM here.
//
// Matching follows the library's own grouping keys (makeKey / modelKey /
// trimKey), so a submission for "Chevy" joins the existing "Chevrolet"
// subject instead of creating a second one.
// ─────────────────────────────────────────────

import type { Pattern, PatternZone, ProjectType, UserPattern, VehicleEntry } from "$lib/types";
import { makeKey, modelKey, slug, trimKey } from "./vehicleCatalog";
import { expandYears } from "./libraryRows";

/** A Firestore batch allows 500 operations; stay well under. */
export const MAX_BATCH_WRITES = 450;

export interface PublishInput {
	/** The submission with the reviewer's edits (name, size, notes) already applied. */
	sub: UserPattern;
	vehicles: VehicleEntry[];
	patterns: Pattern[];
	/** The opposite-side zone of a left/right pair, if the zone has one. */
	mirrorOf: (zone: PatternZone) => PatternZone | undefined;
	newId: (prefix: string) => string;
	now?: Date;
}

export interface PublishTarget {
	/** The subject the patterns attach to — existing, or one we'll create. */
	subject: VehicleEntry;
	isNew: boolean;
	/** An existing subject that isn't published: customers won't see the pattern until it is. */
	hidden: boolean;
}

export interface PublishPlan {
	targets: PublishTarget[];
	/** New catalog patterns, one per subject × zone. */
	patterns: Pattern[];
	/** Zones left out because they are the other half of a left/right pair already published. */
	pairedZones: PatternZone[];
	/** Pattern/subject combinations already published from this submission. */
	alreadyPublished: number;
	/**
	 * Catalog patterns published from this submission before the link existed
	 * (same outline, same zone). They aren't duplicated; they're linked to the
	 * submission so it can be revoked and re-published like any other.
	 */
	adopt: string[];
	warnings: string[];
	/** Firestore operations the commit needs, including the submitter's copy. */
	writes: number;
	/** Set when the plan can't be committed. */
	error?: string;
}

const clean = (list: string[] | undefined) =>
	[...new Set((list ?? []).map((s) => (s ?? "").trim()).filter(Boolean))];

const day = (d: Date) => d.toISOString().split("T")[0];

export function planPublish(input: PublishInput): PublishPlan {
	const { sub, vehicles, patterns, mirrorOf, newId } = input;
	const now = input.now ?? new Date();
	const type: ProjectType = sub.projectType ?? "vehicle";
	const plan: PublishPlan = { targets: [], patterns: [], pairedZones: [], alreadyPublished: 0, adopt: [], warnings: [], writes: 0 };
	const fail = (error: string) => ({ ...plan, error });

	// ── Zones: one pattern each, except the second half of a left/right pair ──
	// (customers get both sides from "Add both sides", which mirrors the one outline.)
	const zones = sub.zones.map((zone, i) => ({ zone, i }));
	if (!zones.length) return fail("This submission has no zone, so there is nothing to publish it as.");
	const keep = zones.filter(({ zone, i }) => {
		const m = mirrorOf(zone);
		const partnerAt = m ? sub.zones.indexOf(m) : -1;
		if (partnerAt >= 0 && partnerAt < i) {
			plan.pairedZones.push(zone);
			return false;
		}
		return true;
	});

	// ── Subjects ──
	const keyOf = (p: Pattern) => `${p.vehicleId}|${p.zone}|${p.customZoneLabel ?? ""}`;
	const existingBySource = new Set(patterns.filter((p) => p.sourcePatternId === sub.id).map(keyOf));
	// Older approvals carry no link: the same outline in the same subject and zone is the same publish.
	const legacyByKey = new Map(patterns.filter((p) => !p.sourcePatternId && p.svgPath === sub.svgPath).map((p) => [keyOf(p), p]));

	if (type === "vehicle") {
		const make = sub.make.trim();
		const models = clean(sub.models);
		if (!make) return fail("This submission has no make.");
		if (!models.length) return fail("This submission has no model.");
		const trims = clean(sub.trims);
		let years = expandYears(sub.years);
		if (!years.length) {
			years = [now.getFullYear()];
			plan.warnings.push(`No usable year was given, so it will be published under ${years[0]}.`);
		}

		// Canonical spelling: reuse whatever the catalog already calls this make / model.
		const sameMake = vehicles.find((v) => (v.projectType ?? "vehicle") === "vehicle" && makeKey(v.make) === makeKey(make));
		const makeName = sameMake?.make ?? make;
		for (const model of models) {
			const sameModel = vehicles.find(
				(v) => (v.projectType ?? "vehicle") === "vehicle" && makeKey(v.make) === makeKey(make) && modelKey(v.model) === modelKey(model),
			);
			const modelName = sameModel?.model ?? model;
			for (const trim of trims.length ? trims : [""]) {
				for (const year of years) {
					const existing = vehicles.find(
						(v) => (v.projectType ?? "vehicle") === "vehicle" && makeKey(v.make) === makeKey(make) &&
							modelKey(v.model) === modelKey(model) && trimKey(v.trim) === trimKey(trim) && v.year === year,
					);
					plan.targets.push(
						existing
							? { subject: existing, isNew: false, hidden: existing.status !== "published" }
							: {
									subject: {
										id: newId("v_"), projectType: "vehicle", make: makeName, model: modelName,
										trim: trim || undefined, year, bodyStyle: sub.bodyStyle,
										status: "published", tags: [], updatedAt: day(now),
										contributedBy: sub.ownerId || undefined,
									},
									isNew: true, hidden: false,
								},
					);
				}
			}
		}
	} else {
		const label = (sub.propertyLabel || sub.patternName || sub.name || "").trim();
		if (!label) return fail("This submission has no property or project name.");
		const existing = vehicles.find((v) => (v.projectType ?? "vehicle") === type && slug(v.propertyLabel) === slug(label));
		plan.targets.push(
			existing
				? { subject: existing, isNew: false, hidden: existing.status !== "published" }
				: {
						subject: {
							id: newId("v_"), projectType: type, propertyLabel: label, address: sub.address || undefined,
							status: "published", tags: [], updatedAt: day(now), contributedBy: sub.ownerId || undefined,
						},
						isNew: true, hidden: false,
					},
		);
	}

	// ── Patterns: subject × zone ──
	for (const t of plan.targets) {
		for (const { zone, i } of keep) {
			const customZoneLabel = zone === "custom" ? sub.customZoneLabels?.[i] || undefined : undefined;
			const key = `${t.subject.id}|${zone}|${customZoneLabel ?? ""}`;
			if (existingBySource.has(key)) {
				plan.alreadyPublished++;
				continue;
			}
			const legacy = legacyByKey.get(key);
			if (legacy) {
				plan.alreadyPublished++;
				plan.adopt.push(legacy.id);
				continue;
			}
			plan.patterns.push({
				id: newId("pat_"),
				vehicleId: t.subject.id,
				projectType: type,
				category: sub.category,
				zone,
				customZoneLabel,
				name: sub.name,
				coverage: sub.coverage,
				svgPath: sub.svgPath,
				widthInches: sub.widthInches,
				heightInches: sub.heightInches,
				revision: now.toISOString().slice(0, 7),
				notes: sub.notes || undefined,
				isPublished: true,
				sourcePatternId: sub.id,
				createdAt: now,
				updatedAt: now,
			});
		}
	}

	// ── Writes: new subjects, touched existing subjects, patterns, the submitter's copy ──
	const touched = new Set(plan.patterns.filter((p) => plan.targets.some((t) => !t.isNew && t.subject.id === p.vehicleId)).map((p) => p.vehicleId));
	plan.writes = plan.targets.filter((t) => t.isNew).length + touched.size + plan.patterns.length + plan.adopt.length + 1;
	if (plan.writes > MAX_BATCH_WRITES) {
		return fail(`This would write ${plan.writes} documents (${plan.targets.length} subjects × ${keep.length} zones). Trim the models, years or trims on the submission first — the limit is ${MAX_BATCH_WRITES}.`);
	}
	if (!plan.patterns.length && !plan.alreadyPublished) return fail("Nothing to publish.");
	return plan;
}

// ─── Links between submissions and catalog patterns ───

/**
 * The catalog patterns published from a submission. Approvals since the
 * `sourcePatternId` link carry it; older ones are recognised by the subject
 * the submission was linked to plus an identical outline.
 */
export function linkedPatterns(sub: Pick<UserPattern, "id" | "vehicleId" | "svgPath">, patterns: Pattern[]): Pattern[] {
	const bySource = patterns.filter((p) => p.sourcePatternId === sub.id);
	if (bySource.length) return bySource;
	if (!sub.vehicleId) return [];
	return patterns.filter((p) => !p.sourcePatternId && p.vehicleId === sub.vehicleId && p.svgPath === sub.svgPath);
}

/** What a submitter's copy goes back to when its community version is removed. */
export const RESET_TO_PRIVATE = { isPublished: false, status: "private", submitToCommunity: false } as const;

/** Revoking a submission: delete its catalog patterns, return the owner's copy to private. */
export function planRevoke(sub: Pick<UserPattern, "id" | "vehicleId" | "svgPath">, patterns: Pattern[]) {
	const linked = linkedPatterns(sub, patterns);
	return { deleteIds: linked.map((p) => p.id), subjectIds: [...new Set(linked.map((p) => p.vehicleId))], patch: RESET_TO_PRIVATE };
}

/**
 * Submissions whose community copy disappears because `deleted` is being
 * removed, and which have nothing left in `remaining`. Their owners' copies
 * must go back to private, or they'd stay locked as "approved" forever.
 */
export function ownersToReset<T extends Pick<UserPattern, "id" | "vehicleId" | "svgPath" | "isPublished">>(
	deleted: Pattern[],
	remaining: Pattern[],
	subs: T[],
): T[] {
	const gone = new Set(deleted.map((p) => p.id));
	const left = new Set(remaining.map((p) => p.id));
	return subs.filter((s) => {
		if (!s.isPublished) return false;
		const linked = linkedPatterns(s, [...deleted, ...remaining]);
		return linked.some((p) => gone.has(p.id)) && !linked.some((p) => left.has(p.id));
	});
}
