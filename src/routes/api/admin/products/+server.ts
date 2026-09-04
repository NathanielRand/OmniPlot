import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { PRICING_PLANS, SHOP_PRICING_PLANS } from '$lib/config';

const SETTINGS_DOC = 'settings/platform';

async function assertAdmin(authHeader: string | null): Promise<boolean> {
	const uid = await verifyIdToken(authHeader);
	if (!uid) return false;
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.data()?.tier === 'admin';
}

function productId(p: string | { id: string }): string {
	return typeof p === 'string' ? p : p.id;
}

export const GET: RequestHandler = async ({ request }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}

	try {
		const [productsRes, pricesRes] = await Promise.all([
			stripe.products.list({ limit: 100 }, connectedAccount),
			stripe.prices.list({ limit: 100 }, connectedAccount),
		]);

		const pricesByProduct = new Map<string, typeof pricesRes.data>();
		for (const price of pricesRes.data) {
			const pid = productId(price.product);
			if (!pricesByProduct.has(pid)) pricesByProduct.set(pid, []);
			pricesByProduct.get(pid)!.push(price);
		}

		const products = productsRes.data
			.sort((a, b) => b.created - a.created)
			.map(p => ({
				id:          p.id,
				name:        p.name,
				description: p.description,
				active:      p.active,
				metadata:    p.metadata,
				created:     p.created,
				prices:      (pricesByProduct.get(p.id) ?? [])
					.sort((a, b) => {
						const ia = a.recurring?.interval === 'month' ? 0 : 1;
						const ib = b.recurring?.interval === 'month' ? 0 : 1;
						return ia !== ib ? ia - ib : b.created - a.created;
					})
					.map(pr => ({
						id:          pr.id,
						productId:   p.id,
						active:      pr.active,
						unit_amount: pr.unit_amount,
						currency:    pr.currency,
						interval:    pr.recurring?.interval ?? null,
						nickname:    pr.nickname,
						metadata:    pr.metadata,
						created:     pr.created,
					})),
			}));

		return json({
			products,
			summary: {
				activeProducts:   productsRes.data.filter(p => p.active).length,
				activePrices:     pricesRes.data.filter(p => p.active).length,
				archivedProducts: productsRes.data.filter(p => !p.active).length,
			},
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Stripe error';
		return new Response(JSON.stringify({ error: msg }), { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}

	try {
		const body = await request.json();
		const { action } = body;

		// ── Create product ────────────────────────────
		if (action === 'create_product') {
			const { name, description, metadata = {} } = body;
			const p = await stripe.products.create({
				name,
				description: description || undefined,
				metadata,
			}, connectedAccount);
			return json({
				product: {
					id: p.id, name: p.name, description: p.description,
					active: p.active, metadata: p.metadata, created: p.created, prices: [],
				},
			});
		}

		// ── Create price ──────────────────────────────
		if (action === 'create_price') {
			const { productId: pid, amount, interval, nickname } = body;
			const cents = Math.round(parseFloat(amount) * 100);
			if (!cents || cents <= 0) {
				return new Response(JSON.stringify({ error: 'Invalid amount' }), { status: 400 });
			}
			const p = await stripe.prices.create({
				product: pid,
				unit_amount: cents,
				currency: 'usd',
				recurring: { interval },
				nickname: nickname || undefined,
			}, connectedAccount);
			return json({
				price: {
					id: p.id, productId: pid, active: p.active,
					unit_amount: p.unit_amount, currency: p.currency,
					interval: p.recurring?.interval ?? null,
					nickname: p.nickname, metadata: p.metadata, created: p.created,
				},
			});
		}

		// ── Archive product ───────────────────────────
		if (action === 'archive_product') {
			await stripe.products.update(body.productId, { active: false }, connectedAccount);
			return json({ ok: true });
		}

		// ── Archive price ─────────────────────────────
		if (action === 'archive_price') {
			await stripe.prices.update(body.priceId, { active: false }, connectedAccount);
			return json({ ok: true });
		}

		// ── Sync from Firestore plan config ───────────
		// Mints Stripe products/prices from settings/platform.plans / .shopPlans
		// (edited in Admin → Products → Plan allowances) and writes the
		// resulting price IDs back into Firestore so checkout resolves them
		// deterministically. Stripe prices are immutable, so when an admin
		// changes an amount this creates a NEW price and archives the old one
		// (matched by cached price ID, not by config_id lookup) rather than
		// silently reusing a stale amount.
		if (action === 'sync_config') {
			const db   = getAdminDb();
			const settingsSnap = await db.doc(SETTINGS_DOC).get();
			const settings = settingsSnap.data() ?? {};
			const plans: Record<string, any>     = { ...(settings.plans     ?? {}) };
			const shopPlans: Record<string, any> = { ...(settings.shopPlans ?? {}) };

			const [existingProducts, existingPrices] = await Promise.all([
				stripe.products.list({ limit: 100 }, connectedAccount),
				stripe.prices.list({ limit: 100, active: true }, connectedAccount),
			]);
			const prodByConfigId = new Map<string, string>();
			for (const p of existingProducts.data) {
				if (p.metadata?.config_id) prodByConfigId.set(p.metadata.config_id, p.id);
			}
			// Prices already created by an earlier run of this sync (or the old
			// pre-Firestore flow) — matched by the config_id metadata stamped on
			// them, same convention checkout's fallback lookup uses. Adopting
			// these instead of blindly minting new ones is what keeps a first
			// sync after this migration from orphaning/duplicating the prices
			// existing subscribers are actually billed on.
			const priceByConfigId = new Map<string, typeof existingPrices.data[number]>();
			for (const p of existingPrices.data) {
				if (p.metadata?.config_id) priceByConfigId.set(p.metadata.config_id, p);
			}

			const createdProducts: Array<{ id: string; name: string }> = [];
			const createdPrices:   Array<{ id: string; configId: string; unit_amount: number }> = [];
			const adoptedPrices:   Array<{ id: string; configId: string }> = [];
			const archivedPrices:  string[] = [];

			async function ensureProduct(
				configId: string, name: string, description: string, meta: Record<string, string>,
			): Promise<string> {
				if (prodByConfigId.has(configId)) return prodByConfigId.get(configId)!;
				const p = await stripe.products.create({
					name, description, metadata: { config_id: configId, ...meta },
				}, connectedAccount);
				prodByConfigId.set(configId, p.id);
				createdProducts.push({ id: p.id, name: p.name });
				return p.id;
			}

			// Creates a fresh price (Stripe prices can't be edited) whenever the
			// admin-set amount differs from what's cached, archiving the stale one.
			async function syncPrice(
				entry: Record<string, any>, idKey: 'stripePriceId' | 'stripeYearlyPriceId',
				configId: string, pid: string, cents: number,
				interval: 'month' | 'year', nickname: string, meta: Record<string, string>,
			) {
				const cachedId = entry[idKey] as string | null | undefined;
				if (cachedId) {
					const cached = await stripe.prices.retrieve(cachedId, {}, connectedAccount).catch(() => null);
					if (cached && cached.active && cached.unit_amount === cents) return; // unchanged
					if (cached && cached.active) {
						await stripe.prices.update(cachedId, { active: false }, connectedAccount);
						archivedPrices.push(cachedId);
					}
				} else {
					// Nothing cached yet (first sync after this migration, or a doc
					// reset) — adopt a matching pre-existing Stripe price rather than
					// minting a duplicate. Existing subscriptions are bound to a price
					// by ID, not by config_id, so leaving this one alone is safe.
					const existing = priceByConfigId.get(configId);
					if (existing && existing.unit_amount === cents) {
						entry[idKey] = existing.id;
						adoptedPrices.push({ id: existing.id, configId });
						return;
					}
					if (existing) {
						await stripe.prices.update(existing.id, { active: false }, connectedAccount);
						archivedPrices.push(existing.id);
					}
				}
				const p = await stripe.prices.create({
					product: pid, unit_amount: cents, currency: 'usd',
					recurring: { interval }, nickname,
					metadata: { config_id: configId, ...meta },
				}, connectedAccount);
				entry[idKey] = p.id;
				createdPrices.push({ id: p.id, configId, unit_amount: cents });
			}

			for (const plan of PRICING_PLANS) {
				if (plan.id === 'free') continue;
				const entry = plans[plan.id] ?? (plans[plan.id] = {});
				const price       = Number(entry.price       ?? plan.price);
				const yearlyPrice = Number(entry.yearlyPrice ?? plan.yearlyPrice);
				const pid = await ensureProduct(
					plan.id, `OmniPlot ${plan.name}`, plan.description,
					{ type: 'individual', tier: plan.id },
				);
				await syncPrice(entry, 'stripePriceId',       `${plan.id}_monthly`, pid, Math.round(price * 100),            'month', `${plan.name} Monthly`, { tier: plan.id });
				await syncPrice(entry, 'stripeYearlyPriceId', `${plan.id}_yearly`,  pid, Math.round(yearlyPrice * 12 * 100), 'year',  `${plan.name} Yearly`,  { tier: plan.id });
			}

			for (const plan of SHOP_PRICING_PLANS) {
				const entry = shopPlans[plan.id] ?? (shopPlans[plan.id] = {});
				const price       = Number(entry.price       ?? plan.price);
				const yearlyPrice = Number(entry.yearlyPrice ?? plan.yearlyPrice);
				const configId = `org_${plan.id}`;
				const pid = await ensureProduct(
					configId, `OmniPlot Team — ${plan.name}`, plan.description,
					{ type: 'org', plan: plan.id, seats: String(entry.seats ?? plan.seats) },
				);
				await syncPrice(entry, 'stripePriceId',       `${configId}_monthly`, pid, Math.round(price * 100),            'month', `Team ${plan.name} Monthly`, { plan: plan.id });
				await syncPrice(entry, 'stripeYearlyPriceId', `${configId}_yearly`,  pid, Math.round(yearlyPrice * 12 * 100), 'year',  `Team ${plan.name} Yearly`,  { plan: plan.id });
			}

			// Persist the resolved price IDs (and confirmed amounts) back to Firestore.
			await db.doc(SETTINGS_DOC).set({ plans, shopPlans }, { merge: true });

			return json({
				created:  { products: createdProducts, prices: createdPrices },
				adopted:  adoptedPrices,
				archived: archivedPrices,
				plans, shopPlans,
			});
		}

		return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Stripe error';
		return new Response(JSON.stringify({ error: msg }), { status: 500 });
	}
};
