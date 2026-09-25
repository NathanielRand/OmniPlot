import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_SETTINGS, cutAllowanceText, fillPlanTokens, mergePlanSettings } from './plans';
import { FAQ_ITEMS, PRICING_PLANS, SHOP_PRICING_PLANS } from './config';

describe('plan copy tokens', () => {
	it('fills limits, prices and seats from the admin-set settings', () => {
		const s = mergePlanSettings({
			plans: { free: { cutsPerMonth: 3 }, lite: { price: 35, cutsPerDay: 8 } },
			shopPlans: { starter: { seats: 4, price: 129 } },
		});
		expect(fillPlanTokens('Free: {{free.cuts}}. Lite {{lite.price}}/mo: {{lite.cuts}}. Pro: {{pro.cuts}}.', s))
			.toBe('Free: 3 cuts per 30 days. Lite $35/mo: 8 cuts per day. Pro: unlimited cuts.');
		expect(fillPlanTokens('From {{shop.minPrice}}/mo for {{starter.seats}} seats', s)).toBe('From $129/mo for 4 seats');
	});

	it('singularizes a one-cut allowance', () => {
		expect(cutAllowanceText({ cutsPerMonth: 1, cutsPerDay: null })).toBe('1 cut per 30 days');
		expect(cutAllowanceText({ cutsPerMonth: null, cutsPerDay: 5 }, 'short')).toBe('5 / day');
	});

	it('names the plans that include custom uploads', () => {
		const s = mergePlanSettings({ plans: { lite: { customUpload: true } } });
		expect(fillPlanTokens('{{upload.plans}}', s)).toBe('Lite and Pro');
	});

	it('leaves no unknown tokens in any static plan or FAQ copy', () => {
		const copy = [
			...FAQ_ITEMS.flatMap((c) => c.items.flatMap((i) => [i.q, i.a])),
			...PRICING_PLANS.flatMap((p) => p.features),
			...SHOP_PRICING_PLANS.flatMap((p) => p.features),
		];
		for (const text of copy) expect(fillPlanTokens(text, DEFAULT_PLAN_SETTINGS)).not.toMatch(/\{\{/);
	});
});
