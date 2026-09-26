import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyIdToken } from '$lib/server/firebase-admin';
import { checkRateLimit, rateLimitedResponse } from '$lib/server/rate-limit';
import { CutError, finishCut, parseCutInput, recordCut, startCut, type FinalStatus } from '$lib/server/cuts';

// POST /api/cuts — the only way a cut job or cut usage gets written.
//   { action: 'start',  job }                          → { jobId }   (live plotter send)
//   { action: 'finish', jobId, status, patternsCompleted }           (complete | error | cancelled)
//   { action: 'record', job }                          → { jobId }   (PLT download / HPGL export)
export const POST: RequestHandler = async ({ request }) => {
	const uid = await verifyIdToken(request.headers.get('authorization'));
	if (!uid) return json({ error: 'Unauthorized' }, { status: 401 });

	const limit = await checkRateLimit(`cuts:${uid}`, { max: 60, windowSeconds: 60 });
	if (!limit.allowed) return rateLimitedResponse(limit);

	const body = await request.json().catch(() => ({}));
	try {
		switch (body.action) {
			case 'start':
				return json(await startCut(uid, parseCutInput(body.job)));
			case 'record':
				return json(await recordCut(uid, parseCutInput(body.job)));
			case 'finish': {
				const jobId = String(body.jobId ?? '');
				if (!/^job_[A-Za-z0-9_-]{1,64}$/.test(jobId)) return json({ error: 'Invalid job.' }, { status: 400 });
				await finishCut(uid, jobId, body.status as FinalStatus, Number(body.patternsCompleted) || 0);
				return json({ ok: true });
			}
			default:
				return json({ error: 'Unknown action' }, { status: 400 });
		}
	} catch (err) {
		if (err instanceof CutError) return json({ error: err.message, code: err.code }, { status: err.status });
		console.error('[api/cuts]', err);
		return json({ error: 'Could not record the cut.' }, { status: 500 });
	}
};
