// ─────────────────────────────────────────────
// OmniPlot — LIVE PLAN SETTINGS (client)
// ─────────────────────────────────────────────
// One fetch of GET /api/settings/plans shared by every page and component
// that shows or enforces a plan limit/price. `settings` holds the shared
// defaults until the live values arrive; check `loaded` where acting on a
// default would be wrong (e.g. locking a paid user out of uploads).

import { DEFAULT_PLAN_SETTINGS, fillPlanTokens, mergePlanSettings, type PlanSettings } from '$lib/plans';

function createPlansStore() {
	let settings = $state<PlanSettings>(DEFAULT_PLAN_SETTINGS);
	let loaded = $state(false);
	let inflight: Promise<void> | null = null;

	function load(force = false): Promise<void> {
		if (typeof window === 'undefined') return Promise.resolve();
		if (inflight && !force) return inflight;
		inflight = fetch('/api/settings/plans')
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => {
				if (data) settings = mergePlanSettings({ plans: data, shopPlans: data.shopPlans });
			})
			.catch(() => {})
			.finally(() => {
				loaded = true;
			});
		return inflight;
	}

	return {
		/** Live settings (defaults until loaded). Reading this kicks off the fetch. */
		get settings() {
			load();
			return settings;
		},
		get loaded() {
			load();
			return loaded;
		},
		load,
		/** Fills {{tokens}} in static copy from the live settings. */
		fill(text: string): string {
			load();
			return fillPlanTokens(text, settings);
		},
	};
}

export const plansStore = createPlansStore();
