import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';

// Build the config_id key that the admin sync stamps on every price
function buildConfigId(type: string, tier: string, plan: string, interval: 'month' | 'year'): string {
	const suffix = interval === 'year' ? 'yearly' : 'monthly';
	return type === 'org' ? `org_${plan}_${suffix}` : `${tier}_${suffix}`;
}

// Find the active Stripe price whose metadata.config_id matches
async function resolvePriceId(configId: string): Promise<string | null> {
	const prices = await stripe.prices.list({ limit: 100, active: true }, connectedAccount);
	return prices.data.find(p => p.metadata?.config_id === configId)?.id ?? null;
}

export const POST: RequestHandler = async ({ request, url }) => {
	try {
		const uid = await verifyIdToken(request.headers.get('authorization'));
		if (!uid) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const { type = 'individual', orgId, tier, plan, interval = 'month' } = await request.json();

		const configId = buildConfigId(type, tier ?? '', plan ?? '', interval);
		const priceId  = await resolvePriceId(configId);

		if (!priceId) {
			return json({
				error: `No active Stripe price found for "${configId}". Run the product sync in Admin → Products.`,
			}, { status: 400 });
		}

		// Reuse existing Stripe customer so saved cards are available and we
		// don't create duplicate customers on repeated checkout attempts.
		const db = getAdminDb();
		let customerId: string | undefined;
		if (type === 'org' && orgId) {
			const orgSnap = await db.doc(`orgs/${orgId}`).get();
			customerId = orgSnap.data()?.stripeCustomerId ?? undefined;
		} else {
			const userSnap = await db.doc(`users/${uid}`).get();
			customerId = userSnap.data()?.subscription?.stripeCustomerId ?? undefined;
		}

		const meta: Record<string, string> = {
			uid,
			type,
			orgId: orgId ?? '',
			tier:  tier  ?? '',
			plan:  plan  ?? '',
		};

		const isOrg = type === 'org' && orgId;

		const session = await stripe.checkout.sessions.create({
			mode: 'subscription',
			customer: customerId,
			line_items: [{ price: priceId, quantity: 1 }],
			metadata: meta,
			subscription_data: { metadata: meta },
			success_url: isOrg
				? `${url.origin}/settings?tab=team&checkout=success`
				: `${url.origin}/settings?tab=billing&checkout=success`,
			cancel_url: isOrg
				? `${url.origin}/settings?tab=team`
				: `${url.origin}/pricing`,
			allow_promotion_codes: true,
		}, connectedAccount);

		return json({ url: session.url });

	} catch (err) {
		// Surface the real Stripe error message so it's visible in the UI
		if (err instanceof Stripe.errors.StripeError) {
			console.error('[checkout] Stripe error:', err.type, err.message);
			return json({ error: err.message }, { status: err.statusCode ?? 500 });
		}
		console.error('[checkout] Unexpected error:', err);
		return json({ error: 'Unexpected server error during checkout.' }, { status: 500 });
	}
};
