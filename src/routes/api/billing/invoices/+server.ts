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

		if (!customerId) return json({ invoices: [] });

		const list = await stripe.invoices.list(
			{ customer: customerId, limit: 24, expand: ['data.charge'] },
			connectedAccount,
		);

		const invoices = list.data.map(inv => ({
			id:          inv.id,
			number:      inv.number ?? inv.id,
			amount:      inv.amount_paid / 100,
			currency:    inv.currency.toUpperCase(),
			status:      inv.status ?? 'unknown',
			date:        inv.created * 1000,
			pdfUrl:      inv.invoice_pdf ?? null,
			description: inv.description ?? null,
		}));

		return json({ invoices });

	} catch (err) {
		if (err instanceof Stripe.errors.StripeError) {
			return json({ error: err.message }, { status: err.statusCode ?? 500 });
		}
		console.error('[invoices]', err);
		return json({ error: 'Could not load invoices.' }, { status: 500 });
	}
};
