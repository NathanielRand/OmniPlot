import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';

async function assertAdmin(authHeader: string | null): Promise<boolean> {
	const uid = await verifyIdToken(authHeader);
	if (!uid) return false;
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.data()?.tier === 'admin';
}

// POST /api/admin/billing/refund — refund a charge (full or partial, in cents).
// Does not touch the `transactions` ledger directly: the resulting
// `charge.refunded` event lands on the webhook and updates it there, so the
// ledger only ever reflects what Stripe actually did, not what this route
// intended to do.
export const POST: RequestHandler = async ({ request }) => {
	try {
		if (!await assertAdmin(request.headers.get('authorization'))) {
			return json({ error: 'Forbidden' }, { status: 403 });
		}

		const { chargeId, amount } = await request.json() as { chargeId?: string; amount?: number };
		if (!chargeId) return json({ error: 'chargeId required' }, { status: 400 });

		const refund = await stripe.refunds.create(
			{ charge: chargeId, ...(amount ? { amount } : {}) },
			connectedAccount,
		);

		return json({ ok: true, refundId: refund.id, status: refund.status });

	} catch (err) {
		if (err instanceof Stripe.errors.StripeError) {
			console.error('[admin/billing/refund] Stripe error:', err.type, err.message);
			return json({ error: err.message }, { status: err.statusCode ?? 500 });
		}
		console.error('[admin/billing/refund] Unexpected error:', err);
		return json({ error: 'Unexpected server error.' }, { status: 500 });
	}
};
