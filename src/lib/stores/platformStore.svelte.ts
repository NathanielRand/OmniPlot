// ─────────────────────────────────────────────
// OmniPlot — LIVE FEATURE FLAGS (client)
// ─────────────────────────────────────────────
// One fetch of GET /api/settings/platform shared app-wide. `flags` holds the
// defaults until the live values arrive; check `loaded` before acting on a
// default would be wrong (e.g. refusing a sign-up).

import { DEFAULT_PLATFORM_FLAGS, mergePlatformFlags, type PlatformFlags } from '$lib/platform';

function createPlatformStore() {
	let flags = $state<PlatformFlags>(DEFAULT_PLATFORM_FLAGS);
	let loaded = $state(false);
	let inflight: Promise<void> | null = null;

	function load(force = false): Promise<void> {
		if (typeof window === 'undefined') return Promise.resolve();
		if (inflight && !force) return inflight;
		inflight = fetch('/api/settings/platform')
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => {
				if (data) flags = mergePlatformFlags(data.flags);
			})
			.catch(() => {})
			.finally(() => {
				loaded = true;
			});
		return inflight;
	}

	return {
		/** Live flags (defaults until loaded). Reading this kicks off the fetch. */
		get flags() {
			load();
			return flags;
		},
		get loaded() {
			load();
			return loaded;
		},
		load,
	};
}

export const platformStore = createPlatformStore();
