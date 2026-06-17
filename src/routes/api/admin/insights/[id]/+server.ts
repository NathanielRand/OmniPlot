import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

async function assertAdmin(authHeader: string | null): Promise<string | null> {
	const uid = await verifyIdToken(authHeader);
	if (!uid) return null;
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.data()?.tier === 'admin' ? uid : null;
}

// PATCH /api/admin/insights/[id] — update a post
export const PATCH: RequestHandler = async ({ request, params }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}
	const body = await request.json();
	const { publishedAt, ...rest } = body;
	await getAdminDb().doc(`insights/${params.id}`).update({
		...rest,
		...(publishedAt !== undefined
			? { publishedAt: publishedAt ? Timestamp.fromDate(new Date(publishedAt)) : null }
			: {}),
		updatedAt: FieldValue.serverTimestamp(),
	});
	return json({ ok: true });
};

// DELETE /api/admin/insights/[id] — delete a post
export const DELETE: RequestHandler = async ({ request, params }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}
	await getAdminDb().doc(`insights/${params.id}`).delete();
	return json({ ok: true });
};
