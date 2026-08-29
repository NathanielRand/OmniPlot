import type { RequestHandler } from './$types';
import type Stripe from 'stripe';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { STRIPE_CONNECTED_ACCOUNT_ID, STRIPE_WEBHOOK_SECRET } from '$env/static/private';
import { getAdminDb } from '$lib/server/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { sendReceiptEmail, sendRefundEmail, sendUpgradeEmail } from '$lib/server/email';
import { attributeUid, chargeToRow, syncSubscriptionToFirestore, upsertTransaction } from '$lib/server/stripe-ledger';

// Single endpoint for every Stripe event on this platform account and its
// connected account — avoids managing multiple webhooks in the Dashboard.
//
// Delivery is at-least-once and out of order, so every write below is a
// Firestore `set(..., { merge: true })` keyed by a Stripe object id, never
// `.update()` (which throws on a missing doc and would silently 200 out
// through the catch below).
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

	// Connect events carry `event.account`. Platform-level events (none of
	// ours today) omit it. Ignore anything from an account we don't run —
	// relevant once/if other connected accounts ever exist.
	if (event.account && event.account !== STRIPE_CONNECTED_ACCOUNT_ID) {
		return new Response(JSON.stringify({ received: true, skipped: 'foreign account' }), { status: 200 });
	}

	try {
		switch (event.type) {
			// ── Ledger: the source of truth for "what did we charge, when" ──────
			case 'charge.succeeded':
			case 'charge.failed':
			case 'charge.captured':
			case 'charge.updated':
				await onChargeEvent(event.data.object as Stripe.Charge);
				break;
			case 'charge.refunded':
				await onChargeEvent(event.data.object as Stripe.Charge);
				await onChargeRefunded(event.data.object as Stripe.Charge);
				break;

			case 'charge.dispute.created':
			case 'charge.dispute.updated':
			case 'charge.dispute.closed':
			case 'charge.dispute.funds_withdrawn':
			case 'charge.dispute.funds_reinstated':
				await onDisputeEvent(event.data.object as Stripe.Dispute);
				break;

			// ── Subscription lifecycle ───────────────────────────────────────────
			case 'checkout.session.completed':
				await onCheckoutComplete(event.data.object as Stripe.Checkout.Session);
				break;
			case 'customer.subscription.created':
			case 'customer.subscription.updated':
			// Self-service `pause_collection` changes fire as `.updated`, not
			// `.paused`/`.resumed` — those two only fire for the unrelated
			// "trial ends with no payment method" status. Handle both here;
			// `syncSubscriptionToFirestore` reads `sub.pause_collection`
			// directly rather than relying on which event type arrived.
			case 'customer.subscription.paused':
			case 'customer.subscription.resumed':
				await onSubscriptionUpdated(event.data.object as Stripe.Subscription);
				break;
			case 'customer.subscription.deleted':
				await onSubscriptionDeleted(event.data.object as Stripe.Subscription);
				break;
			case 'customer.subscription.trial_will_end':
				// No reminder flow built yet — tracked for when one exists.
				break;

			// ── Invoices ──────────────────────────────────────────────────────────
			case 'invoice.payment_failed':
				await onPaymentFailed(event.data.object as Stripe.Invoice);
				break;
			case 'invoice.paid':
				// `invoice.paid` supersedes the legacy `invoice.payment_succeeded`,
				// which we don't subscribe to — subscribing to both would send
				// Connor's replacement flow two receipt emails per invoice.
				await onInvoicePaid(event.data.object as Stripe.Invoice);
				break;
			case 'invoice.payment_action_required':
				// No 3DS reminder flow built yet — tracked for when one exists.
				break;

			// ── No current handler — acknowledged so Stripe stops retrying,
			//    logged so adding a handler later is a one-line move above. ──────
			case 'charge.expired':
			case 'charge.pending':
			case 'charge.refund.updated':
			case 'entitlements.active_entitlement_summary.updated':
			case 'invoice.created':
			case 'invoice.finalized':
			case 'invoice.finalization_failed':
			case 'invoice.upcoming':
			case 'invoice.updated':
			case 'payment_intent.created':
			case 'payment_intent.succeeded':
			case 'subscription_schedule.aborted':
			case 'subscription_schedule.canceled':
			case 'subscription_schedule.completed':
			case 'subscription_schedule.created':
			case 'subscription_schedule.expiring':
			case 'subscription_schedule.released':
			case 'subscription_schedule.updated':
				break;

			default:
				console.log(`[webhook] Unhandled event type: ${event.type}`);
		}
	} catch (e) {
		console.error(`[webhook] Handler error for ${event.type}:`, e);
		// Ledger/subscription writes are idempotent, so a 500 here just makes
		// Stripe retry — safe, and necessary, since a swallowed failure is
		// exactly how Connor's charge went missing in the first place.
		return new Response(JSON.stringify({ received: true, error: String(e) }), { status: 500 });
	}

	return new Response(JSON.stringify({ received: true }), { status: 200 });
};

// ─── charge.* ──────────────────────────────────────────────────────────────────
async function onChargeEvent(charge: Stripe.Charge) {
	const uid = await attributeUid(charge);
	await upsertTransaction(chargeToRow(charge, uid));
}

// ─── charge.refunded (email side-effect; ledger status handled in onChargeEvent) ──
async function onChargeRefunded(charge: Stripe.Charge) {
	const customerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id;
	if (!customerId) return;

	// Dedupe: `charge.refunded` also fires again for a later partial refund on
	// the same charge, and can be redelivered — only email once per charge.
	const refundRef = getAdminDb().doc(`refundEmails/${charge.id}`);
	if ((await refundRef.get()).exists) return;

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
		await refundRef.set({ sentAt: FieldValue.serverTimestamp() });
	} catch (err) {
		console.error('[webhook] sendRefundEmail failed:', err);
	}
}

// ─── charge.dispute.* ──────────────────────────────────────────────────────────
async function onDisputeEvent(dispute: Stripe.Dispute) {
	const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id;
	await getAdminDb().doc(`transactions/${chargeId}`).set(
		{
			status:         'disputed',
			disputeId:      dispute.id,
			disputeStatus:  dispute.status,
			disputeAmount:  dispute.amount,
			updatedAt:      FieldValue.serverTimestamp(),
		},
		{ merge: true },
	);
}

// ─── checkout.session.completed ───────────────────────────────────────────────
async function onCheckoutComplete(session: Stripe.Checkout.Session) {
	if (session.mode !== 'subscription') return;

	const { uid, type, shopId, tier, plan } = session.metadata ?? {};
	if (!uid) return;

	const customerId   = session.customer as string;
	const subId        = session.subscription as string;
	const sub          = await stripe.subscriptions.retrieve(subId, {}, connectedAccount);
	const item         = sub.items.data[0];
	const priceId      = item?.price.id ?? '';
	const periodEnd    = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;
	const trialEnd     = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
	const unitAmount   = item?.price.unit_amount ?? 0;
	const currency     = item?.price.currency ?? 'usd';

	if (type === 'shop' && shopId) {
		await getAdminDb().doc(`shops/${shopId}`).set({
			plan:               plan || 'starter',
			stripeCustomerId:   customerId,
			stripePriceId:      priceId,
			subscriptionStatus: 'active',
			currentPeriodEnd:   periodEnd,
			updatedAt:          FieldValue.serverTimestamp(),
		}, { merge: true });
	} else {
		// A real nested object, not dotted keys — `.set(..., {merge:true})`
		// doesn't parse "subscription.status" as a path the way `.update()` does.
		await getAdminDb().doc(`users/${uid}`).set({
			tier: tier || 'lite',
			subscription: {
				stripeCustomerId:     customerId,
				stripeSubscriptionId: subId,
				stripePriceId:        priceId,
				status:               'active',
				cancelAtPeriodEnd:    false,
				currentPeriodEnd:     periodEnd,
				trialEnd,
			},
			updatedAt: FieldValue.serverTimestamp(),
		}, { merge: true });

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
					periodEnd ?? new Date(),
				);
			}
		} catch (err) {
			console.error('[webhook] sendUpgradeEmail failed:', err);
		}
	}
}

// ─── customer.subscription.created / updated ──────────────────────────────────
async function onSubscriptionUpdated(sub: Stripe.Subscription) {
	await syncSubscriptionToFirestore(sub);
}

// ─── customer.subscription.deleted ───────────────────────────────────────────
async function onSubscriptionDeleted(sub: Stripe.Subscription) {
	const { uid, type, shopId } = sub.metadata ?? {};
	if (!uid) return;

	if (type === 'shop' && shopId) {
		await getAdminDb().doc(`shops/${shopId}`).set({
			subscriptionStatus: 'canceled',
			updatedAt:          FieldValue.serverTimestamp(),
		}, { merge: true });
	} else {
		await getAdminDb().doc(`users/${uid}`).set({
			tier: 'free',
			subscription: { status: 'canceled', currentPeriodEnd: null },
			updatedAt: FieldValue.serverTimestamp(),
		}, { merge: true });
	}
}

// ─── invoice.payment_failed ───────────────────────────────────────────────────
async function onPaymentFailed(invoice: Stripe.Invoice) {
	const invoiceAny = invoice as unknown as { subscription?: string };
	if (!invoiceAny.subscription) return;
	const sub = await stripe.subscriptions.retrieve(invoiceAny.subscription, {}, connectedAccount);

	const { uid, type, shopId } = sub.metadata ?? {};
	if (!uid) return;

	if (type === 'shop' && shopId) {
		await getAdminDb().doc(`shops/${shopId}`).set({
			subscriptionStatus: 'past_due',
			updatedAt:          FieldValue.serverTimestamp(),
		}, { merge: true });
	} else {
		await getAdminDb().doc(`users/${uid}`).set({
			subscription: { status: 'past_due' },
			updatedAt: FieldValue.serverTimestamp(),
		}, { merge: true });
	}
}

// ─── invoice.paid ──────────────────────────────────────────────────────────────
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

	// Guard against Stripe redelivering the same `invoice.paid` event —
	// don't send a second receipt for an invoice we've already emailed.
	const receiptRef  = getAdminDb().doc(`receipts/${invoiceAny.id}`);
	if ((await receiptRef.get()).exists) return;

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
		await receiptRef.set({ sentAt: FieldValue.serverTimestamp() });
	} catch (err) {
		console.error('[webhook] sendReceiptEmail failed:', err);
	}
}
