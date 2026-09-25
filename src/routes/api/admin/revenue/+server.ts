import { json } from '@sveltejs/kit';
import type Stripe from 'stripe';
import type { RequestHandler } from './$types';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { tierFromSubscription, orgPlanFromSubscription } from '$lib/server/stripe-ledger';

// Revenue is read straight from Stripe on every load — NOT from the Firestore
// `transactions` mirror, which only fills when the webhook delivers and so
// silently under-counts whenever delivery breaks (as it did in Sep 2026).
//
// Source of truth is the connected account's balance transactions: the same
// ledger Stripe's own balance reports are built from, so gross − refunds −
// disputes − fees here equals what actually landed in the balance.
//
// The one exception is Sep 4–24 2026, when prod checkouts ran on the PLATFORM
// account (shared with other businesses). Those charges are found only via the
// platform customer ids recorded in billingMigrations/*, so nothing from the
// platform's other businesses can leak in, and they're reported separately.

const CURRENCY = 'usd';

// Money movements that aren't revenue — moving the balance out, not earning it.
const NON_REVENUE = new Set(['payout', 'payout_reversal', 'transfer', 'transfer_reversal', 'topup', 'topup_reversal']);

// Subscriptions that contribute to MRR. Trials haven't paid yet; paused ones
// (pause_collection) are excluded below; canceled/incomplete never paid.
const MRR_STATUSES = new Set<Stripe.Subscription.Status>(['active', 'past_due']);
const LISTED_STATUSES = new Set<Stripe.Subscription.Status>(['active', 'past_due', 'trialing']);

// Hard cap so a runaway account can't make this page hang; flagged in the response.
const MAX_BALANCE_TXNS = 20_000;

async function assertAdmin(authHeader: string | null): Promise<boolean> {
	const uid = await verifyIdToken(authHeader);
	if (!uid) return false;
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.data()?.tier === 'admin';
}

interface MonthBucket {
	month:         string; // YYYY-MM (UTC)
	gross:         number;
	refunds:       number;
	disputes:      number;
	fees:          number;
	net:           number;
	charges:       number;
	platformGross: number; // portion of gross collected on the platform account
	adjustments:   number;
}

interface Payment {
	id:             string;
	created:        number;
	email:          string | null;
	description:    string | null;
	amount:         number;
	amountRefunded: number;
	fee:            number;
	disputed:       boolean;
	account:        'connected' | 'platform';
}

function monthKey(unix: number): string {
	return new Date(unix * 1000).toISOString().slice(0, 7);
}

function emptyBucket(month: string): MonthBucket {
	return { month, gross: 0, refunds: 0, disputes: 0, fees: 0, net: 0, charges: 0, platformGross: 0, adjustments: 0 };
}

/** Normalizes one subscription item to cents per month. */
function monthlyAmount(item: Stripe.SubscriptionItem): number {
	const p = item.price;
	const unit = p.unit_amount ?? Math.round(Number(p.unit_amount_decimal ?? 0));
	const total = unit * (item.quantity ?? 1);
	const every = p.recurring?.interval_count ?? 1;
	switch (p.recurring?.interval) {
		case 'year':  return total / (12 * every);
		case 'week':  return (total * 52) / (12 * every);
		case 'day':   return (total * 365) / (12 * every);
		default:      return total / every;
	}
}

/** Recurring discounts reduce MRR; a one-off ("once", e.g. a free-month coupon) doesn't. */
function applyDiscounts(sub: Stripe.Subscription, monthly: number): { mrr: number; oneOffDiscount: boolean } {
	let mrr = monthly;
	let oneOffDiscount = false;
	const now = Date.now() / 1000;
	for (const d of sub.discounts ?? []) {
		if (typeof d === 'string') continue;
		if (d.end && d.end < now) continue;
		const coupon = d.source?.coupon;
		if (!coupon || typeof coupon === 'string') continue;
		if (coupon.duration === 'once') { oneOffDiscount = true; continue; }
		if (coupon.percent_off) mrr *= 1 - coupon.percent_off / 100;
		else if (coupon.amount_off && coupon.currency === sub.currency) {
			// amount_off is per invoice — spread over the billing interval like the price.
			const item = sub.items.data[0];
			const ratio = item ? monthlyAmount(item) / Math.max(1, (item.price.unit_amount ?? 0) * (item.quantity ?? 1)) : 1;
			mrr -= coupon.amount_off * ratio;
		}
	}
	return { mrr: Math.max(0, Math.round(mrr)), oneOffDiscount };
}

export const GET: RequestHandler = async ({ request }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const warnings: string[] = [];
	const buckets = new Map<string, MonthBucket>();
	const bucket = (unix: number) => {
		const k = monthKey(unix);
		let b = buckets.get(k);
		if (!b) { b = emptyBucket(k); buckets.set(k, b); }
		return b;
	};

	// ── 1. Connected account ledger (all time) ────────────────────────────────
	const connected = { gross: 0, refunds: 0, disputes: 0, other: 0, net: 0, fees: 0, charges: 0, payouts: 0 };
	const payments: Payment[] = [];
	let otherCurrency = 0;
	let scanned = 0;
	let truncated = false;

	try {
		for await (const t of stripe.balanceTransactions.list({ limit: 100, expand: ['data.source'] }, connectedAccount)) {
			if (++scanned > MAX_BALANCE_TXNS) { truncated = true; break; }
			if (t.currency !== CURRENCY) { otherCurrency++; continue; }

			const cat = t.reporting_category;
			if (cat === 'payout' || cat === 'payout_reversal') { connected.payouts -= t.amount; continue; }
			if (NON_REVENUE.has(cat)) continue;

			const b = bucket(t.created);
			connected.net += t.net;
			b.net += t.net;

			if (cat === 'charge') {
				connected.gross += t.amount; b.gross += t.amount;
				connected.charges++;       b.charges++;
				const ch = t.source && typeof t.source === 'object' && t.source.object === 'charge' ? t.source as Stripe.Charge : null;
				payments.push({
					id:             ch?.id ?? t.id,
					created:        t.created,
					email:          ch?.billing_details?.email ?? ch?.receipt_email ?? null,
					description:    ch?.description ?? t.description ?? null,
					amount:         t.amount,
					amountRefunded: ch?.amount_refunded ?? 0,
					fee:            t.fee,
					disputed:       ch?.disputed ?? false,
					account:        'connected',
				});
			} else if (cat === 'refund' || cat === 'refund_failure' || cat === 'partial_capture_reversal') {
				connected.refunds -= t.amount; b.refunds -= t.amount;
			} else if (cat === 'dispute' || cat === 'dispute_reversal') {
				connected.disputes -= t.amount; b.disputes -= t.amount;
			} else if (cat !== 'fee') {
				// Adjustments, etc. — kept so the fee identity below balances exactly.
				connected.other += t.amount; b.adjustments += t.amount;
			}
		}
	} catch (err) {
		console.error('[admin/revenue] balance transactions failed:', err);
		return json({ error: 'Could not read the Stripe ledger — check STRIPE_CONNECTED_ACCOUNT_ID / key.' }, { status: 502 });
	}

	// Everything not accounted for as gross/refund/dispute/adjustment is Stripe's
	// cut — per-charge fees plus standalone fee debits (Billing, Radar, etc.).
	connected.fees = connected.gross - connected.refunds - connected.disputes + connected.other - connected.net;
	for (const b of buckets.values()) b.fees = b.gross - b.refunds - b.disputes + b.adjustments - b.net;
	if (connected.other !== 0) warnings.push(`Ledger includes ${fmt(connected.other)} of adjustments (not charges/refunds/fees) — see the Stripe dashboard.`);
	if (otherCurrency) warnings.push(`${otherCurrency} non-USD balance transaction(s) excluded from totals.`);
	if (truncated) warnings.push(`Only the newest ${MAX_BALANCE_TXNS.toLocaleString()} balance transactions were read — older totals are incomplete.`);

	// ── 2. Platform account — Sep 2026 misrouted charges only ─────────────────
	const platform = { gross: 0, refunds: 0, fees: 0, net: 0, charges: 0 };
	try {
		const migrations = await getAdminDb().collection('billingMigrations').get();
		const customerIds = [...new Set(migrations.docs.map((d) => d.data().platformCustomerId).filter((c): c is string => typeof c === 'string'))];
		const lists = await Promise.all(customerIds.map((customer) =>
			// No connectedAccount here on purpose — these live on the platform account.
			stripe.charges.list({ customer, limit: 100, expand: ['data.balance_transaction'] })));
		for (const ch of lists.flatMap((l) => l.data)) {
			if (ch.status !== 'succeeded' || ch.currency !== CURRENCY) continue;
			const bt = typeof ch.balance_transaction === 'object' ? ch.balance_transaction : null;
			const fee = bt?.fee ?? 0;
			const b = bucket(ch.created);
			platform.gross += ch.amount;         b.gross += ch.amount; b.platformGross += ch.amount;
			platform.refunds += ch.amount_refunded; b.refunds += ch.amount_refunded;
			platform.fees += fee;                b.fees += fee;
			platform.charges++;                  b.charges++;
			const net = ch.amount - ch.amount_refunded - fee;
			platform.net += net;                 b.net += net;
			payments.push({
				id:             ch.id,
				created:        ch.created,
				email:          ch.billing_details?.email ?? ch.receipt_email ?? null,
				description:    ch.description ?? null,
				amount:         ch.amount,
				amountRefunded: ch.amount_refunded,
				fee,
				disputed:       ch.disputed,
				account:        'platform',
			});
		}
	} catch (err) {
		console.error('[admin/revenue] platform charges failed:', err);
		warnings.push('Could not read the Sep 2026 platform-account charges — totals exclude them.');
	}

	// ── 3. Subscriptions → MRR ────────────────────────────────────────────────
	const subscriptions: {
		id: string; email: string | null; plan: string; status: string;
		mrr: number; cancelAtPeriodEnd: boolean; paused: boolean; oneOffDiscount: boolean;
		nextBill: number | null; created: number; kind: 'individual' | 'org';
	}[] = [];
	const byPlan: Record<string, { count: number; mrr: number }> = {};
	let mrr = 0;
	let trialing = 0;
	let cancelling = 0;
	let atRiskMrr = 0;

	try {
		for await (const s of stripe.subscriptions.list(
			{ status: 'all', limit: 100, expand: ['data.customer', 'data.discounts.source.coupon'] },
			connectedAccount,
		)) {
			if (!LISTED_STATUSES.has(s.status)) continue;
			if (s.currency !== CURRENCY) { warnings.push(`Subscription ${s.id} is ${s.currency.toUpperCase()} — excluded from MRR.`); continue; }

			const isOrg = s.metadata?.type === 'org';
			let plan: string;
			if (isOrg) {
				const o = await orgPlanFromSubscription(s);
				plan = o ? `${o.plan} (${o.seats} seat${o.seats === 1 ? '' : 's'})` : 'team';
			} else {
				plan = (await tierFromSubscription(s)) ?? s.items.data[0]?.price.nickname ?? 'unknown';
			}
			const planKey = isOrg ? (plan.split(' ')[0]) : plan;

			const gross = s.items.data.reduce((sum, it) => sum + monthlyAmount(it), 0);
			const { mrr: subMrr, oneOffDiscount } = applyDiscounts(s, gross);
			const paused = !!s.pause_collection;
			const counts = MRR_STATUSES.has(s.status) && !paused;

			if (s.status === 'trialing') trialing++;
			if (counts) {
				mrr += subMrr;
				byPlan[planKey] ??= { count: 0, mrr: 0 };
				byPlan[planKey].count++;
				byPlan[planKey].mrr += subMrr;
				if (s.cancel_at_period_end || s.cancel_at) { cancelling++; atRiskMrr += subMrr; }
			}

			const customer = typeof s.customer === 'object' && !('deleted' in s.customer && s.customer.deleted) ? s.customer as Stripe.Customer : null;
			subscriptions.push({
				id:                s.id,
				email:             customer?.email ?? null,
				plan,
				status:            paused ? 'paused' : s.status,
				mrr:               counts ? subMrr : 0,
				cancelAtPeriodEnd: s.cancel_at_period_end || !!s.cancel_at,
				paused,
				oneOffDiscount,
				nextBill:          s.items.data[0]?.current_period_end ?? null,
				created:           s.created,
				kind:              isOrg ? 'org' : 'individual',
			});
		}
	} catch (err) {
		console.error('[admin/revenue] subscriptions failed:', err);
		warnings.push('Could not read subscriptions — MRR unavailable.');
	}

	// ── 4. Balance ────────────────────────────────────────────────────────────
	let balance: { available: number; pending: number } | null = null;
	try {
		const bal = await stripe.balance.retrieve({}, connectedAccount);
		const sum = (arr: Stripe.Balance.Available[] | Stripe.Balance.Pending[]) =>
			arr.filter((a) => a.currency === CURRENCY).reduce((s, a) => s + a.amount, 0);
		balance = { available: sum(bal.available), pending: sum(bal.pending) };
	} catch (err) {
		console.error('[admin/revenue] balance failed:', err);
	}

	// Fill empty months so the series has no gaps, oldest → newest.
	const months = [...buckets.keys()].sort();
	if (months.length) {
		const [y0, m0] = months[0].split('-').map(Number);
		const end = monthKey(Date.now() / 1000);
		for (let d = new Date(Date.UTC(y0, m0 - 1, 1)); d.toISOString().slice(0, 7) <= end; d.setUTCMonth(d.getUTCMonth() + 1)) {
			const k = d.toISOString().slice(0, 7);
			if (!buckets.has(k)) buckets.set(k, emptyBucket(k));
		}
	}

	payments.sort((a, b) => b.created - a.created);
	subscriptions.sort((a, b) => b.mrr - a.mrr || b.created - a.created);

	return json({
		currency: CURRENCY,
		generatedAt: Math.floor(Date.now() / 1000),
		connected,
		platform,
		totals: {
			gross:    connected.gross + platform.gross,
			refunds:  connected.refunds + platform.refunds,
			disputes: connected.disputes,
			fees:     connected.fees + platform.fees,
			net:      connected.net + platform.net,
			charges:  connected.charges + platform.charges,
		},
		mrr,
		arr: mrr * 12,
		activeSubscribers: Object.values(byPlan).reduce((s, p) => s + p.count, 0),
		trialing,
		cancelling,
		atRiskMrr,
		byPlan,
		balance,
		months: [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month)),
		payments: payments.slice(0, 100),
		subscriptions,
		warnings,
	});
};

function fmt(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}
