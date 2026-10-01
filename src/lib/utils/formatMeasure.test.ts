import { describe, it, expect } from "vitest";
import { formatMeasure } from "./index";

describe("formatMeasure", () => {
	it("keeps one decimal and drops a trailing .0", () => {
		expect(formatMeasure(24.04)).toBe("24");
		expect(formatMeasure(24.46)).toBe("24.5");
		expect(formatMeasure(12.3456789)).toBe("12.3");
		expect(formatMeasure(7)).toBe("7");
	});
	it("doesn't print NaN", () => {
		expect(formatMeasure(NaN)).toBe("—");
	});
});
