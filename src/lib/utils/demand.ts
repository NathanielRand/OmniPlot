// ─────────────────────────────────────────────
// Demand: what customers are waiting for, counted once.
//
// A request ("I want a GR86 pattern") and a vote on a coming-soon subject are the
// same thing, so both land on ONE record per make/model — `demand/{demandId}` —
// no matter how the user typed it. Years live inside that record, so a model's
// total and each year's figure come from one place and a person who wants
// several years still counts once for the model. Pure functions: shared by the
// server routes, the library and admin so a number can't disagree between them.
// ─────────────────────────────────────────────

import type { ProjectType } from "$lib/types";
import { makeKey, slug } from "$lib/utils/vehicleCatalog";

/** Model grouping key for demand: "GR86", "GR-86" and "Toyota GR 86" are one model. */
export function demandModelKey(make: string | undefined | null, model: string | undefined | null): string {
	let words = slug(model).split("-").filter(Boolean);
	const makeWords = slug(make).split("-").filter(Boolean);
	// "Toyota GR86" typed into the model box under make Toyota.
	if (makeWords.length && words.length > makeWords.length && makeWords.every((w, i) => words[i] === w)) {
		words = words.slice(makeWords.length);
	}
	return words.join("");
}

export interface DemandTarget {
	projectType?: ProjectType;
	/** Vehicle make. Ignored for other types. */
	make?: string;
	/** Vehicle model, or the property / project label for other types. */
	model?: string;
}

/** Firestore doc id for a demand record — always built from keys, never from typed text. */
export function demandId(t: DemandTarget): string {
	const type = t.projectType ?? "vehicle";
	const id = type === "vehicle"
		? `vehicle__${makeKey(t.make)}__${demandModelKey(t.make, t.model)}`
		: `${type}__${slug(t.model)}`;
	return id.slice(0, 150);
}

export const demandValid = (t: DemandTarget): boolean =>
	(t.projectType ?? "vehicle") === "vehicle"
		? !!makeKey(t.make) && !!demandModelKey(t.make, t.model)
		: !!slug(t.model);

/** One person's stake in a record: any year, or specific years. */
export interface MyVote { any: boolean; years: number[] }

/** The shape of a demand record as the app reads it. */
export interface DemandFigures {
	/** Distinct people (plus pre-merge anonymous votes) — the headline number. */
	votes: number;
	anyVotes: number;
	yearVotes: Record<string, number>;
}

/** People who want this exact year: those who named it, plus anyone happy with any year. */
export const votesForYear = (d: DemandFigures | undefined, year: number | undefined): number =>
	!d ? 0 : year ? (d.yearVotes?.[String(year)] ?? 0) + (d.anyVotes ?? 0) : d.votes;

/** Has this person already voted for this record (and year)? */
export function hasVoted(mine: MyVote | undefined, year?: number): boolean {
	if (!mine) return false;
	return year ? mine.any || mine.years.includes(year) : mine.any || mine.years.length > 0;
}

/** Apply a vote / un-vote to someone's stake; null = nothing left. */
export function nextVote(mine: MyVote | undefined, year: number | undefined, on: boolean): MyVote | null {
	const cur: MyVote = mine ? { any: mine.any, years: [...mine.years] } : { any: false, years: [] };
	if (on) {
		if (!year) { cur.any = true; cur.years = []; }
		else if (!cur.any && !cur.years.includes(year)) cur.years.push(year);
	} else if (!year || cur.any) return null; // withdrawing from an "any year" vote withdraws it entirely
	else cur.years = cur.years.filter((y) => y !== year);
	cur.years.sort((a, b) => a - b);
	return cur.any || cur.years.length ? cur : null;
}

/** Display title for a record. */
export function demandTitle(t: DemandTarget): string {
	return (t.projectType ?? "vehicle") === "vehicle" ? [t.make, t.model].filter(Boolean).join(" ") : (t.model ?? "");
}
