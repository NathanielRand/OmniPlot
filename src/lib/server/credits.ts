// ─────────────────────────────────────────────
// OmniPlot — FREE-MONTH CREDITS (coupons)
// ─────────────────────────────────────────────
// "Next month is on us" is a single-use Stripe coupon attached to the
// customer's subscription on the connected account — no money moves and no
// balance is created; their next invoice is simply discounted. (Refunds are
// the separate tool for giving money back.)
//
//   monthly plan, N months  → 100% off, for the next N invoices
//   yearly/other interval   → fixed amount off = N × one month's price, once
//                             (100% off a yearly invoice would be a free year)
//   custom amount           → fixed amount off the next invoice, once
//
// Every coupon we grant is also written to `billingCredits` (admin SDK only)
// as the audit trail: who, why, which ticket, and the coupon/discount it made.

import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb } from '$lib/server/firebase-admin';
import { getConnectedCustomerId } from '$lib/server/stripe-customer';

export type CreditReason = 'service_issue' | 'billing_error' | 'goodwill' | 'other';

export const CREDIT_REASON_LABEL: Record<CreditReason, string> = {
	service_issue: 'Service issue (our fault)',
	billing_error: 'Billing error',
	goodwill:      'Goodwill',
	other:         'Other',
};

/** applied  = coupon is on the subscription, waiting for the next invoice(s)
 *  used     = Stripe consumed it (it's no longer on the subscription)
 *  reversed = an admin removed it before it was used */
export type CreditStatus = 'applied' | 'used' | 'reversed';

export interface CreditRecord {
	id: string;
	uid: string;
	customerId: string;
	subscriptionId: string;
	couponId: string;
	/** Human label, also the coupon name on the invoice ("1 month on us"). */
	label: string;
	months: number | null;
	/** Estimated value, for reporting only — the coupon itself is what applies. */
	valueCents: number;
	currency: string;
	reason: CreditReason;
	note: string;
	ticketId: string | null;
	adminUid: string;
	adminName: string;
	status: CreditStatus;
	reversedBy: string | null;
	createdAt: number;
}

export class CreditError extends Error {
	constructor(message: string, public status = 400) { super(message); }
}

const COLLECTION = 'billingCredits';
const LIVE = new Set(['active', 'trialing', 'past_due']);
const MAX_MONTHS = 12;
const MAX_AMOUNT_CENTS = 100_000; // $1,000 — a fat-finger guard, not a policy

function toMs(v: unknown): number {
	if (!v) return 0;
	if (typeof (v as { toMillis?: () => number }).toMillis === 'function') return (v as { toMillis: () => number }).toMillis();
	return typeof v === 'number' ? v : 0;
}

export function fmtCents(cents: number, currency = 'usd'): string {
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}

async function liveSubscription(uid: string): Promise<{ customerId: string; sub: Stripe.Subscription } | null> {
	const customerId = await getConnectedCustomerId(uid);
	if (!customerId) return null;
	const subs = await stripe.subscriptions.list(
		{ customer: customerId, status: 'all', limit: 10, expand: ['data.discounts'] },
		connectedAccount,
	);
	const sub = subs.data.find((s) => LIVE.has(s.status));
	return sub ? { customerId, sub } : null;
}

/** One month of this subscription's price, in its currency. */
function monthValue(sub: Stripe.Subscription): { cents: number; currency: string; monthly: boolean } | null {
	const item = sub.items.data[0];
	const price = item?.price;
	if (price?.unit_amount == null || !price.recurring) return null;
	const perInterval = price.unit_amount * (item.quantity ?? 1);
	const n = price.recurring.interval_count || 1;
	const { interval } = price.recurring;
	const cents =
		interval === 'year' ? perInterval / (12 * n)
		: interval === 'month' ? perInterval / n
		: interval === 'week' ? (perInterval * 52) / (12 * n)
		: (perInterval * 30) / n;
	return { cents: Math.round(cents), currency: price.currency, monthly: interval === 'month' && n === 1 };
}

function couponIdOf(d: string | Stripe.Discount): string | null {
	if (typeof d === 'string') return null;
	const c = d.source?.coupon;
	return typeof c === 'string' ? c : c?.id ?? null;
}

// ─── Reads ────────────────────────────────────

export interface CreditSummary {
	/** Null when there's no live subscription — free months need one. */
	subscription: { id: string; planLabel: string; monthValueCents: number; currency: string; monthly: boolean; cancelAtPeriodEnd: boolean } | null;
	/** Free-month coupons on the subscription, still waiting for an invoice. */
	pending: { id: string; label: string }[];
	history: CreditRecord[];
}

export async function getCreditSummary(uid: string): Promise<CreditSummary> {
	const [live, historySnap] = await Promise.all([
		liveSubscription(uid).catch(() => null),
		getAdminDb().collection(COLLECTION).where('uid', '==', uid).limit(50).get(),
	]);

	const onSub = new Set((live?.sub.discounts ?? []).map(couponIdOf).filter(Boolean) as string[]);
	const history = historySnap.docs
		.map((d) => {
			const r = { id: d.id, ...d.data(), createdAt: toMs(d.data().createdAt) } as CreditRecord;
			// "applied" becomes "used" once Stripe has taken it off the subscription.
			if (r.status === 'applied' && (!live || r.subscriptionId !== live.sub.id || !onSub.has(r.couponId))) r.status = 'used';
			return r;
		})
		.sort((a, b) => b.createdAt - a.createdAt);

	const month = live ? monthValue(live.sub) : null;
	return {
		subscription: live && month
			? {
				id: live.sub.id,
				planLabel: live.sub.items.data[0]?.price.nickname || (month.monthly ? 'monthly plan' : 'yearly plan'),
				monthValueCents: month.cents,
				currency: month.currency,
				monthly: month.monthly,
				cancelAtPeriodEnd: !!live.sub.cancel_at_period_end,
			}
			: null,
		pending: history.filter((h) => h.status === 'applied').map((h) => ({ id: h.id, label: h.label })),
		history,
	};
}

/** What the customer sees on Settings → Billing. */
export async function getPendingFreeMonths(uid: string): Promise<string[]> {
	const live = await liveSubscription(uid);
	if (!live) return [];
	return (live.sub.discounts ?? [])
		.filter((d): d is Stripe.Discount => typeof d !== 'string')
		.map((d) => (typeof d.source?.coupon === 'object' ? d.source.coupon : null))
		.filter((c): c is Stripe.Coupon => !!c && c.metadata?.omniplotCredit === '1')
		.map((c) => c.name ?? 'Free month');
}

// ─── Writes ───────────────────────────────────

export interface ApplyCreditInput {
	uid: string;
	/** Whole months free, or an explicit amount off the next invoice. */
	months?: number;
	amountCents?: number;
	reason: CreditReason;
	note?: string;
	ticketId?: string | null;
	admin: { uid: string; name: string };
}

export async function applyCredit(input: ApplyCreditInput): Promise<CreditRecord> {
	const db = getAdminDb();

	// One make-good per ticket — a double-click or a re-sent reply must never
	// grant twice. (Stripe idempotency keys below back this up.)
	if (input.ticketId) {
		const existing = await db.collection(COLLECTION).where('ticketId', '==', input.ticketId).limit(5).get();
		if (existing.docs.some((d) => d.data().status !== 'reversed')) {
			throw new CreditError('This ticket already has a free month applied.', 409);
		}
	}

	const live = await liveSubscription(input.uid);
	if (!live) throw new CreditError('This account has no active subscription — a free month applies to a subscription\'s next invoice.');
	if (live.sub.cancel_at_period_end) {
		throw new CreditError('Their subscription is set to cancel, so there is no next invoice for a free month to apply to.');
	}
	const month = monthValue(live.sub);
	if (!month) throw new CreditError('Could not read this subscription\'s price.');

	let params: Stripe.CouponCreateParams;
	let label: string;
	let months: number | null = null;
	let valueCents: number;

	if (input.months) {
		months = Math.max(1, Math.min(MAX_MONTHS, Math.round(input.months)));
		label = `${months} month${months === 1 ? '' : 's'} on us`;
		valueCents = month.cents * months;
		params = month.monthly
			? months === 1
				? { percent_off: 100, duration: 'once' }
				: { percent_off: 100, duration: 'repeating', duration_in_months: months }
			: { amount_off: valueCents, currency: month.currency, duration: 'once' };
	} else {
		valueCents = Math.round(input.amountCents ?? 0);
		if (!Number.isFinite(valueCents) || valueCents <= 0) throw new CreditError('Enter an amount greater than zero.');
		label = `${fmtCents(valueCents, month.currency)} off on us`;
		params = { amount_off: valueCents, currency: month.currency, duration: 'once' };
	}
	if (valueCents > MAX_AMOUNT_CENTS) throw new CreditError('Credits over $1,000 need to be done directly in Stripe.');

	const ref = db.collection(COLLECTION).doc();
	const key = input.ticketId ? `ticket-${input.ticketId}` : ref.id;

	// A single-use coupon per grant: it's named for the invoice line, can't be
	// redeemed anywhere else, and carries its own audit metadata.
	const coupon = await stripe.coupons.create(
		{
			...params,
			name: label,
			max_redemptions: 1,
			metadata: { omniplotCredit: '1', uid: input.uid, creditId: ref.id, ticketId: input.ticketId ?? '', reason: input.reason },
		},
		{ ...connectedAccount, idempotencyKey: `credit-coupon-${key}` },
	);

	// Keep any discounts already on the subscription — `discounts` replaces the list.
	const keep = (live.sub.discounts ?? []).map((d) => ({ discount: typeof d === 'string' ? d : d.id }));
	await stripe.subscriptions.update(
		live.sub.id,
		{ discounts: [...keep, { coupon: coupon.id }] },
		{ ...connectedAccount, idempotencyKey: `credit-attach-${key}` },
	);

	const record = {
		uid: input.uid,
		customerId: live.customerId,
		subscriptionId: live.sub.id,
		couponId: coupon.id,
		label,
		months,
		valueCents,
		currency: month.currency,
		reason: input.reason,
		note: (input.note ?? '').slice(0, 500),
		ticketId: input.ticketId ?? null,
		adminUid: input.admin.uid,
		adminName: input.admin.name,
		status: 'applied' as CreditStatus,
		reversedBy: null,
		createdAt: FieldValue.serverTimestamp(),
	};
	await ref.set(record);
	return { ...record, id: ref.id, createdAt: Date.now() };
}

/** Removes a free month granted by mistake — only possible while it's still
 *  waiting on the subscription. Once an invoice has used it, it's done. */
export async function reverseCredit(creditId: string, admin: { uid: string; name: string }): Promise<CreditRecord> {
	const ref = getAdminDb().doc(`${COLLECTION}/${creditId}`);
	const snap = await ref.get();
	if (!snap.exists) throw new CreditError('Credit not found.', 404);
	const c = { id: creditId, ...snap.data(), createdAt: toMs(snap.data()!.createdAt) } as CreditRecord;
	if (c.status === 'reversed') throw new CreditError('This free month was already removed.', 409);

	const sub = await stripe.subscriptions.retrieve(c.subscriptionId, { expand: ['discounts'] }, connectedAccount);
	const discounts = sub.discounts ?? [];
	const ours = discounts.find((d) => couponIdOf(d) === c.couponId);
	if (!ours) {
		await ref.update({ status: 'used' });
		throw new CreditError('This free month has already been used on an invoice, so it can\'t be removed.', 409);
	}

	await stripe.subscriptions.update(
		c.subscriptionId,
		{ discounts: discounts.filter((d) => d !== ours).map((d) => ({ discount: typeof d === 'string' ? d : d.id })) },
		connectedAccount,
	);
	// Retire the coupon too so it can never be redeemed again.
	await stripe.coupons.del(c.couponId, {}, connectedAccount).catch(() => {});
	await ref.update({ status: 'reversed', reversedBy: admin.name, reversedAt: FieldValue.serverTimestamp() });
	return { ...c, status: 'reversed', reversedBy: admin.name };
}

// ─── Customer notices ─────────────────────────
// The in-app "a free month was applied" banner. Shown until the customer
// dismisses it (stored on the record, so it follows them across devices).

export interface CreditNotice { id: string; label: string; months: number | null }

export async function getCreditNotices(uid: string): Promise<CreditNotice[]> {
	const snap = await getAdminDb().collection(COLLECTION).where('uid', '==', uid).limit(50).get();
	return snap.docs
		.filter((d) => d.data().status !== 'reversed' && !d.data().noticeDismissedAt)
		.sort((a, b) => toMs(b.data().createdAt) - toMs(a.data().createdAt))
		.map((d) => ({ id: d.id, label: d.data().label ?? 'Free month', months: d.data().months ?? null }));
}

export async function dismissCreditNotice(uid: string, creditId: string): Promise<void> {
	const ref = getAdminDb().doc(`${COLLECTION}/${creditId}`);
	const snap = await ref.get();
	// Owner-only; anything else is silently ignored rather than confirming the id exists.
	if (!snap.exists || snap.data()?.uid !== uid) return;
	await ref.update({ noticeDismissedAt: FieldValue.serverTimestamp() });
}
