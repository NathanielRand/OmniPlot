import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { checkRateLimit, rateLimitedResponse } from '$lib/server/rate-limit';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const uid = await verifyIdToken(request.headers.get('authorization'));
		if (!uid) return json({ error: 'Unauthorized' }, { status: 401 });

		const limit = await checkRateLimit(`reports:${uid}`, { max: 5, windowSeconds: 300 });
		if (!limit.allowed) return rateLimitedResponse(limit);

		const body = await request.json();
		const { type, severity, title, description, url, userAgent } = body;

		if (!title?.trim() || !description?.trim()) {
			return json({ error: 'Title and description are required.' }, { status: 400 });
		}

		const userSnap = await getAdminDb().doc(`users/${uid}`).get();
		const userData = userSnap.data() ?? {};

		const ref = getAdminDb().collection('reports').doc();
		await ref.set({
			uid,
			email:       userData.email       ?? '',
			displayName: userData.displayName  ?? '',
			tier:        userData.tier         ?? 'free',
			type:        type        ?? 'bug',
			severity:    severity    ?? null,
			title:       title.trim(),
			description: description.trim(),
			url:         url         ?? '',
			userAgent:   userAgent   ?? '',
			status:      'open',
			createdAt:   FieldValue.serverTimestamp(),
			updatedAt:   FieldValue.serverTimestamp(),
		});

		return json({ id: ref.id });
	} catch (err) {
		console.error('[reports POST]', err);
		return json({ error: 'Could not submit report.' }, { status: 500 });
	}
};
