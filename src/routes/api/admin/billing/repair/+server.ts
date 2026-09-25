import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';
import { requireSupportAdmin } from '$lib/server/support/admin-auth';
import { recentCharges, resyncUserBilling } from '$lib/server/billing-repair';

// GET ?uid= — recent charges with likely duplicates flagged.
export const GET: RequestHandler = async ({ request, url }) => {
	const admin = await requireSupportAdmin(request);
	if (!admin) return json({ error: 'Forbidden' }, { status: 403 });
	const uid = url.searchParams.get('uid');
	if (!uid) return json({ error: 'uid required' }, { status: 400 });
	try {
		return json({ charges: await recentCharges(uid) });
	} catch (err) {
		console.error('[admin/billing/repair GET]', err);
		return json({ error: 'Could not load charges.' }, { status: 500 });
	}
};

// POST { uid } — re-apply the user's live Stripe subscription to their account.
export const POST: RequestHandler = async ({ request }) => {
	const admin = await requireSupportAdmin(request);
	if (!admin) return json({ error: 'Forbidden' }, { status: 403 });
	const { uid } = await request.json().catch(() => ({}));
	if (!uid) return json({ error: 'uid required' }, { status: 400 });
	try {
		return json(await resyncUserBilling(String(uid)));
	} catch (err) {
		if (err instanceof Stripe.errors.StripeError) return json({ error: err.message }, { status: err.statusCode ?? 500 });
		console.error('[admin/billing/repair POST]', err);
		return json({ error: 'Resync failed.' }, { status: 500 });
	}
};
