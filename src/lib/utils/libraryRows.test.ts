import { describe, expect, it } from "vitest";
import type { UserPattern, VehicleEntry } from "$lib/types";
import { buildTree, entriesUnder, makeKey } from "./vehicleCatalog";
import {
	comingSoonRows, communityRows, distinctCount, expandYears, privateRows, rowsForSource, shareStatusOf, uniquePatterns,
	MAX_YEARS_PER_PATTERN,
} from "./libraryRows";

function up(over: Partial<UserPattern> = {}): UserPattern {
	return {
		id: "u1", ownerId: "me", createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-02-01"),
		submitToCommunity: false, isPublished: false, status: "private",
		make: "Ford", models: ["F-150"], years: ["2022"], bodyStyle: "truck",
		category: "ppf", zones: ["hood"], name: "Hood", coverage: "full",
		widthInches: 10, heightInches: 5, svgPath: "M0 0L10 0L10 5L0 5Z",
		...over,
	} as UserPattern;
}

const rowsToTree = (rows: ReturnType<typeof privateRows>) =>
	buildTree(rows.map((r) => ({ v: r.v, count: r.pats.length, ids: r.pats.map((p) => p.id) })));

describe("expandYears", () => {
	it("expands ranges and singles, newest first", () => {
		expect(expandYears(["2018", "2020-2022"])).toEqual([2022, 2021, 2020, 2018]);
	});
	it("skips junk and caps runaway ranges", () => {
		expect(expandYears(["abc", "2024-2020", "1-9999", ""])).toEqual([]);
		expect(expandYears(["1900-2100"]).length).toBe(MAX_YEARS_PER_PATTERN);
	});
});

describe("privateRows", () => {
	it("counts one pattern once however many models, years and trims it fits", () => {
		const p = up({ models: ["F-150", "Ranger"], trims: ["XL", "Raptor"], years: ["2020-2022"] });
		const rows = privateRows([p]);
		expect(rows).toHaveLength(2 * 2 * 3);
		expect(distinctCount(rows)).toBe(1);

		const tree = rowsToTree(rows);
		expect(tree).toHaveLength(1);
		expect(tree[0].count).toBe(1);
		for (const m of tree[0].models) {
			expect(m.count).toBe(1);
			for (const t of m.trims) expect(t.count).toBe(1);
		}
		// One card per leaf, not one per year.
		const leaf = entriesUnder(rows, { make: "ford", model: "f-150", trim: "raptor" });
		expect(leaf).toHaveLength(3);
		expect(uniquePatterns(leaf.flatMap((r) => r.pats))).toHaveLength(1);
	});

	it("counts distinct patterns when two uploads share a model", () => {
		const rows = privateRows([up({ id: "a" }), up({ id: "b", name: "Fender", zones: ["fender-left"] as never })]);
		const tree = rowsToTree(rows);
		expect(tree[0].count).toBe(2);
		expect(tree[0].models[0].count).toBe(2);
	});

	it("keeps uploads with no make or model reachable", () => {
		const rows = privateRows([up({ make: "", models: [], years: [] })]);
		expect(rows).toHaveLength(1);
		const tree = rowsToTree(rows);
		expect(tree[0].label).toBe("Unsorted");
		expect(tree[0].models[0].label).toBe("Unspecified");
		expect(distinctCount(rows)).toBe(1);
	});

	it("groups property patterns that share a label into one subject", () => {
		const rows = privateRows([
			up({ id: "a", projectType: "residential", propertyLabel: "Smith Residence", make: "", models: [] }),
			up({ id: "b", projectType: "residential", propertyLabel: "smith residence", make: "", models: [] }),
			up({ id: "c", projectType: "commercial", propertyLabel: "Smith Residence", make: "", models: [] }),
		]);
		expect(rows).toHaveLength(2);
		expect(rows[0].pats.map((p) => p.id)).toEqual(["a", "b"]);
	});

	it("tags rows private and carries every zone and the owner record", () => {
		const p = up({ zones: ["door-front-left", "door-front-right"] });
		const [row] = privateRows([p]);
		expect(row.pats[0].source).toBe("private");
		expect(row.pats[0].zones).toEqual(["door-front-left", "door-front-right"]);
		expect(row.pats[0].up).toBe(p);
		// The pattern itself is untouched: same outline, same size.
		expect(row.pats[0].svgPath).toBe(p.svgPath);
		expect(row.pats[0].widthInches).toBe(10);
		expect(row.pats[0].heightInches).toBe(5);
	});
});

describe("sources", () => {
	const veh = (id: string): VehicleEntry => ({
		id, projectType: "vehicle", make: "Ford", model: "F-150", year: 2022, tags: [], status: "published", updatedAt: "2026-01-01",
	});
	const catalog = {
		v1: [{ id: "c1", vehicleId: "v1", category: "ppf", zone: "hood", name: "Hood", coverage: "full", svgPath: "M0 0", widthInches: 1, heightInches: 1, revision: "2026-01" }],
	} as unknown as Record<string, never[]>;
	const community = communityRows([veh("v1"), { ...veh("v2"), status: "draft" }, veh("v3")], (id) => (catalog[id] ?? []) as never);

	it("community rows are published subjects that have patterns", () => {
		expect(community).toHaveLength(1);
		expect(community[0].pats[0].source).toBe("community");
	});

	it("All hides the owner's already-published copy; Private keeps it", () => {
		const priv = privateRows([up({ id: "a" }), up({ id: "b", isPublished: true, status: "approved" })]);
		expect(distinctCount(rowsForSource("private", community, priv))).toBe(2);
		expect(distinctCount(rowsForSource("community", community, priv))).toBe(1);
		const all = rowsForSource("all", community, priv);
		expect(distinctCount(all)).toBe(2); // community copy + the unpublished private one
		expect(all.flatMap((r) => r.pats).some((p) => p.id === "b")).toBe(false);
	});
});

describe("per-year community copies", () => {
	const veh = (id: string, year: number): VehicleEntry => ({
		id, projectType: "vehicle", make: "Ford", model: "F-150", year, tags: [], status: "published", updatedAt: "2026-01-01",
	});
	const pat = (id: string, vehicleId: string, svgPath = "M0 0L9 9") =>
		({ id, vehicleId, category: "ppf", zone: "hood", name: "Hood", coverage: "full", svgPath, widthInches: 9, heightInches: 9, revision: "2026-01" });
	const catalog: Record<string, unknown[]> = {
		v21: [pat("p21", "v21")], v22: [pat("p22", "v22")], v23: [pat("p23", "v23", "M0 0L9 8")],
	};
	const rows = communityRows([veh("v21", 2021), veh("v22", 2022), veh("v23", 2023)], (id) => (catalog[id] ?? []) as never);

	it("shows an identical outline once and keeps differing ones apart", () => {
		expect(distinctCount(rows)).toBe(2);
		expect(uniquePatterns(rows.flatMap((r) => r.pats))).toHaveLength(2);
	});

	it("keeps every year reachable for filtering", () => {
		const leaf = entriesUnder(rows, { make: "ford", model: "f-150" });
		const in2022 = leaf.filter((r) => r.v.year === 2022);
		expect(uniquePatterns(in2022.flatMap((r) => r.pats)).map((p) => p.id)).toEqual(["p22"]);
	});
});

describe("shareStatusOf", () => {
	it("maps the record to a status", () => {
		expect(shareStatusOf({ isPublished: true, status: "approved" })).toBe("published");
		expect(shareStatusOf({ isPublished: false, status: "pending" })).toBe("pending");
		expect(shareStatusOf({ isPublished: false, status: "rejected" })).toBe("rejected");
		expect(shareStatusOf({ isPublished: false, status: "private" })).toBe("unshared");
	});
	it("makeKey still groups the aliased make", () => {
		expect(makeKey("Chevy")).toBe("chevrolet");
	});
});

describe("coming soon", () => {
	const veh = (id: string, status: "published" | "draft" = "published"): VehicleEntry => ({
		id, projectType: "vehicle", make: "Toyota", model: "GR86", year: 2024, tags: [], status, updatedAt: "2026-01-01",
	});
	const live = { v1: [{ id: "c1" }] } as unknown as Record<string, never[]>;
	const rows = comingSoonRows([veh("v1"), veh("v2"), veh("v3", "draft")], (id) => (live[id] ?? []) as never);

	it("is published subjects with no live pattern, and counts no patterns", () => {
		expect(rows.map((r) => r.v.id)).toEqual(["v2"]);
		expect(distinctCount(rows)).toBe(0);
	});
});
