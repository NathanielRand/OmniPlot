// Admin → Uploads: shared server helpers for reading users' private pattern
// libraries. Everything here runs with the Admin SDK (rules don't apply), so
// every route that uses it must check requireAdmin() first.
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { toDate } from '$lib/server/cut-stats';
import { pathStats } from '$lib/utils/pathStats';

export interface AdminCaller { uid: string; name: string }

export async function requireAdmin(authHeader: string | null): Promise<AdminCaller | null> {
	const uid = await verifyIdToken(authHeader);
	if (!uid) return null;
	const d = (await getAdminDb().doc(`users/${uid}`).get()).data();
	if (d?.tier !== 'admin') return null;
	return { uid, name: d.displayName || d.email || uid };
}

const iso = (v: unknown) => toDate(v)?.toISOString() ?? null;

/** Fields used by the stats/list views — everything except the path itself. */
export const META_FIELDS = [
	'ownerId', 'name', 'status', 'submitToCommunity', 'isPublished', 'projectType', 'patternName',
	'propertyLabel', 'make', 'models', 'years', 'bodyStyle', 'category', 'zones', 'customZoneLabels',
	'coverage', 'widthInches', 'heightInches', 'notes', 'source', 'batchId', 'tierAtUpload',
	'geometry', 'editCount', 'createdAt', 'updatedAt', 'rejectionReason',
] as const;

export interface AdminPatternUsage { cuts: number; lastCutAt: string | null }
export interface AdminPatternModeration { flagged: boolean; flagReason: string | null; note: string | null; updatedBy: string | null; updatedAt: string | null }

/** JSON shape for one private pattern. `svgPath` only when the doc was read in full. */
export function serializeUserPattern(
	id: string,
	d: FirebaseFirestore.DocumentData,
	usage?: AdminPatternUsage,
	moderation?: AdminPatternModeration,
) {
	const svgPath = typeof d.svgPath === 'string' ? d.svgPath : undefined;
	return {
		id,
		ownerId:           d.ownerId ?? '',
		name:              d.name ?? '',
		status:            d.status ?? 'private',
		submitToCommunity: !!d.submitToCommunity,
		isPublished:       !!d.isPublished,
		projectType:       d.projectType ?? 'vehicle',
		patternName:       d.patternName ?? null,
		propertyLabel:     d.propertyLabel ?? null,
		address:           d.address ?? null,
		make:              d.make ?? '',
		models:            Array.isArray(d.models) ? d.models : [],
		years:             Array.isArray(d.years) ? d.years : [],
		bodyStyle:         d.bodyStyle ?? null,
		category:          d.category ?? 'ppf',
		zones:             Array.isArray(d.zones) ? d.zones : [],
		customZoneLabels:  Array.isArray(d.customZoneLabels) ? d.customZoneLabels : [],
		coverage:          d.coverage ?? 'full',
		widthInches:       d.widthInches ?? 0,
		heightInches:      d.heightInches ?? 0,
		notes:             d.notes ?? null,
		rejectionReason:   d.rejectionReason ?? null,
		source:            d.source ?? null,
		batchId:           d.batchId ?? null,
		tierAtUpload:      d.tierAtUpload ?? null,
		// Older patterns predate stored geometry — derive it when we have the path.
		geometry:          d.geometry ?? (svgPath ? pathStats(svgPath) : null),
		editCount:         typeof d.editCount === 'number' ? d.editCount : null,
		createdAt:         iso(d.createdAt),
		updatedAt:         iso(d.updatedAt),
		usage:             usage ?? { cuts: 0, lastCutAt: null },
		moderation:        moderation ?? null,
		...(svgPath !== undefined ? { svgPath } : {}),
	};
}
export type AdminUserPattern = ReturnType<typeof serializeUserPattern>;

/** How many cut jobs used each pattern. Jobs store the canvas's pattern ids,
 *  and private patterns keep their userPatterns id on the canvas. */
export async function patternCutUsage(ownerId?: string): Promise<Map<string, AdminPatternUsage>> {
	const db = getAdminDb();
	const q = ownerId ? db.collection('jobs').where('userId', '==', ownerId) : db.collection('jobs');
	const snap = await q.select('patternIds', 'createdAt').get();
	const out = new Map<string, AdminPatternUsage>();
	for (const doc of snap.docs) {
		const j = doc.data();
		if (!Array.isArray(j.patternIds)) continue;
		const at = iso(j.createdAt);
		for (const pid of j.patternIds as string[]) {
			const u = out.get(pid) ?? { cuts: 0, lastCutAt: null };
			u.cuts++;
			if (at && (!u.lastCutAt || at > u.lastCutAt)) u.lastCutAt = at;
			out.set(pid, u);
		}
	}
	return out;
}

export async function patternModeration(ids: string[]): Promise<Map<string, AdminPatternModeration>> {
	const out = new Map<string, AdminPatternModeration>();
	if (!ids.length) return out;
	const db = getAdminDb();
	for (let i = 0; i < ids.length; i += 300) {
		const refs = ids.slice(i, i + 300).map((id) => db.doc(`patternModeration/${id}`));
		for (const snap of await db.getAll(...refs)) {
			if (!snap.exists) continue;
			const m = snap.data()!;
			out.set(snap.id, {
				flagged:    !!m.flagged,
				flagReason: m.flagReason ?? null,
				note:       m.note ?? null,
				updatedBy:  m.updatedByName ?? null,
				updatedAt:  iso(m.updatedAt),
			});
		}
	}
	return out;
}

/** Flagged pattern ids — small set, read in one query. */
export async function flaggedPatternIds(): Promise<Map<string, AdminPatternModeration>> {
	const snap = await getAdminDb().collection('patternModeration').where('flagged', '==', true).get();
	return new Map(snap.docs.map((s) => {
		const m = s.data();
		return [s.id, { flagged: true, flagReason: m.flagReason ?? null, note: m.note ?? null, updatedBy: m.updatedByName ?? null, updatedAt: iso(m.updatedAt) }];
	}));
}

/** Display names for a set of uids. */
export async function userLabels(uids: string[]): Promise<Map<string, { name: string; email: string; tier: string }>> {
	const out = new Map<string, { name: string; email: string; tier: string }>();
	const db = getAdminDb();
	const unique = [...new Set(uids.filter(Boolean))];
	for (let i = 0; i < unique.length; i += 300) {
		const refs = unique.slice(i, i + 300).map((uid) => db.doc(`users/${uid}`));
		for (const snap of await db.getAll(...refs)) {
			const d = snap.data() ?? {};
			out.set(snap.id, { name: d.displayName || d.email || snap.id, email: d.email ?? '', tier: d.tier ?? 'free' });
		}
	}
	return out;
}

/** Every admin read or change of someone's private library is recorded.
 *  Best-effort unless `required` — then a failed write throws, so e.g. a
 *  delete never goes ahead without its restorable snapshot. */
export async function logAdminAudit(entry: {
	admin: AdminCaller;
	action: 'library.view' | 'pattern.view' | 'pattern.flag' | 'pattern.unflag' | 'pattern.note' | 'pattern.delete';
	targetUid: string | null;
	patternId?: string;
	reason?: string;
	/** For deletes: the full pattern as it was, so a mistaken delete can be restored. */
	snapshot?: FirebaseFirestore.DocumentData;
	required?: boolean;
}): Promise<void> {
	try {
		await getAdminDb().collection('adminAudit').add({
			adminUid:  entry.admin.uid,
			adminName: entry.admin.name,
			action:    entry.action,
			targetUid: entry.targetUid,
			...(entry.patternId ? { patternId: entry.patternId } : {}),
			...(entry.reason ? { reason: entry.reason } : {}),
			...(entry.snapshot ? { snapshot: entry.snapshot } : {}),
			createdAt: FieldValue.serverTimestamp(),
		});
	} catch (err) {
		console.error('[admin-audit]', err);
		if (entry.required) throw err;
	}
}
