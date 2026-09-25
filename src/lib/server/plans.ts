import { getAdminDb } from '$lib/server/firebase-admin';
import { mergePlanSettings, type PlanSettings } from '$lib/plans';

const TTL_MS = 60_000;
let cache: { at: number; value: PlanSettings } | null = null;

/** Admin-set plan allowances + prices (settings/platform), merged over the
 *  shared defaults. Cached for a minute per server instance — Admin →
 *  Products edits show up within that window without a deploy. */
export async function getPlanSettings(): Promise<PlanSettings> {
	if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
	const data = (await getAdminDb().doc('settings/platform').get()).data();
	const value = mergePlanSettings(data);
	cache = { at: Date.now(), value };
	return value;
}

/** Call after an admin saves plan settings so this instance serves them immediately. */
export function invalidatePlanSettings(): void {
	cache = null;
}
