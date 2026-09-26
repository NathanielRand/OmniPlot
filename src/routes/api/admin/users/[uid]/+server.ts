import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { isReconstructed, jobPieces, jobStatus, jobSubjects, toDate } from '$lib/server/cut-stats';
import { monthKey, usageInWindow } from '$lib/cuts';

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
		const subjectOf = await jobSubjects(jobsSnap.docs.map((d) => d.data()));
		recentJobs = jobsSnap.docs.map((doc) => {
			const j = doc.data();
			const { total, done } = jobPieces(j);
			return {
				id:         doc.id,
				name:       subjectOf(j),
				status:     jobStatus(j),
				pieces:     total,
				piecesDone: done,
				reconstructed: isReconstructed(j),
				connection: j.plotterConfig?.connection ?? 'unknown',
				createdAt:  j.createdAt?.toDate?.()?.toISOString() ?? null,
			};
		});
	} catch (err) { console.error('[admin/users/uid] jobs:', err); }

	// Counts in the CURRENT windows — the raw monthlyCount/dailyCount keep
	// last period's number until the next cut starts a new window.
	const window = usageInWindow({
		monthlyCount: d.usage?.monthlyCount, monthResetAt: toDate(d.usage?.monthResetAt),
		dailyCount: d.usage?.dailyCount, dayResetAt: toDate(d.usage?.dayResetAt),
	});

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

	// Size of their pattern library — the list itself loads on demand
	// (GET /api/admin/user-patterns, audited) so opening the drawer doesn't.
	let patternCount = 0;
	try {
		patternCount = (await db.collection('userPatterns').where('ownerId', '==', params.uid).count().get()).data().count;
	} catch (err) { console.error('[admin/users/uid] patternCount:', err); }

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
			monthlyCount: window.month,
			dailyCount:   window.day,
			/** Calendar month (UTC) — only tracked from Sep 2026 on. */
			thisMonth:    d.usage?.byMonth?.[monthKey(new Date())] ?? null,
			lastCutAt:    d.usage?.lastCutAt?.toDate?.()?.toISOString()    ?? null,
			monthResetAt: window.monthResetAt?.toISOString() ?? null,
		},
		subscription: {
			status:               d.subscription?.status               ?? null,
			pausedCollection:     d.subscription?.pausedCollection     ?? false,
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
		lastActiveAt: (d.lastActiveAt ?? d.updatedAt)?.toDate?.()?.toISOString() ?? null,
		shop,
		recentJobs,
		recentTransactions,
		patternCount,
	});
};
