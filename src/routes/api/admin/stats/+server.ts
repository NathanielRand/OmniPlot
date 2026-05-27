import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
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
	const now = new Date();
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const oneDayAgo  = new Date(now.getTime() - 24 * 60 * 60 * 1000);

	// ── Users ────────────────────────────────────
	const usersSnap = await db.collection('users').orderBy('createdAt', 'desc').limit(500).get();

	const KNOWN_USER_TIERS = new Set(['free', 'lite', 'pro', 'admin']);
	const byTier: Record<string, number> = { free: 0, lite: 0, pro: 0, admin: 0 };
	let activeToday = 0;

	for (const doc of usersSnap.docs) {
		const d    = doc.data();
		const tier = d.tier ?? 'free';
		const key  = KNOWN_USER_TIERS.has(tier) ? tier : 'other';
		byTier[key] = (byTier[key] ?? 0) + 1;
		const lastActive: Date | null = d.updatedAt?.toDate?.() ?? null;
		if (lastActive && lastActive >= oneDayAgo) activeToday++;
	}

	// ── Shops ─────────────────────────────────────
	const KNOWN_SHOP_PLANS = new Set(['starter', 'team', 'studio']);
	const byShopPlan: Record<string, number> = { starter: 0, team: 0, studio: 0 };
	let totalShops = 0;

	try {
		const shopsSnap = await db.collection('shops').get();
		totalShops = shopsSnap.size;
		for (const doc of shopsSnap.docs) {
			const plan = doc.data().plan ?? 'starter';
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
	let recentJobs:  object[] = [];
	let cutsToday    = 0;

	try {
		const jobsSnap = await db.collection('jobs').orderBy('createdAt', 'desc').limit(10).get();

		// Collect unique userIds to batch-fetch display names
		const userIds = [...new Set(jobsSnap.docs.map((d) => d.data().userId).filter(Boolean))];
		const userMap: Record<string, string> = {};
		await Promise.all(
			userIds.slice(0, 10).map(async (uid) => {
				const snap = await db.doc(`users/${uid}`).get();
				userMap[uid] = snap.data()?.email ?? uid;
			}),
		);

		recentJobs = jobsSnap.docs.map((doc) => {
			const d = doc.data();
			const itemCount         = d.metrics?.itemCount ?? 0;
			const patternsCompleted = d.metrics?.patternsCompleted ?? itemCount;
			return {
				id:                 doc.id,
				userId:             d.userId ?? '',
				userEmail:          userMap[d.userId] ?? d.userId ?? '',
				vehicleName:        d.name ?? 'Unknown',
				status:             d.status ?? 'complete',
				pieces:             itemCount,
				patternsCompleted,
				connection:         d.plotterConfig?.connection ?? 'unknown',
				presetName:         d.plotterConfig?.name ?? '',
				createdAt:          d.createdAt?.toDate?.()?.toISOString() ?? null,
			};
		});

		// Count today's cuts from the slice we have (jobs are ordered desc so filter)
		cutsToday = jobsSnap.docs.filter((doc) => {
			const ts: Date | null = doc.data().createdAt?.toDate?.() ?? null;
			return ts && ts >= todayStart;
		}).length;
	} catch {
		// jobs collection doesn't exist yet
	}

	return json({
		users: {
			total:         usersSnap.size,
			byTier,
			activeToday,
			recentSignups,
		},
		shops: {
			total:      totalShops,
			byShopPlan,
		},
		plotters: {
			total: totalPlotters,
		},
		agent: {
			downloads: agentDownloads,
		},
		jobs: {
			today:  cutsToday,
			recent: recentJobs,
		},
	});
};
