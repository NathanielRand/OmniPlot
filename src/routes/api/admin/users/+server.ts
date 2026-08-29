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

// GET /api/admin/users  — list all users
export const GET: RequestHandler = async ({ request, url }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}

	const limitCount = Math.min(parseInt(url.searchParams.get('limit') ?? '100'), 500);
	const db = getAdminDb();

	const snap = await db.collection('users').orderBy('createdAt', 'desc').limit(limitCount).get();

	const users = snap.docs.map((doc) => {
		const d = doc.data();
		return {
			uid:          doc.id,
			displayName:  d.displayName  ?? '',
			email:        d.email        ?? '',
			phone:        d.phone        ?? null,
			tier:         d.tier         ?? 'free',
			status:       d.status       ?? 'active',
			shopId:       d.shopId       ?? null,
			shopName:     d.shopName     ?? null,
			shopRole:     d.shopRole     ?? null,
			cutsTotal:    d.usage?.cutCount ?? 0,
			createdAt:    d.createdAt?.toDate?.()?.toISOString()   ?? null,
			lastActiveAt: d.updatedAt?.toDate?.()?.toISOString()   ?? null,
		};
	});

	return json({ users });
};

// PATCH /api/admin/users  — update a single user's tier or status
export const PATCH: RequestHandler = async ({ request }) => {
	const adminUid = await assertAdmin(request.headers.get('authorization'));
	if (!adminUid) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}

	const { uid, tier, status, clearSession, removeShop } = await request.json();
	if (!uid) {
		return new Response(JSON.stringify({ error: 'uid required' }), { status: 400 });
	}

	const db    = getAdminDb();
	const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

	if (tier)         patch.tier            = tier;
	if (status)       patch.status          = status;
	if (clearSession) patch.activeSessionId = null;

	if (removeShop) {
		patch.shopId = null;
		patch.shopRole = null;
		patch.shopName = null;

		// Clearing only the user-doc pointer left the member doc behind,
		// so isMember() in firestore.rules still granted shop access.
		const userSnap = await db.doc(`users/${uid}`).get();
		const shopId = userSnap.data()?.shopId;
		if (shopId) {
			await db.doc(`shops/${shopId}/members/${uid}`).delete();
		}
	}

	await db.doc(`users/${uid}`).update(patch);

	return json({ ok: true });
};
