import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { mergePlanSettings } from '$lib/plans';
import { invalidatePlanSettings } from '$lib/server/plans';

function plansAndShops(data: FirebaseFirestore.DocumentData) {
	const { shopPlans, ...plans } = mergePlanSettings(data);
	return { plans, shopPlans };
}

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
	docsUrl:      'https://docs.omniplot.app',
};

// Per-tier allowances — the single source of truth for cut limits, gated
// features, and billing amounts. Editable from /admin/products; enforced
// client-side via GET /api/settings/plans (public mirror) and canCut()/
// upload gating, and shown in customer-facing copy via plan tokens; the
// Stripe sync (sync_config) mints prices from `price`/`yearlyPrice` here and
// caches the resulting price IDs back onto each entry. Defaults: $lib/plans.

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
		...plansAndShops(data),
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
	if (plans || shopPlans) invalidatePlanSettings();
	return json({ ok: true });
};
