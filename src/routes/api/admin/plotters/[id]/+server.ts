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

// PATCH /api/admin/plotters/[id] — resolve a plotter error report
export const PATCH: RequestHandler = async ({ request, params }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}
	await getAdminDb().doc(`plotterErrors/${params.id}`).update({
		resolvedAt: FieldValue.serverTimestamp(),
	});
	return json({ ok: true });
};
