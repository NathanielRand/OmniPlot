import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { PRICING_PLANS, SHOP_PRICING_PLANS } from '$lib/config';

async function assertAdmin(authHeader: string | null): Promise<boolean> {
	const uid = await verifyIdToken(authHeader);
	if (!uid) return false;
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.data()?.tier === 'admin';
}

function productId(p: string | { id: string }): string {
	return typeof p === 'string' ? p : p.id;
}

// Maps our pricing config keys → .env var names
const PRICE_CONFIG_TO_ENV: Record<string, string> = {
	lite_monthly:         'VITE_STRIPE_LITE_MONTHLY',
	lite_yearly:          'VITE_STRIPE_LITE_YEARLY',
	pro_monthly:          'VITE_STRIPE_PRO_MONTHLY',
	pro_yearly:           'VITE_STRIPE_PRO_YEARLY',
	org_starter_monthly: 'VITE_STRIPE_SHOP_STARTER_MONTHLY',
	org_starter_yearly:  'VITE_STRIPE_SHOP_STARTER_YEARLY',
	org_team_monthly:    'VITE_STRIPE_SHOP_TEAM_MONTHLY',
	org_team_yearly:     'VITE_STRIPE_SHOP_TEAM_YEARLY',
	org_studio_monthly:  'VITE_STRIPE_SHOP_STUDIO_MONTHLY',
	org_studio_yearly:   'VITE_STRIPE_SHOP_STUDIO_YEARLY',
};

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

		// ── Sync from pricing config ──────────────────
		// Creates all products + prices defined in PRICING_PLANS / SHOP_PRICING_PLANS.
		// Safe to re-run — uses config_id metadata to skip anything already created.
		if (action === 'sync_config') {
			const [existingProducts, existingPrices] = await Promise.all([
				stripe.products.list({ limit: 100 }, connectedAccount),
				stripe.prices.list({ limit: 100 }, connectedAccount),
			]);

			const prodByConfigId  = new Map<string, string>();
			const priceByConfigId = new Map<string, string>();

			for (const p of existingProducts.data) {
				if (p.metadata?.config_id) prodByConfigId.set(p.metadata.config_id, p.id);
			}
			for (const p of existingPrices.data) {
				if (p.metadata?.config_id) priceByConfigId.set(p.metadata.config_id, p.id);
			}

			const createdProducts: Array<{ id: string; name: string }> = [];
			const createdPrices:   Array<{ id: string; configId: string }> = [];

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

			async function ensurePrice(
				configId: string, pid: string, cents: number,
				interval: 'month' | 'year', nickname: string, meta: Record<string, string>,
			) {
				if (priceByConfigId.has(configId)) return;
				const p = await stripe.prices.create({
					product: pid, unit_amount: cents, currency: 'usd',
					recurring: { interval }, nickname,
					metadata: { config_id: configId, ...meta },
				}, connectedAccount);
				priceByConfigId.set(configId, p.id);
				createdPrices.push({ id: p.id, configId });
			}

			for (const plan of PRICING_PLANS) {
				if (plan.id === 'free') continue;
				const pid = await ensureProduct(
					plan.id, `OmniPlot ${plan.name}`, plan.description,
					{ type: 'individual', tier: plan.id },
				);
				await ensurePrice(`${plan.id}_monthly`, pid, plan.price * 100, 'month', `${plan.name} Monthly`, { tier: plan.id });
				await ensurePrice(`${plan.id}_yearly`,  pid, plan.yearlyPrice * 12 * 100, 'year', `${plan.name} Yearly`, { tier: plan.id });
			}

			for (const plan of SHOP_PRICING_PLANS) {
				const configId = `org_${plan.id}`;
				const pid = await ensureProduct(
					configId, `OmniPlot Team — ${plan.name}`, plan.description,
					{ type: 'org', plan: plan.id, seats: String(plan.seats) },
				);
				await ensurePrice(`${configId}_monthly`, pid, plan.price * 100,           'month', `Team ${plan.name} Monthly`, { plan: plan.id });
				await ensurePrice(`${configId}_yearly`,  pid, plan.yearlyPrice * 12 * 100, 'year',  `Team ${plan.name} Yearly`,  { plan: plan.id });
			}

			// Return env var mapping for ALL known config prices (new + existing)
			const envVars = Object.entries(PRICE_CONFIG_TO_ENV)
				.filter(([cid]) => priceByConfigId.has(cid))
				.map(([cid, envVar]) => ({
					envVar,
					priceId: priceByConfigId.get(cid)!,
					configId: cid,
					isNew: createdPrices.some(p => p.configId === cid),
				}));

			return json({ created: { products: createdProducts, prices: createdPrices }, envVars });
		}

		return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Stripe error';
		return new Response(JSON.stringify({ error: msg }), { status: 500 });
	}
};
