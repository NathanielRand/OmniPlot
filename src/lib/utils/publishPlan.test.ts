import { describe, expect, it } from "vitest";
import type { Pattern, PatternZone, UserPattern, VehicleEntry } from "$lib/types";
import { MAX_BATCH_WRITES, linkedPatterns, ownersToReset, planPublish, planRevoke } from "./publishPlan";

let n = 0;
const newId = (p: string) => `${p}${++n}`;
const NOW = new Date("2026-10-01T12:00:00Z");
const mirrorOf = (z: PatternZone) =>
	(({ "door-front-left": "door-front-right", "door-front-right": "door-front-left" }) as Record<string, PatternZone>)[z];

function sub(over: Partial<UserPattern> = {}): UserPattern {
	return {
		id: "u1", ownerId: "owner", createdAt: NOW, updatedAt: NOW,
		submitToCommunity: true, isPublished: false, status: "pending",
		make: "Ford", models: ["F-150"], years: ["2022"], bodyStyle: "truck", trims: undefined,
		category: "ppf", zones: ["hood"] as PatternZone[], name: "Hood", coverage: "full",
		widthInches: 10, heightInches: 5, svgPath: "M0 0L10 0L10 5L0 5Z",
		...over,
	} as UserPattern;
}
const veh = (over: Partial<VehicleEntry> = {}): VehicleEntry => ({
	id: "v1", projectType: "vehicle", make: "Chevrolet", model: "Silverado", year: 2022,
	tags: [], status: "published", updatedAt: "2026-01-01", ...over,
});
const pat = (over: Partial<Pattern> = {}): Pattern => ({
	id: "p1", vehicleId: "v1", category: "ppf", zone: "hood", name: "Hood", coverage: "full",
	svgPath: "M0 0L10 0L10 5L0 5Z", widthInches: 10, heightInches: 5, revision: "2026-01", isPublished: true, ...over,
} as Pattern);

const plan = (s: UserPattern, vehicles: VehicleEntry[] = [], patterns: Pattern[] = []) =>
	planPublish({ sub: s, vehicles, patterns, mirrorOf, newId, now: NOW });

describe("planPublish", () => {
	it("publishes every model × year × zone, not just the first", () => {
		const p = plan(sub({ models: ["F-150", "Ranger"], years: ["2022", "2023"], zones: ["hood", "roof"] as PatternZone[] }));
		expect(p.error).toBeUndefined();
		expect(p.targets).toHaveLength(4); // 2 models × 2 years
		expect(p.targets.every((t) => t.isNew)).toBe(true);
		expect(p.patterns).toHaveLength(8); // × 2 zones
		expect(p.patterns.every((x) => x.sourcePatternId === "u1" && x.isPublished)).toBe(true);
		expect(p.writes).toBe(4 + 8 + 1);
	});

	it("expands year ranges and trims", () => {
		const p = plan(sub({ years: ["2020-2022"], trims: ["XL", "Raptor"] }));
		expect(p.targets).toHaveLength(3 * 2);
		expect(new Set(p.targets.map((t) => t.subject.trim))).toEqual(new Set(["XL", "Raptor"]));
	});

	it("joins an existing Chevrolet subject for a Chevy submission", () => {
		const p = plan(sub({ make: "Chevy", models: ["silverado"], years: ["2022"] }), [veh()]);
		expect(p.targets).toHaveLength(1);
		expect(p.targets[0].isNew).toBe(false);
		expect(p.targets[0].subject.id).toBe("v1");
		expect(p.patterns[0].vehicleId).toBe("v1");
	});

	it("reuses the catalog's spelling for new subjects of a known make", () => {
		const p = plan(sub({ make: "Chevy", models: ["Silverado"], years: ["2024"] }), [veh()]);
		expect(p.targets[0].isNew).toBe(true);
		expect(p.targets[0].subject.make).toBe("Chevrolet");
		expect(p.targets[0].subject.model).toBe("Silverado");
	});

	it("flags an existing subject that customers can't see", () => {
		const p = plan(sub({ make: "Chevrolet", models: ["Silverado"] }), [veh({ status: "draft" })]);
		expect(p.targets[0].hidden).toBe(true);
	});

	it("publishes a left/right pair once", () => {
		const p = plan(sub({ zones: ["door-front-left", "door-front-right"] as PatternZone[] }));
		expect(p.patterns.map((x) => x.zone)).toEqual(["door-front-left"]);
		expect(p.pairedZones).toEqual(["door-front-right"]);
	});

	it("is idempotent: re-approving skips what was already published", () => {
		const first = plan(sub());
		const catalog = first.patterns;
		const again = planPublish({ sub: sub(), vehicles: first.targets.map((t) => t.subject), patterns: catalog, mirrorOf, newId, now: NOW });
		expect(again.patterns).toHaveLength(0);
		expect(again.alreadyPublished).toBe(1);
	});

	it("repairs an older single-year approval: keeps its pattern, adds the other years", () => {
		// Approved before the link existed: only 2014 was published.
		const subject = veh({ id: "v14", make: "Ford", model: "F-150", year: 2014 });
		const legacy = pat({ id: "old", vehicleId: "v14", svgPath: "M0 0L10 0L10 5L0 5Z" });
		const p = plan(sub({ years: ["2014-2016"], vehicleId: "v14" }), [subject], [legacy]);
		expect(p.error).toBeUndefined();
		expect(p.targets).toHaveLength(3);
		expect(p.patterns).toHaveLength(2); // 2015 and 2016 — not a second 2014
		expect(p.patterns.map((x) => x.vehicleId)).not.toContain("v14");
		expect(p.adopt).toEqual(["old"]);
		expect(p.alreadyPublished).toBe(1);
	});

	it("groups non-vehicle submissions under one property subject", () => {
		const s = sub({ projectType: "residential", propertyLabel: "Smith Residence", make: "", models: [] });
		const existing = veh({ id: "r1", projectType: "residential", propertyLabel: "smith residence", make: undefined, model: undefined, year: undefined });
		const p = plan(s, [existing]);
		expect(p.targets).toHaveLength(1);
		expect(p.targets[0].subject.id).toBe("r1");
		expect(p.patterns[0].projectType).toBe("residential");
	});

	it("falls back to the current year with a warning", () => {
		const p = plan(sub({ years: ["nope"] }));
		expect(p.targets[0].subject.year).toBe(2026);
		expect(p.warnings.length).toBe(1);
	});

	it("refuses past the batch limit", () => {
		const p = plan(sub({ models: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], years: ["1990-2049"] }));
		expect(p.error).toMatch(String(MAX_BATCH_WRITES));
	});

	it("keeps the outline and size exactly as submitted", () => {
		const s = sub({ widthInches: 12.5, heightInches: 6.25, svgPath: "M0 0L2 0L2 1L0 1Z" });
		const p = plan(s);
		expect(p.patterns[0].svgPath).toBe(s.svgPath);
		expect(p.patterns[0].widthInches).toBe(12.5);
		expect(p.patterns[0].heightInches).toBe(6.25);
	});

	it("errors on missing make, model or zone", () => {
		expect(plan(sub({ make: "" })).error).toBeDefined();
		expect(plan(sub({ models: [] })).error).toBeDefined();
		expect(plan(sub({ zones: [] })).error).toBeDefined();
	});
});

describe("links", () => {
	it("finds patterns by sourcePatternId", () => {
		const ps = [pat({ id: "a", sourcePatternId: "u1" }), pat({ id: "b" })];
		expect(linkedPatterns({ id: "u1", vehicleId: "v1", svgPath: "x" }, ps).map((p) => p.id)).toEqual(["a"]);
	});

	it("falls back to subject + identical outline for older approvals", () => {
		const ps = [pat({ id: "a" }), pat({ id: "b", svgPath: "other" }), pat({ id: "c", vehicleId: "v2" })];
		expect(linkedPatterns({ id: "u1", vehicleId: "v1", svgPath: "M0 0L10 0L10 5L0 5Z" }, ps).map((p) => p.id)).toEqual(["a"]);
	});

	it("revoke deletes the linked patterns and resets the owner's copy", () => {
		const ps = [pat({ id: "a", sourcePatternId: "u1" }), pat({ id: "b", sourcePatternId: "u1", zone: "roof" as PatternZone }), pat({ id: "c" })];
		const r = planRevoke({ id: "u1", vehicleId: "v1", svgPath: "x" }, ps);
		expect(r.deleteIds).toEqual(["a", "b"]);
		expect(r.patch).toEqual({ isPublished: false, status: "private", submitToCommunity: false });
	});

	it("deleting the last community copy returns the owner's pattern to private", () => {
		const a = pat({ id: "a", sourcePatternId: "u1" });
		const b = pat({ id: "b", sourcePatternId: "u1", zone: "roof" as PatternZone });
		const s = { id: "u1", vehicleId: "v1", svgPath: "x", isPublished: true };
		expect(ownersToReset([a], [b], [s])).toEqual([]); // another copy remains
		expect(ownersToReset([a, b], [], [s])).toEqual([s]);
		expect(ownersToReset([a, b], [], [{ ...s, isPublished: false }])).toEqual([]);
	});
});
