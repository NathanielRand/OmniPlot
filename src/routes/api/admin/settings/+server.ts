import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';

const SETTINGS_DOC = 'settings/platform';

const DEFAULT_FLAGS = {
	aiAssist:         true,
	commandPalette:   true,
	exportDXF:        false,
	exportPDF:        true,
	cutAgent:         false,
	openRegistration: true,
	maintenanceMode:  false,
};

const DEFAULT_PLATFORM = {
	appName:      'OmniPlot',
	supportEmail: 'support@omniplot.app',
	docsUrl:      'https://docs.omniplot.app',
};

// Per-tier allowances — the single source of truth for cut limits, gated
// features, and billing amounts. Editable from /admin/products; enforced
// client-side via GET /api/settings/plans (public mirror) and canCut()/
// upload gating; the Stripe sync (sync_config) mints prices from `price`/
// `yearlyPrice` here and caches the resulting price IDs back onto each
// entry so checkout resolves deterministically instead of re-listing Stripe.
const DEFAULT_PLANS = {
	free: {
		cutsPerMonth: 10, cutsPerDay: null as number | null, customUpload: false,
		price: 0, yearlyPrice: 0,
		stripePriceId: null as string | null, stripeYearlyPriceId: null as string | null,
	},
	lite: {
		cutsPerMonth: null as number | null, cutsPerDay: 5, customUpload: false,
		price: 29, yearlyPrice: 24,
		stripePriceId: null as string | null, stripeYearlyPriceId: null as string | null,
	},
	pro: {
		cutsPerMonth: null as number | null, cutsPerDay: null as number | null, customUpload: true,
		price: 79, yearlyPrice: 66,
		stripePriceId: null as string | null, stripeYearlyPriceId: null as string | null,
	},
};

// Shop/org plans — no cut limits (unlimited for all seats), but same
// price/yearlyPrice + cached Stripe price ID shape.
const DEFAULT_SHOP_PLANS = {
	starter: { seats: 3,  price: 149, yearlyPrice: 124, stripePriceId: null as string | null, stripeYearlyPriceId: null as string | null },
	team:    { seats: 10, price: 299, yearlyPrice: 249, stripePriceId: null as string | null, stripeYearlyPriceId: null as string | null },
	studio:  { seats: 25, price: 499, yearlyPrice: 416, stripePriceId: null as string | null, stripeYearlyPriceId: null as string | null },
};

async function assertAdmin(authHeader: string | null): Promise<boolean> {
	const uid = await verifyIdToken(authHeader);
	if (!uid) return false;
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.data()?.tier === 'admin';
}

export const GET: RequestHandler = async ({ request }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}

	const db   = getAdminDb();
	const snap = await db.doc(SETTINGS_DOC).get();
	const data = snap.data() ?? {};

	// Fetch admin users
	const adminSnap = await db.collection('users').where('tier', '==', 'admin').get();
	const admins = adminSnap.docs.map((doc) => {
		const d = doc.data();
		return {
			uid:         doc.id,
			displayName: d.displayName ?? '',
			email:       d.email ?? '',
			createdAt:   d.createdAt?.toDate?.()?.toISOString() ?? null,
		};
	});

	return json({
		flags:    { ...DEFAULT_FLAGS,    ...(data.flags    ?? {}) },
		platform: { ...DEFAULT_PLATFORM, ...(data.platform ?? {}) },
		plans: {
			free: { ...DEFAULT_PLANS.free, ...(data.plans?.free ?? {}) },
			lite: { ...DEFAULT_PLANS.lite, ...(data.plans?.lite ?? {}) },
			pro:  { ...DEFAULT_PLANS.pro,  ...(data.plans?.pro  ?? {}) },
		},
		shopPlans: {
			starter: { ...DEFAULT_SHOP_PLANS.starter, ...(data.shopPlans?.starter ?? {}) },
			team:    { ...DEFAULT_SHOP_PLANS.team,    ...(data.shopPlans?.team    ?? {}) },
			studio:  { ...DEFAULT_SHOP_PLANS.studio,  ...(data.shopPlans?.studio  ?? {}) },
		},
		admins,
	});
};

export const POST: RequestHandler = async ({ request }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}

	const { flags, platform, plans, shopPlans } = await request.json();
	const db  = getAdminDb();
	const patch: Record<string, unknown> = {};
	if (flags)     patch.flags     = flags;
	if (platform)  patch.platform  = platform;
	if (plans)     patch.plans     = plans;
	if (shopPlans) patch.shopPlans = shopPlans;

	await db.doc(SETTINGS_DOC).set(patch, { merge: true });
	return json({ ok: true });
};
