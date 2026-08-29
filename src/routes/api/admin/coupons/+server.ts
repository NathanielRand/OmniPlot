import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';

async function assertAdmin(authHeader: string | null): Promise<boolean> {
	const uid = await verifyIdToken(authHeader);
	if (!uid) return false;
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.data()?.tier === 'admin';
}

// ── GET — list all promotion codes (with expanded coupon) ─────────────────
export const GET: RequestHandler = async ({ request }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}

	const codes = await stripe.promotionCodes.list(
		{ limit: 100, expand: ['data.coupon'] },
		connectedAccount,
	);

	return json({ codes: codes.data });
};

// ── POST — create coupon + promotion code ─────────────────────────────────
export const POST: RequestHandler = async ({ request }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}

	const body = await request.json();
	const { code, discountType, discountValue, duration, durationMonths, maxRedemptions, expiresAt } = body;

	if (!discountType || !discountValue || !duration) {
		return new Response(JSON.stringify({ error: 'discountType, discountValue, and duration are required' }), { status: 400 });
	}

	const couponParams: Stripe.CouponCreateParams = { duration };

	if (discountType === 'percent') {
		couponParams.percent_off = Number(discountValue);
	} else {
		couponParams.amount_off = Math.round(Number(discountValue) * 100);
		couponParams.currency   = 'usd';
	}

	if (duration === 'repeating') {
		couponParams.duration_in_months = Number(durationMonths) || 1;
	}

	if (maxRedemptions) couponParams.max_redemptions = Number(maxRedemptions);
	if (expiresAt)      couponParams.redeem_by       = Math.floor(new Date(expiresAt).getTime() / 1000);

	// Use the code as the coupon name so it's identifiable in the Stripe dashboard
	if (code) couponParams.name = code.trim().toUpperCase();

	const coupon = await stripe.coupons.create(couponParams, connectedAccount);

	// `coupon` moved under `promotion` in newer API versions — a promotion
	// code now references a typed `Promotion` (currently only `type: 'coupon'`
	// exists) rather than taking a bare coupon id.
	const promoParams: Stripe.PromotionCodeCreateParams = { promotion: { type: 'coupon', coupon: coupon.id } };
	if (code)             promoParams.code             = code.trim().toUpperCase();
	if (maxRedemptions)   promoParams.max_redemptions  = Number(maxRedemptions);
	if (expiresAt)        promoParams.expires_at       = Math.floor(new Date(expiresAt).getTime() / 1000);

	const promoCode = await stripe.promotionCodes.create(promoParams, connectedAccount);

	return json({ code: { ...promoCode, coupon } });
};

// ── PATCH — deactivate a promotion code ───────────────────────────────────
export const PATCH: RequestHandler = async ({ request }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}

	const { id } = await request.json();
	if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 });

	const updated = await stripe.promotionCodes.update(id, { active: false }, connectedAccount);
	return json({ code: updated });
};
