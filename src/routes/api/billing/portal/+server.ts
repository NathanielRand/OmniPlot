import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';

export const POST: RequestHandler = async ({ request, url }) => {
	try {
		const uid = await verifyIdToken(request.headers.get('authorization'));
		if (!uid) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const { type = 'individual', shopId } = await request.json();

		let customerId: string | null = null;
		let returnPath = '/settings?tab=billing';

		const db = getAdminDb();
		if (type === 'shop' && shopId) {
			const snap = await db.doc(`shops/${shopId}`).get();
			customerId = snap.data()?.stripeCustomerId ?? null;
			returnPath = '/settings?tab=team';
		} else {
			const snap = await db.doc(`users/${uid}`).get();
			customerId = snap.data()?.subscription?.stripeCustomerId ?? null;
		}

		if (!customerId) {
			return json({ error: 'No billing account found. Complete a checkout first.' }, { status: 400 });
		}

		const session = await stripe.billingPortal.sessions.create({
			customer: customerId,
			return_url: `${url.origin}${returnPath}`,
		}, connectedAccount);

		return json({ url: session.url });

	} catch (err) {
		if (err instanceof Stripe.errors.StripeError) {
			console.error('[portal] Stripe error:', err.type, err.message);
			return json({ error: err.message }, { status: err.statusCode ?? 500 });
		}
		console.error('[portal] Unexpected error:', err);
		return json({ error: 'Unexpected server error opening billing portal.' }, { status: 500 });
	}
};
