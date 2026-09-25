// ─────────────────────────────────────────────
// OmniPlot — PER-USER BILLING REPAIR
// ─────────────────────────────────────────────
// The two checks behind "I paid but my account still says Free":
//   1. resyncUserBilling — find the user's live subscription on the connected
//      account and re-apply it to their user doc (the same writer the webhook
//      uses). Covers subscriptions that never synced because the webhook
//      missed them, including ones missing `metadata.uid`.
//   2. recentCharges — their ledger rows, flagging likely duplicate charges
//      so they can be refunded from the same screen.

import type Stripe from 'stripe';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb } from '$lib/server/firebase-admin';
import { getConnectedCustomerId } from '$lib/server/stripe-customer';
import { syncSubscriptionToFirestore } from '$lib/server/stripe-ledger';

const LIVE = new Set(['active', 'trialing', 'past_due']);

export interface ResyncResult {
	tierBefore: string;
	tierAfter: string;
	subscriptions: { id: string; status: string; customerId: string; synced: boolean; stampedUid: boolean }[];
	note: string;
}

export async function resyncUserBilling(uid: string): Promise<ResyncResult> {
	const db = getAdminDb();
	const user = (await db.doc(`users/${uid}`).get()).data() ?? {};
	const tierBefore: string = user.tier ?? 'free';
	const emails = [user.email, user.billingEmail].filter(Boolean).map((e: string) => e.toLowerCase());

	// Their own customer first, then any connected-account customer with a
	// matching email — a checkout during the misrouting window could have
	// created a second customer that nobody linked back to the user.
	const customerIds = new Set<string>();
	const own = await getConnectedCustomerId(uid);
	if (own) customerIds.add(own);
	for (const email of new Set(emails)) {
		const found = await stripe.customers.list({ email, limit: 10 }, connectedAccount);
		for (const c of found.data) customerIds.add(c.id);
	}

	const subs: Stripe.Subscription[] = [];
	for (const customer of customerIds) {
		const page = await stripe.subscriptions.list({ customer, status: 'all', limit: 20 }, connectedAccount);
		subs.push(...page.data);
	}

	// Live subs last so they win if an old canceled one also syncs.
	subs.sort((a, b) => Number(LIVE.has(a.status)) - Number(LIVE.has(b.status)) || a.created - b.created);

	const results: ResyncResult['subscriptions'] = [];
	for (let sub of subs) {
		let stampedUid = false;
		const metaUid = sub.metadata?.uid;
		if (metaUid && metaUid !== uid) {
			// Belongs to someone else (shared billing email) — never reassign.
			results.push({ id: sub.id, status: sub.status, customerId: String(sub.customer), synced: false, stampedUid: false });
			continue;
		}
		if (!metaUid) {
			sub = await stripe.subscriptions.update(sub.id, { metadata: { ...sub.metadata, uid } }, connectedAccount);
			stampedUid = true;
		}
		const synced = await syncSubscriptionToFirestore(sub);
		results.push({ id: sub.id, status: sub.status, customerId: String(sub.customer), synced, stampedUid });
	}

	const tierAfter: string = (await db.doc(`users/${uid}`).get()).data()?.tier ?? 'free';
	const live = results.filter((r) => LIVE.has(r.status));
	const note =
		subs.length === 0 ? 'No subscriptions found on the connected account for this user or their email.'
		: live.length === 0 ? 'Only inactive subscriptions found — nothing to activate.'
		: tierBefore === tierAfter ? `Already in sync (${tierAfter}).`
		: `Fixed: ${tierBefore} → ${tierAfter}.`;

	return { tierBefore, tierAfter, subscriptions: results, note };
}

export interface ChargeRow {
	id: string;
	amount: number;
	amountRefunded: number;
	currency: string;
	status: string;
	description: string | null;
	created: number;
	possibleDuplicate: boolean;
}

const DUPLICATE_WINDOW_MS = 72 * 60 * 60 * 1000;

export async function recentCharges(uid: string): Promise<ChargeRow[]> {
	const snap = await getAdminDb().collection('transactions').where('uid', '==', uid).limit(50).get();
	const rows: ChargeRow[] = snap.docs
		.map((d) => {
			const t = d.data();
			return {
				id: d.id,
				amount: t.amount ?? 0,
				amountRefunded: t.amountRefunded ?? 0,
				currency: t.currency ?? 'usd',
				status: t.status ?? 'succeeded',
				description: t.description ?? null,
				created: t.created?.toMillis?.() ?? 0,
				possibleDuplicate: false,
			};
		})
		.sort((a, b) => a.created - b.created);

	// A second successful, unrefunded charge for the same amount within 72h of
	// another is almost always a duplicate checkout — flag the later one.
	for (let i = 0; i < rows.length; i++) {
		const r = rows[i];
		if (r.status !== 'succeeded' || r.amountRefunded >= r.amount) continue;
		r.possibleDuplicate = rows.slice(0, i).some(
			(p) => p.status !== 'failed' && p.amount === r.amount && p.currency === r.currency && r.created - p.created <= DUPLICATE_WINDOW_MS,
		);
	}
	return rows.reverse().slice(0, 12);
}
