import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';

async function assertAdmin(authHeader: string | null): Promise<boolean> {
	const uid = await verifyIdToken(authHeader);
	if (!uid) return false;
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.data()?.tier === 'admin';
}

export const GET: RequestHandler = async ({ request, params }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}

	const db   = getAdminDb();
	const snap = await db.doc(`users/${params.uid}`).get();
	if (!snap.exists) {
		return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
	}

	const d = snap.data()!;

	// Fetch shop document if user belongs to one
	let shop = null;
	if (d.shopId) {
		try {
			const shopSnap = await db.doc(`shops/${d.shopId}`).get();
			if (shopSnap.exists) {
				const s = shopSnap.data()!;
				shop = {
					id:                 shopSnap.id,
					name:               s.name               ?? '',
					plan:               s.plan               ?? 'starter',
					seats:              s.seats              ?? 1,
					ownerId:            s.ownerId            ?? '',
					subscriptionStatus: s.subscriptionStatus ?? null,
					currentPeriodEnd:   s.currentPeriodEnd?.toDate?.()?.toISOString() ?? null,
					createdAt:          s.createdAt?.toDate?.()?.toISOString()        ?? null,
				};
			}
		} catch { /* shops collection may not exist */ }
	}

	// Fetch recent jobs for this user (best-effort — may need composite index)
	let recentJobs: object[] = [];
	try {
		const jobsSnap = await db.collection('jobs')
			.where('userId', '==', params.uid)
			.orderBy('createdAt', 'desc')
			.limit(5)
			.get();
		recentJobs = jobsSnap.docs.map((doc) => {
			const j = doc.data();
			return {
				id:         doc.id,
				name:       j.name                     ?? 'Unknown',
				status:     j.status                   ?? 'complete',
				pieces:     j.metrics?.itemCount       ?? 0,
				connection: j.plotterConfig?.connection ?? 'unknown',
				createdAt:  j.createdAt?.toDate?.()?.toISOString() ?? null,
			};
		});
	} catch { /* index may not exist yet — return empty */ }

	// Financial history for this user (needs the transactions/uid+created index)
	let recentTransactions: object[] = [];
	try {
		const txSnap = await db.collection('transactions')
			.where('uid', '==', params.uid)
			.orderBy('created', 'desc')
			.limit(20)
			.get();
		recentTransactions = txSnap.docs.map((doc) => {
			const t = doc.data();
			return {
				id:             doc.id,
				amount:         t.amount         ?? 0,
				amountRefunded: t.amountRefunded ?? 0,
				currency:       t.currency       ?? 'usd',
				status:         t.status         ?? 'succeeded',
				description:    t.description    ?? null,
				created:        t.created?.toDate?.()?.toISOString() ?? null,
			};
		});
	} catch { /* transactions collection or index may not exist yet */ }

	return json({
		uid:             params.uid,
		displayName:     d.displayName  ?? '',
		email:           d.email        ?? '',
		phone:           d.phone        ?? null,
		photoURL:        d.photoURL     ?? null,
		tier:            d.tier         ?? 'free',
		status:          d.status       ?? 'active',
		shopId:          d.shopId       ?? null,
		shopName:        d.shopName     ?? null,
		shopRole:        d.shopRole     ?? null,
		activeSessionId: d.activeSessionId ?? null,
		usage: {
			cutCount:     d.usage?.cutCount      ?? 0,
			monthlyCount: d.usage?.monthlyCount  ?? 0,
			lastCutAt:    d.usage?.lastCutAt?.toDate?.()?.toISOString()    ?? null,
			monthResetAt: d.usage?.monthResetAt?.toDate?.()?.toISOString() ?? null,
		},
		subscription: {
			status:               d.subscription?.status               ?? null,
			stripeCustomerId:     d.subscription?.stripeCustomerId     ?? null,
			stripeSubscriptionId: d.subscription?.stripeSubscriptionId ?? null,
			currentPeriodEnd:     d.subscription?.currentPeriodEnd?.toDate?.()?.toISOString() ?? null,
			trialEnd:             d.subscription?.trialEnd?.toDate?.()?.toISOString()         ?? null,
			cancelAtPeriodEnd:    d.subscription?.cancelAtPeriodEnd ?? false,
		},
		preferences: {
			theme:          d.preferences?.theme          ?? 'dark',
			units:          d.preferences?.units          ?? 'inches',
			autoNest:       d.preferences?.autoNest       ?? false,
			defaultPlotter: d.preferences?.defaultPlotter ?? null,
		},
		createdAt:    d.createdAt?.toDate?.()?.toISOString()  ?? null,
		lastActiveAt: d.updatedAt?.toDate?.()?.toISOString()  ?? null,
		shop,
		recentJobs,
		recentTransactions,
	});
};
