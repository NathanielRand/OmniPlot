import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { getConnectedCustomerId } from '$lib/server/stripe-customer';

// Creates (or reuses) a Stripe customer for the user, then opens a hosted
// setup session so they can save a card without an immediate charge.
export const POST: RequestHandler = async ({ request, url }) => {
	try {
		const uid = await verifyIdToken(request.headers.get('authorization'));
		if (!uid) return json({ error: 'Unauthorized' }, { status: 401 });

		const db = getAdminDb();
		const snap = await db.doc(`users/${uid}`).get();
		const userData = snap.data() ?? {};

		// Verifies the stored customer exists on the connected account (not a
		// stale platform-account ID) and creates one if needed.
		const customerId = (await getConnectedCustomerId(uid, { create: true }))!;

		const session = await stripe.checkout.sessions.create({
			mode:                 'setup',
			currency:             'usd',
			payment_method_types: ['card'],
			customer:             customerId,
			success_url:          `${url.origin}/settings?tab=billing&setup=success`,
			cancel_url:           `${url.origin}/settings?tab=billing`,
		}, connectedAccount);

		return json({ url: session.url });

	} catch (err) {
		if (err instanceof Stripe.errors.StripeError) {
			console.error('[setup] Stripe error:', err.type, err.message);
			return json({ error: err.message }, { status: err.statusCode ?? 500 });
		}
		console.error('[setup] Unexpected error:', err);
		return json({ error: 'Could not start card setup.' }, { status: 500 });
	}
};
