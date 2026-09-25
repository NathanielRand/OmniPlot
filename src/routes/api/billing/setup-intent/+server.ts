import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { getConnectedCustomerId } from '$lib/server/stripe-customer';
import { STRIPE_CONNECTED_ACCOUNT_ID } from '$env/static/private';
import { checkRateLimit, rateLimitedResponse } from '$lib/server/rate-limit';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const uid = await verifyIdToken(request.headers.get('authorization'));
		if (!uid) return json({ error: 'Unauthorized' }, { status: 401 });

		const limit = await checkRateLimit(`setup-intent:${uid}`, { max: 10, windowSeconds: 60 });
		if (!limit.allowed) return rateLimitedResponse(limit);

		const db   = getAdminDb();
		const snap = await db.doc(`users/${uid}`).get();
		const userData = snap.data() ?? {};

		// Verifies the stored customer exists on the connected account (not a
		// stale platform-account ID) and creates one if needed.
		const customerId = (await getConnectedCustomerId(uid, { create: true }))!;

		const intent = await stripe.setupIntents.create({
			customer:             customerId,
			payment_method_types: ['card'],
			usage:                'off_session',
		}, connectedAccount);

		return json({ clientSecret: intent.client_secret, stripeAccount: STRIPE_CONNECTED_ACCOUNT_ID });

	} catch (err) {
		if (err instanceof Stripe.errors.StripeError) {
			console.error('[setup-intent] Stripe error:', err.type, err.message);
			return json({ error: err.message }, { status: err.statusCode ?? 500 });
		}
		console.error('[setup-intent] Unexpected error:', err);
		return json({ error: 'Could not create setup intent.' }, { status: 500 });
	}
};
