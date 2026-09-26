// ─────────────────────────────────────────────
// OmniPlot — CUT RECORDING (server, Admin SDK)
// ─────────────────────────────────────────────
// The single writer of cut jobs, usage counters and platform cut totals.
// Each call is one transaction, so a job, the user's allowance and the
// admin numbers either all change or none do. Clients can't write any of
// these (firestore.rules), which also means the allowance can't be reset
// from the browser.
//
// Lifecycle:  start → cutting → finish(complete | error | cancelled)
//             record = start + finish(complete) in one go (file downloads)
// A cut counts against the allowance when it completes — including a
// failed/cancelled cut that is later resumed to completion — exactly once.

import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { getAdminDb } from '$lib/server/firebase-admin';
import { getPlanSettings } from '$lib/server/plans';
import { canCut, cutLimitsFromPlans } from '$lib/utils';
import { dayKey, monthKey, usageAfterCut, type CutUsageFields } from '$lib/cuts';
import type { CutSource, JobStatus, UserProfile } from '$lib/types';

export class CutError extends Error {
	constructor(message: string, public status = 400, public code?: string) { super(message); }
}

export type FinalStatus = 'complete' | 'error' | 'cancelled';
const FINAL: FinalStatus[] = ['complete', 'error', 'cancelled'];
const CONNECTIONS = ['usb-serial', 'network', 'download', 'cut-agent'];
const SOURCES: CutSource[] = ['plotter', 'download', 'export'];

export interface CutInput {
	source: CutSource;
	name: string;
	/** What was cut, readable ("2024 Tesla Model 3", "+1 more") — for admin lists. */
	subject: string;
	vehicleIds: string[];
	patternIds: string[];
	itemCount: number;
	plotter: { name: string; connection: string; protocol: string; cuttingSpeed: number | null; bladeForce: number | null; passes: number | null };
	sheet: { name: string; widthInches: number };
	metrics: { materialEfficiency: number; estimatedCutSeconds: number; sheetArea: number; usedArea: number };
}

// ─── Input hygiene ────────────────────────────
// Everything here comes from the browser: clamp it, and never let an
// `undefined` reach Firestore (the bug that silently dropped every job
// from June to September 2026).

const str = (v: unknown, max = 120) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown, min = 0, max = 1e9) => {
	const n = Number(v);
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
};
const optNum = (v: unknown, max = 1e6) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : num(v, 0, max));
const ids = (v: unknown, max = 200) =>
	Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 128))].slice(0, max) : [];

export function parseCutInput(raw: unknown): CutInput {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
	const source = SOURCES.includes(r.source) ? (r.source as CutSource) : 'plotter';
	const itemCount = Math.round(num(r.itemCount, 0, 10_000));
	if (itemCount < 1) throw new CutError('A cut needs at least one pattern.');
	const connection = CONNECTIONS.includes(r.plotter?.connection) ? r.plotter.connection : source === 'plotter' ? 'unknown' : 'download';
	return {
		source,
		name: str(r.name) || 'Cut job',
		subject: str(r.subject, 200),
		vehicleIds: ids(r.vehicleIds, 50),
		patternIds: ids(r.patternIds),
		itemCount,
		plotter: {
			name: str(r.plotter?.name),
			connection,
			protocol: str(r.plotter?.protocol, 20),
			cuttingSpeed: optNum(r.plotter?.cuttingSpeed),
			bladeForce: optNum(r.plotter?.bladeForce),
			passes: optNum(r.plotter?.passes, 20),
		},
		sheet: { name: str(r.sheet?.name), widthInches: num(r.sheet?.widthInches, 0, 1000) },
		metrics: {
			materialEfficiency: num(r.metrics?.materialEfficiency, 0, 1),
			estimatedCutSeconds: Math.round(num(r.metrics?.estimatedCutSeconds, 0, 1e7)),
			sheetArea: num(r.metrics?.sheetArea, 0, 1e7),
			usedArea: num(r.metrics?.usedArea, 0, 1e7),
		},
	};
}

// ─── Entitlement ──────────────────────────────

function toDate(v: unknown): Date | null {
	if (!v) return null;
	if (v instanceof Timestamp) return v.toDate();
	if (v instanceof Date) return v;
	return null;
}

function usageOf(d: FirebaseFirestore.DocumentData | undefined): CutUsageFields {
	const u = d?.usage ?? {};
	return {
		cutCount: u.cutCount ?? 0,
		lastCutAt: toDate(u.lastCutAt),
		monthlyCount: u.monthlyCount ?? 0,
		monthResetAt: toDate(u.monthResetAt),
		dailyCount: u.dailyCount ?? 0,
		dayResetAt: toDate(u.dayResetAt),
	};
}

/** Same rule as the studio's shopStore.isActive: a seat on a shop whose org
 *  (or, for legacy shops, the shop itself) has a live subscription. */
async function teamActive(tx: Transaction, user: FirebaseFirestore.DocumentData): Promise<boolean> {
	if (!user.shopId) return false;
	const db = getAdminDb();
	const shop = (await tx.get(db.doc(`shops/${user.shopId}`))).data();
	if (!shop) return false;
	const org = shop.orgId ? (await tx.get(db.doc(`orgs/${shop.orgId}`))).data() : undefined;
	const status = org?.subscriptionStatus ?? shop.subscriptionStatus;
	return status === 'active' || status === 'trialing';
}

async function assertAllowance(tx: Transaction, user: FirebaseFirestore.DocumentData) {
	if (user.status === 'suspended') throw new CutError('This account is suspended.', 403, 'suspended');
	const limits = cutLimitsFromPlans(await getPlanSettings());
	const profile = { tier: (user.tier ?? 'free') as UserProfile['tier'], usage: usageOf(user) as UserProfile['usage'] };
	// Server clock, not the browser's — the windows can't be skewed from the client.
	const check = canCut(profile, await teamActive(tx, user), limits);
	if (!check.allowed) throw new CutError(check.reason ?? 'Cut limit reached.', 403, 'limit');
}

// ─── Writes ───────────────────────────────────

function statsRef(now: Date) {
	return getAdminDb().doc(`stats/cuts/days/${dayKey(now)}`);
}

function jobDoc(uid: string, input: CutInput, now: Date) {
	return {
		userId: uid,
		name: input.name,
		subject: input.subject,
		status: 'cutting' as JobStatus,
		source: input.source,
		vehicleId: input.vehicleIds[0] ?? '',
		vehicleIds: input.vehicleIds,
		patternIds: input.patternIds,
		plotterConfig: input.plotter,
		materialSheet: input.sheet,
		exportFormat: 'hpgl',
		metrics: {
			...input.metrics,
			totalPathLengthMm: 0,
			itemCount: input.itemCount,
			patternsCompleted: 0,
		},
		counted: false,
		createdAt: Timestamp.fromDate(now),
		updatedAt: Timestamp.fromDate(now),
		completedAt: null,
		exportUrl: null,
	};
}

/** Applies a final status to a job inside `tx`: the job itself, and — the
 *  first time it completes — the user's usage and the platform totals. */
function applyFinish(
	tx: Transaction,
	jobRef: FirebaseFirestore.DocumentReference,
	job: FirebaseFirestore.DocumentData,
	user: FirebaseFirestore.DocumentData,
	status: FinalStatus,
	patternsCompleted: number,
	now: Date,
) {
	const itemCount = job.metrics?.itemCount ?? 0;
	const done = status === 'complete' ? itemCount : Math.min(itemCount, Math.max(job.metrics?.patternsCompleted ?? 0, patternsCompleted));
	const countNow = status === 'complete' && !job.counted;

	tx.update(jobRef, {
		status,
		'metrics.patternsCompleted': done,
		updatedAt: Timestamp.fromDate(now),
		completedAt: status === 'complete' ? Timestamp.fromDate(now) : null,
		...(countNow ? { counted: true } : {}),
	});

	const connection = job.plotterConfig?.connection ?? 'unknown';
	const stats: Record<string, unknown> = { date: dayKey(now), updatedAt: Timestamp.fromDate(now) };
	if (countNow) {
		const next = usageAfterCut(usageOf(user), now);
		tx.update(getAdminDb().doc(`users/${job.userId}`), {
			'usage.cutCount': next.cutCount,
			'usage.lastCutAt': Timestamp.fromDate(now),
			'usage.monthlyCount': next.monthlyCount,
			'usage.monthResetAt': Timestamp.fromDate(next.monthResetAt!),
			'usage.dailyCount': next.dailyCount,
			'usage.dayResetAt': Timestamp.fromDate(next.dayResetAt!),
			[`usage.byMonth.${monthKey(now)}`]: FieldValue.increment(1),
		});
		stats.cuts = FieldValue.increment(1);
		stats.pieces = FieldValue.increment(itemCount);
		// Nested objects, not dotted keys: set(…, { merge }) takes dotted keys literally.
		stats.byConnection = { [connection]: FieldValue.increment(1) };
		stats.bySource = { [job.source ?? 'plotter']: FieldValue.increment(1) };
	} else if (status !== 'complete' && job.status === 'cutting') {
		// A run that stopped short. Counted once per run, not per retry.
		stats[status === 'error' ? 'failed' : 'cancelled'] = FieldValue.increment(1);
		stats.partialPieces = FieldValue.increment(done);
	} else {
		return;
	}
	tx.set(statsRef(now), stats, { merge: true });
}

/** Opens a job before a live plotter send. Refuses when the allowance is used up. */
export async function startCut(uid: string, input: CutInput): Promise<{ jobId: string }> {
	const db = getAdminDb();
	const jobRef = db.collection('jobs').doc(`job_${randomUUID()}`);
	await db.runTransaction(async (tx) => {
		const userSnap = await tx.get(db.doc(`users/${uid}`));
		if (!userSnap.exists) throw new CutError('Account not found.', 404);
		await assertAllowance(tx, userSnap.data()!);
		tx.set(jobRef, jobDoc(uid, input, new Date()));
	});
	return { jobId: jobRef.id };
}

/** Closes a job: complete, failed part-way, or cancelled. Calling it again
 *  after a resume moves an error/cancelled job to complete (counted once). */
export async function finishCut(uid: string, jobId: string, status: FinalStatus, patternsCompleted: number): Promise<void> {
	if (!FINAL.includes(status)) throw new CutError('Invalid status.');
	const db = getAdminDb();
	await db.runTransaction(async (tx) => {
		const jobRef = db.doc(`jobs/${jobId}`);
		const [jobSnap, userSnap] = await Promise.all([tx.get(jobRef), tx.get(db.doc(`users/${uid}`))]);
		const job = jobSnap.data();
		if (!job || job.userId !== uid) throw new CutError('Job not found.', 404);
		if (job.status === 'complete') return; // already final — retries are no-ops
		applyFinish(tx, jobRef, job, userSnap.data() ?? {}, status, Math.round(num(patternsCompleted, 0, 10_000)), new Date());
	});
}

/** A completed cut in one step — the PLT download and Export → HPGL. */
export async function recordCut(uid: string, input: CutInput): Promise<{ jobId: string }> {
	const db = getAdminDb();
	const jobRef = db.collection('jobs').doc(`job_${randomUUID()}`);
	await db.runTransaction(async (tx) => {
		const userSnap = await tx.get(db.doc(`users/${uid}`));
		if (!userSnap.exists) throw new CutError('Account not found.', 404);
		const now = new Date();
		const user = userSnap.data()!;
		await assertAllowance(tx, user);
		const job = jobDoc(uid, input, now);
		tx.set(jobRef, job);
		applyFinish(tx, jobRef, job, user, 'complete', input.itemCount, now);
	});
	return { jobId: jobRef.id };
}
