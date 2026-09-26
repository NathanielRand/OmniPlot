import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { cutTotalsByDay, isReconstructed, jobPieces, jobStatus, jobSubjects } from '$lib/server/cut-stats';

type Range = '7d' | '30d' | '90d' | 'ytd';
const RANGES: Range[] = ['7d', '30d', '90d', 'ytd'];

async function assertAdmin(authHeader: string | null): Promise<boolean> {
	const uid = await verifyIdToken(authHeader);
	if (!uid) return false;
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.data()?.tier === 'admin';
}

/** Start of the range, as midnight UTC. */
function rangeStart(range: Range): Date {
	const now = new Date();
	if (range === 'ytd') return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
	const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
}

function toDate(v: unknown): Date | null {
	if (v instanceof Timestamp) return v.toDate();
	if (v instanceof Date) return v;
	return null;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

// GET /api/admin/analytics?range=30d — usage metrics for Admin → Analytics.
// Reads users and in-range jobs directly; revenue/MRR comes from
// /api/admin/revenue, which is reconciled against Stripe.
export const GET: RequestHandler = async ({ request, url }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const range = (RANGES as string[]).includes(url.searchParams.get('range') ?? '')
		? (url.searchParams.get('range') as Range)
		: '30d';
	const start = rangeStart(range);
	const db = getAdminDb();

	try {
		const [usersSnap, shopsSnap, jobsSnap] = await Promise.all([
			db.collection('users').select('tier', 'createdAt', 'lastActiveAt', 'updatedAt', 'shopId', 'displayName', 'email').get(),
			db.collection('shops').select('plan').get(),
			db.collection('jobs')
				.where('createdAt', '>=', Timestamp.fromDate(start))
				.select('userId', 'vehicleId', 'vehicle', 'subject', 'name', 'status', 'metrics.itemCount', 'metrics.patternsCompleted', 'createdAt', 'updatedAt', 'completedAt')
				.get(),
		]);

		// ── Daily buckets for the whole range, oldest → newest ──
		const days = new Map<string, { date: string; signups: number; jobs: number; pieces: number }>();
		for (let d = new Date(start); d <= new Date(); d.setUTCDate(d.getUTCDate() + 1)) {
			const k = dayKey(d);
			days.set(k, { date: k, signups: 0, jobs: 0, pieces: 0 });
		}

		// ── Users ──
		const byTier: Record<string, number> = {};
		const names = new Map<string, string>();
		let shopMembers = 0, newUsers = 0, activeUsers = 0;
		for (const doc of usersSnap.docs) {
			const u = doc.data();
			const tier = u.tier ?? 'free';
			byTier[tier] = (byTier[tier] ?? 0) + 1;
			if (u.shopId) shopMembers++;
			names.set(doc.id, u.displayName || u.email || doc.id.slice(0, 8));

			const created = toDate(u.createdAt);
			if (created && created >= start) {
				newUsers++;
				const b = days.get(dayKey(created));
				if (b) b.signups++;
			}
			// lastActiveAt is stamped per browser session; older accounts only have updatedAt.
			const active = toDate(u.lastActiveAt) ?? toDate(u.updatedAt);
			if (active && active >= start) activeUsers++;
		}

		// ── Shops ──
		const byShopPlan: Record<string, number> = {};
		for (const doc of shopsSnap.docs) {
			const plan = doc.data().plan ?? 'other';
			byShopPlan[plan] = (byShopPlan[plan] ?? 0) + 1;
		}

		// ── Jobs ──
		// "Jobs" in the response = COMPLETED cuts (the series, the KPI and top
		// subjects). Failed/interrupted and cancelled runs are counted apart.
		const jobDocs = jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as FirebaseFirestore.DocumentData & { id: string });
		const [totals, subjectOf] = await Promise.all([cutTotalsByDay(start, jobDocs), jobSubjects(jobDocs)]);
		let jobs = 0, pieces = 0, failed = 0, cancelled = 0;
		for (const t of totals.values()) {
			const b = days.get(t.date);
			if (b) { b.jobs = t.cuts; b.pieces = t.pieces; }
			jobs += t.cuts; pieces += t.pieces; failed += t.failed; cancelled += t.cancelled;
		}

		const subjects = new Map<string, { label: string; jobs: number; pieces: number }>();
		const cutters = new Set<string>();
		const recent: { id: string; user: string; subject: string; status: string; pieces: number; reconstructed: boolean; createdAt: string | null }[] = [];
		for (const j of jobDocs) {
			const status = jobStatus(j);
			const label = subjectOf(j);
			const { total, done } = jobPieces(j);
			if (status === 'complete' && j.userId) cutters.add(j.userId);
			// A reconstructed cut is real, but we don't know what was cut.
			if (status === 'complete' && !isReconstructed(j)) {
				const key = j.vehicleId || label;
				const s = subjects.get(key) ?? { label, jobs: 0, pieces: 0 };
				s.jobs++;
				s.pieces += total;
				subjects.set(key, s);
			}
			recent.push({
				id: j.id,
				user: names.get(j.userId) ?? (j.userId ? String(j.userId).slice(0, 8) : '—'),
				subject: label,
				status,
				pieces: status === 'complete' ? total : done,
				reconstructed: isReconstructed(j),
				createdAt: toDate(j.createdAt)?.toISOString() ?? null,
			});
		}
		recent.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

		return json({
			range,
			start: start.toISOString(),
			users: { total: usersSnap.size, byTier, shopMembers, newUsers, activeUsers },
			shops: { total: shopsSnap.size, byShopPlan },
			jobs: { total: jobs, pieces, failed, cancelled, cutters: cutters.size },
			series: [...days.values()],
			topSubjects: [...subjects.values()].sort((a, b) => b.jobs - a.jobs || b.pieces - a.pieces).slice(0, 8),
			recentJobs: recent.slice(0, 10),
		});
	} catch (err) {
		console.error('[admin/analytics GET]', err);
		return json({ error: 'Could not load analytics.' }, { status: 500 });
	}
};
