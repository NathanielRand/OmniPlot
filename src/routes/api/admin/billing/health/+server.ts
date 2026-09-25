import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { checkBillingHealth } from '$lib/server/billing-health';

async function assertAdmin(authHeader: string | null): Promise<boolean> {
	const uid = await verifyIdToken(authHeader);
	if (!uid) return false;
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.data()?.tier === 'admin';
}

// GET /api/admin/billing/health — on-demand run of the same checks the
// daily cron performs (see $lib/server/billing-health).
export const GET: RequestHandler = async ({ request }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const checks = await checkBillingHealth();
	return json({ ok: checks.every((c) => c.ok), checks, ranAt: new Date().toISOString() });
};
