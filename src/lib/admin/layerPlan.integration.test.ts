import { describe, it, expect } from "vitest";
import type { Pattern, UserPattern, VehicleEntry, VehicleMedia } from "$lib/types";
import { planPublish } from "$lib/utils/publishPlan";
import { planLayerEdit, planLayerDelete, planSubmissionRename, planEntryMove } from "./layerPlan";

// These run the REAL repair planner (planPublish) against a catalog after a layer
// change, to prove the change doesn't leave the Repair flow wanting to rebuild
// what was just renamed or deleted.

const veh = (id: string, make: string, model: string, year: number, trim?: string): VehicleEntry => ({
	id, make, model, year, trim, projectType: "vehicle", tags: [], status: "published", updatedAt: "",
});
const pattern = (id: string, vehicleId: string, sourcePatternId: string): Pattern => ({
	id, vehicleId, sourcePatternId, category: "ppf", zone: "hood", name: "Hood", coverage: "full",
	svgPath: "M0 0 L10 0 L10 10 Z", widthInches: 10, heightInches: 10, isPublished: true,
} as unknown as Pattern);
const sub = (over: Partial<UserPattern> = {}): UserPattern => ({
	id: "sub1", ownerId: "u1", name: "Hood", isPublished: true, status: "approved",
	make: "Toyota", models: ["Camry"], trims: [], years: ["2020-2021"], bodyStyle: "sedan",
	category: "ppf", zones: ["hood"], coverage: "full", svgPath: "M0 0 L10 0 L10 10 Z", widthInches: 10, heightInches: 10,
	vehicleId: "1", ...over,
} as unknown as UserPattern);

const vehicles = [veh("1", "Toyota", "Camry", 2020), veh("2", "Toyota", "Camry", 2021)];
const patterns = [pattern("p1", "1", "sub1"), pattern("p2", "2", "sub1")];
const repairWants = (s: UserPattern, vs: VehicleEntry[], ps: Pattern[]) =>
	planPublish({ sub: s, vehicles: vs, patterns: ps, mirrorOf: () => undefined, newId: (p) => `${p}x` }).patterns.length;

describe("rename and the Repair flow", () => {
	const apply = (vs: VehicleEntry[], patches: { id: string; patch: Partial<VehicleEntry> }[]) =>
		vs.map((v) => ({ ...v, ...(patches.find((p) => p.id === v.id)?.patch ?? {}) }));

	it("starts out complete", () => {
		expect(repairWants(sub(), vehicles, patterns)).toBe(0);
	});

	it("would be offered a rebuild if only the catalog were renamed (the bug this guards)", () => {
		const plan = planLayerEdit({ ref: { level: "make", make: "Toyota" }, name: "Lexus", vehicles, media: {} });
		expect(repairWants(sub(), apply(vehicles, plan.patches), patterns)).toBeGreaterThan(0);
	});

	it("is not once the published submissions are renamed with it", () => {
		const ref = { level: "make", make: "Toyota" } as const;
		const plan = planLayerEdit({ ref, name: "Lexus", vehicles, media: {} });
		const subPatches = planSubmissionRename({ ref, name: "Lexus", scopePatterns: patterns, submissions: [sub()] });
		expect(subPatches).toEqual([{ id: "sub1", patch: { make: "Lexus" } }]);
		const renamed = { ...sub(), ...subPatches[0].patch } as UserPattern;
		expect(repairWants(renamed, apply(vehicles, plan.patches), patterns)).toBe(0);
	});

	it("handles a model rename that keeps the submission's other models", () => {
		const vs = [...vehicles, veh("3", "Toyota", "Corolla", 2020)];
		const ps = [...patterns, pattern("p3", "3", "sub1")];
		const s = sub({ models: ["Camry", "Corolla"], years: ["2020-2021"] });
		const ref = { level: "model", make: "Toyota", model: "Camry" } as const;
		const plan = planLayerEdit({ ref, name: "Camry Hybrid", vehicles: vs, media: {} });
		const [sp] = planSubmissionRename({ ref, name: "Camry Hybrid", scopePatterns: ps.filter((p) => p.vehicleId !== "3"), submissions: [s] });
		expect(sp.patch.models).toEqual(["Camry Hybrid", "Corolla"]);
		// Corolla 2021 never existed in this fixture; only the renamed model should be settled.
		const after = repairWants({ ...s, ...sp.patch, models: ["Camry Hybrid"] } as UserPattern, apply(vs, plan.patches), ps);
		expect(after).toBe(0);
	});

	it("renames a trim inside a submission", () => {
		const vs = [veh("1", "Toyota", "Camry", 2020, "SE"), veh("2", "Toyota", "Camry", 2021, "SE")];
		const s = sub({ trims: ["SE"] });
		const ref = { level: "trim", make: "Toyota", model: "Camry", trim: "SE" } as const;
		const plan = planLayerEdit({ ref, name: "Sport", vehicles: vs, media: {} });
		const [sp] = planSubmissionRename({ ref, name: "Sport", scopePatterns: patterns, submissions: [s] });
		expect(repairWants(s, apply(vs, plan.patches), patterns)).toBeGreaterThan(0);
		expect(repairWants({ ...s, ...sp.patch } as UserPattern, apply(vs, plan.patches), patterns)).toBe(0);
	});

	it("leaves unrelated submissions alone", () => {
		const other = sub({ id: "other", make: "Ford", models: ["F-150"], vehicleId: "9" });
		expect(planSubmissionRename({ ref: { level: "make", make: "Toyota" }, name: "Lexus", scopePatterns: patterns, submissions: [other] })).toEqual([]);
	});
});

describe("retrying a half-finished change", () => {
	const doc = (id: string, over: Partial<VehicleMedia> = {}): VehicleMedia => ({ id, kind: "model", make: "Toyota", model: "Camry", ...over });

	it("finishes a rename whose new media docs were already written", () => {
		// Media was copied to the new ids, one entry was renamed, then the run stopped.
		const vs = [veh("1", "Lexus", "Camry", 2020), veh("2", "Toyota", "Camry", 2021)];
		const gens = [{ label: "Gen 1", from: 2020, to: 2021 }];
		const media = {
			toyota__camry: doc("toyota__camry", { imageUrl: "c.jpg", generations: gens }),
			lexus__camry: doc("lexus__camry", { make: "Lexus", imageUrl: "c.jpg", generations: gens }),
		};
		const p = planLayerEdit({ ref: { level: "make", make: "Toyota" }, name: "Lexus", vehicles: vs, media });
		expect(p.error).toBeUndefined();
		expect(p.patches.map((x) => x.id)).toEqual(["2"]);
		expect(p.removeMedia).toContain("toyota__camry");
		expect(p.removeMedia).not.toContain("lexus__camry");
	});

	it("still refuses a genuinely different record at the new name", () => {
		const media = {
			toyota__camry: doc("toyota__camry", { imageUrl: "c.jpg" }),
			lexus__camry: doc("lexus__camry", { make: "Lexus", imageUrl: "someone-elses.jpg" }),
		};
		const p = planLayerEdit({ ref: { level: "make", make: "Toyota" }, name: "Lexus", vehicles, media });
		expect(p.error).toMatch(/already/);
	});

	it("resets a published copy whose patterns an earlier, interrupted delete already removed", () => {
		// Entry 1's patterns are gone from the catalog; entry 2 is still there.
		const left = [pattern("p2", "2", "sub1")];
		const gone = planLayerDelete({
			ref: { level: "model", make: "Toyota", model: "Camry" }, vehicles, media: {},
			patternsOf: (id) => left.filter((p) => p.vehicleId === id), allPatterns: left, submissions: [sub()],
		});
		expect(gone.resets.map((r) => r.id)).toEqual(["sub1"]);
		// And one whose patterns are ALL gone, with the subject still in scope:
		const orphan = planLayerDelete({
			ref: { level: "model", make: "Toyota", model: "Camry" }, vehicles, media: {},
			patternsOf: () => [], allPatterns: [], submissions: [sub()],
		});
		expect(orphan.resets.map((r) => r.id)).toEqual(["sub1"]);
	});

	it("does not reset a submission that still has live patterns elsewhere", () => {
		const elsewhere = [pattern("p9", "9", "sub1")];
		const d = planLayerDelete({
			ref: { level: "model", make: "Toyota", model: "Camry" }, vehicles, media: {},
			patternsOf: (id) => patterns.filter((p) => p.vehicleId === id), allPatterns: [...patterns, ...elsewhere], submissions: [sub()],
		});
		expect(d.resets).toEqual([]);
	});
});

describe("delete and the Repair flow", () => {
	it("returns the submitter's copy to private so repair has nothing to rebuild", () => {
		const d = planLayerDelete({
			ref: { level: "make", make: "Toyota" }, vehicles, media: {},
			patternsOf: (id) => patterns.filter((p) => p.vehicleId === id), allPatterns: patterns, submissions: [sub()],
		});
		expect(d.resets.map((r) => r.id)).toEqual(["sub1"]);
		expect(d.patterns).toHaveLength(2);
	});
});

describe("planEntryMove", () => {
	it("moves one entry's year image when its identity changes", () => {
		const media = { "toyota__camry__~y-2020": { id: "toyota__camry__~y-2020", kind: "year", make: "Toyota", model: "Camry", year: 2020, imageUrl: "y.jpg" } as VehicleMedia };
		const m = planEntryMove(vehicles[0], { ...vehicles[0], trim: "SE" }, media);
		expect(m.moves[0].to).toBe("toyota__camry__se__~y-2020");
		expect(m.moves[0].doc.trim).toBe("SE");
		expect(m.removeMedia).toEqual(["toyota__camry__~y-2020"]);
		expect(planEntryMove(vehicles[0], { ...vehicles[0], status: "draft" }, media).moves).toEqual([]);
	});
});
