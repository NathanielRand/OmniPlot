import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { previewMerge, runMerge } from '$lib/server/demand';

// Admin → Patterns → Requests.
//   GET   → what merging the old free-text requests would do (nothing is written)
//   POST  → do it (idempotent; old docs are marked mergedInto, never deleted)
//   PATCH { id, status } → move a demand record along: queued / in-progress / done
async function assertAdmin(request: Request): Promise<boolean> {
	const uid = await verifyIdToken(request.headers.get('authorization'));
	if (!uid) return false;
	return (await getAdminDb().doc(`users/${uid}`).get()).data()?.tier === 'admin';
}
const forbidden = () => json({ error: 'Forbidden' }, { status: 403 });

export const GET: RequestHandler = async ({ request }) => {
	if (!await assertAdmin(request)) return forbidden();
	return json(await previewMerge());
};

export const POST: RequestHandler = async ({ request }) => {
	if (!await assertAdmin(request)) return forbidden();
	try { return json(await runMerge()); }
	catch (err) {
		console.error('[admin/demand] merge', err);
		return json({ error: err instanceof Error ? err.message : 'Merge failed.' }, { status: 500 });
	}
};

export const PATCH: RequestHandler = async ({ request }) => {
	if (!await assertAdmin(request)) return forbidden();
	const { id, status } = await request.json().catch(() => ({}));
	if (typeof id !== 'string' || !id || id.includes('/') || !['queued', 'in-progress', 'done'].includes(status)) {
		return json({ error: 'Bad request.' }, { status: 400 });
	}
	const ref = getAdminDb().doc(`demand/${id}`);
	if (!(await ref.get()).exists) return json({ error: 'No such request.' }, { status: 404 });
	await ref.update({ status });
	return json({ ok: true });
};
