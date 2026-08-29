import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';

async function assertAdmin(authHeader: string | null): Promise<boolean> {
	const uid = await verifyIdToken(authHeader);
	if (!uid) return false;
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.data()?.tier === 'admin';
}

export const GET: RequestHandler = async ({ request }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}

	const db = getAdminDb();

	// ── Firebase usage ────────────────────────────────────────────────────────
	const [usersSnap, jobsSnap, shopsSnap, patternsSnap] = await Promise.allSettled([
		db.collection('users').count().get(),
		db.collection('jobs').count().get(),
		db.collection('shops').count().get(),
		db.collection('patterns').count().get(),
	]);

	const firebaseUsage = {
		authUsers:     usersSnap.status     === 'fulfilled' ? (usersSnap.value.data().count     ?? 0) : null,
		firestoreJobs: jobsSnap.status      === 'fulfilled' ? (jobsSnap.value.data().count      ?? 0) : null,
		firestoreShops: shopsSnap.status    === 'fulfilled' ? (shopsSnap.value.data().count     ?? 0) : null,
		firestorePatterns: patternsSnap.status === 'fulfilled' ? (patternsSnap.value.data().count ?? 0) : null,
	};

	// ── Stripe platform ───────────────────────────────────────────────────────
	let stripeBalance: {
		available: { amount: number; currency: string }[];
		pending:   { amount: number; currency: string }[];
	} | null = null;

	let recentFees: {
		id: string;
		amount: number;
		fee: number;
		currency: string;
		created: number;
		description: string | null;
	}[] = [];

	try {
		const [balance, charges] = await Promise.all([
			stripe.balance.retrieve({}, connectedAccount),
			stripe.charges.list({ limit: 10 }, connectedAccount),
		]);

		stripeBalance = {
			available: balance.available.map(b => ({ amount: b.amount, currency: b.currency })),
			pending:   balance.pending.map(b   => ({ amount: b.amount, currency: b.currency })),
		};

		recentFees = charges.data.map(c => ({
			id:          c.id,
			amount:      c.amount,
			fee:         c.application_fee_amount ?? 0,
			currency:    c.currency,
			created:     c.created,
			description: c.description,
		}));
	} catch (err) {
		// Non-fatal — Stripe section degrades gracefully
		console.error('[admin/billing] Stripe balance/charges fetch failed:', err);
	}

	// ── Revenue ledger (Firestore, populated by the webhook + backfill sync) ───
	let revenue: {
		totalSucceeded: number;
		totalRefunded:  number;
		totalDisputed:  number;
		unattributed:   number;
		byCurrency:     Record<string, number>;
	} = { totalSucceeded: 0, totalRefunded: 0, totalDisputed: 0, unattributed: 0, byCurrency: {} };

	let recentTransactions: {
		id: string; uid: string | null; email: string | null;
		amount: number; amountRefunded: number; currency: string;
		status: string; description: string | null; created: number;
	}[] = [];

	try {
		const txSnap = await db.collection('transactions')
			.orderBy('created', 'desc')
			.limit(200)
			.get();

		for (const doc of txSnap.docs) {
			const t = doc.data();
			if (t.status === 'succeeded' || t.status === 'refunded') {
				revenue.totalSucceeded += t.amount ?? 0;
				revenue.byCurrency[t.currency] = (revenue.byCurrency[t.currency] ?? 0) + (t.amount ?? 0);
			}
			if (t.status === 'refunded')  revenue.totalRefunded += t.amountRefunded ?? 0;
			if (t.status === 'disputed')  revenue.totalDisputed += t.disputeAmount  ?? 0;
			if (!t.uid) revenue.unattributed++;
		}

		recentTransactions = txSnap.docs.slice(0, 50).map(doc => {
			const t = doc.data();
			return {
				id:             doc.id,
				uid:            t.uid ?? null,
				email:          t.email ?? null,
				amount:         t.amount ?? 0,
				amountRefunded: t.amountRefunded ?? 0,
				currency:       t.currency ?? 'usd',
				status:         t.status ?? 'succeeded',
				description:    t.description ?? null,
				created:        t.created?.toDate ? Math.floor(t.created.toDate().getTime() / 1000) : Math.floor(Date.now() / 1000),
			};
		});
	} catch {
		// transactions collection may not exist yet (before first webhook delivery / sync)
	}

	return json({ firebaseUsage, stripeBalance, recentFees, revenue, recentTransactions });
};
