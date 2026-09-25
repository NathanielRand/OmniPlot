import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { getConnectedCustomerId } from '$lib/server/stripe-customer';
import { getOrgRole, roleAtLeast } from '$lib/server/org-auth';
import { checkRateLimit, rateLimitedResponse } from '$lib/server/rate-limit';
import { logServerError } from '$lib/server/log-error';
import { PAID_TIERS, syncSubscriptionToFirestore } from '$lib/server/stripe-ledger';

const SHOP_PLANS = ['starter', 'team', 'studio'];
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

// Build the config_id key that the admin sync stamps on every price
function buildConfigId(type: string, tier: string, plan: string, interval: 'month' | 'year'): string {
	const suffix = interval === 'year' ? 'yearly' : 'monthly';
	return type === 'org' ? `org_${plan}_${suffix}` : `${tier}_${suffix}`;
}

// Resolve a Stripe price ID for a plan/interval. Prefers the price ID cached
// in Firestore by the admin sync (settings/platform.plans/.shopPlans) —
// deterministic, and reflects the amount an admin last synced. Falls back to
// a live Stripe metadata scan for installs that haven't synced yet.
async function resolvePriceId(
	type: string, tier: string, plan: string, interval: 'month' | 'year',
): Promise<string | null> {
	const db   = getAdminDb();
	const snap = await db.doc('settings/platform').get();
	const data = snap.data() ?? {};

	const key = interval === 'year' ? 'stripeYearlyPriceId' : 'stripePriceId';
	const cached = type === 'org'
		? data.shopPlans?.[plan]?.[key]
		: data.plans?.[tier]?.[key];
	if (cached) return cached;

	// Fallback: scan live Stripe prices by config_id metadata (pre-sync installs).
	const configId = buildConfigId(type, tier, plan, interval);
	const prices = await stripe.prices.list({ limit: 100, active: true }, connectedAccount);
	return prices.data.find(p => p.metadata?.config_id === configId)?.id ?? null;
}

export const POST: RequestHandler = async ({ request, url }) => {
	try {
		const uid = await verifyIdToken(request.headers.get('authorization'));
		if (!uid) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const limit = await checkRateLimit(`checkout:${uid}`, { max: 10, windowSeconds: 60 });
		if (!limit.allowed) return rateLimitedResponse(limit);

		const { type = 'individual', orgId, tier, plan, interval = 'month' } = await request.json();

		// Reject anything that isn't a purchasable plan up front — `tier`
		// lands in subscription metadata, so it must never be free-form.
		if (interval !== 'month' && interval !== 'year') {
			return json({ error: 'Invalid billing interval.' }, { status: 400 });
		}
		if (type === 'org') {
			if (!orgId || !SHOP_PLANS.includes(plan)) return json({ error: 'Invalid team plan.' }, { status: 400 });
		} else if (!(PAID_TIERS as readonly string[]).includes(tier)) {
			return json({ error: 'Invalid plan.' }, { status: 400 });
		}

		const priceId = await resolvePriceId(type, tier ?? '', plan ?? '', interval);

		if (!priceId) {
			const configId = buildConfigId(type, tier ?? '', plan ?? '', interval);
			return json({
				error: `No active Stripe price found for "${configId}". Run the product sync in Admin → Products.`,
			}, { status: 400 });
		}

		// Reuse existing Stripe customer so saved cards are available and we
		// don't create duplicate customers on repeated checkout attempts.
		const db = getAdminDb();
		let customerId: string | undefined;
		if (type === 'org' && orgId) {
			const orgSnap = await db.doc(`orgs/${orgId}`).get();
			const orgData = orgSnap.data() ?? {};
			// Same gate as the billing portal — previously any signed-in user
			// could start (and overwrite the billing of) any org's checkout.
			const role = await getOrgRole(orgId, uid);
			if (!role || !roleAtLeast(role, 'owner')) {
				return json({ error: 'Only the organization owner can change its plan.' }, { status: 403 });
			}
			customerId = orgData.stripeCustomerId ?? undefined;
			if (customerId) {
				const ok = await stripe.customers.retrieve(customerId, {}, connectedAccount).then((c) => !('deleted' in c && c.deleted)).catch(() => false);
				if (!ok) customerId = undefined;
			}

			// Same as individual: an org that already has a live team sub gets
			// its plan changed in place, never a second concurrent subscription.
			let existing: Stripe.Subscription | null = null;
			if (orgData.stripeSubscriptionId) {
				existing = await stripe.subscriptions.retrieve(orgData.stripeSubscriptionId, {}, connectedAccount).catch(() => null);
			} else if (customerId) {
				const list = await stripe.subscriptions.list({ customer: customerId, limit: 10 }, connectedAccount);
				existing = list.data.find((s) => s.metadata?.orgId === orgId && LIVE_STATUSES.has(s.status)) ?? null;
			}
			if (existing && LIVE_STATUSES.has(existing.status)) {
				const item = existing.items.data[0];
				if (item?.price.id === priceId) return json({ error: 'Your team is already on this plan.' }, { status: 400 });
				const updated = await stripe.subscriptions.update(existing.id, {
					items: [{ id: item.id, price: priceId }],
					proration_behavior: 'always_invoice',
					payment_behavior:   'error_if_incomplete',
					cancel_at_period_end: false,
					metadata: { ...existing.metadata, uid, type: 'org', orgId, plan },
				}, connectedAccount);
				await syncSubscriptionToFirestore(updated);
				return json({ url: `${url.origin}/settings?tab=team&checkout=success`, updated: true });
			}
		} else {
			const userSnap = await db.doc(`users/${uid}`).get();
			const subData  = userSnap.data()?.subscription ?? {};

			// Subscribed during the Sep 2026 misrouted-billing window: their live
			// sub is on the platform account, invisible to the lookup below, so a
			// new checkout would double-bill them. Hand off to support instead.
			if (userSnap.data()?.legacyPlatformBilling) {
				return json({ error: "Your plan needs a quick manual update — please chat with support (Account menu → Support tickets) and we'll switch it for you." }, { status: 409 });
			}
			customerId = (await getConnectedCustomerId(uid)) ?? undefined;

			// Already subscribed (e.g. Lite → Pro): change the plan on the
			// EXISTING subscription. Opening a new Checkout here used to
			// create a second, concurrently-billed subscription whose events
			// then fought the first one over `users/{uid}.tier`.
			const existingSubId: string = subData.stripeSubscriptionId ?? '';
			if (existingSubId) {
				const existing = await stripe.subscriptions.retrieve(existingSubId, {}, connectedAccount).catch(() => null);
				if (existing && LIVE_STATUSES.has(existing.status)) {
					const item = existing.items.data[0];
					if (item?.price.id === priceId) {
						return json({ error: 'You are already on this plan.' }, { status: 400 });
					}
					if (existing.pause_collection) {
						return json({ error: 'Resume your paused plan before changing it.' }, { status: 400 });
					}
					const updated = await stripe.subscriptions.update(existingSubId, {
						items: [{ id: item.id, price: priceId }],
						// Bill/credit the difference now, and refuse the change
						// outright if the charge fails rather than granting the
						// new tier on an unpaid invoice.
						proration_behavior: 'always_invoice',
						payment_behavior:   'error_if_incomplete',
						cancel_at_period_end: false,
						metadata: { ...existing.metadata, uid, type: 'individual', tier },
					}, connectedAccount);
					// Write through so the UI flips immediately; the
					// customer.subscription.updated webhook reconciles the same.
					await syncSubscriptionToFirestore(updated);
					return json({ url: `${url.origin}/settings?tab=billing&checkout=success`, updated: true });
				}
			}
		}

		const meta: Record<string, string> = {
			uid,
			type,
			orgId: orgId ?? '',
			tier:  tier  ?? '',
			plan:  plan  ?? '',
		};

		const isOrg = type === 'org' && orgId;

		const session = await stripe.checkout.sessions.create({
			mode: 'subscription',
			customer: customerId,
			line_items: [{ price: priceId, quantity: 1 }],
			metadata: meta,
			subscription_data: { metadata: meta },
			success_url: isOrg
				? `${url.origin}/settings?tab=team&checkout=success`
				: `${url.origin}/settings?tab=billing&checkout=success`,
			cancel_url: isOrg
				? `${url.origin}/settings?tab=team`
				: `${url.origin}/pricing`,
			allow_promotion_codes: true,
		}, connectedAccount);

		return json({ url: session.url });

	} catch (err) {
		// Surface the real Stripe error message so it's visible in the UI
		if (err instanceof Stripe.errors.StripeError) {
			console.error('[checkout] Stripe error:', err.type, err.message);
			return json({ error: err.message }, { status: err.statusCode ?? 500 });
		}
		console.error('[checkout] Unexpected error:', err);
		await logServerError(err, { source: 'api', route: '/api/billing/checkout', severity: 'error' });
		return json({ error: 'Unexpected server error during checkout.' }, { status: 500 });
	}
};
