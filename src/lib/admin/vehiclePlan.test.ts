import { describe, expect, it } from "vitest";
import type { VehicleEntry } from "$lib/types";
import { planVehicles, type VehiclePlanInput } from "./vehiclePlan";

let n = 0;
const newId = (p: string) => `${p}${++n}`;
const input = (over: Partial<VehiclePlanInput> = {}): VehiclePlanInput => ({
	make: "Toyota", models: "GR86, GR Supra", yearFrom: 2022, yearTo: 2024, trims: "", bodyStyle: "coupe",
	status: "published", tags: ["advertised"], popular: false, ...over,
});
const veh = (over: Partial<VehicleEntry>): VehicleEntry => ({ id: "x", projectType: "vehicle", make: "Toyota", model: "GR86", year: 2023, tags: [], status: "published", updatedAt: "2026-01-01", ...over });

describe("planVehicles", () => {
	it("creates models × years and skips what exists, even under another spelling", () => {
		const plan = planVehicles(input({ models: "GR-86, Supra" }), [veh({ model: "GR86", year: 2023 }), veh({ id: "y", make: "toyota", model: "GR86", year: 2022 })], newId, "2026-10-02");
		expect(plan.skipped).toBe(2);
		expect(plan.create).toHaveLength(4); // GR86 2024 + Supra ×3
		expect(plan.create.every((v) => v.make === "Toyota")).toBe(true);
		expect(plan.create.filter((v) => v.model === "GR86")).toHaveLength(1);
	});
	it("crosses trims and de-duplicates repeated entries", () => {
		const plan = planVehicles(input({ models: "Tacoma, tacoma", yearFrom: 2024, yearTo: 2024, trims: "SR5, TRD Pro" }), [], newId, "d");
		expect(plan.create.map((v) => v.trim).sort()).toEqual(["SR5", "TRD Pro"]);
	});
	it("rejects bad input and oversized batches", () => {
		expect(planVehicles(input({ make: " " }), [], newId, "d").error).toBeTruthy();
		expect(planVehicles(input({ yearFrom: 2025, yearTo: 2020 }), [], newId, "d").error).toBeTruthy();
		expect(planVehicles(input({ models: "A,B,C,D,E,F,G,H,I,J,K", yearFrom: 1990, yearTo: 2029 }), [], newId, "d").error).toMatch(/at a time/);
	});
});
