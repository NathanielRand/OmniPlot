import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';

const SETTINGS_DOC = 'settings/platform';

const DEFAULT_FLAGS = {
	aiAssist:         true,
	commandPalette:   true,
	exportDXF:        false,
	exportPDF:        true,
	cutAgent:         false,
	openRegistration: true,
	maintenanceMode:  false,
};

const DEFAULT_PLATFORM = {
	appName:      'OmniPlot',
	supportEmail: 'support@omniplot.app',
	docsUrl:      'https://docs.omniplot.app',
	maxFreeCuts:  5,
	maxLiteCuts:  50,
};

async function assertAdmin(authHeader: string | null): Promise<boolean> {
	const uid = await verifyIdToken(authHeader);
	if (!uid) return false;
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.data()?.tier === 'admin';
}

export const GET: RequestHandler = async ({ request }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}

	const db   = getAdminDb();
	const snap = await db.doc(SETTINGS_DOC).get();
	const data = snap.data() ?? {};

	// Fetch admin users
	const adminSnap = await db.collection('users').where('tier', '==', 'admin').get();
	const admins = adminSnap.docs.map((doc) => {
		const d = doc.data();
		return {
			uid:         doc.id,
			displayName: d.displayName ?? '',
			email:       d.email ?? '',
			createdAt:   d.createdAt?.toDate?.()?.toISOString() ?? null,
		};
	});

	return json({
		flags:    { ...DEFAULT_FLAGS,    ...(data.flags    ?? {}) },
		platform: { ...DEFAULT_PLATFORM, ...(data.platform ?? {}) },
		admins,
	});
};

export const POST: RequestHandler = async ({ request }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}

	const { flags, platform } = await request.json();
	const db  = getAdminDb();
	const patch: Record<string, unknown> = {};
	if (flags)    patch.flags    = flags;
	if (platform) patch.platform = platform;

	await db.doc(SETTINGS_DOC).set(patch, { merge: true });
	return json({ ok: true });
};
