import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

async function assertAdmin(authHeader: string | null): Promise<boolean> {
	const uid = await verifyIdToken(authHeader);
	if (!uid) return false;
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.data()?.tier === 'admin';
}

/** Count of docs matching a query; null when the query fails so one broken
 *  collection never blanks the whole strip. */
async function count(q: FirebaseFirestore.Query): Promise<number | null> {
	try { return (await q.count().get()).data().count; }
	catch (err) { console.error('[admin/attention]', err); return null; }
}

// GET /api/admin/attention — counts of things waiting on staff, for the
// "Needs attention" strip on Admin → Overview. Support counts come from
// /api/admin/support?summary=1, which the overview fetches separately.
export const GET: RequestHandler = async ({ request }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const db = getAdminDb();
	const dayAgo = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);

	const [errors24h, openReports, patternSubmissions, patternAdjustments] = await Promise.all([
		// Error groups seen in the last 24h that nobody has resolved.
		(async () => {
			try {
				const snap = await db.collection('errorLogs').where('lastSeenAt', '>=', dayAgo).select('resolvedAt', 'severity').get();
				const open = snap.docs.filter((d) => !d.data().resolvedAt);
				return { open: open.length, critical: open.filter((d) => d.data().severity === 'critical' || d.data().severity === 'fatal').length };
			} catch (err) {
				console.error('[admin/attention] errors', err);
				return null;
			}
		})(),
		count(db.collection('reports').where('status', '==', 'open')),
		count(db.collection('userPatterns').where('status', '==', 'pending')),
		count(db.collection('patternAdjustments').where('status', '==', 'pending')),
	]);

	return json({
		errors:   errors24h,
		reports:  openReports,
		patterns: patternSubmissions === null && patternAdjustments === null
			? null
			: (patternSubmissions ?? 0) + (patternAdjustments ?? 0),
	});
};
