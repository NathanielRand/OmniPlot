import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { checkRateLimit, rateLimitedResponse } from '$lib/server/rate-limit';
import { accessKeyMatches, getTicket, ownsTicket, toRequesterView, TicketError } from '$lib/server/support/store';
import { handleRequesterAction } from '$lib/server/support/requester';

/** Either the signed-in owner (Bearer token) or a guest holding the access
 *  key from their email link. Anything else is a 404 — not 403 — so a
 *  guessed id doesn't even confirm the ticket exists. */
async function resolveAccess(request: Request, id: string, key: string | null) {
	const found = await getTicket(id);
	if (!found) return null;

	const uid = await verifyIdToken(request.headers.get('authorization'));
	if (uid) {
		const user = (await getAdminDb().doc(`users/${uid}`).get()).data() ?? {};
		if (ownsTicket(found.ticket, uid, user.email ?? null)) {
			return { ...found, author: { uid, name: (user.displayName as string) || found.ticket.name } };
		}
	}
	if (accessKeyMatches(found.accessKey, key)) {
		return { ...found, author: { uid: null, name: found.ticket.name } };
	}
	return null;
}

export const GET: RequestHandler = async ({ request, params, url, getClientAddress }) => {
	const limit = await checkRateLimit(`support-view:${getClientAddress()}`, { max: 60, windowSeconds: 300 });
	if (!limit.allowed) return rateLimitedResponse(limit);

	const access = await resolveAccess(request, params.id, url.searchParams.get('k'));
	if (!access) return json({ error: 'Ticket not found' }, { status: 404 });
	return json({ ticket: toRequesterView(access.ticket), signedIn: !!access.author.uid });
};

export const POST: RequestHandler = async ({ request, params, url, getClientAddress }) => {
	const limit = await checkRateLimit(`support-act:${getClientAddress()}`, { max: 20, windowSeconds: 300 });
	if (!limit.allowed) return rateLimitedResponse(limit);

	let payload: { action?: string; body?: string; intent?: string; k?: string };
	try {
		payload = await request.json();
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	const access = await resolveAccess(request, params.id, payload.k ?? url.searchParams.get('k'));
	if (!access) return json({ error: 'Ticket not found' }, { status: 404 });

	try {
		const ticket = await handleRequesterAction(access.ticket, access.accessKey, payload, access.author);
		return json({ ticket });
	} catch (err) {
		if (err instanceof TicketError) return json({ error: err.message }, { status: err.status });
		console.error('[support/tickets/id POST]', err);
		return json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
	}
};
