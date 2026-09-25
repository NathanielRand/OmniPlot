import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { listTicketsForUser, toRequesterView } from '$lib/server/support/store';
import { userAttentionCount } from '$lib/support/tickets';

// GET — the signed-in user's tickets. `?summary=1` returns just the nav
// badge count, which AppShell polls.
export const GET: RequestHandler = async ({ request, url }) => {
	const uid = await verifyIdToken(request.headers.get('authorization'));
	if (!uid) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const email = ((await getAdminDb().doc(`users/${uid}`).get()).data()?.email as string | undefined) ?? null;
		const tickets = (await listTicketsForUser(uid, email)).map(toRequesterView);
		const attention = userAttentionCount(tickets);
		if (url.searchParams.get('summary')) return json({ attention });
		return json({ tickets, attention });
	} catch (err) {
		console.error('[support/tickets GET]', err);
		return json({ error: 'Could not load tickets.' }, { status: 500 });
	}
};
