import { getAdminDb } from '$lib/server/firebase-admin';
import { json } from '@sveltejs/kit';

/**
 * Fixed-window rate limiter backed by Firestore so it works correctly across
 * serverless instances (an in-memory counter would reset per cold start and
 * not be shared between concurrent Vercel invocations).
 *
 * Not exact under heavy contention (last-write-wins on the transaction retry
 * is fine here — the cost of an occasional extra request through is far
 * lower than adding a paid limiter service for this traffic volume).
 */
export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	retryAfterSeconds: number;
}

export async function checkRateLimit(
	key: string,
	opts: { max: number; windowSeconds: number },
): Promise<RateLimitResult> {
	const db = getAdminDb();
	const windowMs = opts.windowSeconds * 1000;
	const now = Date.now();
	const windowStart = Math.floor(now / windowMs) * windowMs;
	const docId = `${key}__${windowStart}`;
	const ref = db.collection('rateLimits').doc(docId);

	const result = await db.runTransaction(async (tx) => {
		const snap = await tx.get(ref);
		const count = (snap.exists ? snap.data()?.count : 0) ?? 0;
		if (count >= opts.max) {
			return { allowed: false, remaining: 0 };
		}
		tx.set(ref, {
			count: count + 1,
			windowStart,
			expiresAt: new Date(windowStart + windowMs + windowMs), // TTL: keep one extra window for safety
		}, { merge: true });
		return { allowed: true, remaining: opts.max - (count + 1) };
	});

	const retryAfterSeconds = Math.max(0, Math.ceil((windowStart + windowMs - now) / 1000));
	return { ...result, retryAfterSeconds };
}

/** 429 helper — call after checkRateLimit returns allowed:false. */
export function rateLimitedResponse(result: RateLimitResult) {
	return json(
		{ error: 'Too many requests. Please try again shortly.' },
		{ status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } },
	);
}
