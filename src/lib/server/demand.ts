import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '$lib/server/firebase-admin';
import { demandId, demandTitle, demandValid, nextVote, type MyVote } from '$lib/utils/demand';
import type { ProjectType } from '$lib/types';

// Demand writes (Admin SDK only — rules keep clients out):
//   demand/{id}        one record per make/model (see $lib/utils/demand)
//   userVotes/{uid}    { votes: { [demandId]: { any, years } } } — one doc per person,
//                      so "one vote each" holds and a user can read their own.
// A vote changes both in ONE transaction, so the counters can't drift from the
// per-person records.

export const PROJECT_TYPES: ProjectType[] = ['vehicle', 'residential', 'commercial', 'custom'];
const MAX_VOTES_PER_USER = 500;
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** Removes these from the public record — they live in demandPrivate. */
const SCRUB = { notes: FieldValue.delete(), requestedBy: FieldValue.delete() };
const today = () => new Date().toISOString().split('T')[0];

export interface VoteInput {
	projectType: ProjectType;
	make: string;
	model: string;
	/** 0 = any year */
	year: number;
	notes: string;
}

export function parseVoteInput(body: any): VoteInput | string {
	const projectType = PROJECT_TYPES.includes(body?.projectType) ? (body.projectType as ProjectType) : 'vehicle';
	const isVehicle = projectType === 'vehicle';
	const make = isVehicle ? clean(body?.make, 60) : '';
	const model = clean(body?.model, isVehicle ? 80 : 140);
	const year = Number(body?.year) || 0;
	if (!demandValid({ projectType, make, model })) return isVehicle ? 'Make and model are required.' : 'Describe what you need.';
	if (isVehicle && year && (year < 1950 || year > new Date().getFullYear() + 3)) return 'Enter a valid year.';
	return { projectType, make, model, year: isVehicle ? year : 0, notes: clean(body?.notes, 300) };
}

type Tally = { any: number; years: Record<string, number> };
const tallyOf = (v: MyVote | undefined): Tally => ({
	any: v?.any ? 1 : 0,
	years: Object.fromEntries((v?.years ?? []).map((y) => [String(y), 1])),
});

/** Add or remove one person's vote; returns the record's new total. */
export async function setVote(uid: string, input: VoteInput, on: boolean, idOverride?: string) {
	const db = getAdminDb();
	const id = idOverride ?? demandId(input);
	const dRef = db.doc(`demand/${id}`);
	const uRef = db.doc(`userVotes/${uid}`);
	const pRef = db.doc(`demandPrivate/${id}`);

	return db.runTransaction(async (tx) => {
		const [dSnap, uSnap, pSnap] = await Promise.all([tx.get(dRef), tx.get(uRef), tx.get(pRef)]);
		const votes: Record<string, MyVote> = uSnap.data()?.votes ?? {};
		const prev = votes[id];
		const next = nextVote(prev, input.year || undefined, on);
		if (on && !prev && Object.keys(votes).length >= MAX_VOTES_PER_USER) throw new Error('Too many votes on this account.');
		if (!dSnap.exists && !on) return { id, votes: 0, mine: null as MyVote | null };

		const d = dSnap.data() ?? {};
		const yearVotes: Record<string, number> = { ...(d.yearVotes ?? {}) };
		let anyVotes: number = d.anyVotes ?? 0;
		let voters: number = d.voters ?? 0;
		const before = tallyOf(prev), after = tallyOf(next ?? undefined);
		anyVotes += after.any - before.any;
		for (const y of new Set([...Object.keys(before.years), ...Object.keys(after.years)])) {
			const n = (yearVotes[y] ?? 0) + (after.years[y] ?? 0) - (before.years[y] ?? 0);
			if (n > 0) yearVotes[y] = n; else delete yearVotes[y];
		}
		voters += (next ? 1 : 0) - (prev ? 1 : 0);
		const total = voters + (d.legacyVotes ?? 0);

		const base = dSnap.exists ? {} : {
			projectType: input.projectType,
			vehicle: demandTitle(input),
			make: input.projectType === 'vehicle' ? input.make : '',
			model: input.model,
			year: 0,
			status: 'queued',
			requestedAt: today(),
			legacyVotes: 0,
		};
		// Who asked and the notes live in demandPrivate (admin-only); the public record
		// carries neither. Keep different people's notes, once each, up to a cap.
		const pd = pSnap.data() ?? {};
		const notes = !input.notes || String(pd.notes ?? '').includes(input.notes)
			? pd.notes ?? ''
			: [pd.notes, input.notes].filter(Boolean).join(' · ').slice(0, 600);
		tx.set(dRef, { ...base, ...SCRUB, voters, anyVotes, yearVotes, votes: total, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
		if (on && (notes !== (pd.notes ?? '') || (!pSnap.exists && !dSnap.exists))) {
			tx.set(pRef, { notes, ...(pd.requestedBy ? {} : { requestedBy: uid }) }, { merge: true });
		}

		if (next) votes[id] = next; else delete votes[id];
		tx.set(uRef, { votes }, { merge: false });
		return { id, votes: total, mine: next };
	});
}

// ─── Merge the old free-text requests ────────────────
interface Legacy {
	ref: FirebaseFirestore.DocumentReference;
	id: string;
	data: FirebaseFirestore.DocumentData;
	key: string | null;
}

async function loadLegacy(): Promise<Legacy[]> {
	const snap = await getAdminDb().collection('requests').get();
	return snap.docs
		.filter((d) => !d.data().mergedInto)
		.map((d) => {
			const x = d.data();
			const projectType = PROJECT_TYPES.includes(x.projectType) ? (x.projectType as ProjectType) : 'vehicle';
			const t = { projectType, make: projectType === 'vehicle' ? x.make : '', model: x.model };
			return { ref: d.ref, id: d.id, data: x, key: demandValid(t) ? demandId(t) : null };
		});
}

export interface MergeGroup { id: string; title: string; requests: number; votes: number; years: number[] }

function groupLegacy(all: Legacy[]) {
	const groups = new Map<string, Legacy[]>();
	for (const l of all) if (l.key) groups.set(l.key, [...(groups.get(l.key) ?? []), l]);
	return groups;
}

export async function previewMerge(): Promise<{ groups: MergeGroup[]; unmergeable: number }> {
	const all = await loadLegacy();
	const groups = [...groupLegacy(all)].map(([id, ls]) => ({
		id,
		title: demandTitle({ projectType: ls[0].data.projectType, make: ls[0].data.make, model: ls[0].data.model }),
		requests: ls.length,
		votes: ls.reduce((n, l) => n + Math.max(1, Number(l.data.votes) || 0), 0),
		years: [...new Set(ls.map((l) => Number(l.data.year) || 0).filter(Boolean))].sort(),
	}));
	return { groups, unmergeable: all.filter((l) => !l.key).length };
}

/**
 * Fold every old request into its demand record. A requester we know becomes a
 * real per-person vote; extra votes beyond that (and anonymous requests) are kept
 * as `legacyVotes`. Old docs are marked `mergedInto`, never deleted. Safe to
 * re-run: merged docs are skipped, and one group is one transaction.
 */
export async function runMerge(): Promise<{ merged: number; groups: number }> {
	const db = getAdminDb();
	const groups = groupLegacy(await loadLegacy());
	let merged = 0;
	for (const [id, ls] of groups) {
		await db.runTransaction(async (tx) => {
			const dRef = db.doc(`demand/${id}`);
			const uids = [...new Set(ls.map((l) => l.data.requestedBy as string | undefined).filter(Boolean) as string[])];
			const pRef = db.doc(`demandPrivate/${id}`);
			const [dSnap, pSnap, ...uSnaps] = await Promise.all([tx.get(dRef), tx.get(pRef), ...uids.map((u) => tx.get(db.doc(`userVotes/${u}`)))]);

			const d = dSnap.data() ?? {};
			const yearVotes: Record<string, number> = { ...(d.yearVotes ?? {}) };
			let anyVotes: number = d.anyVotes ?? 0, voters: number = d.voters ?? 0, legacy: number = d.legacyVotes ?? 0;

			const userDocs = new Map<string, Record<string, MyVote>>();
			uids.forEach((u, i) => userDocs.set(u, uSnaps[i].data()?.votes ?? {}));

			for (const l of ls) {
				const year = Number(l.data.year) || 0;
				const count = Math.max(1, Number(l.data.votes) || 0);
				const u = l.data.requestedBy as string | undefined;
				const votes = u ? userDocs.get(u) : undefined;
				let counted = 0;
				if (votes) {
					const prev = votes[id];
					const next = nextVote(prev, year || undefined, true)!;
					const b = tallyOf(prev), a = tallyOf(next);
					anyVotes += a.any - b.any;
					for (const y of new Set([...Object.keys(b.years), ...Object.keys(a.years)])) yearVotes[y] = Math.max(0, (yearVotes[y] ?? 0) + (a.years[y] ?? 0) - (b.years[y] ?? 0));
					if (!prev) voters++;
					counted = 1; // the requester is one of the request's votes — even on their second request
					votes[id] = next;
				}
				legacy += count - counted;
			}
			for (const y of Object.keys(yearVotes)) if (!yearVotes[y]) delete yearVotes[y];

			const first = ls[0].data;
			const status = ls.every((l) => l.data.status === 'done') ? 'done' : ls.some((l) => l.data.status === 'in-progress') ? 'in-progress' : 'queued';
			const projectType = PROJECT_TYPES.includes(first.projectType) ? first.projectType : 'vehicle';
			const pd = pSnap.data() ?? {};
			const notes = [...new Set([pd.notes ?? d.notes, ...ls.map((l) => clean(l.data.notes, 300))].filter(Boolean))].join(' · ').slice(0, 600);
			const earliest = ls.map((l) => String(l.data.requestedAt ?? '')).filter(Boolean).sort()[0] ?? today();
			tx.set(dRef, {
				projectType, vehicle: dSnap.exists ? d.vehicle : demandTitle({ projectType, make: first.make, model: first.model }),
				make: projectType === 'vehicle' ? clean(first.make, 60) : '', model: clean(first.model, 140), year: 0,
				status: dSnap.exists ? d.status : status, requestedAt: dSnap.exists ? d.requestedAt : earliest,
				...SCRUB,
				voters, legacyVotes: legacy, anyVotes, yearVotes, votes: voters + legacy,
				updatedAt: FieldValue.serverTimestamp(),
			}, { merge: true });
			const requestedBy = pd.requestedBy ?? d.requestedBy ?? first.requestedBy;
			tx.set(pRef, { notes, ...(requestedBy ? { requestedBy } : {}) }, { merge: true });
			for (const [u, votes] of userDocs) tx.set(db.doc(`userVotes/${u}`), { votes }, { merge: false });
			for (const l of ls) tx.update(l.ref, { mergedInto: id });
		});
		merged += ls.length;
	}
	return { merged, groups: groups.size };
}
