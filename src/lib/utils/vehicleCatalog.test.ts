import { describe, it, expect } from "vitest";
import type { VehicleEntry } from "$lib/types";
import {
	buildTree, entriesUnder, makeKey, matchesQuery, mediaId, monogram, yearSpan, BASE_TRIM_LABEL,
	cleanGenerations, generationError, generationOf, groupByGeneration, yearOptions, genSpan, groupYearLabels, vehicleImage, targetId, generationsFor,
} from "./vehicleCatalog";

const v = (id: string, make: string, model: string, year: number, trim?: string): VehicleEntry => ({
	id, make, model, year, trim, tags: [], status: "published", updatedAt: "",
});

describe("matchesQuery", () => {
	const text = "2022 Ford F-150 Raptor truck Hood";
	it("matches words in any order, ignoring punctuation and case", () => {
		for (const q of ["ford raptor", "F150", "f-150 FORD", "2022 hood", "  RAPTOR ", ""]) expect(matchesQuery(text, q), q).toBe(true);
	});
	it("requires every word", () => {
		expect(matchesQuery(text, "ford tundra")).toBe(false);
		expect(matchesQuery(text, "2021")).toBe(false);
	});
	it("understands make nicknames and accents", () => {
		expect(matchesQuery("Chevrolet Silverado", "chevy silverado")).toBe(true);
		expect(matchesQuery("Mercedes-Benz C-Class", "merc c class")).toBe(true);
		expect(matchesQuery("Citroën C3", "citroen")).toBe(true);
	});
});

describe("vehicleCatalog", () => {
	it("groups make aliases and casing together", () => {
		expect(makeKey("Chevy")).toBe(makeKey("Chevrolet "));
		expect(mediaId("Chevy", "Silverado 1500")).toBe("chevrolet__silverado-1500");
		expect(mediaId("Ford", "F-150", "Raptor")).toBe("ford__f-150__raptor");
		expect(mediaId("Ford")).toBe("ford");
	});

	it("builds make → model → trim with pattern counts and base bucket", () => {
		const rows = [
			{ v: v("1", "Ford", "F-150", 2022), count: 3 },
			{ v: v("2", "Ford", "F-150", 2023, "Raptor"), count: 5 },
			{ v: v("3", "Ford", "F-150", 2024, "raptor"), count: 2 },
			{ v: v("4", "Ford", "Mustang", 2020), count: 1 },
			{ v: v("5", "Toyota", "GR86", 2024), count: 4 },
		];
		const tree = buildTree(rows);
		expect(tree.map((m) => m.label)).toEqual(["Ford", "Toyota"]);
		const ford = tree[0];
		expect(ford.count).toBe(11);
		const f150 = ford.models.find((m) => m.label === "F-150")!;
		expect(f150.count).toBe(10);
		expect(f150.years).toEqual([2024, 2023, 2022]);
		expect(f150.trims.map((t) => t.label)).toEqual([BASE_TRIM_LABEL, "Raptor"]);
		expect(f150.trims[1].count).toBe(7);
		expect(ford.models.find((m) => m.label === "Mustang")!.trims).toHaveLength(1);
	});

	it("filters entries by path", () => {
		const rows = [
			{ v: v("1", "Ford", "F-150", 2022) },
			{ v: v("2", "Ford", "F-150", 2023, "Raptor") },
			{ v: v("3", "Ford", "Mustang", 2020) },
		];
		expect(entriesUnder(rows, { make: "ford" })).toHaveLength(3);
		expect(entriesUnder(rows, { make: "ford", model: "f-150" })).toHaveLength(2);
		expect(entriesUnder(rows, { make: "ford", model: "f-150", trim: "" })).toHaveLength(1);
		expect(entriesUnder(rows, { make: "ford", model: "f-150", trim: "raptor" })).toHaveLength(1);
	});

	it("monograms and year spans", () => {
		expect(monogram("BMW")).toBe("BMW");
		expect(monogram("Toyota")).toBe("TO");
		expect(monogram("Land Rover")).toBe("LR");
		expect(yearSpan([2024, 2020])).toBe("2020–2024");
		expect(yearSpan([2021])).toBe("2021");
		expect(yearSpan([])).toBe("");
	});
});

describe("generations", () => {
	const gens = [{ label: "Gen 2", from: 2016, to: 2020 }, { label: "Gen 1", from: 2010, to: 2015 }];
	const rows = [2022, 2020, 2018, 2015, 2011].map((y) => ({ v: v(String(y), "Mazda", "MX-5", y) }));

	it("finds a year's generation by range", () => {
		expect(generationOf(2018, gens)?.label).toBe("Gen 2");
		expect(generationOf(2015, gens)?.label).toBe("Gen 1");
		expect(generationOf(2022, gens)).toBeUndefined();
		expect(generationOf(undefined, gens)).toBeUndefined();
	});

	it("groups rows, newest generation first, leaving uncovered years loose", () => {
		const { groups, loose } = groupByGeneration(rows, gens);
		expect(groups.map((g) => [g.gen.label, g.rows.length])).toEqual([["Gen 2", 2], ["Gen 1", 2]]);
		expect(loose.map((r) => r.v.year)).toEqual([2022]);
	});

	it("builds year filter options: generations first by recency, then loose years", () => {
		const opts = yearOptions(rows, gens);
		expect(opts.map((o) => o.label)).toEqual(["2022", "Gen 2", "Gen 1"]);
		expect(opts.map((o) => o.isGen)).toEqual([false, true, true]);
		expect(yearOptions(rows, []).map((o) => o.label)).toEqual(["2022", "2020", "2018", "2015", "2011"]);
	});

	it("does not offer a generation that has no entries", () => {
		expect(yearOptions([{ v: v("a", "Mazda", "MX-5", 2022) }], gens).map((o) => o.label)).toEqual(["2022"]);
	});

	it("validates ranges and names", () => {
		expect(generationError(gens)).toBeNull();
		expect(generationError([{ label: " ", from: 2010, to: 2012 }])).toMatch(/Name/);
		expect(generationError([{ label: "A", from: 2012, to: 2010 }])).toMatch(/ends before/);
		expect(generationError([{ label: "A", from: 2010, to: 2015 }, { label: "B", from: 2015, to: 2018 }])).toMatch(/share a year/);
		expect(generationError([{ label: "A", from: 2010, to: 2012 }, { label: "a ", from: 2013, to: 2015 }])).toMatch(/Two generations/);
	});

	it("cleans stored data", () => {
		expect(cleanGenerations(undefined)).toEqual([]);
		expect(cleanGenerations([{ label: " X ", from: 2020, to: 2016 }, { label: "", from: 1, to: 2 }, null])).toEqual([{ label: "X", from: 2016, to: 2020 }]);
		expect(genSpan({ from: 2016, to: 2020 })).toBe("2016–2020");
		expect(genSpan({ from: 2016, to: 2016 })).toBe("2016");
	});
});

describe("groupYearLabels", () => {
	const gens = [{ label: "Gen 2", from: 2016, to: 2020 }];
	it("collapses a fully covered generation, keeps the rest single", () => {
		expect(groupYearLabels([2016, 2017, 2018, 2019, 2020, 2022], gens).map((g) => g.label)).toEqual(["2022", "Gen 2"]);
		expect(groupYearLabels([2016, 2017], gens).map((g) => g.label)).toEqual(["2017", "2016"]);
	});
	it("treats only the available years as required", () => {
		expect(groupYearLabels([2018, 2019], gens, [2018, 2019]).map((g) => g.label)).toEqual(["Gen 2"]);
		expect(groupYearLabels([2018], gens, [2018, 2019]).map((g) => g.label)).toEqual(["2018"]);
	});
});

describe("vehicleImage", () => {
	const m = (id: string, imageUrl: string, extra: object = {}) => [id, { id, kind: "model", make: "Toyota", model: "Camry", imageUrl, ...extra }] as const;
	const media = Object.fromEntries([
		["toyota__camry", { id: "toyota__camry", kind: "model", make: "Toyota", model: "Camry", imageUrl: "model.jpg", generations: [{ label: "Gen 1", from: 1997, to: 2010 }, { label: "Gen 2", from: 2011, to: 2020 }] }],
		m("toyota__camry__~g-gen-1", "gen1.jpg"),
		m("toyota__camry__~y-2005", "y2005.jpg"),
		m("toyota__camry__le", "le.jpg"),
	]) as Record<string, any>;
	it("prefers year, then generation, then trim, then model", () => {
		expect(vehicleImage(media, "Toyota", "Camry", { year: 2005 })).toBe("y2005.jpg");
		expect(vehicleImage(media, "Toyota", "Camry", { year: 2006 })).toBe("gen1.jpg");
		// A trim never borrows the base entries' generations.
		expect(vehicleImage(media, "Toyota", "Camry", { year: 2006, trim: "LE" })).toBe("le.jpg");
		expect(vehicleImage(media, "Toyota", "Camry", { generation: "Gen 1" })).toBe("gen1.jpg");
		expect(vehicleImage(media, "Toyota", "Camry", { year: 2015, trim: "LE" })).toBe("le.jpg");
		expect(vehicleImage(media, "Toyota", "Camry", { year: 2015 })).toBe("model.jpg");
		expect(vehicleImage(media, "Toyota", "Camry")).toBe("model.jpg");
	});
	it("uses the newest generation image when the model has none", () => {
		const noModel = { ...media, toyota__camry: { ...media.toyota__camry, imageUrl: undefined } };
		expect(vehicleImage(noModel, "Toyota", "Camry")).toBe("gen1.jpg");
		expect(vehicleImage(noModel, "Toyota", "Camry", { year: 2015 })).toBeUndefined();
	});
	it("keeps each trim's generations and images apart", () => {
		const m2: Record<string, any> = {
			toyota__camry: { id: "toyota__camry", kind: "model", make: "Toyota", model: "Camry", generations: [{ label: "Gen 1", from: 1997, to: 2010 }] },
			toyota__camry__se: { id: "toyota__camry__se", kind: "trim", make: "Toyota", model: "Camry", trim: "SE", generations: [{ label: "SE Mk1", from: 2000, to: 2005 }] },
			"toyota__camry__se__~g-se-mk1": { imageUrl: "semk1.jpg" },
			"toyota__camry__~g-gen-1": { imageUrl: "base-gen1.jpg" },
		};
		expect(generationsFor(m2, "Toyota", "Camry", "SE").map((g) => g.label)).toEqual(["SE Mk1"]);
		expect(generationsFor(m2, "Toyota", "Camry").map((g) => g.label)).toEqual(["Gen 1"]);
		expect(generationsFor(m2, "Toyota", "Camry", "LE")).toEqual([]);
		expect(vehicleImage(m2, "Toyota", "Camry", { trim: "SE", year: 2003 })).toBe("semk1.jpg");
		expect(vehicleImage(m2, "Toyota", "Camry", { year: 2003 })).toBe("base-gen1.jpg");
		expect(targetId({ kind: "generation", make: "Toyota", model: "Camry", trim: "SE", generation: "SE Mk1" })).toBe("toyota__camry__se__~g-se-mk1");
	});
	it("builds distinct ids", () => {
		expect(targetId({ kind: "generation", make: "Toyota", model: "Camry", generation: "Gen 1" })).toBe("toyota__camry__~g-gen-1");
		expect(targetId({ kind: "year", make: "Toyota", model: "Camry", year: 2005 })).toBe("toyota__camry__~y-2005");
	});
});
