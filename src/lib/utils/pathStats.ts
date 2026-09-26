import type { PatternGeometryStats } from "$lib/types";

/** Cheap complexity stats for an SVG path's `d` string. Counts commands by
 *  letter, so implicit repeats (e.g. "L 1 2 3 4") count once — it's a rough
 *  measure for spotting heavy traces, not an exact segment count. */
export function pathStats(d: string): PatternGeometryStats {
	const letters = d.match(/[MLHVCSQTAZ]/gi) ?? [];
	return {
		pathBytes: new TextEncoder().encode(d).length,
		subpaths:  letters.filter((c) => c === "M" || c === "m").length,
		commands:  letters.length,
	};
}
