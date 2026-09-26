// ─────────────────────────────────────────────
// OmniPlot — CUT STATS (admin reads)
// ─────────────────────────────────────────────
// One reading of cut data for every admin screen, so the dashboard, Analytics,
// the user drawer and support agree:
//  • "Cuts" means COMPLETED cuts. Failed and cancelled runs are reported
//    separately, never added in.
//  • Daily totals come from stats/cuts/days/{YYYY-MM-DD}, written in the same
//    transaction as the job (so a user clearing their history doesn't erase
//    them). Days before those counters existed fall back to the jobs.
//  • Lifetime per-user totals are users/{uid}.usage.cutCount.
//  • `backfilled` jobs are reconstructed stand-ins for cuts whose job record
//    was lost (Jun–Sep 2026): real cuts with a real time (or no known date),
//    but no details. They count as cuts; they're never in the day counters.

import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '$lib/server/firebase-admin';
import { dayKey } from '$lib/cuts';

export const RECONSTRUCTED_LABEL = 'Reconstructed · details not recorded';

export function isReconstructed(j: FirebaseFirestore.DocumentData): boolean {
	return j.backfilled === true;
}

/** A job left "cutting" this long never reported back (tab closed, crash). */
const STALE_CUTTING_MS = 2 * 60 * 60 * 1000;

export type DisplayStatus = 'complete' | 'error' | 'cancelled' | 'cutting' | 'interrupted';

export function toDate(v: unknown): Date | null {
	if (v instanceof Timestamp) return v.toDate();
	if (v instanceof Date) return v;
	if (typeof v === 'string' || typeof v === 'number') {
		const d = new Date(v);
		return Number.isNaN(d.getTime()) ? null : d;
	}
	return null;
}

export function jobStatus(j: FirebaseFirestore.DocumentData, now = Date.now()): DisplayStatus {
	const s = j.status === 'completed' ? 'complete' : j.status === 'failed' ? 'error' : j.status;
	if (s === 'cutting') {
		const since = toDate(j.updatedAt) ?? toDate(j.createdAt);
		return since && now - since.getTime() > STALE_CUTTING_MS ? 'interrupted' : 'cutting';
	}
	return s === 'complete' || s === 'error' || s === 'cancelled' ? s : 'complete';
}

/** Pieces actually cut: all of them for a completed job, the sent ones otherwise. */
export function jobPieces(j: FirebaseFirestore.DocumentData): { total: number; done: number } {
	const total = Number(j.metrics?.itemCount ?? 0) || 0;
	const done = jobStatus(j) === 'complete' ? total : Math.min(total, Number(j.metrics?.patternsCompleted ?? 0) || 0);
	return { total, done };
}

/** When a job counts for date buckets: completion time, else when it started. */
export function jobDate(j: FirebaseFirestore.DocumentData): Date | null {
	return toDate(j.completedAt) ?? toDate(j.createdAt);
}

function vehicleLabel(v: FirebaseFirestore.DocumentData | undefined): string {
	if (!v) return '';
	if ((v.projectType ?? 'vehicle') === 'vehicle' && (v.make || v.model)) return [v.year, v.make, v.model].filter(Boolean).join(' ');
	return v.propertyLabel || v.model || v.address || '';
}

/** Readable "what was cut" for a set of jobs. New jobs carry `subject`;
 *  older ones are resolved from the vehicles catalog by vehicleId. */
export async function jobSubjects(jobs: FirebaseFirestore.DocumentData[]): Promise<(j: FirebaseFirestore.DocumentData) => string> {
	const db = getAdminDb();
	const missing = [...new Set(jobs.filter((j) => !j.subject && j.vehicleId).map((j) => String(j.vehicleId)))].slice(0, 300);
	const names = new Map<string, string>();
	if (missing.length) {
		const snaps = await db.getAll(...missing.map((id) => db.doc(`vehicles/${id}`)));
		for (const s of snaps) if (s.exists) names.set(s.id, vehicleLabel(s.data()));
	}
	return (j) => (isReconstructed(j) ? RECONSTRUCTED_LABEL : '') || j.subject || vehicleLabel(j.vehicle) || names.get(j.vehicleId) || j.vehicleId || j.name || 'Untitled';
}

export interface DayTotals { date: string; cuts: number; pieces: number; failed: number; cancelled: number }

/** Completed cuts, pieces, failed and cancelled runs per UTC day in [start, now]. */
export async function cutTotalsByDay(start: Date, legacyJobs: FirebaseFirestore.DocumentData[]): Promise<Map<string, DayTotals>> {
	const days = new Map<string, DayTotals>();
	for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())); d <= new Date(); d.setUTCDate(d.getUTCDate() + 1)) {
		const k = dayKey(d);
		days.set(k, { date: k, cuts: 0, pieces: 0, failed: 0, cancelled: 0 });
	}

	const counted = new Set<string>();
	const snap = await getAdminDb().collection('stats/cuts/days').where('date', '>=', dayKey(start)).get();
	for (const doc of snap.docs) {
		const b = days.get(doc.id);
		if (!b) continue;
		const d = doc.data();
		b.cuts = d.cuts ?? 0;
		b.pieces = d.pieces ?? 0;
		b.failed = d.failed ?? 0;
		b.cancelled = d.cancelled ?? 0;
		counted.add(doc.id);
	}

	// Days with no counter doc: derive from the jobs (pre-counter history).
	// Reconstructed jobs are never in a counter doc, so they always add.
	for (const j of legacyJobs) {
		const at = jobDate(j);
		if (!at) continue;
		const k = dayKey(at);
		const b = days.get(k);
		if (!b || (counted.has(k) && !isReconstructed(j))) continue;
		const status = jobStatus(j);
		if (status === 'complete') { b.cuts++; b.pieces += jobPieces(j).total; }
		else if (status === 'error' || status === 'interrupted') b.failed++;
		else if (status === 'cancelled') b.cancelled++;
	}
	return days;
}
