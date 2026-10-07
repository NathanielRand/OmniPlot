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

// ─── Naming ──────────────────────────────────
// The first person to request a model names its record for everyone, so what they
// type is tidied into one house style before it's stored: "toyota" / "TOYOTA" →
// "Toyota", "gr86" → "GR86", "f-150 raptor" → "F-150 Raptor". Spelling that matches
// a catalog name wins over any guess.

const MAKE_DISPLAY: Record<string, string> = {
	chevrolet: "Chevrolet",
	volkswagen: "Volkswagen",
	"mercedes-benz": "Mercedes-Benz",
	"land-rover": "Land Rover",
	"alfa-romeo": "Alfa Romeo",
};
/** Short names that are always capitalised. Tokens with a digit and 1–2 letter tokens are upper-cased anyway. */
const ACRONYMS = new Set(["bmw", "gmc", "byd", "amc", "tvr", "wrx", "sti", "gti", "gtr", "srt", "trd", "suv", "awd", "ltz", "xlt", "slt", "xse"]);

function tidyPart(p: string): string {
	if (!p) return p;
	// Someone who typed their own mixed case ("MacBook", "ProMaster") meant it.
	if (p !== p.toLowerCase() && p !== p.toUpperCase()) return p;
	const letters = p.replace(/[^a-z]/gi, "");
	if (p === p.toUpperCase() && letters.length <= 3) return p; // "RAM", "KIA", "GT"
	if (/\d/.test(p) || letters.length <= 2 || ACRONYMS.has(p.toLowerCase())) return p.toUpperCase();
	return p[0].toUpperCase() + p.slice(1).toLowerCase();
}

/** Spaces collapsed, each word / hyphenated part cased: "  f-150   RAPTOR " → "F-150 Raptor". */
export function tidyName(text: string | undefined | null): string {
	return (text ?? "")
		.replace(/\s+/g, " ")
		.trim()
		.split(" ")
		.map((w) => w.split(/([-/])/).map(tidyPart).join(""))
		.join(" ");
}

export interface KnownNames {
	/** Make labels as the catalog spells them. */
	makes?: string[];
	/** Model labels (of the make being requested) as the catalog spells them. */
	models?: string[];
}

/**
 * The target with its names in house style, ready to store. `known` (catalog
 * spellings) takes priority so a request reads exactly like the library entry it
 * will become. Never changes which record it lands on — `demandId` is unaffected.
 */
export function canonicalTarget<T extends DemandTarget>(t: T, known: KnownNames = {}): T {
	const isVehicle = (t.projectType ?? "vehicle") === "vehicle";
	if (!isVehicle) {
		const s = (t.model ?? "").replace(/\s+/g, " ").trim();
		return { ...t, model: s ? s[0].toUpperCase() + s.slice(1) : s };
	}
	const mk = makeKey(t.make);
	const make = known.makes?.find((m) => makeKey(m) === mk) ?? MAKE_DISPLAY[mk] ?? tidyName(t.make);
	// "Toyota GR86" typed under make Toyota: drop the repeated make before casing.
	const makeWords = slug(t.make).split("-").filter(Boolean);
	let words = (t.model ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
	const lead = words.slice(0, makeWords.length).map((w) => slug(w)).join("-");
	if (makeWords.length && words.length > makeWords.length && lead === makeWords.join("-")) words = words.slice(makeWords.length);
	const typed = words.join(" ");
	const mdl = demandModelKey(t.make, typed);
	const model = known.models?.find((m) => demandModelKey(t.make, m) === mdl) ?? tidyName(typed);
	return { ...t, make, model };
}

/** Display title for a record. */
export function demandTitle(t: DemandTarget): string {
	return (t.projectType ?? "vehicle") === "vehicle" ? [t.make, t.model].filter(Boolean).join(" ") : (t.model ?? "");
}
