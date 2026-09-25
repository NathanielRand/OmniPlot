import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { mergePlanSettings } from '$lib/plans';
import { invalidatePlanSettings } from '$lib/server/plans';
import { invalidatePlatformFlags } from '$lib/server/platform';
import { mergePlatformFlags } from '$lib/platform';
import { stripe } from '$lib/server/stripe';
import { STRIPE_CONNECTED_ACCOUNT_ID } from '$env/static/private';

function plansAndShops(data: FirebaseFirestore.DocumentData) {
	const { shopPlans, ...plans } = mergePlanSettings(data);
	return { plans, shopPlans };
}

const SETTINGS_DOC = 'settings/platform';

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

	// Which Stripe account billing runs against — shown so a misconfigured
	// STRIPE_CONNECTED_ACCOUNT_ID is obvious at a glance.
	const stripeAccount = { id: STRIPE_CONNECTED_ACCOUNT_ID, name: null as string | null, email: null as string | null };
	try {
		const account = await stripe.accounts.retrieve(STRIPE_CONNECTED_ACCOUNT_ID);
		stripeAccount.name  = account.business_profile?.name ?? account.settings?.dashboard?.display_name ?? null;
		stripeAccount.email = account.email ?? null;
	} catch { /* shown as unreachable on the page */ }

	return json({
		flags: mergePlatformFlags(data.flags),
		stripeAccount,
		...plansAndShops(data),
		admins,
	});
};

export const POST: RequestHandler = async ({ request }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}

	const { flags, plans, shopPlans } = await request.json();
	const db  = getAdminDb();
	const patch: Record<string, unknown> = {};
	// Only known boolean flags are stored — the whole map is written so a
	// save never leaves a stale value behind.
	if (flags)     patch.flags     = mergePlatformFlags(flags);
	if (plans)     patch.plans     = plans;
	if (shopPlans) patch.shopPlans = shopPlans;

	await db.doc(SETTINGS_DOC).set(patch, { merge: true });
	if (plans || shopPlans) invalidatePlanSettings();
	if (flags) invalidatePlatformFlags();
	return json({ ok: true });
};
