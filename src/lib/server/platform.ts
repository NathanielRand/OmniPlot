import { getAdminDb } from '$lib/server/firebase-admin';
import { mergePlatformFlags, type PlatformFlags } from '$lib/platform';

const TTL_MS = 30_000;
let cache: { at: number; value: PlatformFlags } | null = null;

/** Admin-set feature flags (settings/platform.flags) over the defaults.
 *  Cached briefly per server instance, like plan settings. */
export async function getPlatformFlags(): Promise<PlatformFlags> {
	if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
	const data = (await getAdminDb().doc('settings/platform').get()).data();
	const value = mergePlatformFlags(data?.flags);
	cache = { at: Date.now(), value };
	return value;
}

/** Call after an admin saves flags so this instance serves them immediately. */
export function invalidatePlatformFlags(): void {
	cache = null;
}
