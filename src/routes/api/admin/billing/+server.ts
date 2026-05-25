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
			stripe.balance.retrieve(connectedAccount),
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
	} catch {
		// Non-fatal — Stripe section degrades gracefully
	}

	return json({ firebaseUsage, stripeBalance, recentFees });
};
