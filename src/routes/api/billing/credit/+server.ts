import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyIdToken } from '$lib/server/firebase-admin';
import { dismissCreditNotice, getCreditNotices, getPendingFreeMonths } from '$lib/server/credits';

// GET — free-month / discount coupons on the signed-in user's subscription
// that haven't been used by an invoice yet (Settings → Billing), plus any
// "it's been applied" notices they haven't dismissed (app banner).
// `?notices=1` skips the Stripe lookup — the banner only needs Firestore.
export const GET: RequestHandler = async ({ request, url }) => {
	const uid = await verifyIdToken(request.headers.get('authorization'));
	if (!uid) return json({ error: 'Unauthorized' }, { status: 401 });
	try {
		if (url.searchParams.get('notices')) return json({ notices: await getCreditNotices(uid) });
		const [freeMonths, notices] = await Promise.all([getPendingFreeMonths(uid), getCreditNotices(uid)]);
		return json({ freeMonths, notices });
	} catch (err) {
		console.error('[billing/credit]', err);
		return json({ freeMonths: [], notices: [] });
	}
};

// POST { action: 'dismiss', id } — hide the banner for that grant.
export const POST: RequestHandler = async ({ request }) => {
	const uid = await verifyIdToken(request.headers.get('authorization'));
	if (!uid) return json({ error: 'Unauthorized' }, { status: 401 });
	const { action, id } = await request.json().catch(() => ({}));
	if (action !== 'dismiss' || !id) return json({ error: 'Invalid request' }, { status: 400 });
	await dismissCreditNotice(uid, String(id));
	return json({ ok: true });
};
