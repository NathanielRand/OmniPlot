import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlatformFlags } from '$lib/server/platform';

// Public, read-only feature flags (Admin → Settings). The client uses them to
// show the maintenance banner, close sign-ups, and hide gated features.
export const GET: RequestHandler = async () => {
	return json({ flags: await getPlatformFlags() });
};
