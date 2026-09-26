import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { LATEST_VERSION } from '$lib/config';

// GET /api/version — the release this deploy is running. The update card
// asks for it once SvelteKit reports a new deploy, so it can name the
// version the user is about to get (the running tab only knows its own).
export const GET: RequestHandler = () =>
	json({ version: LATEST_VERSION }, { headers: { 'cache-control': 'no-store' } });
