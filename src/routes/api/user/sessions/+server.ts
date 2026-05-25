import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';

export const GET: RequestHandler = async ({ request }) => {
	try {
		const uid = await verifyIdToken(request.headers.get('authorization'));
		if (!uid) return json({ error: 'Unauthorized' }, { status: 401 });

		const snap = await getAdminDb()
			.collection(`users/${uid}/sessions`)
			.orderBy('createdAt', 'desc')
			.limit(15)
			.get();

		const sessions = snap.docs.map(doc => {
			const d = doc.data();
			return {
				id:             doc.id,
				sessionId:      d.sessionId      ?? '',
				ip:             d.ip             ?? '',
				city:           d.city           ?? '',
				region:         d.region         ?? '',
				country:        d.country        ?? '',
				countryCode:    d.countryCode    ?? '',
				browser:        d.browser        ?? 'Unknown',
				browserVersion: d.browserVersion ?? '',
				os:             d.os             ?? 'Unknown',
				osVersion:      d.osVersion      ?? '',
				device:         d.device         ?? 'desktop',
				createdAt:      (d.createdAt?.toMillis() ?? 0) as number,
			};
		});

		return json({ sessions });
	} catch (err) {
		console.error('[sessions]', err);
		return json({ error: 'Could not load sessions.' }, { status: 500 });
	}
};
