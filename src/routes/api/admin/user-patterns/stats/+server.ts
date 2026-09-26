import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb } from '$lib/server/firebase-admin';
import { toDate } from '$lib/server/cut-stats';
import {
	META_FIELDS, flaggedPatternIds, patternCutUsage, requireAdmin, serializeUserPattern, userLabels,
} from '$lib/server/user-patterns';

type Range = '30d' | '90d' | '1y' | 'all';
const RANGES: Range[] = ['30d', '90d', '1y', 'all'];
const RECENT_LIMIT = 1000;

function rangeStart(range: Range): Date | null {
	if (range === 'all') return null;
	const days = range === '30d' ? 30 : range === '90d' ? 90 : 365;
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
}

/** Monday (UTC) of the week containing d, as YYYY-MM-DD. */
function weekKey(d: Date): string {
	const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
	x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
	return x.toISOString().slice(0, 10);
}

function sizeBucket(w: number, h: number): string {
	const m = Math.max(w, h);
	if (!m) return 'unknown';
	if (m < 12) return '< 12 in';
	if (m < 24) return '12–24 in';
	if (m < 48) return '24–48 in';
	if (m < 72) return '48–72 in';
	return '72+ in';
}

function complexityBucket(commands: number | undefined): string {
	if (commands === undefined) return 'unknown';
	if (commands < 50) return '< 50 cmds';
	if (commands < 200) return '50–200';
	if (commands < 1000) return '200–1k';
	return '1k+';
}

/** Tally of label → { count, distinct users }. Keys are normalized so
 *  "Hood Edge" and "hood edge " land together; the first spelling wins. */
class Tally {
	private m = new Map<string, { label: string; count: number; users: Set<string> }>();
	add(label: string | null | undefined, uid: string) {
		const clean = (label ?? '').trim();
		if (!clean) return;
		const key = clean.toLowerCase().replace(/\s+/g, ' ');
		const row = this.m.get(key) ?? { label: clean, count: 0, users: new Set<string>() };
		row.count++;
		row.users.add(uid);
		this.m.set(key, row);
	}
	top(n: number) {
		return [...this.m.values()]
			.sort((a, b) => b.users.size - a.users.size || b.count - a.count)
			.slice(0, n)
			.map((r) => ({ label: r.label, count: r.count, users: r.users.size }));
	}
	get size() { return this.m.size; }
}

const bump = (rec: Record<string, number>, key: string) => { rec[key] = (rec[key] ?? 0) + 1; };

// GET /api/admin/user-patterns/stats?range=90d — what people upload to their
// private libraries: categories, subjects, zones, the labels they invent,
// how they import, and whether they ever cut it. Admin → Uploads.
export const GET: RequestHandler = async ({ request, url }) => {
	if (!await requireAdmin(request.headers.get('authorization'))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const range = (RANGES as string[]).includes(url.searchParams.get('range') ?? '')
		? (url.searchParams.get('range') as Range) : '90d';
	const start = rangeStart(range);

	try {
		const db = getAdminDb();
		const [snap, usage, flagged] = await Promise.all([
			db.collection('userPatterns').select(...META_FIELDS).get(),
			patternCutUsage(),
			flaggedPatternIds(),
		]);

		const totals = {
			patterns: snap.size, private: 0, pending: 0, published: 0, rejected: 0,
			uploaders: 0, inRange: 0, uploadersInRange: 0, flagged: flagged.size,
			cutInRange: 0, trackedInRange: 0, editedInRange: 0,
		};
		const allUploaders = new Set<string>();
		const rangeUploaders = new Set<string>();

		const breakdowns = {
			category: {} as Record<string, number>, projectType: {} as Record<string, number>,
			coverage: {} as Record<string, number>, status: {} as Record<string, number>,
			input: {} as Record<string, number>, flow: {} as Record<string, number>,
			tier: {} as Record<string, number>, size: {} as Record<string, number>,
			complexity: {} as Record<string, number>, fileType: {} as Record<string, number>,
		};
		const zones = new Map<string, { zone: string; category: string; projectType: string; count: number; users: Set<string> }>();
		const customZoneLabels = new Tally();
		const makes = new Tally();
		const models = new Tally();
		const projects = new Tally();
		const perUser = new Map<string, { count: number; cuts: number }>();
		const series = new Map<string, { week: string; uploads: number; users: Set<string> }>();
		const inRangeDocs: { id: string; data: FirebaseFirestore.DocumentData; at: number }[] = [];

		for (const doc of snap.docs) {
			const d = doc.data();
			const owner = d.ownerId ?? '';
			const status = d.status ?? 'private';
			if (status === 'private') totals.private++;
			else if (status === 'pending') totals.pending++;
			else if (status === 'approved' || d.isPublished) totals.published++;
			else if (status === 'rejected') totals.rejected++;
			if (owner) allUploaders.add(owner);

			const created = toDate(d.createdAt);
			if (start && (!created || created < start)) continue;

			totals.inRange++;
			if (owner) rangeUploaders.add(owner);
			const u = usage.get(doc.id);
			if (u?.cuts) totals.cutInRange++;
			if (d.source) totals.trackedInRange++;
			if ((d.editCount ?? 0) > 0) totals.editedInRange++;

			const projectType = d.projectType ?? 'vehicle';
			const category = d.category ?? 'ppf';
			bump(breakdowns.category, category);
			bump(breakdowns.projectType, projectType);
			bump(breakdowns.coverage, d.coverage ?? 'full');
			bump(breakdowns.status, status);
			bump(breakdowns.size, sizeBucket(d.widthInches ?? 0, d.heightInches ?? 0));
			bump(breakdowns.complexity, complexityBucket(d.geometry?.commands));
			if (d.source) {
				bump(breakdowns.input, d.source.fromPdf ? `${d.source.input} (pdf)` : d.source.input ?? 'unknown');
				bump(breakdowns.flow, d.source.flow ?? 'unknown');
				if (d.source.fileType) bump(breakdowns.fileType, d.source.fileType);
			}
			if (d.tierAtUpload) bump(breakdowns.tier, d.tierAtUpload);

			const zoneList: string[] = Array.isArray(d.zones) ? d.zones : [];
			zoneList.forEach((z, i) => {
				if (z === 'custom') {
					customZoneLabels.add(d.customZoneLabels?.[i], owner);
					return;
				}
				const key = `${projectType}|${category}|${z}`;
				const row = zones.get(key) ?? { zone: z, category, projectType, count: 0, users: new Set<string>() };
				row.count++;
				row.users.add(owner);
				zones.set(key, row);
			});

			if (projectType === 'vehicle') {
				makes.add(d.make, owner);
				for (const m of Array.isArray(d.models) ? d.models : []) models.add(`${d.make ?? ''} ${m}`, owner);
			} else {
				projects.add(projectType === 'custom' ? d.patternName : d.propertyLabel, owner);
			}

			const pu = perUser.get(owner) ?? { count: 0, cuts: 0 };
			pu.count++;
			pu.cuts += u?.cuts ?? 0;
			perUser.set(owner, pu);

			if (created) {
				const wk = weekKey(created);
				const row = series.get(wk) ?? { week: wk, uploads: 0, users: new Set<string>() };
				row.uploads++;
				row.users.add(owner);
				series.set(wk, row);
			}
			inRangeDocs.push({ id: doc.id, data: d, at: created?.getTime() ?? 0 });
		}
		totals.uploaders = allUploaders.size;
		totals.uploadersInRange = rangeUploaders.size;

		// Weekly series: fill empty weeks so gaps show. "All time" starts at the first upload.
		const firstWeek = start ? weekKey(start) : [...series.keys()].sort()[0];
		const weeks: { week: string; uploads: number; users: number }[] = [];
		if (firstWeek) {
			const cur = new Date(`${firstWeek}T00:00:00Z`);
			const end = weekKey(new Date());
			while (cur.toISOString().slice(0, 10) <= end) {
				const k = cur.toISOString().slice(0, 10);
				const row = series.get(k);
				weeks.push({ week: k, uploads: row?.uploads ?? 0, users: row?.users.size ?? 0 });
				cur.setUTCDate(cur.getUTCDate() + 7);
			}
		}

		const topUploaderIds = [...perUser.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 15);
		inRangeDocs.sort((a, b) => b.at - a.at);
		const recentDocs = inRangeDocs.slice(0, RECENT_LIMIT);
		// Flagged patterns always make the list, even when older than the range.
		const recentIds = new Set(recentDocs.map((r) => r.id));
		const flaggedExtra = snap.docs.filter((doc) => flagged.has(doc.id) && !recentIds.has(doc.id));

		const labels = await userLabels([
			...topUploaderIds.map(([uid]) => uid),
			...recentDocs.map((r) => r.data.ownerId),
			...flaggedExtra.map((doc) => doc.data().ownerId),
		]);
		const owner = (uid: string) => ({ uid, ...(labels.get(uid) ?? { name: uid, email: '', tier: 'free' }) });

		return json({
			range,
			start: start?.toISOString() ?? null,
			totals,
			series: weeks,
			breakdowns,
			topZones: [...zones.values()]
				.sort((a, b) => b.users.size - a.users.size || b.count - a.count)
				.slice(0, 30)
				.map((z) => ({ zone: z.zone, category: z.category, projectType: z.projectType, count: z.count, users: z.users.size })),
			customZoneLabels: customZoneLabels.top(40),
			customZoneLabelCount: customZoneLabels.size,
			topMakes: makes.top(20),
			topModels: models.top(25),
			topProjects: projects.top(25),
			topUploaders: topUploaderIds.map(([uid, v]) => ({ ...owner(uid), patterns: v.count, cuts: v.cuts })),
			recent: [...recentDocs.map((r) => ({ id: r.id, data: r.data })), ...flaggedExtra.map((doc) => ({ id: doc.id, data: doc.data() }))]
				.map((r) => ({ ...serializeUserPattern(r.id, r.data, usage.get(r.id), flagged.get(r.id)), owner: owner(r.data.ownerId ?? '') })),
			recentTruncated: inRangeDocs.length > RECENT_LIMIT,
		});
	} catch (err) {
		console.error('[admin/user-patterns/stats]', err);
		return json({ error: 'Could not load upload stats.' }, { status: 500 });
	}
};
