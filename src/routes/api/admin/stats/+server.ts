import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminAuth, getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { isReconstructed, jobPieces, jobStatus, jobSubjects } from '$lib/server/cut-stats';

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
	const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

	// ── Users ────────────────────────────────────
	// Every user doc — a capped query lets the tier counts drift once the
	// platform outgrows the cap.
	const usersSnap = await db.collection('users').orderBy('createdAt', 'desc').get();

	const KNOWN_USER_TIERS = new Set(['free', 'lite', 'pro', 'admin']);
	const byTier: Record<string, number> = { free: 0, lite: 0, pro: 0, admin: 0 };
	let shopMemberCount = 0;

	for (const doc of usersSnap.docs) {
		const d    = doc.data();
		const tier = d.tier ?? 'free';
		const key  = KNOWN_USER_TIERS.has(tier) ? tier : 'other';
		byTier[key] = (byTier[key] ?? 0) + 1;
		if (d.shopId) shopMemberCount++;
	}

	// Activity comes from Firebase Auth, not the user doc's updatedAt — that
	// only moves on profile edits, admin patches and billing writes. The ID
	// token refreshes hourly while the app is open, so lastRefreshTime is a
	// real "used the app" signal.
	let activeToday = 0;
	try {
		let pageToken: string | undefined;
		do {
			const page = await getAdminAuth().listUsers(1000, pageToken);
			for (const u of page.users) {
				const last = u.metadata.lastRefreshTime ?? u.metadata.lastSignInTime;
				if (last && new Date(last) >= oneDayAgo) activeToday++;
			}
			pageToken = page.pageToken;
		} while (pageToken);
	} catch (err) {
		console.error('[admin/stats] listUsers failed:', err);
	}

	// ── Shops ─────────────────────────────────────
	// A shop's `plan` is set to starter at creation whether or not it ever
	// subscribes, so only shops with a live subscription count toward a plan.
	const PAID_SHOP_STATUSES = new Set(['active', 'trialing', 'past_due']);
	const KNOWN_SHOP_PLANS = new Set(['starter', 'team', 'studio']);
	const byShopPlan: Record<string, number> = { starter: 0, team: 0, studio: 0 };
	let totalShops  = 0;
	let unpaidShops = 0;

	try {
		const shopsSnap = await db.collection('shops').get();
		totalShops = shopsSnap.size;
		for (const doc of shopsSnap.docs) {
			const d = doc.data();
			if (!PAID_SHOP_STATUSES.has(d.subscriptionStatus)) { unpaidShops++; continue; }
			const plan = d.plan ?? 'starter';
			const key  = KNOWN_SHOP_PLANS.has(plan) ? plan : 'other';
			byShopPlan[key] = (byShopPlan[key] ?? 0) + 1;
		}
	} catch {
		// shops collection may not exist yet
	}

	// ── Plotters ──────────────────────────────────
	let totalPlotters = 0;
	try {
		const plottersSnap = await db.collection('plotters').get();
		totalPlotters = plottersSnap.size;
	} catch {
		// plotters collection may not exist yet
	}

	// ── Agent downloads ───────────────────────────
	let agentDownloads = 0;
	try {
		const counterSnap = await db.doc('counters/agent_downloads').get();
		agentDownloads = counterSnap.data()?.count ?? 0;
	} catch {
		// counter document may not exist yet
	}

	const recentSignups = usersSnap.docs.slice(0, 5).map((doc) => {
		const d = doc.data();
		return {
			uid:         doc.id,
			displayName: d.displayName ?? '',
			email:       d.email ?? '',
			tier:        d.tier ?? 'free',
			createdAt:   d.createdAt?.toDate?.()?.toISOString() ?? null,
		};
	});

	// ── Jobs ─────────────────────────────────────
	// "Cuts" = completed cuts (see $lib/server/cut-stats). The all-time total
	// is the per-user counters, which survive users clearing their history.
	let recentJobs:  object[] = [];
	let cutsToday    = 0;
	let cutsTotal    = 0;
	for (const doc of usersSnap.docs) cutsTotal += Number(doc.data().usage?.cutCount ?? 0) || 0;

	try {
		const [jobsSnap, countSnap] = await Promise.all([
			db.collection('jobs').orderBy('createdAt', 'desc').limit(10).get(),
			// Only completed jobs have a completedAt, so this is completed cuts
			// in the last 24h — not every job started (failed/cancelled included).
			db.collection('jobs').where('completedAt', '>=', oneDayAgo).count().get(),
		]);
		cutsToday = countSnap.data().count;

		const userMap = new Map(usersSnap.docs.map((d) => {
			const u = d.data();
			return [d.id, u.displayName || u.email || u.phone || d.id] as const;
		}));
		const subjectOf = await jobSubjects(jobsSnap.docs.map((d) => d.data()));

		recentJobs = jobsSnap.docs.map((doc) => {
			const d = doc.data();
			const { total, done } = jobPieces(d);
			return {
				id:                 doc.id,
				userId:             d.userId ?? '',
				userLabel:          userMap.get(d.userId) ?? d.userId ?? '',
				vehicleName:        subjectOf(d),
				status:             jobStatus(d),
				pieces:             total,
				patternsCompleted:  done,
				reconstructed:      isReconstructed(d),
				connection:         d.plotterConfig?.connection ?? 'unknown',
				presetName:         d.plotterConfig?.name ?? '',
				createdAt:          d.createdAt?.toDate?.()?.toISOString() ?? null,
			};
		});
	} catch (err) {
		console.error('[admin/stats] jobs:', err);
	}

	return json({
		users: {
			total:           usersSnap.size,
			byTier,
			activeToday,
			shopMemberCount,
			recentSignups,
		},
		shops: {
			total:      totalShops,
			byShopPlan,
			unpaid:     unpaidShops,
		},
		plotters: {
			total: totalPlotters,
		},
		agent: {
			downloads: agentDownloads,
		},
		jobs: {
			today:  cutsToday,
			total:  cutsTotal,
			recent: recentJobs,
		},
	});
};
