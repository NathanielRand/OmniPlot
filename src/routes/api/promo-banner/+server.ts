import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb } from '$lib/server/firebase-admin';

// Public endpoint — no auth required. Returns the active banner or null.
export const GET: RequestHandler = async () => {
	try {
		const snap = await getAdminDb().doc('config/promo_banner').get();
		if (!snap.exists) return json({ banner: null });

		const data = snap.data()!;
		if (!data.active) return json({ banner: null });

		// Respect expiresAt
		if (data.expiresAt) {
			const expMs = data.expiresAt?.toMillis?.() ?? 0;
			if (expMs && Date.now() > expMs) {
				return json({ banner: null });
			}
		}

		return json({
			banner: {
				code:        data.code        ?? '',
				message:     data.message     ?? '',
				cta:         data.cta         ?? 'Claim offer',
				ctaHref:     data.ctaHref     ?? '/pricing',
				accentColor: data.accentColor ?? 'brand',
				expiresAt:   data.expiresAt?.toMillis?.() ?? null,
			},
		}, {
			headers: {
				// Cache for 60 s on CDN, revalidate in background
				'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
			},
		});
	} catch (err) {
		console.error('[promo-banner]', err);
		return json({ banner: null });
	}
};
