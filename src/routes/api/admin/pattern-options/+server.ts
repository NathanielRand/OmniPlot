import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb } from '$lib/server/firebase-admin';
import { requireSupportAdmin } from '$lib/server/support/admin-auth';
import { readPatternOptions, sanitizePatternOptions } from '$lib/patternOptions';

const DOC = 'settings/patternOptions';
const forbidden = () => json({ error: 'Forbidden' }, { status: 403 });

type Kind = 'zones' | 'bodyStyles' | 'categories';

/** How many saved things still reference this id: catalog patterns, community /
 *  private patterns, and (for vehicle types) catalog vehicles. */
async function usageCount(kind: Kind, id: string): Promise<number> {
	const db = getAdminDb();
	const queries =
		kind === 'zones'
			? [db.collection('patterns').where('zone', '==', id), db.collection('userPatterns').where('zones', 'array-contains', id)]
			: kind === 'categories'
				? [db.collection('patterns').where('category', '==', id), db.collection('userPatterns').where('category', '==', id)]
				: [db.collection('vehicles').where('bodyStyle', '==', id), db.collection('userPatterns').where('bodyStyle', '==', id)];
	const counts = await Promise.all(queries.map((q) => q.count().get()));
	return counts.reduce((n, c) => n + c.data().count, 0);
}

export const GET: RequestHandler = async ({ request }) => {
	if (!await requireSupportAdmin(request)) return forbidden();
	return json(readPatternOptions((await getAdminDb().doc(DOC).get()).data()));
};

// Saves the whole document, normalized. Removing an added entry is allowed only
// while nothing saved uses it — a pattern keeps its id forever, so a removed one
// would show as a raw slug. (Built-ins can't be removed; they're hidden/renamed
// through `overrides`.)
export const POST: RequestHandler = async ({ request }) => {
	if (!await requireSupportAdmin(request)) return forbidden();

	const res = sanitizePatternOptions(await request.json().catch(() => null));
	if (!res.ok) return json({ error: res.error }, { status: 400 });

	const ref = getAdminDb().doc(DOC);
	// Compared against the raw stored arrays, not the validated read: a stored doc
	// that no longer validates reads as empty and would let a save drop every entry.
	const stored = (await ref.get()).data() ?? {};
	for (const kind of ['zones', 'bodyStyles', 'categories'] as const) {
		const kept = new Set(res.doc[kind].map((x) => x.id));
		const was: { id?: string; label?: string }[] = Array.isArray(stored[kind]) ? stored[kind] : [];
		for (const gone of was.filter((x) => x?.id && !kept.has(x.id))) {
			const n = await usageCount(kind, gone.id!);
			if (n > 0) {
				return json({ error: `"${gone.label ?? gone.id}" is used by ${n} saved pattern${n === 1 ? '' : 's'} — hide it instead of deleting it.` }, { status: 409 });
			}
		}
	}

	await ref.set(res.doc);
	return json({ ok: true, ...res.doc });
};
