import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';

export const GET: RequestHandler = async ({ request }) => {
	try {
		const uid = await verifyIdToken(request.headers.get('authorization'));
		if (!uid) return json({ error: 'Unauthorized' }, { status: 401 });

		const snap = await getAdminDb().doc(`users/${uid}`).get();
		const customerId: string = snap.data()?.subscription?.stripeCustomerId ?? '';

		if (!customerId) return json({ methods: [], defaultMethodId: null });

		const [methods, customer] = await Promise.all([
			stripe.paymentMethods.list({ customer: customerId, type: 'card' }, connectedAccount),
			stripe.customers.retrieve(customerId, {}, connectedAccount),
		]);

		const defaultMethodId =
			!customer.deleted && typeof customer.invoice_settings?.default_payment_method === 'string'
				? customer.invoice_settings.default_payment_method
				: null;

		const formatted = methods.data.map(pm => ({
			id:      pm.id,
			brand:   pm.card?.brand    ?? 'card',
			last4:   pm.card?.last4    ?? '••••',
			expMonth: pm.card?.exp_month ?? 0,
			expYear:  pm.card?.exp_year  ?? 0,
			isDefault: pm.id === defaultMethodId,
		}));

		return json({ methods: formatted, defaultMethodId });

	} catch (err) {
		if (err instanceof Stripe.errors.StripeError) {
			console.error('[payment-methods] Stripe error:', err.type, err.message);
			return json({ error: err.message }, { status: err.statusCode ?? 500 });
		}
		console.error('[payment-methods] Unexpected error:', err);
		return json({ error: 'Could not load payment methods.' }, { status: 500 });
	}
};
