import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb } from '$lib/server/firebase-admin';
import {
	logAdminAudit, patternCutUsage, patternModeration, requireAdmin, serializeUserPattern,
} from '$lib/server/user-patterns';

// GET /api/admin/user-patterns?uid=… — one user's whole pattern library,
// private patterns included, for support and moderation (Admin → Users).
// Every call is written to adminAudit.
export const GET: RequestHandler = async ({ request, url }) => {
	const admin = await requireAdmin(request.headers.get('authorization'));
	if (!admin) return json({ error: 'Forbidden' }, { status: 403 });

	const uid = url.searchParams.get('uid') ?? '';
	if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) return json({ error: 'Missing uid' }, { status: 400 });

	try {
		const db = getAdminDb();
		const [snap, usage] = await Promise.all([
			db.collection('userPatterns').where('ownerId', '==', uid).get(),
			patternCutUsage(uid),
		]);
		const moderation = await patternModeration(snap.docs.map((d) => d.id));
		const patterns = snap.docs
			.map((doc) => serializeUserPattern(doc.id, doc.data(), usage.get(doc.id), moderation.get(doc.id)))
			.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

		await logAdminAudit({ admin, action: 'library.view', targetUid: uid });

		return json({
			patterns,
			summary: {
				total:     patterns.length,
				private:   patterns.filter((p) => p.status === 'private').length,
				community: patterns.filter((p) => p.status !== 'private').length,
				cut:       patterns.filter((p) => p.usage.cuts > 0).length,
				flagged:   patterns.filter((p) => p.moderation?.flagged).length,
				lastUploadAt: patterns[0]?.createdAt ?? null,
			},
		});
	} catch (err) {
		console.error('[admin/user-patterns]', err);
		return json({ error: 'Could not load this library.' }, { status: 500 });
	}
};
