import type { RequestHandler } from './$types';
import type Stripe from 'stripe';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb } from '$lib/server/firebase-admin';
import { STRIPE_WEBHOOK_SECRET } from '$env/static/private';
import { FieldValue } from 'firebase-admin/firestore';
import { sendReceiptEmail, sendRefundEmail, sendUpgradeEmail } from '$lib/server/email';

// Stripe requires the raw body for signature verification — read as text.
export const POST: RequestHandler = async ({ request }) => {
	const sig  = request.headers.get('stripe-signature');
	const body = await request.text();

	if (!sig) {
		return new Response('Missing stripe-signature header', { status: 400 });
	}

	let event: Stripe.Event;
	try {
		event = stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET);
	} catch (e) {
		console.error('[webhook] Signature verification failed:', e);
		return new Response('Invalid signature', { status: 400 });
	}

	try {
		switch (event.type) {
			case 'checkout.session.completed':
				await onCheckoutComplete(event.data.object as Stripe.Checkout.Session);
				break;
			case 'customer.subscription.updated':
				await onSubscriptionUpdated(event.data.object as Stripe.Subscription);
				break;
			case 'customer.subscription.deleted':
				await onSubscriptionDeleted(event.data.object as Stripe.Subscription);
				break;
			case 'invoice.payment_failed':
				await onPaymentFailed(event.data.object as Stripe.Invoice);
				break;
			case 'invoice.payment_succeeded':
				await onInvoicePaid(event.data.object as Stripe.Invoice);
				break;
			case 'charge.refunded':
				await onChargeRefunded(event.data.object as Stripe.Charge);
				break;
		}
	} catch (e) {
		console.error(`[webhook] Handler error for ${event.type}:`, e);
		// Return 200 to Stripe anyway — a 5xx would cause retries for events we've
		// partially processed, which can cause duplicate side-effects.
		return new Response(JSON.stringify({ received: true, error: String(e) }), { status: 200 });
	}

	return new Response(JSON.stringify({ received: true }), { status: 200 });
};

// ─── checkout.session.completed ───────────────────────────────────────────────
async function onCheckoutComplete(session: Stripe.Checkout.Session) {
	if (session.mode !== 'subscription') return;

	const { uid, type, shopId, tier, plan } = session.metadata ?? {};
	if (!uid) return;

	const customerId   = session.customer as string;
	const subId        = session.subscription as string;
	const sub          = await stripe.subscriptions.retrieve(subId, {}, connectedAccount);
	const priceId      = sub.items.data[0]?.price.id ?? '';
	const periodEnd    = new Date(sub.current_period_end * 1000);
	const trialEnd     = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
	const unitAmount   = sub.items.data[0]?.price.unit_amount ?? 0;
	const currency     = sub.items.data[0]?.price.currency ?? 'usd';

	if (type === 'shop' && shopId) {
		await getAdminDb().doc(`shops/${shopId}`).update({
			plan:               plan || 'starter',
			stripeCustomerId:   customerId,
			stripePriceId:      priceId,
			subscriptionStatus: 'active',
			currentPeriodEnd:   periodEnd,
			updatedAt:          FieldValue.serverTimestamp(),
		});
	} else {
		await getAdminDb().doc(`users/${uid}`).update({
			tier:                                    tier || 'lite',
			'subscription.stripeCustomerId':         customerId,
			'subscription.stripeSubscriptionId':     subId,
			'subscription.stripePriceId':            priceId,
			'subscription.status':                   'active',
			'subscription.cancelAtPeriodEnd':        false,
			'subscription.currentPeriodEnd':         periodEnd,
			'subscription.trialEnd':                 trialEnd,
			updatedAt:                               FieldValue.serverTimestamp(),
		});

		// Send upgrade confirmation email (non-fatal)
		try {
			const userSnap = await getAdminDb().doc(`users/${uid}`).get();
			const userData = userSnap.data() ?? {};
			if (userData.email) {
				const tierLabel = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : 'Pro';
				await sendUpgradeEmail(
					userData.email as string,
					(userData.displayName as string) ?? '',
					tierLabel,
					unitAmount / 100,
					currency,
					periodEnd,
				);
			}
		} catch (err) {
			console.error('[webhook] sendUpgradeEmail failed:', err);
		}
	}
}

// ─── customer.subscription.updated ───────────────────────────────────────────
async function onSubscriptionUpdated(sub: Stripe.Subscription) {
	const { uid, type, shopId } = sub.metadata ?? {};
	if (!uid) return;

	const status            = sub.status as 'active' | 'canceled' | 'past_due' | 'trialing';
	const priceId           = sub.items.data[0]?.price.id ?? '';
	const periodEnd         = new Date(sub.current_period_end * 1000);
	const cancelAtPeriodEnd = sub.cancel_at_period_end ?? false;

	if (type === 'shop' && shopId) {
		await getAdminDb().doc(`shops/${shopId}`).update({
			stripePriceId:      priceId,
			subscriptionStatus: status,
			currentPeriodEnd:   periodEnd,
			updatedAt:          FieldValue.serverTimestamp(),
		});
	} else {
		await getAdminDb().doc(`users/${uid}`).update({
			'subscription.stripeSubscriptionId':  sub.id,
			'subscription.stripePriceId':         priceId,
			'subscription.status':                status,
			'subscription.cancelAtPeriodEnd':     cancelAtPeriodEnd,
			'subscription.currentPeriodEnd':      periodEnd,
			updatedAt:                            FieldValue.serverTimestamp(),
		});
	}
}

// ─── customer.subscription.deleted ───────────────────────────────────────────
async function onSubscriptionDeleted(sub: Stripe.Subscription) {
	const { uid, type, shopId } = sub.metadata ?? {};
	if (!uid) return;

	if (type === 'shop' && shopId) {
		await getAdminDb().doc(`shops/${shopId}`).update({
			subscriptionStatus: 'canceled',
			updatedAt:          FieldValue.serverTimestamp(),
		});
	} else {
		await getAdminDb().doc(`users/${uid}`).update({
			tier:                            'free',
			'subscription.status':           'canceled',
			'subscription.currentPeriodEnd': null,
			updatedAt:                       FieldValue.serverTimestamp(),
		});
	}
}

// ─── invoice.payment_failed ───────────────────────────────────────────────────
async function onPaymentFailed(invoice: Stripe.Invoice) {
	if (!invoice.subscription) return;
	const sub = await stripe.subscriptions.retrieve(invoice.subscription as string, {}, connectedAccount);

	const { uid, type, shopId } = sub.metadata ?? {};
	if (!uid) return;

	if (type === 'shop' && shopId) {
		await getAdminDb().doc(`shops/${shopId}`).update({
			subscriptionStatus: 'past_due',
			updatedAt:          FieldValue.serverTimestamp(),
		});
	} else {
		await getAdminDb().doc(`users/${uid}`).update({
			'subscription.status': 'past_due',
			updatedAt:             FieldValue.serverTimestamp(),
		});
	}
}

// ─── invoice.payment_succeeded ────────────────────────────────────────────────
async function onInvoicePaid(invoice: Stripe.Invoice) {
	// Skip subscription_create — the checkout/upgrade flow already handles that
	if (invoice.billing_reason === 'subscription_create') return;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const invoiceAny = invoice as any;
	if (!invoiceAny.subscription) return;

	const sub = await stripe.subscriptions.retrieve(invoiceAny.subscription as string, {}, connectedAccount);
	const { uid } = sub.metadata ?? {};
	if (!uid) return;

	const snap     = await getAdminDb().doc(`users/${uid}`).get();
	const userData = snap.data() ?? {};
	if (!userData.email) return;

	// Derive plan name from line item description or price metadata
	const lineItem  = invoiceAny.lines?.data?.[0];
	const planName  = (lineItem?.description ?? lineItem?.price?.metadata?.config_id ?? 'your plan') as string;
	const periodEnd = new Date(((invoiceAny.period_end as number) ?? 0) * 1000);

	try {
		await sendReceiptEmail(
			userData.email as string,
			(userData.displayName as string) ?? '',
			((invoiceAny.amount_paid as number) ?? 0) / 100,
			(invoiceAny.currency as string) ?? 'usd',
			planName,
			(invoiceAny.invoice_pdf as string | null) ?? null,
			periodEnd,
		);
	} catch (err) {
		console.error('[webhook] sendReceiptEmail failed:', err);
	}
}

// ─── charge.refunded ──────────────────────────────────────────────────────────
async function onChargeRefunded(charge: Stripe.Charge) {
	const customerId = charge.customer as string;
	if (!customerId) return;

	const result = await getAdminDb()
		.collection('users')
		.where('subscription.stripeCustomerId', '==', customerId)
		.limit(1)
		.get();

	if (result.empty) return;

	const userData = result.docs[0].data() ?? {};
	if (!userData.email) return;

	try {
		await sendRefundEmail(
			userData.email as string,
			(userData.displayName as string) ?? '',
			(charge.amount_refunded ?? 0) / 100,
			charge.currency ?? 'usd',
		);
	} catch (err) {
		console.error('[webhook] sendRefundEmail failed:', err);
	}
}
