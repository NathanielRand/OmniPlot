import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminAuth, getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { recomputeOrgMember } from '$lib/server/recompute-org-member';
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

	// Defaults to every user: the page's tabs, counts and search all filter
	// client-side, so a capped list silently hid older accounts from them.
	const limitParam = url.searchParams.get('limit');
	const db = getAdminDb();

	let query = db.collection('users').orderBy('createdAt', 'desc');
	if (limitParam) query = query.limit(Math.max(1, parseInt(limitParam) || 100));
	const snap = await query.get();

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
			// lastActiveAt is stamped per browser session; older accounts fall back to updatedAt
			lastActiveAt: (d.lastActiveAt ?? d.updatedAt)?.toDate?.()?.toISOString() ?? null,
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

	if (tier) {
		if (!['free', 'lite', 'pro', 'admin'].includes(tier)) {
			return new Response(JSON.stringify({ error: 'Invalid tier' }), { status: 400 });
		}
		patch.tier = tier;
		// A paid tier granted by hand (no Stripe subscription behind it) is a
		// comp — flagged so the billing health reconciliation doesn't report it.
		patch.compedTier = tier === 'lite' || tier === 'pro';
	}
	if (status) {
		if (!['active', 'suspended'].includes(status)) {
			return new Response(JSON.stringify({ error: 'Invalid status' }), { status: 400 });
		}
		if (status === 'suspended' && uid === adminUid) {
			return new Response(JSON.stringify({ error: "You can't suspend your own account" }), { status: 400 });
		}
		patch.status = status;
	}
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
			const shopSnap = await db.doc(`shops/${shopId}`).get();
			await db.doc(`shops/${shopId}/members/${uid}`).delete();
			const orgId = shopSnap.data()?.orgId;
			if (orgId) await recomputeOrgMember(orgId, uid);
		}
	}

	await db.doc(`users/${uid}`).update(patch);

	// Suspension is enforced at three layers: Firestore rules read `status`,
	// the disabled Auth account can't sign in or refresh, and revoking tokens
	// makes verifyIdToken (checkRevoked) reject the ones already issued.
	if (status) {
		const adminAuth = getAdminAuth();
		try {
			await adminAuth.updateUser(uid, { disabled: status === 'suspended' });
			if (status === 'suspended') await adminAuth.revokeRefreshTokens(uid);
		} catch (err) {
			// A Firestore-only profile with no Auth record still gets the rules block.
			if ((err as { code?: string }).code !== 'auth/user-not-found') throw err;
		}
	}

	return json({ ok: true });
};
