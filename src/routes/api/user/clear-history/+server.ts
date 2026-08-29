import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';

// POST /api/user/clear-history — permanently deletes the caller's cut jobs.
// Patterns (userPatterns) are untouched; jobs are just the plot run records.
export const POST: RequestHandler = async ({ request }) => {
	try {
		const uid = await verifyIdToken(request.headers.get('authorization'));
		if (!uid) return json({ error: 'Unauthorized' }, { status: 401 });

		const db = getAdminDb();
		const snap = await db.collection('jobs').where('userId', '==', uid).get();
		for (let i = 0; i < snap.docs.length; i += 500) {
			const batch = db.batch();
			for (const doc of snap.docs.slice(i, i + 500)) batch.delete(doc.ref);
			await batch.commit();
		}

		return json({ ok: true, deleted: snap.docs.length });

	} catch (err) {
		console.error('[clear-history]', err);
		return json({ error: 'Could not clear job history.' }, { status: 500 });
	}
};
