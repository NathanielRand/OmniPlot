// ─────────────────────────────────────────────
// OmniPlot — PLAN SETTINGS (shared client + server)
// ─────────────────────────────────────────────
// Plan allowances and prices are admin-set (Admin → Products) and stored in
// settings/platform. These defaults are the ONLY fallback copy of them —
// used until the live values load, or if the doc has never been saved.
// Anything customer-facing that states a limit or price should read the live
// settings (plansStore on the client, getPlanSettings() on the server) and,
// for static copy, use the {{tokens}} filled in by fillPlanTokens().

export type IndividualTier = 'free' | 'lite' | 'pro';
export type ShopTier = 'starter' | 'team' | 'studio';

export interface IndividualPlanSettings {
	cutsPerMonth: number | null;
	cutsPerDay: number | null;
	customUpload: boolean;
	price: number;
	yearlyPrice: number;
	stripePriceId: string | null;
	stripeYearlyPriceId: string | null;
}

export interface ShopPlanSettings {
	seats: number;
	price: number;
	yearlyPrice: number;
	stripePriceId: string | null;
	stripeYearlyPriceId: string | null;
}

export interface PlanSettings extends Record<IndividualTier, IndividualPlanSettings> {
	shopPlans: Record<ShopTier, ShopPlanSettings>;
}

const noStripe = { stripePriceId: null, stripeYearlyPriceId: null };

export const DEFAULT_PLAN_SETTINGS: PlanSettings = {
	free: { cutsPerMonth: 10,   cutsPerDay: null, customUpload: false, price: 0,  yearlyPrice: 0,  ...noStripe },
	lite: { cutsPerMonth: null, cutsPerDay: 5,    customUpload: false, price: 29, yearlyPrice: 24, ...noStripe },
	pro:  { cutsPerMonth: null, cutsPerDay: null, customUpload: true,  price: 79, yearlyPrice: 66, ...noStripe },
	shopPlans: {
		starter: { seats: 3,  price: 149, yearlyPrice: 124, ...noStripe },
		team:    { seats: 10, price: 299, yearlyPrice: 249, ...noStripe },
		studio:  { seats: 25, price: 499, yearlyPrice: 416, ...noStripe },
	},
};

/** Merges a stored settings/platform doc over the defaults. */
export function mergePlanSettings(data: { plans?: Record<string, object>; shopPlans?: Record<string, object> } | null | undefined): PlanSettings {
	const plans = data?.plans ?? {};
	const shop = data?.shopPlans ?? {};
	const d = DEFAULT_PLAN_SETTINGS;
	return {
		free: { ...d.free, ...(plans.free ?? {}) },
		lite: { ...d.lite, ...(plans.lite ?? {}) },
		pro:  { ...d.pro,  ...(plans.pro  ?? {}) },
		shopPlans: {
			starter: { ...d.shopPlans.starter, ...(shop.starter ?? {}) },
			team:    { ...d.shopPlans.team,    ...(shop.team    ?? {}) },
			studio:  { ...d.shopPlans.studio,  ...(shop.studio  ?? {}) },
		},
	};
}

// ─── Formatting ───────────────────────────────

export function fmtPrice(n: number): string {
	return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

/** "10 cuts per month" / "5 cuts per day" / "Unlimited cuts".
 *  `short` → "10 / 30 days", "5 / day", "Unlimited". */
export function cutAllowanceText(p: Pick<IndividualPlanSettings, 'cutsPerDay' | 'cutsPerMonth'>, style: 'long' | 'short' = 'long'): string {
	if (p.cutsPerDay != null) {
		return style === 'short' ? `${p.cutsPerDay} / day` : `${p.cutsPerDay} cut${p.cutsPerDay === 1 ? '' : 's'} per day`;
	}
	if (p.cutsPerMonth != null) {
		return style === 'short' ? `${p.cutsPerMonth} / 30 days` : `${p.cutsPerMonth} cut${p.cutsPerMonth === 1 ? '' : 's'} per 30 days`;
	}
	return style === 'short' ? 'Unlimited' : 'Unlimited cuts';
}

/** Rough annual saving across Lite/Pro, e.g. 17 → "~17%". */
export function yearlySavingsPct(s: PlanSettings): number {
	const pcts = (['lite', 'pro'] as const)
		.filter((t) => s[t].price > 0)
		.map((t) => 1 - s[t].yearlyPrice / s[t].price);
	return pcts.length ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 100) : 0;
}

// ─── Copy tokens ──────────────────────────────
// Static copy (FAQ answers, plan feature bullets, legal text) embeds tokens
// like "{{free.cuts}}" or "{{starter.seats}}" instead of numbers:
//   {{<tier>.cuts}}         "10 cuts per 30 days" (lowercase-safe)
//   {{<tier>.price}}        "$29"   ({{<tier>.yearlyPrice}} → "$24")
//   {{<shop>.seats}}        "3"
//   {{shop.minPrice}}       cheapest shop plan monthly price
//   {{shop.maxSeats}}       largest shop plan seat count
//   {{yearlySavings}}       "17%"
//   {{upload.plans}}        individual plans with custom uploads, "Pro" / "Lite and Pro"

export function planTokens(s: PlanSettings): Record<string, string> {
	const t: Record<string, string> = {};
	for (const tier of ['free', 'lite', 'pro'] as const) {
		t[`${tier}.cuts`] = cutAllowanceText(s[tier]).replace(/^Unlimited/, 'unlimited');
		t[`${tier}.Cuts`] = cutAllowanceText(s[tier]);
		t[`${tier}.price`] = fmtPrice(s[tier].price);
		t[`${tier}.yearlyPrice`] = fmtPrice(s[tier].yearlyPrice);
	}
	for (const shop of ['starter', 'team', 'studio'] as const) {
		t[`${shop}.seats`] = String(s.shopPlans[shop].seats);
		t[`${shop}.price`] = fmtPrice(s.shopPlans[shop].price);
		t[`${shop}.yearlyPrice`] = fmtPrice(s.shopPlans[shop].yearlyPrice);
	}
	const shops = Object.values(s.shopPlans);
	t['shop.minPrice'] = fmtPrice(Math.min(...shops.map((p) => p.price)));
	t['shop.maxSeats'] = String(Math.max(...shops.map((p) => p.seats)));
	t['yearlySavings'] = `${yearlySavingsPct(s)}%`;
	const NAMES = { free: 'Free', lite: 'Lite', pro: 'Pro' } as const;
	t['upload.plans'] = (['free', 'lite', 'pro'] as const).filter((x) => s[x].customUpload).map((x) => NAMES[x]).join(' and ') || 'Pro';
	return t;
}

export function fillPlanTokens(text: string, s: PlanSettings): string {
	const tokens = planTokens(s);
	return text.replace(/\{\{([\w.]+)\}\}/g, (m, key: string) => tokens[key] ?? m);
}
