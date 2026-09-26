import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CRON_SECRET } from '$env/static/private';
import { getAdminDb } from '$lib/server/firebase-admin';
import { sendMonthlyReportEmail } from '$lib/server/email';
import { monthKey } from '$lib/cuts';

const BATCH_SIZE = 10;

function chunkArray<T>(arr: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < arr.length; i += size) {
		chunks.push(arr.slice(i, i + size));
	}
	return chunks;
}

function getMonthLabel(): string {
	const now = new Date();
	// Report is for the previous month
	const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
	return prev.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export const GET: RequestHandler = async ({ request }) => {
	// Verify cron secret
	if (!CRON_SECRET) {
		console.warn('[monthly-report] CRON_SECRET not set');
		return json({ error: 'Cron secret not configured.' }, { status: 500 });
	}

	const authHeader = request.headers.get('authorization');
	if (authHeader !== `Bearer ${CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const db         = getAdminDb();
	const monthLabel = getMonthLabel();

	// Completed cuts in the previous calendar month (UTC). Per-user month
	// counters (usage.byMonth) are authoritative from Sep 2026 and survive
	// "Clear history"; the jobs cover earlier months. Take the larger.
	// (usage.monthlyCount is a rolling 30-day window — wrong for a monthly report.)
	const now        = new Date();
	const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
	const monthEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const reportKey  = monthKey(monthStart);
	const jobCounts  = new Map<string, number>();
	const jobsSnap   = await db.collection('jobs')
		.where('completedAt', '>=', monthStart)
		.where('completedAt', '<', monthEnd)
		.select('userId')
		.get();
	for (const d of jobsSnap.docs) {
		const uid = d.data().userId;
		if (uid) jobCounts.set(uid, (jobCounts.get(uid) ?? 0) + 1);
	}

	let sent       = 0;
	let errors     = 0;
	let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

	// Paginate through all active users in batches of 500
	while (true) {
		let query = db
			.collection('users')
			.where('subscription.status', '==', 'active')
			.limit(500);

		if (lastDoc) {
			query = query.startAfter(lastDoc);
		}

		const snapshot = await query.get();
		if (snapshot.empty) break;

		lastDoc = snapshot.docs[snapshot.docs.length - 1];

		// Process in mini-batches of 10 to avoid overwhelming Resend
		const chunks = chunkArray(snapshot.docs, BATCH_SIZE);
		for (const chunk of chunks) {
			const results = await Promise.allSettled(
				chunk.map(async (doc) => {
					const data        = doc.data() ?? {};
					const email       = data.email as string | undefined;
					const displayName = (data.displayName as string) ?? '';
					const tier        = (data.tier as string) ?? 'free';
					const cutCount    = Math.max(Number(data.usage?.byMonth?.[reportKey] ?? 0) || 0, jobCounts.get(doc.id) ?? 0);

					if (!email) return;

					await sendMonthlyReportEmail(
						email,
						displayName,
						monthLabel,
						cutCount,
						0,
						tier,
					);
				}),
			);

			for (const result of results) {
				if (result.status === 'fulfilled') {
					sent++;
				} else {
					errors++;
					console.error('[monthly-report] send error:', result.reason);
				}
			}
		}

		if (snapshot.size < 500) break;
	}

	return json({ sent, errors });
};
