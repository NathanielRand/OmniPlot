import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireSupportAdmin } from '$lib/server/support/admin-auth';
import { searchAccounts } from '$lib/server/support/match';

// GET /api/admin/support/accounts?q=  — account picker for "Attach to account…"
export const GET: RequestHandler = async ({ request, url }) => {
	const admin = await requireSupportAdmin(request);
	if (!admin) return json({ error: 'Forbidden' }, { status: 403 });
	const q = (url.searchParams.get('q') ?? '').slice(0, 120);
	try {
		return json({ accounts: await searchAccounts(q) });
	} catch (err) {
		console.error('[admin/support/accounts GET]', err);
		return json({ error: 'Search failed.' }, { status: 500 });
	}
};
