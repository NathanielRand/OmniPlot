import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

async function getSubId(uid: string): Promise<string | null> {
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	const data = snap.data() ?? {};

	const stored: string = data.subscription?.stripeSubscriptionId ?? '';
	if (stored) return stored;

	const customerId: string = data.subscription?.stripeCustomerId ?? '';
	if (!customerId) return null;

	const list = await stripe.subscriptions.list(
		{ customer: customerId, limit: 1 },
		connectedAccount,
	);
	return list.data[0]?.id ?? null;
}

// NOTE: `pause_collection` does NOT change a Stripe subscription's `status`
// field — Stripe leaves it "active" and just voids/marks-uncollectible the
// invoices it generates. So the webhook fires `customer.subscription.updated`
// here, not a special paused/resumed event, and there's nothing to key
// gating off of in `status`. We write `subscription.pausedCollection` and
// drop `tier` to `free` here directly (rather than only waiting on webhook
// delivery) so the UI reflects it immediately; the webhook's
// `syncSubscriptionToFirestore` reconciles the same fields from `sub.pause_collection`
// after the fact.

// POST — pause billing collection. No charge is made while paused; billing
// resumes once un-paused.
export const POST: RequestHandler = async ({ request }) => {
	try {
		const uid = await verifyIdToken(request.headers.get('authorization'));
		if (!uid) return json({ error: 'Unauthorized' }, { status: 401 });

		const subId = await getSubId(uid);
		if (!subId) return json({ error: 'No active subscription found.' }, { status: 404 });

		await stripe.subscriptions.update(
			subId,
			{ pause_collection: { behavior: 'void' } },
			connectedAccount,
		);

		await getAdminDb().doc(`users/${uid}`).set({
			tier: 'free',
			subscription: { pausedCollection: true },
			updatedAt: FieldValue.serverTimestamp(),
		}, { merge: true });

		return json({ ok: true });

	} catch (err) {
		if (err instanceof Stripe.errors.StripeError) {
			return json({ error: err.message }, { status: err.statusCode ?? 500 });
		}
		console.error('[pause]', err);
		return json({ error: 'Could not pause subscription.' }, { status: 500 });
	}
};

// DELETE — resume a paused subscription.
export const DELETE: RequestHandler = async ({ request }) => {
	try {
		const uid = await verifyIdToken(request.headers.get('authorization'));
		if (!uid) return json({ error: 'Unauthorized' }, { status: 401 });

		const subId = await getSubId(uid);
		if (!subId) return json({ error: 'No subscription found.' }, { status: 404 });

		const sub = await stripe.subscriptions.update(
			subId,
			{ pause_collection: null },
			connectedAccount,
		);

		const tier = sub.metadata?.tier;
		await getAdminDb().doc(`users/${uid}`).set({
			...(tier ? { tier } : {}),
			subscription: { pausedCollection: false },
			updatedAt: FieldValue.serverTimestamp(),
		}, { merge: true });

		return json({ ok: true });

	} catch (err) {
		if (err instanceof Stripe.errors.StripeError) {
			return json({ error: err.message }, { status: err.statusCode ?? 500 });
		}
		console.error('[resume-pause]', err);
		return json({ error: 'Could not resume subscription.' }, { status: 500 });
	}
};
