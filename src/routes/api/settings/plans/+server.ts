import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb } from '$lib/server/firebase-admin';

// Public, read-only mirror of the admin-configured plan allowances and
// pricing (settings/platform.plans / .shopPlans) — the client needs these
// to enforce cut limits, gate features (e.g. custom uploads), and display
// live prices without an admin token. Stripe price IDs are not secret
// (already client-visible via the old VITE_STRIPE_* vars) so they're safe
// to include here too. Edited from /admin/products.
const SETTINGS_DOC = 'settings/platform';

const DEFAULT_PLANS = {
	free: { cutsPerMonth: 10, cutsPerDay: null as number | null, customUpload: false, price: 0,  yearlyPrice: 0,  stripePriceId: null as string | null, stripeYearlyPriceId: null as string | null },
	lite: { cutsPerMonth: null as number | null, cutsPerDay: 5, customUpload: false, price: 29, yearlyPrice: 24, stripePriceId: null as string | null, stripeYearlyPriceId: null as string | null },
	pro:  { cutsPerMonth: null as number | null, cutsPerDay: null as number | null, customUpload: true, price: 79, yearlyPrice: 66, stripePriceId: null as string | null, stripeYearlyPriceId: null as string | null },
};

const DEFAULT_SHOP_PLANS = {
	starter: { seats: 3,  price: 149, yearlyPrice: 124, stripePriceId: null as string | null, stripeYearlyPriceId: null as string | null },
	team:    { seats: 10, price: 299, yearlyPrice: 249, stripePriceId: null as string | null, stripeYearlyPriceId: null as string | null },
	studio:  { seats: 25, price: 499, yearlyPrice: 416, stripePriceId: null as string | null, stripeYearlyPriceId: null as string | null },
};

export const GET: RequestHandler = async () => {
	const snap = await getAdminDb().doc(SETTINGS_DOC).get();
	const data = snap.data() ?? {};
	const plans     = data.plans     ?? {};
	const shopPlans = data.shopPlans ?? {};

	return json({
		free: { ...DEFAULT_PLANS.free, ...(plans.free ?? {}) },
		lite: { ...DEFAULT_PLANS.lite, ...(plans.lite ?? {}) },
		pro:  { ...DEFAULT_PLANS.pro,  ...(plans.pro  ?? {}) },
		shopPlans: {
			starter: { ...DEFAULT_SHOP_PLANS.starter, ...(shopPlans.starter ?? {}) },
			team:    { ...DEFAULT_SHOP_PLANS.team,    ...(shopPlans.team    ?? {}) },
			studio:  { ...DEFAULT_SHOP_PLANS.studio,  ...(shopPlans.studio  ?? {}) },
		},
	});
};
