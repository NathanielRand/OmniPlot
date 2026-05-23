import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe } from '$lib/server/stripe';
import { verifyIdToken } from '$lib/server/firebase-admin';
import { STRIPE_CONNECTED_ACCOUNT_ID } from '$env/static/private';

export const POST: RequestHandler = async ({ request, url }) => {
	const uid = await verifyIdToken(request.headers.get('authorization'));
	if (!uid) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
	}

	const { priceId, type = 'individual', shopId, tier, plan } = await request.json();

	if (!priceId) {
		return new Response(JSON.stringify({ error: 'Missing priceId' }), { status: 400 });
	}

	const meta: Record<string, string> = {
		uid,
		type,
		shopId:  shopId ?? '',
		tier:    tier   ?? '',
		plan:    plan   ?? '',
	};

	const isShop = type === 'shop' && shopId;

	const session = await stripe.checkout.sessions.create({
		mode: 'subscription',
		line_items: [{ price: priceId, quantity: 1 }],
		metadata: meta,
		subscription_data: {
			metadata: meta,
			on_behalf_of:           STRIPE_CONNECTED_ACCOUNT_ID,
			application_fee_percent: 0.5,
		},
		success_url: isShop
			? `${url.origin}/settings?tab=team&checkout=success`
			: `${url.origin}/settings?tab=billing&checkout=success`,
		cancel_url: isShop
			? `${url.origin}/settings?tab=team`
			: `${url.origin}/pricing`,
		allow_promotion_codes: true,
	});

	return json({ url: session.url });
};
