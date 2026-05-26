import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb } from '$lib/server/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

// Uses VITE_APP_URL so redirects resolve correctly in every environment:
// - local dev:  http://localhost:5173/downloads/agent/...
// - production: https://omniplot.app/downloads/agent/...
const APP_URL    = (import.meta.env.VITE_APP_URL ?? 'https://omniplot.app').replace(/\/$/, '');
const AGENT_BASE = `${APP_URL}/downloads/agent`;

export const GET: RequestHandler = async ({ url }) => {
	const file     = url.searchParams.get('file')    ?? '';
	const version  = url.searchParams.get('version') ?? '1.0.0';
	const platform = url.searchParams.get('platform') ?? 'unknown';

	if (!file) {
		return new Response('Missing file param', { status: 400 });
	}

	// Increment global counter + per-platform breakdown. Best-effort — never
	// block the redirect if Firestore is unavailable.
	try {
		const db = getAdminDb();
		await db.doc('counters/agent_downloads').set(
			{
				count: FieldValue.increment(1),
				byPlatform: { [platform]: FieldValue.increment(1) },
				updatedAt: new Date(),
			},
			{ merge: true },
		);
	} catch {
		// non-fatal
	}

	throw redirect(302, `${AGENT_BASE}/v${version}/${file}`);
};
