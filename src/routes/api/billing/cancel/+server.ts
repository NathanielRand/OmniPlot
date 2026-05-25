import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { sendCancellationEmail } from '$lib/server/email';

async function getSubId(uid: string): Promise<string | null> {
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	const data = snap.data() ?? {};

	// Prefer the stored subscription ID
	const stored: string = data.subscription?.stripeSubscriptionId ?? '';
	if (stored) return stored;

	// Fallback: look it up from the customer (handles users who subscribed before
	// stripeSubscriptionId was stored)
	const customerId: string = data.subscription?.stripeCustomerId ?? '';
	if (!customerId) return null;

	const list = await stripe.subscriptions.list(
		{ customer: customerId, limit: 1 },
		connectedAccount,
	);
	return list.data[0]?.id ?? null;
}

// POST — cancel at period end
export const POST: RequestHandler = async ({ request }) => {
	try {
		const uid = await verifyIdToken(request.headers.get('authorization'));
		if (!uid) return json({ error: 'Unauthorized' }, { status: 401 });

		const subId = await getSubId(uid);
		if (!subId) return json({ error: 'No active subscription found.' }, { status: 404 });

		await stripe.subscriptions.update(
			subId,
			{ cancel_at_period_end: true },
			connectedAccount,
		);

		await getAdminDb().doc(`users/${uid}`).update({
			'subscription.cancelAtPeriodEnd': true,
		});

		// Send cancellation email (non-fatal)
		try {
			const userData = (await getAdminDb().doc(`users/${uid}`).get()).data() ?? {};
			const accessUntil = userData.subscription?.currentPeriodEnd instanceof Date
				? userData.subscription.currentPeriodEnd
				: new Date(userData.subscription?.currentPeriodEnd?.toDate?.() ?? Date.now());
			await sendCancellationEmail(
				userData.email ?? '',
				userData.displayName ?? '',
				'your plan',
				accessUntil,
			);
		} catch { /* non-fatal */ }

		return json({ ok: true });

	} catch (err) {
		if (err instanceof Stripe.errors.StripeError) {
			return json({ error: err.message }, { status: err.statusCode ?? 500 });
		}
		console.error('[cancel]', err);
		return json({ error: 'Could not cancel subscription.' }, { status: 500 });
	}
};

// DELETE — reactivate (undo cancel_at_period_end)
export const DELETE: RequestHandler = async ({ request }) => {
	try {
		const uid = await verifyIdToken(request.headers.get('authorization'));
		if (!uid) return json({ error: 'Unauthorized' }, { status: 401 });

		const subId = await getSubId(uid);
		if (!subId) return json({ error: 'No subscription found.' }, { status: 404 });

		await stripe.subscriptions.update(
			subId,
			{ cancel_at_period_end: false },
			connectedAccount,
		);

		await getAdminDb().doc(`users/${uid}`).update({
			'subscription.cancelAtPeriodEnd': false,
		});

		return json({ ok: true });

	} catch (err) {
		if (err instanceof Stripe.errors.StripeError) {
			return json({ error: err.message }, { status: err.statusCode ?? 500 });
		}
		console.error('[reactivate]', err);
		return json({ error: 'Could not reactivate subscription.' }, { status: 500 });
	}
};
