import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// PATCH — update the receipt/billing email. Independent of the login email/phone,
// which stays locked to whatever the user authenticated with.
export const PATCH: RequestHandler = async ({ request }) => {
	try {
		const uid = await verifyIdToken(request.headers.get('authorization'));
		if (!uid) return json({ error: 'Unauthorized' }, { status: 401 });

		const { email } = await request.json();
		if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
			return json({ error: 'Enter a valid email address.' }, { status: 400 });
		}

		const db = getAdminDb();
		await db.doc(`users/${uid}`).update({ billingEmail: email });

		// Keep the Stripe customer's email in sync so receipts land in the right inbox
		const userData = (await db.doc(`users/${uid}`).get()).data() ?? {};
		const customerId: string = userData.subscription?.stripeCustomerId ?? '';
		if (customerId) {
			await stripe.customers.update(customerId, { email }, connectedAccount);
		}

		return json({ ok: true });

	} catch (err) {
		if (err instanceof Stripe.errors.StripeError) {
			return json({ error: err.message }, { status: err.statusCode ?? 500 });
		}
		console.error('[billing/email]', err);
		return json({ error: 'Could not update billing email.' }, { status: 500 });
	}
};
