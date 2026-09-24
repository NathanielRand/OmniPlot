import { describe, it, expect } from "vitest";
import { canCut, cutLimitsFromPlans, DEFAULT_CUT_LIMITS } from "./index";
import type { UserProfile } from "$lib/types";

const HOUR = 3_600_000;

function user(tier: UserProfile["tier"], usage: Partial<UserProfile["usage"]> = {}): UserProfile {
	return {
		tier,
		usage: {
			cutCount: 0, lastCutAt: null,
			monthlyCount: 0, monthResetAt: null,
			dailyCount: 0, dayResetAt: null,
			...usage,
		},
	} as unknown as UserProfile;
}

const future = () => new Date(Date.now() + 10 * HOUR);
const past   = () => new Date(Date.now() - HOUR);

describe("canCut", () => {
	it("gives Lite its daily allowance, not Free's", () => {
		expect(canCut(user("lite"))).toEqual({ allowed: true, remaining: 5 });
		expect(canCut(user("lite", { dailyCount: 3, dayResetAt: future() })).remaining).toBe(2);
	});

	it("blocks Lite at the daily limit and resets after the window", () => {
		expect(canCut(user("lite", { dailyCount: 5, dayResetAt: future() })).allowed).toBe(false);
		expect(canCut(user("lite", { dailyCount: 5, dayResetAt: past() })).allowed).toBe(true);
	});

	it("does not apply Free's monthly usage to a newly upgraded Lite user", () => {
		const u = user("lite", { monthlyCount: 10, monthResetAt: future() });
		expect(canCut(u)).toEqual({ allowed: true, remaining: 5 });
	});

	it("enforces Free's monthly allowance", () => {
		expect(canCut(user("free", { monthlyCount: 9, monthResetAt: future() })).remaining).toBe(1);
		expect(canCut(user("free", { monthlyCount: 10, monthResetAt: future() })).allowed).toBe(false);
	});

	it("treats pro, admin and active team seats as unlimited", () => {
		expect(canCut(user("pro")).remaining).toBeNull();
		expect(canCut(user("admin")).remaining).toBeNull();
		expect(canCut(user("free", { monthlyCount: 99, monthResetAt: future() }), true).allowed).toBe(true);
	});

	it("honours admin-configured allowances, including null = unlimited", () => {
		const limits = cutLimitsFromPlans({ free: {}, lite: { cutsPerDay: null, cutsPerMonth: null }, pro: {} });
		expect(canCut(user("lite", { dailyCount: 50, dayResetAt: future() }), false, limits)).toEqual({ allowed: true, remaining: null });
		expect(limits.free).toEqual(DEFAULT_CUT_LIMITS.free);
	});

	it("enforces both windows when a tier has both", () => {
		const limits = { ...DEFAULT_CUT_LIMITS, lite: { cutsPerDay: 5, cutsPerMonth: 20 } };
		const u = user("lite", { dailyCount: 1, dayResetAt: future(), monthlyCount: 20, monthResetAt: future() });
		expect(canCut(u, false, limits).allowed).toBe(false);
	});
});
