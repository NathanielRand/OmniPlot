import type Stripe from 'stripe';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb } from '$lib/server/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export const PAID_TIERS = ['lite', 'pro'] as const;
export type PaidTier = typeof PAID_TIERS[number];

// Statuses that still hold a paid tier. `past_due` keeps access through
// Stripe's retry window; the terminal statuses below drop to free.
const ENTITLED_STATUSES = new Set<Stripe.Subscription.Status>(['active', 'trialing', 'past_due']);
const TERMINAL_STATUSES = new Set<Stripe.Subscription.Status>(['canceled', 'incomplete_expired', 'unpaid']);

function isPaidTier(t: unknown): t is PaidTier {
	return typeof t === 'string' && (PAID_TIERS as readonly string[]).includes(t);
}

/**
 * The tier a subscription actually pays for, derived from its PRICE — not
 * from `sub.metadata.tier`, which is stamped once at checkout and goes stale
 * the moment the plan changes (portal plan switch, in-app upgrade). Falls
 * back through: price metadata (stamped by the admin product sync) → the
 * price IDs cached in settings/platform.plans → subscription metadata.
 */
export async function tierFromSubscription(sub: Stripe.Subscription): Promise<PaidTier | null> {
	const price = sub.items.data[0]?.price;
	if (isPaidTier(price?.metadata?.tier)) return price.metadata.tier;

	if (price?.id) {
		const plans = (await getAdminDb().doc('settings/platform').get()).data()?.plans ?? {};
		for (const t of PAID_TIERS) {
			if (plans[t]?.stripePriceId === price.id || plans[t]?.stripeYearlyPriceId === price.id) return t;
		}
		const configId = price.metadata?.config_id ?? '';
		for (const t of PAID_TIERS) {
			if (configId === `${t}_monthly` || configId === `${t}_yearly`) return t;
		}
	}

	return isPaidTier(sub.metadata?.tier) ? sub.metadata.tier : null;
}

/**
 * Writes a subscription's status/tier onto the user or org doc it belongs
 * to, keyed by `sub.metadata.uid` — the same logic the webhook's
 * `customer.subscription.*` / `checkout.session.completed` handlers use,
 * shared here so the admin backfill sync can reconcile subscriptions that
 * existed in Stripe before the webhook was correctly receiving events
 * (e.g. Connor's).
 *
 * Returns false when nothing was written (no uid, or a stale subscription
 * that isn't the user's current one).
 */
export async function syncSubscriptionToFirestore(sub: Stripe.Subscription): Promise<boolean> {
	const { uid, type, orgId } = sub.metadata ?? {};
	if (!uid) return false;

	const status            = sub.status;
	const item               = sub.items.data[0];
	const priceId            = item?.price.id ?? '';
	const periodEnd          = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;
	const trialEnd           = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
	const cancelAtPeriodEnd  = sub.cancel_at_period_end ?? false;
	// `pause_collection` (self-service "pause billing") does NOT change
	// `status` — Stripe leaves it 'active' and keeps generating invoices
	// (voided/marked uncollectible, per `behavior`). `status === 'paused'` is
	// a distinct, unrelated thing that only happens when a trial ends with no
	// payment method on file. Track both separately.
	const collectionPaused  = !!sub.pause_collection;

	const db = getAdminDb();
	let existingTier: string | undefined;

	// Backfill a missing user email from the Stripe customer — receipts and
	// upgrade emails silently no-op without one, and a subscription with no
	// email on file is invisible the same way an unattributed charge is.
	if (!(type === 'org' && orgId)) {
		const userSnap = await db.doc(`users/${uid}`).get();
		existingTier = userSnap.data()?.tier;

		// A user can have more than one subscription in Stripe over time (an
		// old canceled one, or a duplicate from before in-app plan changes
		// updated the existing sub). Events for a sub that isn't the user's
		// current one must not clobber it — e.g. an old sub's `.deleted`
		// dropping a freshly-upgraded Lite user back to free. A live sub
		// always wins (it's the one they're paying for); a dead one only
		// applies if it IS the current sub.
		const currentSubId: string = userSnap.data()?.subscription?.stripeSubscriptionId ?? '';
		if (currentSubId && currentSubId !== sub.id && !ENTITLED_STATUSES.has(status)) {
			return false;
		}

		if (userSnap.exists && !userSnap.data()?.email) {
			const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
			try {
				const customer = await stripe.customers.retrieve(customerId, {}, connectedAccount);
				const email = 'deleted' in customer ? null : customer.email;
				if (email) await db.doc(`users/${uid}`).set({ email }, { merge: true });
			} catch { /* non-fatal — subscription sync below still proceeds */ }
		}
	}

	if (type === 'org' && orgId) {
		await db.doc(`orgs/${orgId}`).set({
			stripeCustomerId:   typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
			stripePriceId:      priceId,
			subscriptionStatus: status,
			currentPeriodEnd:   periodEnd,
			updatedAt:          FieldValue.serverTimestamp(),
		}, { merge: true });
	} else {
		// `.set(..., { merge: true })` does NOT parse dotted string keys as
		// nested paths the way `.update()` does — those would land as literal
		// top-level fields named "subscription.status" etc. Nest for real.
		//
		// A paused subscription (either real trial-pause status, or a
		// self-service pause_collection) still exists in Stripe, but the user
		// shouldn't keep paid entitlements while not being billed for them —
		// drop tier to free for the duration; resuming restores it below.
		// `trialing` is entitled too — only checking `active` left trial
		// subscribers stuck on free.
		const isPaused = status === 'paused' || collectionPaused;
		let tierPatch: { tier?: string } = {};
		if (isPaused || TERMINAL_STATUSES.has(status)) {
			tierPatch = { tier: 'free' };
		} else if (ENTITLED_STATUSES.has(status)) {
			const tier = await tierFromSubscription(sub);
			if (tier) tierPatch = { tier };
			else console.error(`[stripe-ledger] Could not resolve tier for subscription ${sub.id} (price ${priceId})`);
		}
		// Never demote an admin via billing state.
		if (existingTier === 'admin') tierPatch = {};

		await db.doc(`users/${uid}`).set({
			...tierPatch,
			subscription: {
				stripeCustomerId:     typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
				stripeSubscriptionId: sub.id,
				stripePriceId:        priceId,
				status,
				pausedCollection:     collectionPaused,
				cancelAtPeriodEnd,
				currentPeriodEnd:     periodEnd,
				trialEnd,
			},
			updatedAt: FieldValue.serverTimestamp(),
		}, { merge: true });
	}
	return true;
}

export type TransactionStatus = 'succeeded' | 'failed' | 'pending' | 'refunded' | 'disputed';

export interface TransactionRow {
	id:                string; // charge id
	uid:               string | null;
	customerId:        string | null;
	email:             string | null;
	amount:            number; // cents
	amountRefunded:    number; // cents
	currency:          string;
	status:            TransactionStatus;
	subscriptionId:    string | null;
	paymentIntentId:   string | null;
	description:       string | null;
	created:           Date;
	updatedAt:          FieldValue;
	livemode:          boolean;
}

// Dispute fields are owned exclusively by the charge.dispute.* handler — a
// charge.* row must never write these keys (even as null), or a later
// charge.updated merge would clobber dispute state the dispute handler set.
export interface DisputeFields {
	disputeId:     string;
	disputeStatus: string;
	disputeAmount: number;
}

/**
 * Best-effort attribution chain — charge metadata, then customer lookup against
 * the users collection. Returns null (not throws) when nothing matches; an
 * unattributed row is still written so it's visible in admin rather than dropped.
 */
export async function attributeUid(charge: Stripe.Charge): Promise<string | null> {
	if (charge.metadata?.uid) return charge.metadata.uid;

	const customerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id;
	if (!customerId) return null;

	const db = getAdminDb();
	const byCustomer = await db.collection('users')
		.where('subscription.stripeCustomerId', '==', customerId)
		.limit(1)
		.get();
	if (!byCustomer.empty) return byCustomer.docs[0].id;

	// Fall back to orgs, which key subscriptions the same way.
	const orgByCustomer = await db.collection('orgs')
		.where('stripeCustomerId', '==', customerId)
		.limit(1)
		.get();
	if (!orgByCustomer.empty) return orgByCustomer.docs[0].data().ownerId ?? null;

	return null;
}

/**
 * Idempotent upsert keyed by charge id — safe against Stripe's at-least-once,
 * out-of-order delivery and against re-running the backfill sync.
 */
export async function upsertTransaction(row: Omit<TransactionRow, 'updatedAt'>): Promise<void> {
	await getAdminDb().doc(`transactions/${row.id}`).set(
		{ ...row, updatedAt: FieldValue.serverTimestamp() },
		{ merge: true },
	);
}

export function chargeToRow(charge: Stripe.Charge, uid: string | null): Omit<TransactionRow, 'updatedAt'> {
	let status: TransactionStatus = 'succeeded';
	if (charge.status === 'failed') status = 'failed';
	else if (charge.status === 'pending') status = 'pending';
	if (charge.refunded || charge.amount_refunded > 0) status = 'refunded';
	if (charge.disputed) status = 'disputed';

	return {
		id:              charge.id,
		uid,
		customerId:      typeof charge.customer === 'string' ? charge.customer : charge.customer?.id ?? null,
		email:           charge.billing_details?.email ?? charge.receipt_email ?? null,
		amount:          charge.amount,
		amountRefunded:  charge.amount_refunded,
		currency:        charge.currency,
		status,
		subscriptionId:  null,
		paymentIntentId: typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null,
		description:     charge.description ?? null,
		created:         new Date(charge.created * 1000),
		livemode:        charge.livemode,
	};
}
