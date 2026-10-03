// ─────────────────────────────────────────────
// OmniPlot — ADMIN-ADDED PATTERN OPTIONS (client)
// ─────────────────────────────────────────────
// One fetch of GET /api/settings/pattern-options shared app-wide. `doc` is
// empty until it arrives, so the built-in lists are what shows first; the
// zone/category helpers in patternStore read it, so everything that calls them
// updates when it lands.

import { EMPTY_OPTIONS, readPatternOptions, type PatternOptionsDoc } from '$lib/patternOptions';

function createPatternOptionsStore() {
	let doc = $state<PatternOptionsDoc>(EMPTY_OPTIONS);
	let loaded = $state(false);
	let inflight: Promise<void> | null = null;

	function load(force = false): Promise<void> {
		if (typeof window === 'undefined') return Promise.resolve();
		if (inflight && !force) return inflight;
		inflight = fetch('/api/settings/pattern-options')
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => { if (data) doc = readPatternOptions(data); })
			.catch(() => {})
			.finally(() => { loaded = true; });
		return inflight;
	}

	return {
		/** Admin additions (none until loaded). Reading this kicks off the fetch. */
		get doc() {
			load();
			return doc;
		},
		/** True once the admin additions have arrived (or failed to) — don't prune a pattern's zones before then. */
		get loaded() {
			load();
			return loaded;
		},
		load,
		/** Use a document the admin just saved, without another round trip. */
		set(next: PatternOptionsDoc) { doc = next; loaded = true; },
	};
}

export const patternOptionsStore = createPatternOptionsStore();
