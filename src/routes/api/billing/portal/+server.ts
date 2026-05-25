import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';

export const POST: RequestHandler = async ({ request, url }) => {
	const uid = await verifyIdToken(request.headers.get('authorization'));
	if (!uid) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
	}

	const { type = 'individual', shopId } = await request.json();

	let customerId: string | null = null;
	let returnPath = '/settings?tab=billing';

	const db = getAdminDb();
	if (type === 'shop' && shopId) {
		const snap = await db.doc(`shops/${shopId}`).get();
		customerId = snap.data()?.stripeCustomerId ?? null;
		returnPath = '/settings?tab=team';
	} else {
		const snap = await db.doc(`users/${uid}`).get();
		customerId = snap.data()?.subscription?.stripeCustomerId ?? null;
	}

	if (!customerId) {
		return new Response(JSON.stringify({ error: 'No billing account found' }), { status: 400 });
	}

	const session = await stripe.billingPortal.sessions.create({
		customer: customerId,
		return_url: `${url.origin}${returnPath}`,
	}, connectedAccount);

	return json({ url: session.url });
};
