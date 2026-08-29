import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { sendCancellationEmail } from '$lib/server/email';

type Action = 'cancel_at_period_end' | 'cancel_now' | 'resume';

async function assertAdmin(authHeader: string | null): Promise<boolean> {
	const uid = await verifyIdToken(authHeader);
	if (!uid) return false;
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.data()?.tier === 'admin';
}

async function resolveSubId(uid: string): Promise<string | null> {
	const db   = getAdminDb();
	const snap = await db.doc(`users/${uid}`).get();
	const data = snap.data() ?? {};

	const stored: string = data.subscription?.stripeSubscriptionId ?? '';
	if (stored) return stored;

	const customerId: string = data.subscription?.stripeCustomerId ?? '';
	if (!customerId) return null;

	const list = await stripe.subscriptions.list({ customer: customerId, limit: 1 }, connectedAccount);
	return list.data[0]?.id ?? null;
}

// POST /api/admin/billing/subscription — admin-triggered subscription actions
// on any user's subscription (cancel at period end, cancel now, resume a
// pending cancellation). Firestore state is left to the webhook's
// `customer.subscription.updated/deleted` handler to reconcile — this route
// just calls Stripe and lets the single source of truth catch up.
export const POST: RequestHandler = async ({ request }) => {
	try {
		if (!await assertAdmin(request.headers.get('authorization'))) {
			return json({ error: 'Forbidden' }, { status: 403 });
		}

		const { uid, action } = await request.json() as { uid?: string; action?: Action };
		if (!uid || !action) return json({ error: 'uid and action required' }, { status: 400 });

		const subId = await resolveSubId(uid);
		if (!subId) return json({ error: 'No Stripe subscription found for this user.' }, { status: 404 });

		// `.set(..., {merge:true})` doesn't parse dotted string keys as nested
		// paths (that's `.update()` only) — every write below nests for real.
		if (action === 'cancel_at_period_end') {
			await stripe.subscriptions.update(subId, { cancel_at_period_end: true }, connectedAccount);
			await getAdminDb().doc(`users/${uid}`).set(
				{ subscription: { cancelAtPeriodEnd: true }, updatedAt: FieldValue.serverTimestamp() },
				{ merge: true },
			);

			try {
				const userData = (await getAdminDb().doc(`users/${uid}`).get()).data() ?? {};
				const accessUntil = userData.subscription?.currentPeriodEnd?.toDate?.() ?? new Date();
				await sendCancellationEmail(userData.email ?? '', userData.displayName ?? '', 'your plan', accessUntil);
			} catch { /* non-fatal */ }

		} else if (action === 'cancel_now') {
			await stripe.subscriptions.cancel(subId, {}, connectedAccount);
			await getAdminDb().doc(`users/${uid}`).set(
				{
					tier: 'free',
					subscription: { status: 'canceled', cancelAtPeriodEnd: false, currentPeriodEnd: null },
					updatedAt: FieldValue.serverTimestamp(),
				},
				{ merge: true },
			);

		} else if (action === 'resume') {
			await stripe.subscriptions.update(subId, { cancel_at_period_end: false }, connectedAccount);
			await getAdminDb().doc(`users/${uid}`).set(
				{ subscription: { cancelAtPeriodEnd: false }, updatedAt: FieldValue.serverTimestamp() },
				{ merge: true },
			);

		} else {
			return json({ error: `Unknown action: ${action}` }, { status: 400 });
		}

		return json({ ok: true, subscriptionId: subId });

	} catch (err) {
		if (err instanceof Stripe.errors.StripeError) {
			console.error('[admin/billing/subscription] Stripe error:', err.type, err.message);
			return json({ error: err.message }, { status: err.statusCode ?? 500 });
		}
		console.error('[admin/billing/subscription] Unexpected error:', err);
		return json({ error: 'Unexpected server error.' }, { status: 500 });
	}
};
