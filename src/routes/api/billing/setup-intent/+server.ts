import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { STRIPE_CONNECTED_ACCOUNT_ID } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const uid = await verifyIdToken(request.headers.get('authorization'));
		if (!uid) return json({ error: 'Unauthorized' }, { status: 401 });

		const db   = getAdminDb();
		const snap = await db.doc(`users/${uid}`).get();
		const userData = snap.data() ?? {};

		let customerId: string = userData.subscription?.stripeCustomerId ?? '';

		if (!customerId) {
			const customer = await stripe.customers.create({
				email:    userData.billingEmail ?? userData.email ?? undefined,
				name:     userData.displayName ?? undefined,
				metadata: { uid },
			}, connectedAccount);
			customerId = customer.id;
			await db.doc(`users/${uid}`).update({ 'subscription.stripeCustomerId': customerId });
		}

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
