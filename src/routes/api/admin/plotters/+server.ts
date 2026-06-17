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
		userId:        d.userId        ?? '',
		userEmail:     d.userEmail     ?? null,
		displayName:   d.displayName   ?? null,
		plotterPreset: d.plotterPreset ?? '',
		connection:    d.connection    ?? '',
		protocol:      d.protocol      ?? '',
		errorCode:     d.errorCode     ?? 'UNKNOWN',
		errorTitle:    d.errorTitle    ?? '',
		errorRaw:      d.errorRaw      ?? '',
		agentVersion:  d.agentVersion  ?? null,
		userAgent:     d.userAgent     ?? '',
		autoReported:  d.autoReported  ?? false,
		resolvedAt:    d.resolvedAt instanceof Timestamp ? d.resolvedAt.toDate().toISOString() : null,
		createdAt:     d.createdAt instanceof Timestamp ? d.createdAt.toDate().toISOString() : new Date().toISOString(),
	};
}

// GET /api/admin/plotters — list plotter error reports
export const GET: RequestHandler = async ({ request, url }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}
	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '200'), 500);
	const snap = await getAdminDb().collection('plotterErrors').limit(limit).get();
	const reports = snap.docs
		.map((d) => serializeReport(d.id, d.data()))
		.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
	return json({ reports });
};
