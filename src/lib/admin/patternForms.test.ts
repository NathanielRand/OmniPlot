import { describe, it, expect } from "vitest";
import type { VehicleEntry } from "$lib/types";
import { blankSubject, subjectDuplicate } from "./patternForms";

const v = (id: string, make: string, model: string, year: number, trim?: string): VehicleEntry => ({
	id, make, model, year, trim, projectType: "vehicle", tags: [], status: "published", updatedAt: "",
});

describe("subjectDuplicate", () => {
	const existing = [v("a", "Toyota", "GR86", 2024), v("b", "Toyota", "Camry", 2020, "SE")];
	const form = (over: object) => ({ ...blankSubject(), make: "Toyota", model: "GR86", year: 2024, ...over });

	it("matches by the library's keys, ignoring spelling", () => {
		expect(subjectDuplicate(form({ model: "GR-86" }), existing)?.id).toBe("a");
		expect(subjectDuplicate(form({ make: "toyota " }), existing)?.id).toBe("a");
	});
	it("tells years and trims apart", () => {
		expect(subjectDuplicate(form({ year: 2023 }), existing)).toBeNull();
		expect(subjectDuplicate(form({ model: "Camry", year: 2020 }), existing)).toBeNull();
		expect(subjectDuplicate(form({ model: "Camry", year: 2020, trim: "se" }), existing)?.id).toBe("b");
	});
	it("ignores the entry being edited", () => {
		expect(subjectDuplicate(form({}), existing, "a")).toBeNull();
	});
});
