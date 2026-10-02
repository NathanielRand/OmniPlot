import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyIdToken } from '$lib/server/firebase-admin';
import { checkRateLimit, rateLimitedResponse } from '$lib/server/rate-limit';
import { parseVoteInput, setVote } from '$lib/server/demand';

// Customers asking for a pattern, or voting on a coming-soon one. Both land on
// the same per-make/model record (see $lib/server/demand), one vote per person.
//
//   POST   { projectType, make, model, year?, notes? }  add my vote (creates the record if new)
//   DELETE { projectType, make, model, year? }         withdraw it (no year = all of it)
async function handle(request: Request, on: boolean) {
	const uid = await verifyIdToken(request.headers.get('authorization'));
	if (!uid) return json({ error: 'Sign in to vote.' }, { status: 401 });
	const limit = await checkRateLimit(`demand:${uid}`, { max: 40, windowSeconds: 3600 });
	if (!limit.allowed) return rateLimitedResponse(limit);

	const input = parseVoteInput(await request.json().catch(() => null));
	if (typeof input === 'string') return json({ error: input }, { status: 400 });
	try {
		return json(await setVote(uid, input, on));
	} catch (err) {
		console.error('[demand]', err);
		return json({ error: err instanceof Error ? err.message : 'Could not save your vote.' }, { status: 500 });
	}
}

export const POST: RequestHandler = ({ request }) => handle(request, true);
export const DELETE: RequestHandler = ({ request }) => handle(request, false);
