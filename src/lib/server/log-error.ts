import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '$lib/server/firebase-admin';
import { sendEmail } from '$lib/server/email';

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days — pair with a Firestore TTL policy on `expiresAt`
const ALERT_EMAIL = 'support@omniplot.app';
const MAX_STACK_CHARS = 2000;

export interface LogServerErrorOptions {
	source: 'api' | 'webhook' | 'unhandled';
	route: string;
	uid?: string | null;
	meta?: Record<string, unknown>;
	severity?: 'error' | 'warning';
}

function fingerprint(source: string, route: string, message: string): string {
	// First line only — strips dynamic details (ids, amounts) so the same
	// underlying failure groups into one doc instead of one per occurrence.
	const normalized = message.split('\n')[0].slice(0, 200);
	return createHash('sha1').update(`${source}:${route}:${normalized}`).digest('hex');
}

/**
 * Records a server-side error into Firestore, grouped by fingerprint so a
 * retry storm produces one doc with a rising count instead of thousands of
 * docs. Never throws — logging failures must not mask the original error.
 */
export async function logServerError(err: unknown, opts: LogServerErrorOptions): Promise<void> {
	try {
		const message = err instanceof Error ? err.message : String(err);
		const stack = err instanceof Error && err.stack ? err.stack.slice(0, MAX_STACK_CHARS) : null;
		const severity = opts.severity ?? 'error';
		const fp = fingerprint(opts.source, opts.route, message);
		const db = getAdminDb();
		const ref = db.collection('errorLogs').doc(fp);

		const isNew = await db.runTransaction(async (tx) => {
			const snap = await tx.get(ref);
			const now = FieldValue.serverTimestamp();
			const expiresAt = new Date(Date.now() + RETENTION_MS);

			if (!snap.exists) {
				tx.set(ref, {
					fingerprint: fp,
					source: opts.source,
					route: opts.route,
					message,
					stack,
					severity,
					uid: opts.uid ?? null,
					meta: opts.meta ?? {},
					occurrenceCount: 1,
					firstSeenAt: now,
					lastSeenAt: now,
					resolvedAt: null,
					expiresAt,
				});
				return true;
			}

			tx.update(ref, {
				occurrenceCount: FieldValue.increment(1),
				lastSeenAt: now,
				resolvedAt: null, // a recurring error un-resolves itself
				meta: opts.meta ?? snap.data()?.meta ?? {},
				expiresAt,
			});
			return false;
		});

		// Alert only on the first occurrence of a new error-severity fingerprint —
		// repeats just bump the count above, no repeat emails.
		if (isNew && severity === 'error') {
			sendEmail(
				ALERT_EMAIL,
				`[OmniPlot] New server error: ${opts.route}`,
				`<p><strong>Source:</strong> ${opts.source}</p><p><strong>Route:</strong> ${opts.route}</p><p><strong>Message:</strong> ${message}</p>${opts.uid ? `<p><strong>User:</strong> ${opts.uid}</p>` : ''}`,
			).catch((e) => console.error('[log-error] alert email failed:', e));
		}
	} catch (loggingErr) {
		console.error('[log-error] failed to record error log:', loggingErr);
	}
}
