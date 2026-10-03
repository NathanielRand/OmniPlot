import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb } from '$lib/server/firebase-admin';
import { readPatternOptions } from '$lib/patternOptions';

// Public, read-only: the zones, vehicle types and categories admins added on top
// of the built-in lists (Admin → Patterns → Options). Needed by the upload and
// edit forms and the library, so it isn't admin-gated.
export const GET: RequestHandler = async () => {
	const data = (await getAdminDb().doc('settings/patternOptions').get()).data();
	return json(readPatternOptions(data), { headers: { 'Cache-Control': 'public, max-age=30' } });
};
