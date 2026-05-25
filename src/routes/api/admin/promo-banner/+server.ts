import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

const DOC = () => getAdminDb().doc('config/promo_banner');

async function assertAdmin(request: Request): Promise<boolean> {
	const uid = await verifyIdToken(request.headers.get('authorization'));
	if (!uid) return false;
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.data()?.tier === 'admin';
}

// GET — current banner config
export const GET: RequestHandler = async ({ request }) => {
	if (!(await assertAdmin(request))) return json({ error: 'Unauthorized' }, { status: 401 });

	const snap = await DOC().get();
	if (!snap.exists) return json({ banner: null });

	const data = snap.data()!;
	return json({
		banner: {
			active:      data.active      ?? false,
			code:        data.code        ?? '',
			message:     data.message     ?? '',
			cta:         data.cta         ?? 'Claim offer',
			ctaHref:     data.ctaHref     ?? '/pricing',
			accentColor: data.accentColor ?? 'brand',
			expiresAt:   data.expiresAt?.toMillis?.() ?? null,
		},
	});
};

// PUT — create or update banner
export const PUT: RequestHandler = async ({ request }) => {
	if (!(await assertAdmin(request))) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { code, message, cta, ctaHref, accentColor, expiresAt } = body;

	if (!code || !message) return json({ error: 'code and message are required' }, { status: 400 });

	const payload: Record<string, unknown> = {
		active:      true,
		code:        String(code).trim().toUpperCase(),
		message:     String(message).trim(),
		cta:         String(cta || 'Claim offer').trim(),
		ctaHref:     String(ctaHref || '/pricing').trim(),
		accentColor: String(accentColor || 'brand'),
		updatedAt:   FieldValue.serverTimestamp(),
		expiresAt:   expiresAt ? new Date(expiresAt) : null,
	};

	await DOC().set(payload, { merge: true });
	return json({ ok: true });
};

// DELETE — deactivate banner
export const DELETE: RequestHandler = async ({ request }) => {
	if (!(await assertAdmin(request))) return json({ error: 'Unauthorized' }, { status: 401 });

	await DOC().set({ active: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
	return json({ ok: true });
};
