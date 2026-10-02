// Bulk "Add vehicles": one make, several models, a span of years, optional trims
// → the subjects to create, skipping any that already exist. Pure; the caller
// writes the result in one atomic batch. Existing subjects are matched by the
// same keys the library groups by (and the demand records use), so "GR-86" is
// never added next to "GR86", and an existing spelling of the make/model wins.

import type { VehicleEntry } from "$lib/types";
import { makeKey, trimKey } from "$lib/utils/vehicleCatalog";
import { demandModelKey } from "$lib/utils/demand";

export const MAX_BULK_SUBJECTS = 400; // one atomic batch (see MAX_COMMIT_OPS)
export const MIN_YEAR = 1950;

export interface VehiclePlanInput {
	make: string;
	/** Comma / newline separated. */
	models: string;
	yearFrom: number;
	yearTo: number;
	/** Comma / newline separated. Empty = the base (all-trims) subject only. */
	trims: string;
	bodyStyle: NonNullable<VehicleEntry["bodyStyle"]>;
	status: VehicleEntry["status"];
	tags: string[];
	popular: boolean;
}

export const splitList = (s: string) =>
	[...new Map(s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean).map((x) => [x.toLowerCase(), x])).values()];

export interface VehiclePlan {
	create: VehicleEntry[];
	/** Already in the catalog. */
	skipped: number;
	error?: string;
}

export function planVehicles(input: VehiclePlanInput, existing: VehicleEntry[], newId: (prefix: string) => string, today: string): VehiclePlan {
	const none = { create: [], skipped: 0 };
	const make = input.make.trim();
	const models = splitList(input.models);
	const trims = splitList(input.trims);
	const from = Math.floor(Number(input.yearFrom)), to = Math.floor(Number(input.yearTo));
	if (!make) return { ...none, error: "Enter the make." };
	if (!models.length) return { ...none, error: "Enter at least one model." };
	const maxYear = new Date().getFullYear() + 3;
	if (!from || !to || from < MIN_YEAR || to > maxYear) return { ...none, error: `Years must be between ${MIN_YEAR} and ${maxYear}.` };
	if (to < from) return { ...none, error: "The last year is before the first year." };

	const vehicles = existing.filter((v) => (v.projectType ?? "vehicle") === "vehicle" && v.make && v.model);
	const sameMake = vehicles.filter((v) => makeKey(v.make) === makeKey(make));
	const makeName = sameMake[0]?.make ?? make;
	const years = Array.from({ length: to - from + 1 }, (_, i) => to - i);
	const trimList = trims.length ? trims : [""];

	const have = new Set(sameMake.map((v) => `${demandModelKey(v.make, v.model)}|${v.year}|${trimKey(v.trim)}`));
	const create: VehicleEntry[] = [];
	let skipped = 0;
	for (const m of models) {
		const mk = demandModelKey(make, m);
		if (!mk) continue;
		const modelName = sameMake.find((v) => demandModelKey(v.make, v.model) === mk)?.model ?? m;
		for (const year of years) {
			for (const trim of trimList) {
				const key = `${mk}|${year}|${trimKey(trim)}`;
				if (have.has(key)) { skipped++; continue; }
				have.add(key); // the same model typed twice creates once
				create.push({
					id: newId("v_"), projectType: "vehicle", make: makeName, model: modelName, year,
					...(trim ? { trim } : {}), bodyStyle: input.bodyStyle, tags: input.tags, popular: input.popular,
					status: input.status, updatedAt: today,
				});
			}
		}
	}
	if (create.length > MAX_BULK_SUBJECTS) return { create: [], skipped, error: `That's ${create.length} subjects — add up to ${MAX_BULK_SUBJECTS} at a time (fewer models or years).` };
	return { create, skipped };
}
