// Reconstructs job records for cuts that were counted but whose job was never
// saved (Jun–Sep 2026: client saveJob() failed silently — see $lib/server/cuts).
//
//   node --env-file .env scripts/backfill-reconstructed-cuts.mjs           # dry run (default)
//   node --env-file .env scripts/backfill-reconstructed-cuts.mjs --write   # write
//
// Run it only once the app with /api/cuts is deployed — older app versions
// show every job on the customer's Jobs page, and reconstructed rows are meant
// to be admin-only (they're filtered out of the user's list by `backfilled`).
//
// Per user, missing = usage.cutCount − completed jobs (reconstructed ones
// included, so re-running only fills what's still missing). The details of
// those cuts are gone; their TIMES are partly recoverable from the counters:
//   • usage.lastCutAt                    — the latest cut, exactly
//   • usage.monthResetAt − 30 days       — the cut that opened the 30-day window
//   • usage.dayResetAt − 24 hours        — the cut that opened the 24-hour window
// Anything left gets no date, only the range it must fall in: inside the
// current 30-day window (it's in monthlyCount) or between signup and that
// window. Undated records have no createdAt/completedAt, so they never land
// in a day bucket or a monthly report.

import { randomUUID } from 'node:crypto';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const WRITE = process.argv.includes('--write');
const DAY = 86_400_000;
const MONTH_WINDOW = 30 * DAY;
// A counter timestamp within this of an existing job is that job's own cut.
const SAME_CUT_MS = 5 * 60_000;

initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) });
const db = getFirestore();

const ms = (v) => (v?.toDate ? v.toDate().getTime() : null);
const iso = (t) => (t ? new Date(t).toISOString() : '—');

const [usersSnap, jobsSnap] = await Promise.all([
	db.collection('users').select('usage', 'createdAt').get(),
	db.collection('jobs').select('userId', 'status', 'createdAt', 'completedAt').get(),
]);

// Completed cuts already on record, per user (time = completion, else start).
const known = new Map();
for (const doc of jobsSnap.docs) {
	const j = doc.data();
	if (j.status !== 'complete' || !j.userId) continue;
	const list = known.get(j.userId) ?? [];
	list.push(ms(j.completedAt) ?? ms(j.createdAt));
	known.set(j.userId, list);
}

const runAt = new Date();
const plan = [];
for (const doc of usersSnap.docs) {
	const u = doc.data().usage ?? {};
	const times = known.get(doc.id) ?? [];
	const missing = (u.cutCount ?? 0) - times.length;
	if (missing <= 0) continue;

	const lastCut = ms(u.lastCutAt);
	const monthStart = u.monthlyCount > 0 && ms(u.monthResetAt) ? ms(u.monthResetAt) - MONTH_WINDOW : null;
	const dayStart = u.dailyCount > 0 && ms(u.dayResetAt) ? ms(u.dayResetAt) - DAY : null;
	const onRecord = (t) => times.some((k) => k !== null && Math.abs(k - t) < SAME_CUT_MS);

	// Exact anchors not already covered by a job, oldest first.
	const anchors = [];
	for (const [t, basis] of [[monthStart, 'monthWindowStart'], [dayStart, 'dayWindowStart'], [lastCut, 'lastCutAt']]) {
		if (!t || onRecord(t) || anchors.some((a) => Math.abs(a.t - t) < SAME_CUT_MS)) continue;
		anchors.push({ t, basis });
	}
	anchors.sort((a, b) => a.t - b.t);
	const exact = anchors.slice(0, missing);

	// Undated: first fill what monthlyCount says happened inside the window.
	const inWindowOnRecord = monthStart ? times.filter((k) => k !== null && k >= monthStart - SAME_CUT_MS).length : 0;
	const exactInWindow = monthStart ? exact.filter((a) => a.t >= monthStart - SAME_CUT_MS).length : 0;
	const left = missing - exact.length;
	const inWindow = Math.max(0, Math.min(left, (u.monthlyCount ?? 0) - inWindowOnRecord - exactInWindow));
	const beforeWindow = left - inWindow;
	const signup = ms(doc.data().createdAt);

	const records = [
		...exact.map((a) => ({ at: a.t, basis: a.basis, range: null })),
		...Array.from({ length: inWindow }, () => ({ at: null, basis: 'undated', range: { from: monthStart, to: lastCut } })),
		...Array.from({ length: beforeWindow }, () => ({ at: null, basis: 'undated', range: { from: signup, to: monthStart ?? lastCut } })),
	];
	plan.push({ uid: doc.id, cutCount: u.cutCount ?? 0, onRecord: times.length, records });
}

// ── Report ──
const all = plan.flatMap((p) => p.records);
console.log(`${WRITE ? 'WRITING' : 'DRY RUN'} — ${plan.length} users, ${all.length} reconstructed cuts`);
console.log(`  exact time: ${all.filter((r) => r.at).length}   undated: ${all.filter((r) => !r.at).length}`);
for (const p of plan) {
	console.log(`  ${p.uid.slice(0, 8)}…  counter ${p.cutCount}, on record ${p.onRecord}, adding ${p.records.length}`);
	for (const r of p.records) {
		console.log(r.at ? `      ${iso(r.at)}  (${r.basis})` : `      undated, between ${iso(r.range.from)} and ${iso(r.range.to)}`);
	}
}

if (!WRITE) {
	console.log('\nNothing written. Re-run with --write to create these records.');
	process.exit(0);
}

// ── Write ──
const writer = db.bulkWriter();
for (const p of plan) {
	for (const r of p.records) {
		const at = r.at ? Timestamp.fromMillis(r.at) : null;
		const ref = db.doc(`jobs/job_backfill_${randomUUID()}`);
		writer.create(ref, {
			userId: p.uid,
			name: 'Cut (details not recorded)',
			subject: '',
			status: 'complete',
			source: null,
			vehicleId: '',
			vehicleIds: [],
			patternIds: [],
			plotterConfig: { name: '', connection: 'unknown', protocol: '' },
			materialSheet: { name: '', widthInches: 0 },
			exportFormat: 'hpgl',
			metrics: { materialEfficiency: 0, totalPathLengthMm: 0, estimatedCutSeconds: 0, itemCount: 0, patternsCompleted: 0, sheetArea: 0, usedArea: 0 },
			// Already in usage.cutCount — never count it again.
			counted: true,
			backfilled: true,
			reconstructed: {
				basis: r.basis,
				rangeFrom: r.range?.from ? Timestamp.fromMillis(r.range.from) : null,
				rangeTo: r.range?.to ? Timestamp.fromMillis(r.range.to) : null,
				runAt: Timestamp.fromDate(runAt),
				note: 'Cut was counted but its job record was never saved; details unrecoverable.',
			},
			// Undated records carry no dates, so they stay out of day/month buckets.
			...(at ? { createdAt: at, completedAt: at } : {}),
			updatedAt: Timestamp.fromDate(runAt),
			exportUrl: null,
		});
	}
}
await writer.close();
console.log(`\nWrote ${all.length} reconstructed job records.`);
