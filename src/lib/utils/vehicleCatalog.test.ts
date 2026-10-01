import { describe, it, expect } from "vitest";
import type { VehicleEntry } from "$lib/types";
import { buildTree, entriesUnder, makeKey, matchesQuery, mediaId, monogram, yearSpan, BASE_TRIM_LABEL } from "./vehicleCatalog";

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
