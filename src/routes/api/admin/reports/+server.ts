import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

async function assertAdmin(authHeader: string | null): Promise<string | null> {
	const uid = await verifyIdToken(authHeader);
	if (!uid) return null;
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.data()?.tier === 'admin' ? uid : null;
}

export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const uid = await assertAdmin(request.headers.get('authorization'));
		if (!uid) return json({ error: 'Forbidden' }, { status: 403 });

		const status = url.searchParams.get('status'); // open | in_progress | resolved | closed | null (all)

		let query = getAdminDb()
			.collection('reports')
			.orderBy('createdAt', 'desc')
			.limit(100) as FirebaseFirestore.Query;

		if (status) query = query.where('status', '==', status);

		const snap = await query.get();

		const reports = snap.docs.map(doc => {
			const d = doc.data();
			return {
				id:          doc.id,
				uid:         d.uid          ?? '',
				email:       d.email        ?? '',
				displayName: d.displayName  ?? '',
				tier:        d.tier         ?? 'free',
				type:        d.type         ?? 'bug',
				severity:    d.severity     ?? null,
				title:       d.title        ?? '',
				description: d.description  ?? '',
				url:         d.url          ?? '',
				userAgent:   d.userAgent    ?? '',
				status:      d.status       ?? 'open',
				createdAt:   (d.createdAt?.toMillis() ?? 0) as number,
				updatedAt:   (d.updatedAt?.toMillis() ?? 0) as number,
			};
		});

		return json({ reports });
	} catch (err) {
		console.error('[admin/reports GET]', err);
		return json({ error: 'Could not load reports.' }, { status: 500 });
	}
};

export const PATCH: RequestHandler = async ({ request }) => {
	try {
		const uid = await assertAdmin(request.headers.get('authorization'));
		if (!uid) return json({ error: 'Forbidden' }, { status: 403 });

		const { id, status } = await request.json();
		if (!id || !status) return json({ error: 'id and status required' }, { status: 400 });

		await getAdminDb().doc(`reports/${id}`).update({
			status,
			updatedAt: FieldValue.serverTimestamp(),
		});

		return json({ ok: true });
	} catch (err) {
		console.error('[admin/reports PATCH]', err);
		return json({ error: 'Could not update report.' }, { status: 500 });
	}
};
