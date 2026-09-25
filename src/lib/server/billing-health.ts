import { STRIPE_CONNECTED_ACCOUNT_ID, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } from '$env/static/private';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb } from '$lib/server/firebase-admin';
import { tierFromSubscription, PAID_TIERS, SHOP_PLANS } from '$lib/server/stripe-ledger';

export interface HealthCheck {
	name:   string;
	ok:     boolean;
	detail: string;
}

const LIVE = new Set(['active', 'trialing', 'past_due']);
const DEFAULT_AMOUNTS: Record<string, [number, number]> = {
	lite: [29, 24], pro: [79, 66], starter: [149, 124], team: [299, 249], studio: [499, 416],
};

/**
 * End-to-end billing self-test. Every check here maps to a way billing
 * silently broke in Sep 2026: a missing connected-account ID routed
 * checkouts to the platform account, cached price IDs pointed at the wrong
 * account, and the webhook failed without anyone noticing — for three weeks.
 * Run daily by /api/cron/billing-health (failures → errorLogs + alert email)
 * and on demand from Admin → Billing.
 */
export async function checkBillingHealth(): Promise<HealthCheck[]> {
	const checks: HealthCheck[] = [];
	const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
	const run = async (name: string, fn: () => Promise<void>) => {
		try { await fn(); } catch (e) { add(name, false, e instanceof Error ? e.message : String(e)); }
	};

	// ── 1. Environment ──────────────────────────────────────────────────────
	const connectedId = (STRIPE_CONNECTED_ACCOUNT_ID ?? '').trim();
	add('env: connected account ID', /^acct_[A-Za-z0-9]+$/.test(connectedId),
		connectedId ? `set (${connectedId.slice(0, 9)}…)` : 'STRIPE_CONNECTED_ACCOUNT_ID is missing — checkouts would hit the platform account');
	add('env: webhook secret', /^whsec_/.test((STRIPE_WEBHOOK_SECRET ?? '').trim()), 'STRIPE_WEBHOOK_SECRET must start with whsec_');
	const liveKey = (STRIPE_SECRET_KEY ?? '').startsWith('sk_live') || (STRIPE_SECRET_KEY ?? '').startsWith('rk_live');
	add('env: secret key mode', true, liveKey ? 'live' : 'TEST mode key');

	// ── 2. Connected account reachable and able to charge ──────────────────
	await run('connected account', async () => {
		const a = await stripe.accounts.retrieve(connectedId);
		add('connected account', !!a.charges_enabled, a.charges_enabled ? `${a.id} charges enabled` : `${a.id} charges DISABLED`);
	});

	// ── 3. Cached price IDs resolve on the connected account ───────────────
	const db = getAdminDb();
	const settings = (await db.doc('settings/platform').get()).data() ?? {};
	for (const [group, keys] of [['plans', PAID_TIERS], ['shopPlans', SHOP_PLANS]] as const) {
		for (const k of keys) {
			const e = settings[group]?.[k] ?? {};
			for (const [idKey, interval, mult, idx] of [['stripePriceId', 'month', 1, 0], ['stripeYearlyPriceId', 'year', 12, 1]] as const) {
				const name = `price: ${k} ${interval}ly`;
				await run(name, async () => {
					const id = e[idKey];
					if (!id) { add(name, false, 'no cached price ID — run Admin → Products sync'); return; }
					const p = await stripe.prices.retrieve(id, {}, connectedAccount);
					const want = Math.round(Number(e[idx === 0 ? 'price' : 'yearlyPrice'] ?? DEFAULT_AMOUNTS[k][idx]) * mult * 100);
					const ok = p.active && p.recurring?.interval === interval && p.unit_amount === want;
					add(name, ok, ok ? `${id} $${want / 100}` : `${id} active=${p.active} interval=${p.recurring?.interval} $${(p.unit_amount ?? 0) / 100} (want $${want / 100})`);
				});
			}
		}
	}

	// ── 4. Misrouting detector: OmniPlot checkouts on the PLATFORM account ──
	await run('no platform-account checkouts', async () => {
		// Sessions before the Sep 24 2026 migration are known and already
		// migrated (see billingMigrations/*) — only watch for new misrouting.
		const MIGRATED_BEFORE = Date.UTC(2026, 8, 25) / 1000;
		const since = Math.max(Math.floor(Date.now() / 1000) - 7 * 86400, MIGRATED_BEFORE);
		const sessions = await stripe.checkout.sessions.list({ limit: 100, created: { gte: since } });
		const ours = sessions.data.filter((s) => s.metadata?.uid);
		add('no platform-account checkouts', ours.length === 0,
			ours.length ? `${ours.length} OmniPlot checkout(s) on the platform account in 7 days — money is being misrouted` : 'none in last 7 days');
	});

	// ── 5. Webhook delivering (connected-account events not stuck) ──────────
	await run('webhook delivery', async () => {
		const now = Math.floor(Date.now() / 1000);
		const events = await stripe.events.list({ limit: 100, created: { gte: now - 3 * 86400, lte: now - 3600 } }, connectedAccount);
		const stuck = events.data.filter((e) => e.pending_webhooks > 0);
		add('webhook delivery', stuck.length === 0,
			stuck.length ? `${stuck.length} event(s) >1h old still undelivered (e.g. ${stuck[0].type}) — check STRIPE_WEBHOOK_SECRET / function logs` : `${events.data.length} recent events delivered`);
	});

	// ── 6. Reconciliation: Stripe subscriptions ↔ Firestore entitlements ───
	await run('subscriptions in sync', async () => {
		const problems: string[] = [];
		const liveUids = new Set<string>();
		for await (const s of stripe.subscriptions.list({ status: 'all', limit: 100 }, connectedAccount)) {
			const { uid, type, orgId } = s.metadata ?? {};
			if (!uid || !LIVE.has(s.status)) continue;
			if (type === 'org' && orgId) {
				const o = (await db.doc(`orgs/${orgId}`).get()).data();
				if (o?.subscriptionStatus !== s.status) problems.push(`org ${orgId}: status ${o?.subscriptionStatus} ≠ ${s.status}`);
				continue;
			}
			if (liveUids.has(uid)) problems.push(`user ${uid}: more than one live subscription (double-billed)`);
			liveUids.add(uid);
			const u = (await db.doc(`users/${uid}`).get()).data();
			const want = s.pause_collection ? 'free' : await tierFromSubscription(s);
			if (u?.tier !== 'admin' && u?.tier !== want) problems.push(`user ${uid}: tier "${u?.tier}" but paying for "${want}"`);
			if (u?.subscription?.stripeSubscriptionId !== s.id) problems.push(`user ${uid}: stored sub ${u?.subscription?.stripeSubscriptionId ?? 'none'} ≠ ${s.id}`);
		}
		const paid = await db.collection('users').where('tier', 'in', [...PAID_TIERS]).get();
		for (const d of paid.docs) {
			if (!liveUids.has(d.id) && !d.data().compedTier) problems.push(`user ${d.id}: tier "${d.data().tier}" with no live subscription`);
		}
		add('subscriptions in sync', problems.length === 0, problems.length ? problems.slice(0, 10).join(' | ') : `${liveUids.size} subscriber(s) match`);
	});

	return checks;
}
