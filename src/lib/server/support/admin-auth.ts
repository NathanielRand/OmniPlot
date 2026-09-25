import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';

/** Same tier === 'admin' gate the other /api/admin routes use, but returns
 *  the display name too so replies can be attributed. */
export async function requireSupportAdmin(request: Request): Promise<{ uid: string; name: string } | null> {
	const uid = await verifyIdToken(request.headers.get('authorization'));
	if (!uid) return null;
	const data = (await getAdminDb().doc(`users/${uid}`).get()).data();
	if (data?.tier !== 'admin') return null;
	return { uid, name: (data.displayName as string) || 'OmniPlot Support' };
}
