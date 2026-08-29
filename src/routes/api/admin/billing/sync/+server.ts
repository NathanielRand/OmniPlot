import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { attributeUid, chargeToRow, syncSubscriptionToFirestore, upsertTransaction } from '$lib/server/stripe-ledger';

async function assertAdmin(authHeader: string | null): Promise<boolean> {
	const uid = await verifyIdToken(authHeader);
	if (!uid) return false;
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.data()?.tier === 'admin';
}

// One-time (re-runnable) backfill for charges AND subscriptions that predate
// the ledger/webhook, e.g. Connor's — the webhook is forward-only, and a
// charge landing in the ledger doesn't imply the subscription it belongs to
// ever got written to the user's doc (that only happens via
// `checkout.session.completed` / `customer.subscription.*`, which never
// fired while the endpoint was misconfigured). Both passes are idempotent:
// keyed by charge id / by `sub.metadata.uid`, safe to re-run.
export const POST: RequestHandler = async ({ request }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	let chargesSynced = 0;
	let startingAfter: string | undefined;

	do {
		const page = await stripe.charges.list(
			{ limit: 100, starting_after: startingAfter },
			connectedAccount,
		);

		for (const charge of page.data) {
			const uid = await attributeUid(charge);
			await upsertTransaction(chargeToRow(charge, uid));
			chargesSynced++;
		}

		startingAfter = page.has_more ? page.data[page.data.length - 1]?.id : undefined;
	} while (startingAfter);

	let subsSynced = 0;
	let subsSkipped = 0;
	startingAfter = undefined;

	do {
		const page = await stripe.subscriptions.list(
			{ limit: 100, status: 'all', starting_after: startingAfter },
			connectedAccount,
		);

		for (const sub of page.data) {
			const applied = await syncSubscriptionToFirestore(sub);
			applied ? subsSynced++ : subsSkipped++;
		}

		startingAfter = page.has_more ? page.data[page.data.length - 1]?.id : undefined;
	} while (startingAfter);

	return json({ chargesSynced, subsSynced, subsSkipped });
};
