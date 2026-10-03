import { describe, it, expect } from "vitest";
import type { Pattern, VehicleEntry, VehicleMedia } from "$lib/types";
import { planLayerEdit, planLayerDelete, planEntriesDelete, planGenerationChange, scopeOf, entryMediaIds } from "./layerPlan";

const v = (id: string, make: string, model: string, year: number, trim?: string, status: VehicleEntry["status"] = "published"): VehicleEntry => ({
	id, make, model, year, trim, projectType: "vehicle", tags: [], status, updatedAt: "",
});
const doc = (id: string, over: Partial<VehicleMedia>): VehicleMedia => ({ id, kind: "model", make: "Toyota", ...over });

const vehicles = [
	v("1", "Toyota", "Camry", 2020), v("2", "Toyota", "Camry", 2021),
	v("3", "Toyota", "Camry", 2020, "SE"), v("4", "Toyota", "Camry", 2021, "SE"),
	v("5", "Toyota", "GR86", 2024), v("6", "Toyota", "GR-86", 2023),
	v("7", "Ford", "F-150", 2022),
];
const media: Record<string, VehicleMedia> = Object.fromEntries([
	doc("toyota", { kind: "make", logoUrl: "logo.png", logoPath: "vehicle-media/toyota/logo-1.png" }),
	doc("toyota__camry", { model: "Camry", imageUrl: "camry.jpg", generations: [{ label: "Gen 1", from: 2020, to: 2021 }] }),
	doc("toyota__camry__se", { kind: "trim", model: "Camry", trim: "SE", generations: [{ label: "Mk1", from: 2020, to: 2021 }] }),
	doc("toyota__camry__se__~g-mk1", { kind: "generation", model: "Camry", trim: "SE", generation: "Mk1", imageUrl: "mk1.jpg", imagePath: "vehicle-media/x/mk1.jpg" }),
	doc("toyota__camry__~g-gen-1", { kind: "generation", model: "Camry", generation: "Gen 1", imageUrl: "g1.jpg" }),
	doc("toyota__gr86", { model: "GR86", imageUrl: "gr86.jpg" }),
	doc("ford", { kind: "make", make: "Ford", logoUrl: "ford.png" }),
].map((d) => [d.id, d]));

describe("scopeOf", () => {
	it("merges spelling variants of a model", () => {
		expect(scopeOf({ level: "model", make: "Toyota", model: "GR86" }, vehicles).map((x) => x.id).sort()).toEqual(["5", "6"]);
	});
	it("separates trims, and the base is the no-trim entries", () => {
		expect(scopeOf({ level: "trim", make: "Toyota", model: "Camry", trim: "SE" }, vehicles).map((x) => x.id)).toEqual(["3", "4"]);
		expect(scopeOf({ level: "trim", make: "Toyota", model: "Camry", trim: "" }, vehicles).map((x) => x.id)).toEqual(["1", "2"]);
	});
});

describe("planLayerEdit", () => {
	it("renames a make and moves its logo with it", () => {
		const p = planLayerEdit({ ref: { level: "make", make: "Toyota" }, name: "Lexus", vehicles, media });
		expect(p.error).toBeUndefined();
		expect(p.patches).toHaveLength(6);
		expect(p.patches[0].patch).toEqual({ make: "Lexus" });
		const to = p.moves.map((m) => m.to).sort();
		expect(to).toContain("lexus");
		expect(to).toContain("lexus__camry__se__~g-mk1");
		expect(p.moves.find((m) => m.to === "lexus__camry")?.doc.make).toBe("Lexus");
		expect(p.removeMedia).toContain("toyota__camry__se__~g-mk1");
		expect(p.removeMedia).not.toContain("ford");
	});
	it("renames a trim and moves its generations and generation images", () => {
		const p = planLayerEdit({ ref: { level: "trim", make: "Toyota", model: "Camry", trim: "SE" }, name: "Sport", vehicles, media });
		expect(p.moves.map((m) => m.to).sort()).toEqual(["toyota__camry__sport", "toyota__camry__sport__~g-mk1"]);
		expect(p.moves.find((m) => m.to === "toyota__camry__sport")?.doc.trim).toBe("Sport");
		expect(p.moves.find((m) => m.to === "toyota__camry__sport")?.doc.generations).toHaveLength(1);
		// the model's own image and the base generations stay put
		expect(p.removeMedia.sort()).toEqual(["toyota__camry__se", "toyota__camry__se__~g-mk1"]);
	});
	it("leaves media ids alone for a case-only rename", () => {
		const p = planLayerEdit({ ref: { level: "model", make: "Toyota", model: "Camry" }, name: "CAMRY", vehicles, media });
		expect(p.patches).toHaveLength(4);
		expect(p.removeMedia).toEqual([]);
		expect(p.moves.every((m) => m.from === m.to && m.doc.model === "CAMRY")).toBe(true);
	});
	it("refuses a rename that would duplicate an entry", () => {
		const p = planLayerEdit({ ref: { level: "model", make: "Toyota", model: "Camry" }, name: "GR86", vehicles: [...vehicles, v("9", "Toyota", "GR86", 2020)], media });
		expect(p.error).toMatch(/two entries/);
	});
	it("refuses to overwrite existing images or generations", () => {
		const p = planLayerEdit({ ref: { level: "model", make: "Toyota", model: "Camry" }, name: "GR86", vehicles, media });
		expect(p.error).toMatch(/already/);
	});
	it("cannot rename the base entries", () => {
		const p = planLayerEdit({ ref: { level: "trim", make: "Toyota", model: "Camry", trim: "" }, name: "Base", vehicles, media });
		expect(p.error).toMatch(/base/);
	});
	it("applies status and body style without touching media", () => {
		const p = planLayerEdit({ ref: { level: "model", make: "Toyota", model: "Camry" }, status: "draft", bodyStyle: "sedan", vehicles, media });
		expect(p.patches).toHaveLength(4);
		expect(p.patches[0].patch).toEqual({ status: "draft", bodyStyle: "sedan" });
		expect(p.moves).toEqual([]);
	});
});

describe("planLayerDelete", () => {
	const pat = (id: string, vehicleId: string): Pattern => ({ id, vehicleId, svgPath: `M${id}`, isPublished: true } as unknown as Pattern);
	const pats: Record<string, Pattern[]> = { "3": [pat("p1", "3")], "4": [pat("p2", "4")], "5": [pat("p3", "5")] };
	const input = (ref: Parameters<typeof planLayerDelete>[0]["ref"]) => ({
		ref, vehicles, media, patternsOf: (id: string) => pats[id] ?? [], allPatterns: Object.values(pats).flat(), submissions: [],
	});
	it("deletes a trim with its patterns, generations and images", () => {
		const d = planLayerDelete(input({ level: "trim", make: "Toyota", model: "Camry", trim: "SE" }));
		expect(d.subjects.map((x) => x.id)).toEqual(["3", "4"]);
		expect(d.groups).toEqual([{ subjectId: "3", patternIds: ["p1"] }, { subjectId: "4", patternIds: ["p2"] }]);
		expect(d.removeMedia.sort()).toEqual(["toyota__camry__se", "toyota__camry__se__~g-mk1"]);
		expect(d.storagePaths).toEqual(["vehicle-media/x/mk1.jpg"]);
	});
	it("deleting the base keeps the model image and every trim, but drops its generations", () => {
		const d = planLayerDelete(input({ level: "trim", make: "Toyota", model: "Camry", trim: "" }));
		expect(d.subjects.map((x) => x.id)).toEqual(["1", "2"]);
		expect(d.removeMedia).toEqual(["toyota__camry__~g-gen-1"]);
		expect(d.clearGenerations).toEqual(["toyota__camry"]);
	});
	it("deleting a model removes everything under it, both spellings", () => {
		const d = planLayerDelete(input({ level: "model", make: "Toyota", model: "GR86" }));
		expect(d.subjects.map((x) => x.id).sort()).toEqual(["5", "6"]);
		expect(d.removeMedia).toEqual(["toyota__gr86"]);
	});
	it("deleting a make leaves other makes alone", () => {
		const d = planLayerDelete(input({ level: "make", make: "Toyota" }));
		expect(d.subjects).toHaveLength(6);
		expect(d.removeMedia).not.toContain("ford");
		expect(d.removeMedia).toContain("toyota");
	});
});

describe("planGenerationChange", () => {
	const base = { make: "Toyota", model: "Camry", trim: "SE", media };
	const prev = [{ label: "Mk1", from: 2020, to: 2021 }];
	it("moves an image with a rename", () => {
		const c = planGenerationChange({ ...base, previous: prev, next: [{ label: "Series 1", from: 2020, to: 2021, orig: "Mk1" }] });
		expect(c.renamed).toEqual([["Mk1", "Series 1"]]);
		expect(c.moves[0].to).toBe("toyota__camry__se__~g-series-1");
		expect(c.removeMedia).toEqual(["toyota__camry__se__~g-mk1"]);
	});
	it("removes the image of a deleted generation", () => {
		const c = planGenerationChange({ ...base, previous: prev, next: [] });
		expect(c.removed).toEqual(["Mk1"]);
		expect(c.removeMedia).toEqual(["toyota__camry__se__~g-mk1"]);
		expect(c.storagePaths).toEqual(["vehicle-media/x/mk1.jpg"]);
	});
	it("leaves an unchanged name alone, so a range edit keeps its image", () => {
		const c = planGenerationChange({ ...base, previous: prev, next: [{ label: "Mk1", from: 2019, to: 2022, orig: "Mk1" }] });
		expect(c.moves).toEqual([]);
		expect(c.removeMedia).toEqual([]);
	});
});

describe("entryMediaIds", () => {
	it("finds an entry's own year image", () => {
		const m = { "toyota__camry__se__~y-2021": doc("toyota__camry__se__~y-2021", { kind: "year" }) };
		expect(entryMediaIds(vehicles[3], m)).toEqual(["toyota__camry__se__~y-2021"]);
		expect(entryMediaIds(vehicles[1], m)).toEqual([]);
	});
});

describe("planEntriesDelete", () => {
	it("removes only the chosen years, their patterns and their own year images", () => {
		const m = {
			...media,
			"toyota__camry__~y-2020": doc("toyota__camry__~y-2020", { kind: "year", imageUrl: "y.jpg", imagePath: "vehicle-media/y/y.jpg" }),
		};
		const pats = [{ id: "pa", vehicleId: "1", svgPath: "M", isPublished: true }] as unknown as Pattern[];
		const d = planEntriesDelete({
			subjects: [vehicles[0]], vehicles, media: m,
			patternsOf: (id) => pats.filter((p) => p.vehicleId === id), allPatterns: pats, submissions: [],
		});
		expect(d.subjects.map((x) => x.id)).toEqual(["1"]);
		expect(d.groups).toEqual([{ subjectId: "1", patternIds: ["pa"] }]);
		expect(d.removeMedia).toEqual(["toyota__camry__~y-2020"]);
		expect(d.storagePaths).toEqual(["vehicle-media/y/y.jpg"]);
		expect(d.clearGenerations).toEqual([]);
	});
});
