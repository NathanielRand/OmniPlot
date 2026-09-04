import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

async function assertAdmin(authHeader: string | null): Promise<string | null> {
	const uid = await verifyIdToken(authHeader);
	if (!uid) return null;
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.data()?.tier === 'admin' ? uid : null;
}

function serializeReport(id: string, d: FirebaseFirestore.DocumentData) {
	return {
		id,
		fingerprint:     d.fingerprint     ?? id,
		source:          d.source          ?? 'api',
		route:           d.route           ?? '',
		message:         d.message         ?? '',
		stack:           d.stack           ?? null,
		severity:        d.severity        ?? 'error',
		uid:             d.uid             ?? null,
		meta:            d.meta            ?? {},
		occurrenceCount: d.occurrenceCount ?? 1,
		firstSeenAt:     d.firstSeenAt instanceof Timestamp ? d.firstSeenAt.toDate().toISOString() : new Date().toISOString(),
		lastSeenAt:      d.lastSeenAt  instanceof Timestamp ? d.lastSeenAt.toDate().toISOString()  : new Date().toISOString(),
		resolvedAt:      d.resolvedAt  instanceof Timestamp ? d.resolvedAt.toDate().toISOString()  : null,
	};
}

// GET /api/admin/errors — list server error logs
export const GET: RequestHandler = async ({ request, url }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}
	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '200'), 500);
	const snap = await getAdminDb().collection('errorLogs').limit(limit).get();
	const reports = snap.docs
		.map((d) => serializeReport(d.id, d.data()))
		.sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
	return json({ reports });
};
