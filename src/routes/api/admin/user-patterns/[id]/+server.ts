import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '$lib/server/firebase-admin';
import {
	logAdminAudit, patternCutUsage, patternModeration, requireAdmin, serializeUserPattern,
} from '$lib/server/user-patterns';

const validId = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id);
const clip = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// GET /api/admin/user-patterns/:id — one pattern in full (path included).
export const GET: RequestHandler = async ({ request, params }) => {
	const admin = await requireAdmin(request.headers.get('authorization'));
	if (!admin) return json({ error: 'Forbidden' }, { status: 403 });
	if (!validId(params.id)) return json({ error: 'Invalid id' }, { status: 400 });

	const snap = await getAdminDb().doc(`userPatterns/${params.id}`).get();
	if (!snap.exists) return json({ error: 'Not found' }, { status: 404 });
	const d = snap.data()!;
	const [usage, moderation] = await Promise.all([patternCutUsage(d.ownerId), patternModeration([snap.id])]);

	await logAdminAudit({ admin, action: 'pattern.view', targetUid: d.ownerId ?? null, patternId: snap.id });
	return json({ pattern: serializeUserPattern(snap.id, d, usage.get(snap.id), moderation.get(snap.id)) });
};

// PATCH /api/admin/user-patterns/:id — { flagged?, flagReason?, note? }
// Moderation lives in patternModeration/{id}; the pattern itself is untouched.
export const PATCH: RequestHandler = async ({ request, params }) => {
	const admin = await requireAdmin(request.headers.get('authorization'));
	if (!admin) return json({ error: 'Forbidden' }, { status: 403 });
	if (!validId(params.id)) return json({ error: 'Invalid id' }, { status: 400 });

	const body = await request.json().catch(() => ({}));
	const db = getAdminDb();
	const snap = await db.doc(`userPatterns/${params.id}`).get();
	if (!snap.exists) return json({ error: 'Not found' }, { status: 404 });
	const ownerId = snap.data()!.ownerId ?? null;

	const update: Record<string, unknown> = {
		ownerId,
		updatedBy:     admin.uid,
		updatedByName: admin.name,
		updatedAt:     FieldValue.serverTimestamp(),
	};
	if (typeof body.flagged === 'boolean') {
		update.flagged = body.flagged;
		update.flagReason = body.flagged ? clip(body.flagReason) || FieldValue.delete() : FieldValue.delete();
	}
	if (typeof body.note === 'string') update.note = clip(body.note, 2000) || FieldValue.delete();

	await db.doc(`patternModeration/${params.id}`).set(update, { merge: true });

	if (typeof body.flagged === 'boolean') {
		await logAdminAudit({ admin, action: body.flagged ? 'pattern.flag' : 'pattern.unflag', targetUid: ownerId, patternId: params.id, reason: clip(body.flagReason) });
	}
	if (typeof body.note === 'string') {
		await logAdminAudit({ admin, action: 'pattern.note', targetUid: ownerId, patternId: params.id });
	}

	const moderation = await patternModeration([params.id]);
	return json({ moderation: moderation.get(params.id) ?? null });
};

// DELETE /api/admin/user-patterns/:id — { reason } (required). The full
// pattern is kept in the audit entry so a mistaken delete can be restored.
export const DELETE: RequestHandler = async ({ request, params }) => {
	const admin = await requireAdmin(request.headers.get('authorization'));
	if (!admin) return json({ error: 'Forbidden' }, { status: 403 });
	if (!validId(params.id)) return json({ error: 'Invalid id' }, { status: 400 });

	const body = await request.json().catch(() => ({}));
	const reason = clip(body.reason);
	if (!reason) return json({ error: 'A reason is required.' }, { status: 400 });

	const db = getAdminDb();
	const ref = db.doc(`userPatterns/${params.id}`);
	const snap = await ref.get();
	if (!snap.exists) return json({ error: 'Not found' }, { status: 404 });
	const d = snap.data()!;
	// Approved patterns are also in the public catalog — that copy is managed
	// from Admin → Patterns, not here.
	if (d.isPublished) return json({ error: 'This pattern is published. Remove it from Admin → Patterns instead.' }, { status: 409 });

	try {
		await logAdminAudit({ admin, action: 'pattern.delete', targetUid: d.ownerId ?? null, patternId: snap.id, reason, snapshot: d, required: true });
	} catch {
		return json({ error: 'Could not record the deletion, so nothing was deleted. Try again.' }, { status: 500 });
	}
	await ref.delete();
	await db.doc(`patternModeration/${params.id}`).delete().catch(() => {});
	return json({ ok: true });
};
