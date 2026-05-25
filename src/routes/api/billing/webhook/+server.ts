import type { RequestHandler } from './$types';
import type Stripe from 'stripe';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb } from '$lib/server/firebase-admin';
import { STRIPE_WEBHOOK_SECRET } from '$env/static/private';
import { FieldValue } from 'firebase-admin/firestore';

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
			tier:                            tier || 'lite',
			'subscription.stripeCustomerId': customerId,
			'subscription.stripePriceId':    priceId,
			'subscription.status':           'active',
			'subscription.currentPeriodEnd': periodEnd,
			'subscription.trialEnd':         trialEnd,
			updatedAt:                       FieldValue.serverTimestamp(),
		});
	}
}

// ─── customer.subscription.updated ───────────────────────────────────────────
async function onSubscriptionUpdated(sub: Stripe.Subscription) {
	const { uid, type, shopId } = sub.metadata ?? {};
	if (!uid) return;

	const status    = sub.status as 'active' | 'canceled' | 'past_due' | 'trialing';
	const priceId   = sub.items.data[0]?.price.id ?? '';
	const periodEnd = new Date(sub.current_period_end * 1000);

	if (type === 'shop' && shopId) {
		await getAdminDb().doc(`shops/${shopId}`).update({
			stripePriceId:      priceId,
			subscriptionStatus: status,
			currentPeriodEnd:   periodEnd,
			updatedAt:          FieldValue.serverTimestamp(),
		});
	} else {
		await getAdminDb().doc(`users/${uid}`).update({
			'subscription.stripePriceId':    priceId,
			'subscription.status':           status,
			'subscription.currentPeriodEnd': periodEnd,
			updatedAt:                       FieldValue.serverTimestamp(),
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
