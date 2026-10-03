import { describe, expect, it } from "vitest";
import {
	normalizeLabel, normalizeSentence,
	EMPTY_OPTIONS, mirrorPairs, readPatternOptions, sanitizePatternOptions, slugify, withAdminZones,
	PPF_ZONES_LIST, type PatternOptionsDoc,
} from "./patternOptions";

const doc = (p: Partial<PatternOptionsDoc>): PatternOptionsDoc => ({ ...EMPTY_OPTIONS, ...p });
const zone = (o: object) => ({ id: "side-skirt-left", label: "Side Skirt Left", category: "ppf", ...o });

describe("sanitizePatternOptions", () => {
	it("accepts a valid zone, body style and category", () => {
		const res = sanitizePatternOptions({
			categories: [{ id: "chrome-delete", label: "Chrome Delete", accent: "#112233" }],
			bodyStyles: [{ id: "van", label: "Van" }],
			zones: [zone({}), zone({ id: "badge", label: "Badge", category: "chrome-delete" })],
		});
		expect(res.ok).toBe(true);
		if (res.ok) expect(res.doc.categories[0].shortLabel).toBe("Chrome Delete");
	});

	it("rejects ids that collide with a built-in", () => {
		expect(sanitizePatternOptions({ zones: [zone({ id: "hood" })] }).ok).toBe(false);
		expect(sanitizePatternOptions({ zones: [zone({ id: "custom" })] }).ok).toBe(false);
		expect(sanitizePatternOptions({ bodyStyles: [{ id: "suv", label: "SUV" }] }).ok).toBe(false);
		expect(sanitizePatternOptions({ categories: [{ id: "ppf", label: "PPF" }] }).ok).toBe(false);
	});

	it("rejects duplicate admin ids", () => {
		expect(sanitizePatternOptions({ zones: [zone({}), zone({})] }).ok).toBe(false);
	});

	it("needs exactly one scope on a zone, and a category that exists", () => {
		expect(sanitizePatternOptions({ zones: [zone({ category: undefined })] }).ok).toBe(false);
		expect(sanitizePatternOptions({ zones: [zone({ projectType: "residential" })] }).ok).toBe(false);
		expect(sanitizePatternOptions({ zones: [zone({ category: "nope" })] }).ok).toBe(false);
		expect(sanitizePatternOptions({ zones: [zone({ category: undefined, projectType: "commercial" })] }).ok).toBe(true);
		expect(sanitizePatternOptions({ zones: [zone({ category: undefined, projectType: "vehicle" })] }).ok).toBe(false);
	});

	it("only mirrors zones that exist and aren't already paired", () => {
		expect(sanitizePatternOptions({ zones: [zone({ mirrorOf: "ghost" })] }).ok).toBe(false);
		expect(sanitizePatternOptions({ zones: [zone({ mirrorOf: "hood-edge-left" })] }).ok).toBe(false);
		expect(sanitizePatternOptions({ zones: [zone({ mirrorOf: "hood" })] }).ok).toBe(true);
	});

	it("rejects invalid ids and empty names", () => {
		expect(sanitizePatternOptions({ zones: [zone({ id: "Bad Id" })] }).ok).toBe(false);
		expect(sanitizePatternOptions({ zones: [zone({ label: " " })] }).ok).toBe(false);
	});
});

describe("merging", () => {
	it("falls back to no additions on bad stored data", () => {
		expect(readPatternOptions({ zones: [{ id: "hood", label: "x", category: "ppf" }] })).toEqual(EMPTY_OPTIONS);
		expect(readPatternOptions(undefined)).toEqual(EMPTY_OPTIONS);
	});

	it("inserts visible admin zones before Custom and skips hidden ones", () => {
		const out = withAdminZones(PPF_ZONES_LIST, [{ id: "a", label: "A", category: "ppf" }, { id: "b", label: "B", category: "ppf", hidden: true }]);
		const values = out.map((z) => z.value);
		expect(values).toContain("a");
		expect(values).not.toContain("b");
		expect(values.at(-1)).toBe("custom");
	});

	it("mirrors an admin pair in both directions and keeps built-in pairs", () => {
		const pairs = mirrorPairs(doc({ zones: [{ id: "skirt-right", label: "Skirt Right", category: "ppf", mirrorOf: "roof" }] }));
		expect(pairs["skirt-right"]).toBe("roof");
		expect(pairs["roof"]).toBe("skirt-right");
		expect(pairs["door-front-left"]).toBe("door-front-right");
	});

	it("slugifies labels", () => {
		expect(slugify("Side Skirt — Left & Right")).toBe("side-skirt-left-and-right");
	});
});

describe("normalization", () => {
	it("title-cases names like the built-ins", () => {
		expect(normalizeLabel("  side   skirt LEFT ")).toBe("Side Skirt Left");
		expect(normalizeLabel("a-pillar left")).toBe("A-Pillar Left");
		expect(normalizeLabel("windshield (full)")).toBe("Windshield (Full)");
		expect(normalizeLabel("front of the car")).toBe("Front of the Car");
		expect(normalizeLabel("suv")).toBe("Suv");
		expect(normalizeLabel("SUV")).toBe("SUV");
		expect(normalizeLabel("PPF edge")).toBe("PPF Edge");
		expect(normalizeLabel("McLaren roof")).toBe("McLaren Roof");
	});

	it("sentence-cases descriptions", () => {
		expect(normalizeSentence("  clear film for paint. ")).toBe("Clear film for paint");
		expect(normalizeSentence("")).toBe("");
	});

	it("stores normalized values regardless of how they were sent", () => {
		const res = sanitizePatternOptions({
			zones: [zone({ id: "side-skirt-left", label: "side skirt left", group: "rocker panels" })],
			categories: [{ id: "chrome-delete", label: "chrome delete", shortLabel: "chrome", description: "remove chrome trim.", accent: "#112233" }],
			bodyStyles: [{ id: "van", label: "van" }],
		});
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.doc.zones[0]).toMatchObject({ label: "Side Skirt Left", group: "Rocker Panels" });
		expect(res.doc.categories[0]).toMatchObject({ label: "Chrome Delete", shortLabel: "Chrome", description: "Remove chrome trim" });
		expect(res.doc.bodyStyles[0].label).toBe("Van");
	});

	it("rejects names that only differ by case or duplicate a built-in label", () => {
		expect(sanitizePatternOptions({ zones: [zone({ id: "my-hood", label: "HOOD" })] }).ok).toBe(false);
		expect(sanitizePatternOptions({ zones: [zone({}), zone({ id: "other", label: "side skirt left" })] }).ok).toBe(false);
		expect(sanitizePatternOptions({ bodyStyles: [{ id: "crossover", label: "suv / crossover" }] }).ok).toBe(false);
		expect(sanitizePatternOptions({ categories: [{ id: "tint", label: "window tint" }] }).ok).toBe(false);
		// Same name in a different list is fine.
		expect(sanitizePatternOptions({ zones: [zone({}), zone({ id: "skirt-res", category: undefined, projectType: "residential" })] }).ok).toBe(true);
	});

	it("rejects names with no letters or digits", () => {
		expect(sanitizePatternOptions({ zones: [zone({ label: "—" })] }).ok).toBe(false);
	});
});

describe("built-in overrides", () => {
	it("keeps normalized renames and hides, drops empties", () => {
		const res = sanitizePatternOptions({
			overrides: {
				zones: { hood: { label: "bonnet" }, roof: { hidden: true }, trunk: {} },
				bodyStyles: { suv: { label: "sport utility" } },
				categories: { ppf: { shortLabel: "paint film", accent: "#abcdef", hidden: true } },
			},
		});
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.doc.overrides.zones).toEqual({ hood: { label: "Bonnet" }, roof: { hidden: true } });
		expect(res.doc.overrides.bodyStyles.suv.label).toBe("Sport Utility");
		expect(res.doc.overrides.categories.ppf).toEqual({ shortLabel: "Paint Film", accent: "#abcdef", hidden: true });
	});

	it("rejects overrides for unknown ids and for custom", () => {
		expect(sanitizePatternOptions({ overrides: { zones: { nope: { hidden: true } } } }).ok).toBe(false);
		expect(sanitizePatternOptions({ overrides: { zones: { custom: { hidden: true } } } }).ok).toBe(false);
	});

	it("rejects a rename that collides with a sibling, and counts renamed built-ins when adding", () => {
		expect(sanitizePatternOptions({ overrides: { zones: { hood: { label: "roof" } } } }).ok).toBe(false);
		expect(sanitizePatternOptions({ overrides: { zones: { hood: { label: "Bonnet" } } }, zones: [zone({ id: "bonnet", label: "bonnet" })] }).ok).toBe(false);
		// The old name is free once renamed.
		expect(sanitizePatternOptions({ overrides: { zones: { hood: { label: "Bonnet" } } }, zones: [zone({ id: "my-hood", label: "Hood" })] }).ok).toBe(true);
	});

	it("applies renames and hides to a pick-list", () => {
		const out = withAdminZones(PPF_ZONES_LIST, [], false, { hood: { label: "Bonnet" }, roof: { hidden: true } });
		expect(out.find((z) => z.value === "hood")?.label).toBe("Bonnet");
		expect(out.some((z) => z.value === "roof")).toBe(false);
		expect(withAdminZones(PPF_ZONES_LIST, [], true, { roof: { hidden: true } }).some((z) => z.value === "roof")).toBe(true);
	});
});
