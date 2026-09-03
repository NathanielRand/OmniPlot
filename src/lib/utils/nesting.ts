// ─────────────────────────────────────────────
// OmniPlot — AI-ASSISTED NESTING ENGINE
//
// Two tiers of optimization:
//   autoNest  — fast (< 50ms), used on every canvas change
//   smartNest — thorough (100–800ms), user-triggered "AI Nest"
//
// Algorithm family: iterated local search on skyline bin-packing
//   • Best-fit skyline with valley-fill candidate positions
//   • 10 sort heuristics (area, height, width, perimeter, aspect,
//     max-dim, compactness, moment, diagonal, random)
//   • Dual scoring modes: leftmost-first + compact-fill
//   • Rotation improvement pass (tries all 4 rotations per item)
//   • Pairwise swap improvement pass
//   • Insertion improvement pass (smartNest only)
//   • 20 random-restart trials (smartNest only)
//   • Module-level caches survive across calls in a session
// ─────────────────────────────────────────────
import type { CanvasItem, MaterialSheet } from "$lib/types";
import {
	type Point,
	type Polygon,
	polygonBounds,
	translatePolygon,
	rotatePoints,
	normalizeToBBox,
	inflatePolygon,
	nfpGeneral,
	innerFitBounds,
	nfpCandidates,
	pointInPolygon,
	ensureCCW,
	polygonsOverlap,
} from "./polygon";

// Minimum clearance kept between placed pieces (and between a piece and the
// roll edge), in inches. Defaults to a sane cut buffer but is user-settable
// per material sheet (canvasStore.sheet.bufferInches) — the top-level nest
// functions below reassign this before packing. A negative value means
// intentional overlap; the user has to explicitly opt into that.
let PADDING_INCHES = 0.05;

// ─── Module-level caches ──────────────────────
const _sampleCache  = new Map<string, Array<{ x: number; y: number }>>();
const _bboxCache    = new Map<string, { w: number; h: number }>();
const _areaCache    = new Map<string, number>();
const _svgBBoxCache = new Map<string, { x: number; y: number; w: number; h: number }>();

// ─── Skyline helpers ──────────────────────────

interface SkylineSegment {
	x: number;
	y: number;
	width: number;
}

function getMaxY(skyline: SkylineSegment[], x: number, w: number): number {
	let maxY = 0;
	const end = x + w;
	for (const seg of skyline) {
		if (seg.x + seg.width <= x) continue;
		if (seg.x >= end) continue;
		if (seg.y > maxY) maxY = seg.y;
	}
	return maxY;
}

function updateSkyline(
	skyline: SkylineSegment[],
	x: number,
	w: number,
	newY: number,
	sheetW: number,
): SkylineSegment[] {
	const end = Math.min(x + w, sheetW);
	const result: SkylineSegment[] = [];

	for (const seg of skyline) {
		const segEnd = seg.x + seg.width;
		if (segEnd <= x || seg.x >= end) {
			result.push({ ...seg });
			continue;
		}
		if (seg.x < x) {
			result.push({ x: seg.x, y: seg.y, width: x - seg.x });
		}
		const overlapStart = Math.max(seg.x, x);
		const overlapEnd   = Math.min(segEnd, end);
		result.push({ x: overlapStart, y: newY, width: overlapEnd - overlapStart });
		if (segEnd > end) {
			result.push({ x: end, y: seg.y, width: segEnd - end });
		}
	}

	result.sort((a, b) => a.x - b.x);
	const merged: SkylineSegment[] = [];
	for (const seg of result) {
		if (seg.width < 0.001) continue;
		const last = merged[merged.length - 1];
		if (last && last.y === seg.y && Math.abs(last.x + last.width - seg.x) < 0.001) {
			last.width += seg.width;
		} else {
			merged.push({ ...seg });
		}
	}
	return merged;
}

// ─── Tight polygon bounding box ───────────────

function samplePathInchPoints(
	svgPath: string,
	nominalW: number,
	nominalH: number,
	samples = 120,
): Array<{ x: number; y: number }> {
	const cacheKey = `${nominalW}|${nominalH}|${samples}|${svgPath}`;
	if (_sampleCache.has(cacheKey)) return _sampleCache.get(cacheKey)!;

	const fallback = [
		{ x: 0, y: 0 },
		{ x: nominalW, y: 0 },
		{ x: nominalW, y: nominalH },
		{ x: 0, y: nominalH },
	];

	if (typeof document === "undefined") {
		_sampleCache.set(cacheKey, fallback);
		return fallback;
	}
	try {
		const ns  = "http://www.w3.org/2000/svg";
		const svg = document.createElementNS(ns, "svg");
		const el  = document.createElementNS(ns, "path") as SVGPathElement;
		el.setAttribute("d", svgPath);
		svg.appendChild(el);
		document.body.appendChild(svg);

		const total  = el.getTotalLength();
		const step   = total / samples;
		const bbox   = el.getBBox();
		const scaleX = nominalW / (bbox.width  || 1);
		const scaleY = nominalH / (bbox.height || 1);

		const pts: Array<{ x: number; y: number }> = [];
		for (let i = 0; i <= samples; i++) {
			const pt = el.getPointAtLength(i * step);
			pts.push({
				x: (pt.x - bbox.x) * scaleX,
				y: (pt.y - bbox.y) * scaleY,
			});
		}
		document.body.removeChild(svg);
		_sampleCache.set(cacheKey, pts);
		return pts;
	} catch {
		_sampleCache.set(cacheKey, fallback);
		return fallback;
	}
}

function tightBboxAtRotation(
	svgPath: string,
	nominalW: number,
	nominalH: number,
	rotDeg: number,
): { w: number; h: number } {
	const cacheKey = `${nominalW}|${nominalH}|${rotDeg}|${svgPath}`;
	if (_bboxCache.has(cacheKey)) return _bboxCache.get(cacheKey)!;

	const pts = samplePathInchPoints(svgPath, nominalW, nominalH);
	const cx  = nominalW / 2;
	const cy  = nominalH / 2;
	const rad = (rotDeg * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);

	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
	for (const p of pts) {
		const rx = rotDeg === 0 ? p.x : cos * (p.x - cx) - sin * (p.y - cy);
		const ry = rotDeg === 0 ? p.y : sin * (p.x - cx) + cos * (p.y - cy);
		if (rx < minX) minX = rx;
		if (rx > maxX) maxX = rx;
		if (ry < minY) minY = ry;
		if (ry > maxY) maxY = ry;
	}

	const result = { w: Math.max(0.1, maxX - minX), h: Math.max(0.1, maxY - minY) };
	_bboxCache.set(cacheKey, result);
	return result;
}

// ─── Polygon area (shoelace) ──────────────────
export function samplePolygonArea(
	svgPath: string,
	widthInches: number,
	heightInches: number,
): number {
	const cacheKey = `${widthInches}|${heightInches}|${svgPath}`;
	if (_areaCache.has(cacheKey)) return _areaCache.get(cacheKey)!;

	const pts = samplePathInchPoints(svgPath, widthInches, heightInches);
	let area = 0;
	for (let i = 0; i < pts.length; i++) {
		const j = (i + 1) % pts.length;
		area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
	}
	const result = Math.abs(area) / 2;
	_areaCache.set(cacheKey, result);
	return result;
}

// ─── Raw SVG bounding box (in path's own coordinate system) ──────────────────
// Returns the natural bbox of the SVG path string — what the browser computes
// via getBBox(). Cached by path string. Used to set per-item SVG viewBox so the
// path fills its rendered div exactly (no phantom whitespace from 0-0-100-100).
export function getSvgPathBBox(
	svgPath: string,
): { x: number; y: number; w: number; h: number } {
	if (_svgBBoxCache.has(svgPath)) return _svgBBoxCache.get(svgPath)!;

	const fallback = { x: 0, y: 0, w: 100, h: 100 };
	if (typeof document === "undefined") {
		_svgBBoxCache.set(svgPath, fallback);
		return fallback;
	}
	try {
		const ns  = "http://www.w3.org/2000/svg";
		const svg = document.createElementNS(ns, "svg");
		const el  = document.createElementNS(ns, "path") as SVGPathElement;
		el.setAttribute("d", svgPath);
		svg.appendChild(el);
		document.body.appendChild(svg);
		const b = el.getBBox();
		document.body.removeChild(svg);
		const result = { x: b.x, y: b.y, w: b.width, h: b.height };
		_svgBBoxCache.set(svgPath, result);
		return result;
	} catch {
		_svgBBoxCache.set(svgPath, fallback);
		return fallback;
	}
}

// ─── Orientation candidates ───────────────────
function buildOrientations(
	item: CanvasItem,
	sheetW: number,
	allowRotation: boolean,
): Array<{ w: number; h: number; rot: number }> {
	const angles = allowRotation ? [0, 90, 180, 270] : [0];
	const seen   = new Set<string>();
	const result: Array<{ w: number; h: number; rot: number }> = [];
	for (const rot of angles) {
		const bbox = tightBboxAtRotation(
			item.pattern.svgPath,
			item.pattern.widthInches,
			item.pattern.heightInches,
			rot,
		);
		const key = `${bbox.w.toFixed(3)},${bbox.h.toFixed(3)}`;
		if (!seen.has(key) && bbox.w <= sheetW + 0.001) {
			seen.add(key);
			result.push({ w: bbox.w, h: bbox.h, rot });
		}
	}
	return result;
}

// ─── Candidate X positions (best-fit enhancement) ────────────────
// Beyond just the left edge of each segment, also try right-aligned
// positions so items can "fall into valleys" in the skyline.
function candidateXs(
	skyline: SkylineSegment[],
	iW: number,
	sheetW: number,
): number[] {
	const xs = new Set<number>();
	for (const seg of skyline) {
		xs.add(seg.x); // left-align to segment
		const rightAligned = seg.x + seg.width - iW;
		if (rightAligned > 0) xs.add(rightAligned); // right-align to segment end
	}
	return Array.from(xs)
		.filter((x) => x >= 0 && x + iW <= sheetW + 0.001)
		.sort((a, b) => a - b);
}

// ─── Best-fit skyline packer ──────────────────
// scoring:
//   'left'    — minimize roll length (leftmost X first)
//   'compact' — minimize placeY then X (fills valleys aggressively)
function bestFitPack(
	items: CanvasItem[],
	sheet: MaterialSheet,
	allowRotation: boolean,
	scoring: "left" | "compact" = "left",
	floorY = 0,
): CanvasItem[] {
	const sheetW = sheet.widthInches;
	const sheetH = sheet.heightInches;
	const pad    = PADDING_INCHES;

	let skyline: SkylineSegment[] = [{ x: 0, y: floorY, width: sheetW }];
	let overflowRow = 0;
	const placed: CanvasItem[] = [];

	for (const item of items) {
		const orientations = buildOrientations(item, sheetW, allowRotation);

		let best: {
			x: number; y: number; w: number; h: number; rot: number; score: number;
		} | null = null;

		for (const { w: iW, h: iH, rot } of orientations) {
			for (const startX of candidateXs(skyline, iW, sheetW)) {
				const maxY   = getMaxY(skyline, startX, iW);
				const placeY = maxY + pad;
				if (placeY + iH > sheetH + 0.001) continue;

				// 'left': minimize roll length consumed (startX primary)
				// 'compact': fill from bottom-left of sheet (placeY primary)
				// Tie-break: prefer orientations that lay the long side sideways
				// (small length-wise extent iW, large width-wise extent iH) — this
				// only breaks exact ties in the primary/secondary terms above (e.g.
				// the very first item placed, where startX and placeY are identical
				// across all rotations) and never overrides a genuine improvement.
				const sidewaysBias = (iW - iH) * 1e-6;
				const score =
					scoring === "compact"
						? placeY * sheetW + startX + sidewaysBias
						: startX * 1e6 + placeY + sidewaysBias;

				if (best === null || score < best.score) {
					best = { x: startX, y: placeY, w: iW, h: iH, rot, score };
				}
			}
		}

		if (best) {
			placed.push({
				...item,
				x: best.x, y: best.y,
				width: best.w, height: best.h,
				rotation: best.rot,
				outOfBounds: false,
			});
			skyline = updateSkyline(skyline, best.x, best.w + pad, best.y + best.h, sheetW);
		} else {
			placed.push({
				...item,
				x: pad + overflowRow * (item.pattern.widthInches + pad),
				y: sheetH + pad,
				width: item.pattern.widthInches,
				height: item.pattern.heightInches,
				rotation: 0,
				outOfBounds: true,
			});
			overflowRow++;
		}
	}

	return placed;
}

// Maximum X extent of in-bounds items — minimization objective.
function layoutLen(placed: CanvasItem[]): number {
	const ib = placed.filter((i) => !i.outOfBounds);
	return ib.length ? Math.max(...ib.map((i) => i.x + i.width)) : 0;
}

// ─── Row-balance group pass ───────────────────
// bestFitPack is a greedy, order-dependent skyline packer: given a batch of
// identical (or same-footprint) items, its per-item local choices tend to
// converge on a "balanced" split across orientations (e.g. half sideways,
// half not) even when an *unbalanced* split minimizes total roll length —
// classic greedy-vs-global mismatch. rotationImprovementPass can't fix this
// either: it evaluates one item's rotation at a time and, because
// buildOrientations always offers every rotation regardless of what's
// pre-set, a full repack after a single flip just re-derives the same
// greedy local optimum. Reaching the true optimum requires explicitly
// searching how many same-footprint items go in each orientation, which is
// exactly what this pass does — for items whose only two candidate
// orientations are a simple 90° transpose of the same rectangle (windows,
// panels, anything without asymmetric per-rotation area), group them by
// shared footprint and solve the small "how many rows of each orientation"
// sub-problem directly, then bin-pack any leftover (ungroupable) items into
// the remaining width with the existing greedy packer.
export function rowBalanceGroupPass(
	items: CanvasItem[],
	sheet: MaterialSheet,
	allowRotation: boolean,
): CanvasItem[] | null {
	if (!allowRotation) return null;
	// `sheet` here is always the already-transposed sheet (widthInches =
	// length axis, effectively unbounded; heightInches = the true, tightly-
	// bounded 60"-ish roll width) — same convention as bestFitPack and every
	// other function in this file. This previously read sheet.widthInches,
	// which meant the row-height budget check below basically never
	// triggered (the length axis is enormous) — it produced the right split
	// for same-footprint groups anyway simply because the winning split
	// happened to fit under the true width too, but nothing was actually
	// enforcing that. A group whose only length-minimizing split needed
	// more real width than the roll has would have been accepted invalidly
	// upstream, then silently discarded by finalDeclash downstream (which
	// DOES check the true width bound) — correct outcome, but by accident,
	// at the cost of excluding a shape that a right-sized row split could
	// have fit.
	const rollWidth = sheet.heightInches;
	const pad = PADDING_INCHES;

	type Group = { long: number; short: number; items: CanvasItem[] };
	const groups = new Map<string, Group>();
	const ungrouped: CanvasItem[] = [];

	for (const item of items) {
		// buildOrientations' sheetW filter is meant to reject only footprints
		// that can't possibly fit the LENGTH axis — pass sheet.widthInches
		// (the length bound, same as every other buildOrientations call in
		// this file), not rollWidth (the much smaller true-width bound) —
		// otherwise a perfectly valid orientation whose length-axis footprint
		// merely exceeds 60" would get wrongly discarded here.
		const orientations = buildOrientations(item, sheet.widthInches, true);
		// Only groupable if it reduces to exactly one distinct rectangle
		// (i.e. every offered rotation is either that rectangle or its
		// 90° transpose) — asymmetric shapes whose 4 rotations give 3-4
		// distinct bboxes aren't a fit for this row-count search.
		const footprints = new Set(orientations.map((o) => [o.w, o.h].sort((a, b) => a - b).map((n) => n.toFixed(2)).join("x")));
		if (footprints.size !== 1) {
			ungrouped.push(item);
			continue;
		}
		const [a, b] = orientations[0].w >= orientations[0].h
			? [orientations[0].w, orientations[0].h]
			: [orientations[0].h, orientations[0].w];
		const key = `${a.toFixed(2)}x${b.toFixed(2)}`;
		const g = groups.get(key) ?? { long: a, short: b, items: [] };
		g.items.push(item);
		groups.set(key, g);
	}

	if (groups.size === 0) return null; // nothing to gain over the generic packer

	// Pack biggest-footprint groups first so later groups fill leftover width.
	const orderedGroups = [...groups.values()].sort((a, b) => b.long * b.short - a.long * a.short);

	const placed: CanvasItem[] = [];
	let y = 0;

	for (const g of orderedGroups) {
		const k = g.items.length;
		const remaining = rollWidth - y;

		// n1 items "long side crosswise" (row height = long, per-item length = short)
		// n2 items "long side along length" (row height = short, per-item length = long)
		let bestSplit: { n1: number; n2: number; maxLen: number } | null = null;
		for (let n1 = 0; n1 <= k; n1++) {
			const n2 = k - n1;
			const rowsHeight = (n1 > 0 ? g.long + pad : 0) + (n2 > 0 ? g.short + pad : 0);
			if (rowsHeight > remaining + 0.001) continue;
			const len1 = n1 > 0 ? n1 * (g.short + pad) - pad : 0;
			const len2 = n2 > 0 ? n2 * (g.long + pad) - pad : 0;
			const maxLen = Math.max(len1, len2);
			if (!bestSplit || maxLen < bestSplit.maxLen - 0.001) bestSplit = { n1, n2, maxLen };
		}

		if (!bestSplit) {
			// Doesn't fit at all in the remaining width — hand back to the
			// generic packer rather than force a bad placement.
			ungrouped.push(...g.items);
			continue;
		}

		const { n1, n2 } = bestSplit;
		let x = 0;
		for (let i = 0; i < n1; i++) {
			const item = g.items[i];
			placed.push({ ...item, x, y, width: g.short, height: g.long, rotation: 90, outOfBounds: false });
			x += g.short + pad;
		}
		if (n1 > 0) y += g.long + pad;
		x = 0;
		for (let i = n1; i < k; i++) {
			const item = g.items[i];
			placed.push({ ...item, x, y, width: g.long, height: g.short, rotation: 0, outOfBounds: false });
			x += g.long + pad;
		}
		if (n2 > 0) y += g.short + pad;
	}

	if (ungrouped.length > 0) {
		const rest = bestFitPack(ungrouped, sheet, allowRotation, "left", y);
		placed.push(...rest);
	}

	return placed;
}

// ─── Rotation improvement pass ────────────────
// For each placed item, try all other valid rotations. Re-packs and keeps
// any rotation that reduces total roll length. Particularly effective for
// asymmetric shapes where 90° vs 270° tight bboxes differ.
function rotationImprovementPass(
	placed: CanvasItem[],
	sheet: MaterialSheet,
	allowRotation: boolean,
	withinBudget?: () => boolean,
): CanvasItem[] {
	if (!allowRotation) return placed;

	let current = [...placed].sort((a, b) => a.x - b.x || a.y - b.y);
	let curLen  = layoutLen(current);
	const n = current.length;
	// Compaction-aware evaluation is an extra O(n^2) pass per rotation trial
	// (O(n^3) total for this loop) — worth it for the item counts where this
	// module actually runs on every canvas change, too costly to also do it
	// unconditionally at 30+ items and still hit the "<50ms" autoNest budget.
	const evaluateWithCompaction = n <= 20;

	for (let i = 0; i < n; i++) {
		if (withinBudget && !withinBudget()) break;
		const item = current[i];
		const orientations = buildOrientations(item, sheet.widthInches, true);
		for (const { rot } of orientations) {
			if (rot === item.rotation) continue;
			const trial = current.map((it, idx) =>
				idx === i ? { ...it, rotation: rot } : it,
			);
			// Evaluate through compaction: a rotation can look like a wash (or
			// even a regression) against the raw skyline repack, but only pay
			// off once neighbors slide into the gap it opened up. Judging the
			// trial on the uncompacted repack alone misses exactly that case.
			const repacked = bestFitPack(trial, sheet, true, "left");
			const settled  = evaluateWithCompaction ? compactionPass(repacked, sheet) : repacked;
			const len = layoutLen(settled);
			if (len < curLen - 0.01) {
				current = settled.sort((a, b) => a.x - b.x || a.y - b.y);
				curLen  = len;
			}
		}
	}

	return current;
}

// ─── Compaction pass (bottom-left gap fill) ──
// The skyline packer places items against a height *profile*, so a short item
// sitting next to a tall one still consumes the tall one's full row — it can't
// slide into a leftover pocket underneath a shorter neighbor further along.
// This pass re-settles each already-placed item against the true rectangles
// of its neighbors (not the skyline profile), sliding it left then up,
// alternating a few times to converge. Net effect: items reflow to squeeze
// into any real gap, like flex-wrap reflow, tightening both axes.
function computeMinX(
	item: CanvasItem,
	settled: CanvasItem[],
	pad: number,
): number {
	let maxRight = 0;
	for (const s of settled) {
		if (s.id === item.id) continue;
		const sTop = s.y - pad, sBot = s.y + s.height + pad;
		if (sBot <= item.y || sTop >= item.y + item.height) continue;
		const right = s.x + s.width + pad;
		if (right > maxRight) maxRight = right;
	}
	return Math.max(0, maxRight);
}

function computeMinY(
	item: CanvasItem,
	settled: CanvasItem[],
	pad: number,
): number {
	let maxBottom = 0;
	for (const s of settled) {
		if (s.id === item.id) continue;
		const sLeft = s.x - pad, sRight = s.x + s.width + pad;
		if (sRight <= item.x || sLeft >= item.x + item.width) continue;
		const bottom = s.y + s.height + pad;
		if (bottom > maxBottom) maxBottom = bottom;
	}
	return Math.max(0, maxBottom);
}

function compactionPass(
	placed: CanvasItem[],
	sheet: MaterialSheet,
): CanvasItem[] {
	const pad = PADDING_INCHES;
	const inBounds = placed.filter((i) => !i.outOfBounds);

	// Process in reading order (x then y) so earlier-settled items form the
	// walls later items slide up against — keeps the result deterministic.
	const ordered = [...inBounds].sort((a, b) => a.x - b.x || a.y - b.y);
	const settled: CanvasItem[] = [];

	for (const original of ordered) {
		const item = { ...original };
		for (let iter = 0; iter < 3; iter++) {
			// Clamp to the origin side: an item whose y-range merely touches a
			// neighbor's within `pad` can get misread by computeMinX as an
			// x-blocker (it's actually stacked above/below, not beside) and
			// return a value past the item's current x. Compaction must only
			// ever slide an item toward (0, 0), never push it further out.
			const newX = Math.min(item.x, computeMinX(item, settled, pad));
			if (Math.abs(newX - item.x) > 0.001) item.x = newX;
			const newY = Math.min(item.y, computeMinY(item, settled, pad));
			if (Math.abs(newY - item.y) > 0.001) item.y = newY;
		}
		if (item.y + item.height > sheet.heightInches + 0.001) {
			settled.push(original); // safety: keep original placement if it no longer fits
		} else {
			settled.push(item);
		}
	}

	const byId = new Map(settled.map((r) => [r.id, r]));
	const result = placed.map((r) => byId.get(r.id) ?? r);

	// Safety net: never return an overlapping layout.
	return findOverlaps(result).length > 0 ? placed : result;
}

function rectsOverlap(
	ax: number, ay: number, aw: number, ah: number,
	bx: number, by: number, bw: number, bh: number,
	pad: number,
): boolean {
	return (
		ax < bx + bw + pad && ax + aw + pad > bx &&
		ay < by + bh + pad && ay + ah + pad > by
	);
}

// ─── Local rotation refinement ────────────────
// compactionPass squeezes items together, which can open up room for a
// neighbor to flip into a sideways orientation that wouldn't have fit before
// (e.g. a full skyline repack would have kept it in its old row). Rotating
// in place — keeping the item's anchor (x, y) fixed and only swapping its
// w/h footprint — lets that opportunity get exploited without discarding the
// compacted layout via a full bestFitPack repack.
function localRotationRefine(
	placed: CanvasItem[],
	sheet: MaterialSheet,
	allowRotation: boolean,
): CanvasItem[] {
	if (!allowRotation) return placed;

	const pad = PADDING_INCHES;
	const current = [...placed];
	// Rightmost items first — they're the ones actually driving roll length.
	const order = current
		.map((_, idx) => idx)
		.filter((idx) => !current[idx].outOfBounds)
		.sort((a, b) => (current[b].x + current[b].width) - (current[a].x + current[a].width));

	for (const idx of order) {
		const item = current[idx];
		const orientations = buildOrientations(item, sheet.widthInches, true);
		let bestRight = item.x + item.width;
		let bestOrientation: { w: number; h: number; rot: number } | null = null;

		for (const { w, h, rot } of orientations) {
			if (rot === item.rotation) continue;
			if (item.x + w > sheet.widthInches + 0.001) continue;
			if (item.y + h > sheet.heightInches + 0.001) continue;

			const collides = current.some((other, oi) => {
				if (oi === idx || other.outOfBounds) return false;
				return rectsOverlap(item.x, item.y, w, h, other.x, other.y, other.width, other.height, pad);
			});
			if (collides) continue;

			const right = item.x + w;
			if (right < bestRight - 0.01) {
				bestRight = right;
				bestOrientation = { w, h, rot };
			}
		}

		if (bestOrientation) {
			current[idx] = { ...item, width: bestOrientation.w, height: bestOrientation.h, rotation: bestOrientation.rot };
		}
	}

	return current;
}

// ─── Pairwise swap improvement pass ──────────
function swapImprovementPass(
	placed: CanvasItem[],
	sheet: MaterialSheet,
	allowRotation: boolean,
	withinBudget?: () => boolean,
): CanvasItem[] {
	let current = [...placed].sort((a, b) => a.x - b.x || a.y - b.y);
	let curLen  = layoutLen(current);
	const n = current.length;

	for (let i = 0; i < n; i++) {
		if (withinBudget && !withinBudget()) break;
		for (let j = i + 1; j < n; j++) {
			const trial = [...current];
			[trial[i], trial[j]] = [trial[j], trial[i]];
			const repacked = bestFitPack(trial, sheet, allowRotation, "left");
			const len = layoutLen(repacked);
			if (len < curLen - 0.01) {
				current = repacked.sort((a, b) => a.x - b.x || a.y - b.y);
				curLen  = len;
			}
		}
	}

	return current;
}

// ─── Insertion improvement pass ──────────────
// For each item, removes it from its current position in the ordering and
// re-inserts it at the position that minimizes roll length. O(n²) repacks —
// used only in smartNest where we have the budget for it.
function insertionImprovementPass(
	placed: CanvasItem[],
	sheet: MaterialSheet,
	allowRotation: boolean,
	withinBudget?: () => boolean,
): CanvasItem[] {
	let current = [...placed].sort((a, b) => a.x - b.x || a.y - b.y);
	let curLen  = layoutLen(current);
	let improved = true;

	while (improved) {
		if (withinBudget && !withinBudget()) break;
		improved = false;
		const n = current.length;
		for (let i = 0; i < n; i++) {
			if (withinBudget && !withinBudget()) break;
			const item = current[i];
			const rest = current.filter((_, idx) => idx !== i);
			let bestInsertLen = curLen;
			let bestInsertPos = -1;

			for (let j = 0; j <= rest.length; j++) {
				const trial = [...rest.slice(0, j), item, ...rest.slice(j)];
				const repacked = bestFitPack(trial, sheet, allowRotation, "left");
				const len = layoutLen(repacked);
				if (len < bestInsertLen - 0.01) {
					bestInsertLen = len;
					bestInsertPos = j;
				}
			}

			if (bestInsertPos !== -1) {
				const trial = [
					...rest.slice(0, bestInsertPos),
					item,
					...rest.slice(bestInsertPos),
				];
				current = bestFitPack(trial, sheet, allowRotation, "left")
					.sort((a, b) => a.x - b.x || a.y - b.y);
				curLen  = bestInsertLen;
				improved = true;
			}
		}
	}

	return current;
}

// ─── Gap-fill pass (MaxRects-style corner search) ──
// Every pass above — bestFitPack's skyline, rowBalanceGroupPass's dedicated
// bands, even compactionPass's neighbor-slide — is a "shelf" packer at
// heart: each only ever tracks a profile along one axis (a monotonic
// height-per-x-slice, or a fixed-height band), so none of them can
// represent an arbitrary rectangular VOID that opens up in the middle of
// the layout once two neighboring columns/bands of different lengths meet.
// A trailing item then gets appended past everything else instead of
// dropped into that void — even when the void is clearly big enough for
// it. This is the actual mechanism behind "an odd shape should have gone
// in the empty gap between two columns, not past the end of the roll."
//
// Fix: a classic MaxRects-BL-style corner-point search. Candidate anchors
// are the bottom-left corners implied by every OTHER item's right/top edge
// (plus the origin) — the standard, cheap way to enumerate "places a new
// rectangle's corner could legally start" without computing exact free
// regions. Try every allowed rotation at every anchor, keep whichever
// placement shrinks the item's own contribution to total roll length the
// most. Trailing items (the ones actually driving roll length) are tried
// first each round, since pulling one into an interior gap is exactly what
// should happen before anything else.
export function gapFillPass(
	placed: CanvasItem[],
	sheet: MaterialSheet,
	allowRotation: boolean,
	withinBudget?: () => boolean,
): CanvasItem[] {
	let current = [...placed];
	const pad = PADDING_INCHES;
	const rollWidth = sheet.heightInches;

	const overlapsAny = (x: number, y: number, w: number, h: number, skipId: string, layout: CanvasItem[]): boolean =>
		layout.some((o) => {
			if (o.id === skipId || o.outOfBounds) return false;
			return rectsOverlap(x, y, w, h, o.x, o.y, o.width, o.height, pad);
		});

	for (let round = 0; round < 2; round++) {
		if (withinBudget && !withinBudget()) break;
		// Trailing items first — they're the ones actually setting the
		// current roll length, so they benefit most from being tried before
		// items that already sit well inside it.
		const order = current
			.filter((i) => !i.outOfBounds)
			.sort((a, b) => (b.x + b.width) - (a.x + a.width))
			.map((i) => i.id);

		for (const id of order) {
			if (withinBudget && !withinBudget()) break;
			const idx = current.findIndex((i) => i.id === id);
			const item = current[idx];
			// In-bounds neighbors only — used both for collision checks and as
			// the trial-layout base below, but oobItems are carried through
			// separately so they're never dropped from the returned array.
			const others = current.filter((i) => i.id !== id && !i.outOfBounds);
			const oobItems = current.filter((i) => i.outOfBounds);
			const curLen = layoutLen(current);

			// Standard corner-point anchor set: every OTHER item's right/top
			// edge, plus the cross of any two items' edges (the corner of an
			// interior void is frequently formed by one item's right edge and
			// a DIFFERENT item's top edge — e.g. the gap between two ragged
			// columns of unequal length — so a single-item edge set alone
			// misses it).
			const anchors: { x: number; y: number }[] = [{ x: 0, y: 0 }];
			for (const o of others) {
				anchors.push({ x: o.x + o.width + pad, y: o.y });
				anchors.push({ x: o.x, y: o.y + o.height + pad });
			}
			for (const o1 of others) {
				for (const o2 of others) {
					if (o1.id === o2.id) continue;
					anchors.push({ x: o1.x + o1.width + pad, y: o2.y + o2.height + pad });
				}
			}

			const orientations = allowRotation
				? buildOrientations(item, sheet.widthInches, true)
				: [{ w: item.width, h: item.height, rot: item.rotation }];

			let best: { x: number; y: number; w: number; h: number; rot: number } | null = null;
			let bestLen = curLen;

			for (const { x, y } of anchors) {
				if (x < 0 || y < 0) continue;
				for (const { w, h, rot } of orientations) {
					if (y + h > rollWidth + 0.001) continue;
					if (overlapsAny(x, y, w, h, id, others)) continue;
					// Gate on the LAYOUT's total length, not this item's own
					// right edge — an item that's already as far left as its
					// own column allows can still be worth moving if doing so
					// frees the item currently driving total length (the same
					// class of bug fixed twice already this session in
					// rotationRefinePass/compactTowardOrigin: local-only
					// gates silently reject exactly the move that matters).
					const trial = others.concat([{ ...item, x, y, width: w, height: h, rotation: rot }]);
					const trialLen = layoutLen(trial);
					if (trialLen >= bestLen - 0.01) continue;
					bestLen = trialLen;
					best = { x, y, w, h, rot };
				}
			}

			if (best) {
				current = others.concat(
					[{ ...item, x: best.x, y: best.y, width: best.w, height: best.h, rotation: best.rot }],
					oobItems,
				);
			}
		}
	}

	return current;
}

// ─── Sort heuristics ──────────────────────────
// 10 heuristics covering different shape characteristics.
type SortFn = (a: CanvasItem, b: CanvasItem) => number;

function getSortHeuristics(): SortFn[] {
	const area    = (i: CanvasItem) => i.pattern.widthInches * i.pattern.heightInches;
	const perim   = (i: CanvasItem) => i.pattern.widthInches + i.pattern.heightInches;
	const maxDim  = (i: CanvasItem) => Math.max(i.pattern.widthInches, i.pattern.heightInches);
	const minDim  = (i: CanvasItem) => Math.min(i.pattern.widthInches, i.pattern.heightInches);
	const aspect  = (i: CanvasItem) => maxDim(i) / (minDim(i) || 0.01); // 1=square, >1=elongated
	const diag    = (i: CanvasItem) => Math.hypot(i.pattern.widthInches, i.pattern.heightInches);

	return [
		// 1. Largest area first — best general heuristic for skyline
		(a, b) => area(b) - area(a),
		// 2. Tallest first — fills height constraint early, leaves room for short pieces
		(a, b) => b.pattern.heightInches - a.pattern.heightInches,
		// 3. Widest first — maximizes horizontal coverage early
		(a, b) => b.pattern.widthInches - a.pattern.widthInches,
		// 4. Largest perimeter first — good for thin elongated shapes
		(a, b) => perim(b) - perim(a),
		// 5. Smallest area first — fills gaps with smaller pieces; reversal heuristic
		(a, b) => area(a) - area(b),
		// 6. Max-dimension first — handles pieces with large extent in any direction
		(a, b) => maxDim(b) - maxDim(a),
		// 7. Most elongated (highest aspect ratio) first — hard-to-place shapes early
		(a, b) => aspect(b) - aspect(a),
		// 8. Most square (lowest aspect ratio) first — compact pieces claim corner first
		(a, b) => aspect(a) - aspect(b),
		// 9. Longest diagonal first — combines area and aspect considerations
		(a, b) => diag(b) - diag(a),
		// 10. Min-dimension descending — forces wide short pieces to pack side-by-side
		(a, b) => minDim(b) - minDim(a),
	];
}

// ─── Complementary pair detection ────────────
// A left/right pair: two items sharing the same vehicleId and nominal
// dimensions whose zone names differ only in the "-left" / "-right" suffix.
// Covers all PPF and window-tint zone pairs in PatternZone.
export function detectComplementaryPairs(
	items: CanvasItem[],
): Array<[CanvasItem, CanvasItem]> {
	const pairs: Array<[CanvasItem, CanvasItem]> = [];
	const usedIds = new Set<string>();

	for (const a of items) {
		if (usedIds.has(a.id)) continue;
		const zoneA = a.pattern.zone as string;
		if (!zoneA.endsWith("-left")) continue;
		const rightZone = zoneA.slice(0, -5) + "-right";

		const b = items.find(
			(it) =>
				!usedIds.has(it.id) &&
				(it.pattern.zone as string) === rightZone &&
				it.pattern.vehicleId === a.pattern.vehicleId &&
				Math.abs(it.pattern.widthInches  - a.pattern.widthInches)  < 0.01 &&
				Math.abs(it.pattern.heightInches - a.pattern.heightInches) < 0.01,
		);

		if (b) {
			pairs.push([a, b]);
			usedIds.add(a.id);
			usedIds.add(b.id);
		}
	}

	return pairs;
}

// ─── Pair-adjacent orderings ──────────────────
// Produces orderings where each detected pair appears consecutively.
// This nudges the skyline packer to keep partners in the same height band,
// reducing fragmentation compared to packing them independently.
function buildPairedOrderings(
	items: CanvasItem[],
	pairs: Array<[CanvasItem, CanvasItem]>,
): CanvasItem[][] {
	if (pairs.length === 0) return [];

	const pairedIds = new Set<string>(pairs.flatMap(([a, b]) => [a.id, b.id]));
	const singles = items.filter((i) => !pairedIds.has(i.id));
	const sortFns = getSortHeuristics();
	const orderings: CanvasItem[][] = [];

	for (const sortFn of sortFns.slice(0, 4)) {
		const sortedSingles = [...singles].sort(sortFn);
		// Pairs first (left→right), then singles
		orderings.push([...pairs.flatMap(([l, r]) => [l, r]), ...sortedSingles]);
		// Pairs first (right→left variant)
		orderings.push([...pairs.flatMap(([l, r]) => [r, l]), ...sortedSingles]);
		// Singles first, pairs last (lets corners anchor before pairs fill in)
		orderings.push([...sortedSingles, ...pairs.flatMap(([l, r]) => [l, r])]);
	}

	return orderings;
}

// ─── Pair rotation-combination pass ──────────
// For each detected left/right pair, tries all 4×4=16 rotation combinations
// simultaneously and repacks. Complements the single-item rotation pass:
// catches cases where the globally optimal layout requires one piece to be
// in a rotation that looks worse in isolation but works better when its
// mirror companion is also rotated.
function pairRotationCombinationPass(
	placed: CanvasItem[],
	sheet: MaterialSheet,
	pairs: Array<[CanvasItem, CanvasItem]>,
): CanvasItem[] {
	if (pairs.length === 0) return placed;

	let current = [...placed];
	let curLen  = layoutLen(current);
	const ROTS  = [0, 90, 180, 270] as const;

	for (const [leftItem, rightItem] of pairs) {
		const curA = current.find((i) => i.id === leftItem.id)?.rotation  ?? 0;
		const curB = current.find((i) => i.id === rightItem.id)?.rotation ?? 0;

		for (const rotA of ROTS) {
			for (const rotB of ROTS) {
				if (rotA === curA && rotB === curB) continue;
				const trial = current.map((item) => {
					if (item.id === leftItem.id)  return { ...item, rotation: rotA };
					if (item.id === rightItem.id) return { ...item, rotation: rotB };
					return item;
				});
				const repacked = bestFitPack(trial, sheet, true, "left");
				const settled  = compactionPass(repacked, sheet);
				const len = layoutLen(settled);
				if (len < curLen - 0.01) {
					current = settled;
					curLen  = len;
				}
			}
		}
	}

	return current;
}

// ─── Random ordering helper ───────────────────
function shuffled<T>(arr: T[], seed: number): T[] {
	const out = [...arr];
	// Seeded LCG for reproducible but different orderings per seed
	let s = seed | 0;
	for (let i = out.length - 1; i > 0; i--) {
		s = (Math.imul(s, 1664525) + 1013904223) | 0;
		const j = Math.abs(s) % (i + 1);
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

// ─── Best result from a set of orderings ─────
function bestOverOrderings(
	orderings: CanvasItem[][],
	sheet: MaterialSheet,
	allowRotation: boolean,
	withinBudget?: () => boolean,
): CanvasItem[] {
	let best: CanvasItem[] | null = null;
	let bestLen = Infinity;

	for (const ordering of orderings) {
		// Always run at least one ordering so best is never null.
		if (best !== null && withinBudget && !withinBudget()) break;
		for (const scoring of ["left", "compact"] as const) {
			const result = bestFitPack(ordering, sheet, allowRotation, scoring);
			const len = layoutLen(result);
			if (len < bestLen) {
				bestLen = len;
				best    = result;
			}
		}
	}

	return best!;
}

// ─── autoNest ────────────────────────────────
// Fast path: 10 sort heuristics + pair-adjacent orderings, ×2 scoring modes,
// followed by rotation, pair-rotation-combination, and swap improvement passes.
// Typical runtime: < 50ms for ≤ 30 items (all bboxes cached after first call).
export function autoNest(
	items: CanvasItem[],
	sheet: MaterialSheet,
	allowRotation = true,
	bufferInches = PADDING_INCHES,
): CanvasItem[] {
	if (!items.length) return items;
	PADDING_INCHES = bufferInches;

	const pairs    = detectComplementaryPairs(items);
	const sortFns  = getSortHeuristics();
	const orderings = [
		...sortFns.map((fn) => [...items].sort(fn)),
		...buildPairedOrderings(items, pairs),
	];
	let best = bestOverOrderings(orderings, sheet, allowRotation);

	// Rotation improvement: tries flipping each piece to all other orientations.
	best = rotationImprovementPass(best, sheet, allowRotation);

	// Pair rotation-combination: tries all 16 rotation combos for each pair.
	if (pairs.length > 0) {
		const pairOpt = pairRotationCombinationPass(best, sheet, pairs);
		if (layoutLen(pairOpt) < layoutLen(best)) best = pairOpt;
	}

	// Swap improvement: O(n²) pairwise repack, keeps improvements.
	if (items.length < 30) {
		const swapped = swapImprovementPass(best, sheet, allowRotation);
		if (layoutLen(swapped) < layoutLen(best)) best = swapped;
	}

	// Compaction + local rotation: squeeze items into real leftover gaps (not
	// just skyline rows), then let freed-up gaps unlock sideways rotations
	// that a full skyline repack wouldn't have found — alternate twice so
	// each pass can exploit the other's gains. Two rounds of both is only
	// worth the extra O(n^2) work at small item counts; larger layouts get
	// one compaction pass so autoNest stays inside its "<50ms" budget.
	const rounds = items.length <= 20 ? 2 : 1;
	for (let round = 0; round < rounds; round++) {
		const compacted = compactionPass(best, sheet);
		if (layoutLen(compacted) <= layoutLen(best)) best = compacted;

		if (items.length <= 20) {
			const rotated = localRotationRefine(best, sheet, allowRotation);
			if (layoutLen(rotated) <= layoutLen(best)) best = rotated;
		}
	}

	const byId = new Map(best.map((r) => [r.id, r]));
	return items.map((item) => byId.get(item.id) ?? item);
}

// ─── SmartNestResult ─────────────────────────
export interface SmartNestResult {
	items: CanvasItem[];
	improvementPct: number; // efficiency gain vs pre-optimization baseline
	trialsRun: number;
}

// ─── smartNest ───────────────────────────────
// Thorough optimization: everything autoNest does plus 50 random-restart trials,
// pair-adjacent orderings, pair rotation-combination pass, and an insertion
// improvement pass. User-triggered; budget ~200–800ms.
//
// Reports improvementPct relative to a naive first-fit baseline so the UI can
// show "↑ 18% efficiency improvement" after the optimization completes.
export function smartNest(
	items: CanvasItem[],
	sheet: MaterialSheet,
	allowRotation = true,
	bufferInches = PADDING_INCHES,
): SmartNestResult {
	PADDING_INCHES = bufferInches;
	if (!items.length) {
		return { items, improvementPct: 0, trialsRun: 0 };
	}

	// 3-second wall-clock budget — prevents browser freeze on large layouts.
	const deadline = Date.now() + 3000;
	const withinBudget = () => Date.now() < deadline;

	// Naive baseline: items in original order, no optimization.
	const baselinePacked = bestFitPack(items, sheet, allowRotation, "left");
	const baselineLen    = layoutLen(baselinePacked);

	// Detect complementary left/right pairs once.
	const pairs = detectComplementaryPairs(items);

	// Phase 1: 10 sort heuristics + pair-adjacent orderings × 2 scoring modes
	const sortFns  = getSortHeuristics();
	const orderings: CanvasItem[][] = [
		...sortFns.map((fn) => [...items].sort(fn)),
		...buildPairedOrderings(items, pairs),
	];

	// Phase 2: random restart trials (count scaled down for large layouts)
	// 50 trials is fine for ≤ 15 items; above that the marginal benefit drops
	// rapidly while cost grows — cap to 15 for large item sets.
	const RANDOM_TRIALS = items.length <= 15 ? 50 : items.length <= 30 ? 25 : 15;
	for (let seed = 0; seed < RANDOM_TRIALS; seed++) {
		orderings.push(shuffled(items, seed * 7919 + 1));
	}

	let best = bestOverOrderings(orderings, sheet, allowRotation, withinBudget);
	const trialsRun = orderings.length * 2; // × 2 scoring modes
	const trace: Record<string, string> = { phase2_bestOverOrderings: layoutLen(best).toFixed(2) };

	// Phase 2.5: explicit row-count rebalance for same-footprint items —
	// see rowBalanceGroupPass for why the generic greedy packer above can
	// get stuck on a symmetric split that isn't actually length-optimal.
	const rowBalanced = rowBalanceGroupPass(items, sheet, allowRotation);
	if (rowBalanced && layoutLen(rowBalanced) < layoutLen(best) - 0.001) best = rowBalanced;
	trace.phase2_5_rowBalance = layoutLen(best).toFixed(2);

	// Phase 3: rotation improvement pass
	best = rotationImprovementPass(best, sheet, allowRotation, withinBudget);
	trace.phase3_rotationImprovementPass = layoutLen(best).toFixed(2);

	// Phase 4: pair rotation-combination pass (all 16 combos per pair)
	if (pairs.length > 0 && withinBudget()) {
		const pairOpt = pairRotationCombinationPass(best, sheet, pairs);
		if (layoutLen(pairOpt) < layoutLen(best)) best = pairOpt;
	}
	trace.phase4_pairRotation = layoutLen(best).toFixed(2);

	// Phase 5: swap improvement pass (O(n²) repacks — budget-guarded per row)
	if (withinBudget()) {
		const swapped = swapImprovementPass(best, sheet, allowRotation, withinBudget);
		if (layoutLen(swapped) < layoutLen(best)) best = swapped;
	}
	trace.phase5_swap = layoutLen(best).toFixed(2);

	// Phase 6: insertion improvement pass (O(n³) repacks — only for small sets)
	// Threshold kept low: each while-loop round is O(n²) bestFitPack calls and
	// can run multiple rounds. At n=40 this freezes the browser for several seconds.
	if (items.length <= 15 && withinBudget()) {
		const inserted = insertionImprovementPass(best, sheet, allowRotation, withinBudget);
		if (layoutLen(inserted) < layoutLen(best)) best = inserted;
	}
	trace.phase6_insertion = layoutLen(best).toFixed(2);

	// Phase 7: compaction + local rotation — squeeze items into real leftover
	// gaps between neighbors (skyline rows leave pockets a rectangle-aware
	// slide can fill), then let freed-up gaps unlock sideways rotations that
	// a full skyline repack wouldn't have found. Alternate a few rounds so
	// each pass can exploit the other's gains.
	for (let round = 0; round < 3 && withinBudget(); round++) {
		const compacted = compactionPass(best, sheet);
		if (layoutLen(compacted) <= layoutLen(best)) best = compacted;

		const rotated = localRotationRefine(best, sheet, allowRotation);
		if (layoutLen(rotated) <= layoutLen(best)) best = rotated;
	}
	trace.phase7_compactionRotation = layoutLen(best).toFixed(2);

	// Phase 8: gap fill — see gapFillPass for why phases 1-7 (all shelf/band
	// packers underneath) can't discover an interior void on their own. Runs
	// against its OWN fresh deadline rather than the shared one above: by
	// this point phases 1-7 (30+ orderings, an O(n²) swap pass, an O(n³)
	// insertion pass at small item counts) can have already spent most or
	// all of the 3s budget, silently reducing this — the pass most likely
	// to matter for an odd/irregular shape — to a no-op.
	const gapFillDeadline = Date.now() + 800;
	const gapFilled = gapFillPass(best, sheet, allowRotation, () => Date.now() < gapFillDeadline);
	if (layoutLen(gapFilled) <= layoutLen(best)) best = gapFilled;
	trace.phase8_gapFill = layoutLen(best).toFixed(2);

	if (typeof window !== "undefined") {
		console.log("NEST v16 smartNest trace " + JSON.stringify(trace, null, 2));
		console.log("NEST v16 smartNest final " + JSON.stringify(
			best.map((i) => `${i.id}:x=${i.x.toFixed(2)},y=${i.y.toFixed(2)},w=${i.width.toFixed(1)},h=${i.height.toFixed(1)},rot=${i.rotation}`),
			null, 2,
		));
	}

	const finalLen = layoutLen(best);

	// Efficiency improvement = reduction in roll length consumed.
	const improvementPct =
		baselineLen > 0
			? Math.max(0, ((baselineLen - finalLen) / baselineLen) * 100)
			: 0;

	// smartNest is bbox/skyline-based throughout (unlike nfpNest, it has no
	// true-shape verification of its own) — run the same declash backstop
	// used by bestNest so its output respects the buffer too.
	const declashed = finalDeclash(best, sheet.widthInches, sheet.heightInches, bufferInches);
	const byId = new Map(declashed.map((r) => [r.id, r]));
	return {
		items: items.map((item) => byId.get(item.id) ?? item),
		improvementPct,
		trialsRun,
	};
}

// ─── NFP nesting ─────────────────────────────────────────────────────────────
//
// True polygon-based nesting using No-Fit Polygons (NFP).
// Each piece is represented as its actual sampled polygon, not a bounding box.
// This allows non-rectangular shapes to interlock, recovering waste that the
// skyline packer cannot address.
//
// Algorithm:
//   1. Sort items largest-area-first.
//   2. For each item, try 4 rotations.
//   3. Per rotation: compute IFP (valid anchor region inside roll) and NFP
//      (forbidden zones from each already-placed piece) using convex decomposition.
//   4. Candidate anchor positions = NFP vertices + NFP×NFP intersections + IFP corners.
//   5. Best valid candidate = leftmost-then-bottommost (minimises roll consumption).
//   6. Place item; store its absolute polygon for subsequent NFP computations.
//
// NFPs are cached by (shapeA × rotA × shapeB × rotB) and reused across items.
// ─────────────────────────────────────────────────────────────────────────────

// Build the local polygon for a CanvasItem at a given rotation.
// Rotates around the nominal centre, then normalises so bbox starts at (0,0).
//
// Two different fidelities are used for two different jobs:
//   - NFP_POLY_SAMPLES (candidate search): NFP's convex decomposition is
//     triangulation-based (O(n^2) ear-clipping) and nfpGeneral pairs every
//     triangle in A against every triangle in B — at the default 120-point
//     bbox-sampling resolution that's ~118 triangles per shape, ~14k
//     pairwise Minkowski sums per (item, rotation) combo, which hangs the
//     tab on anything but a handful of items. Kept coarse; convexDecompose's
//     MAX_DECOMPOSE_VERTICES cap falls back to a (still-safe, if slightly
//     conservative) convex-hull approximation past 30 vertices anyway.
//   - VERIFY_POLY_SAMPLES (finalDeclash / collidesAt exact-overlap checks):
//     these run plain segment-intersection tests, not decomposition, so
//     there's no triangulation blow-up to worry about — but a coarse
//     approximation here means "verified non-overlapping" can still differ
//     from what's actually drawn (the real SVG path, effectively infinite
//     resolution), especially at sharp corners. This is what actually
//     caught pieces rendering with crossed outlines despite a positive
//     buffer: the safety net was checking a rounded-off stand-in for the
//     shape, not the shape itself. Higher resolution here directly fixes
//     that; it does not touch NFP candidate-search cost at all.
const NFP_POLY_SAMPLES = 10;
const VERIFY_POLY_SAMPLES = 60;

// Two polygons placed exactly PAD apart, each inflated by PAD/2, end up
// perfectly tangent — and polygonsOverlap's segment-intersection test uses a
// generous inclusive tolerance (so genuine near-misses aren't missed), which
// flags exact tangency as an overlap too. Shaving a hair off each side's
// inflate leaves a sub-thousandth-inch gap — invisible to a blade, but
// enough that a layout placed with exactly the requested buffer reads as
// clear instead of "still touching."
const CLEARANCE_EPSILON = 0.001;
function halfPad(PAD: number): number {
	return Math.max(0, PAD / 2 - CLEARANCE_EPSILON / 2);
}

function itemPolygon(item: CanvasItem, rotDeg: number, samples = NFP_POLY_SAMPLES): Polygon {
	const raw = samplePathInchPoints(
		item.pattern.svgPath,
		item.pattern.widthInches,
		item.pattern.heightInches,
		samples,
	) as Point[];

	if (rotDeg === 0) return normalizeToBBox(raw);

	const cx = item.pattern.widthInches  / 2;
	const cy = item.pattern.heightInches / 2;
	const centred = raw.map(p => ({ x: p.x - cx, y: p.y - cy }));
	return normalizeToBBox(rotatePoints(centred, rotDeg));
}

// Check whether anchor (ax, ay) is inside any of the NFP polygon groups.
function inAnyNFP(ax: number, ay: number, nfpGroups: Polygon[][]): boolean {
	const p: Point = { x: ax, y: ay };
	for (const group of nfpGroups) {
		for (const nfp of group) {
			if (pointInPolygon(p, nfp)) return true;
		}
	}
	return false;
}

// NFP cache: keyed by (shapeA_id, rotA, shapeB_id, rotB) → polygon array.
// Module-level so it survives between autoNest/smartNest calls in a session.
const _nfpCache = new Map<string, Polygon[]>();

// Find the tightest valid anchor for `item` at rotation `rot` against a set
// of already-placed obstacle items (their current x/y/rotation). Shared by
// the initial greedy placement pass and the compaction pass below — same
// NFP/IFP candidate search, just parameterised over which obstacles count.
function placeAgainst(
	item: CanvasItem,
	rot: number,
	obstacles: CanvasItem[],
	maxLength: number,
	rollWidth: number,
	PAD: number,
): { x: number; y: number; w: number; h: number; score: number } | null {
	// Low-fidelity polygon for NFP candidate generation (decomposition-based,
	// must stay cheap — see NFP_POLY_SAMPLES).
	const localRaw  = itemPolygon(item, rot);
	const localPoly = normalizeToBBox(inflatePolygon(ensureCCW(localRaw), halfPad(PAD)));
	const bounds    = polygonBounds(localPoly);
	const bw = bounds.maxX - bounds.minX;
	const bh = bounds.maxY - bounds.minY;

	// High-fidelity polygon used ONLY for exact-overlap verification
	// (collidesAt/repair below) — segment-intersection tests, no
	// decomposition, so higher resolution here is cheap and it's what
	// actually needs to match the real rendered shape.
	const verifyPoly = normalizeToBBox(inflatePolygon(ensureCCW(itemPolygon(item, rot, VERIFY_POLY_SAMPLES)), halfPad(PAD)));

	const ifp = innerFitBounds(maxLength, rollWidth, localPoly);
	if (!ifp) return null;

	const nfpGroups: Polygon[][] = [];
	// Absolute (already-inflated, high-fidelity) obstacle polygons, kept
	// alongside nfpGroups for the exact-overlap verification below.
	const obstaclePolys: Polygon[] = [];
	for (const placed of obstacles) {
		if (placed.id === item.id) continue;
		const key = `${placed.pattern.id}|${placed.rotation}|${item.pattern.id}|${rot}|${PAD}`;
		let nfpLocal = _nfpCache.get(key);
		if (!nfpLocal) {
			const polyA = normalizeToBBox(inflatePolygon(ensureCCW(itemPolygon(placed, placed.rotation)), halfPad(PAD)));
			nfpLocal    = nfpGeneral(polyA, localPoly);
			_nfpCache.set(key, nfpLocal);
		}
		nfpGroups.push(nfpLocal.map(nfp => translatePolygon(nfp, placed.x, placed.y)));

		obstaclePolys.push(translatePolygon(
			normalizeToBBox(inflatePolygon(ensureCCW(itemPolygon(placed, placed.rotation, VERIFY_POLY_SAMPLES)), halfPad(PAD))),
			placed.x, placed.y,
		));
	}

	const candidates = nfpCandidates(nfpGroups, ifp);
	const GRID = 6;
	const stepX = (ifp.maxX - ifp.minX) / GRID;
	const stepY = Math.max((ifp.maxY - ifp.minY) / GRID, 0.001);
	for (let gx = 0; gx <= GRID; gx++) {
		for (let gy = 0; gy <= GRID; gy++) {
			candidates.push({ x: ifp.minX + gx * stepX, y: ifp.minY + gy * stepY });
		}
	}

	const collidesAt = (x: number, y: number): boolean => {
		const candPoly = translatePolygon(verifyPoly, x, y);
		return obstaclePolys.some((poly) => polygonsOverlap(candPoly, poly));
	};

	// nfpGeneral's forbidden zone is a union of pairwise convex-part NFPs,
	// which can have small false-free gaps at the seams between decomposed
	// parts — the NFP vertex the candidate search trusts most can sit a
	// couple hundredths of an inch inside the true silhouette. Rather than
	// discarding that candidate outright (which forces a fallback to the
	// sparse safety grid, tens of inches away), nudge it along +x/+y in
	// small steps until it clears — recovering the near-optimal position
	// instead of abandoning it. Only candidates that can't be repaired this
	// way fall through to the next-best candidate in the ranked list.
	const NUDGE_STEP = 0.01, NUDGE_MAX = 1.0;
	const repair = (x: number, y: number): { x: number; y: number } | null => {
		for (let d = NUDGE_STEP; d <= NUDGE_MAX; d += NUDGE_STEP) {
			if (x + d <= ifp.maxX + 1e-6 && !collidesAt(x + d, y)) return { x: x + d, y };
			if (y + d <= ifp.maxY + 1e-6 && !collidesAt(x, y + d)) return { x, y: y + d };
		}
		return null;
	};

	const scored: { x: number; y: number; score: number }[] = [];
	for (const { x: ax, y: ay } of candidates) {
		const cx = Math.max(ifp.minX, Math.min(ifp.maxX, ax));
		const cy = Math.max(ifp.minY, Math.min(ifp.maxY, ay));
		if (inAnyNFP(cx, cy, nfpGroups)) continue;
		scored.push({ x: cx, y: cy, score: (cx + bw) * 1e6 + cy });
	}
	scored.sort((a, b) => a.score - b.score);

	for (const cand of scored) {
		if (!collidesAt(cand.x, cand.y)) {
			return { x: cand.x, y: cand.y, w: bw, h: bh, score: cand.score };
		}
		const fixed = repair(cand.x, cand.y);
		if (fixed) {
			return { x: fixed.x, y: fixed.y, w: bw, h: bh, score: (fixed.x + bw) * 1e6 + fixed.y };
		}
	}
	return null;
}

// Final, provably-correct safety net. The greedy placement + compaction
// above optimize position using local snapshots (an item is checked against
// "everyone placed so far" or "everyone else's position right now") — with
// enough pieces moving in the same pass, a position that was valid when
// computed can end up a hair stale by the time everything settles. Rather
// than chase every such interaction, do one final incremental sweep in x
// order: each piece is checked/nudged only against pieces ALREADY fixed by
// this same sweep, and once fixed a piece is never moved again — so the
// invariant "no two fixed pieces collide" holds by construction, regardless
// of what upstream produced. This is a correctness backstop, not an
// optimizer: it should rarely move anything more than a hundredth of an
// inch in practice.
export function finalDeclash(
	items: CanvasItem[],
	maxLength: number,
	rollWidth: number,
	PAD: number,
): CanvasItem[] {
	const order = [...items]
		.filter((i) => !i.outOfBounds)
		.sort((a, b) => a.x - b.x || a.y - b.y);

	const fixed: CanvasItem[] = [];
	const fixedPolys: Polygon[] = [];
	const STEP = 0.01;
	let overflowRow = 0;

	// Each item's own polygon is inflated by PAD/2 (not the full PAD) before
	// the overlap check below, because both sides of a comparison get
	// inflated — two shapes each grown by PAD/2 stop overlapping exactly
	// when their true separation reaches PAD. Inflating both by the full
	// PAD (as this used to) requires 2×PAD of real clearance before the
	// check clears, so any layout placed with the intended single-PAD gap
	// (every other packer in this file) would still show as "overlapping"
	// here and get walked STEP-by-STEP further apart — capping out at
	// guard*STEP = 5" of pure padding bloat for shapes that never resolve.
	for (const it of order) {
		const localPoly = normalizeToBBox(inflatePolygon(ensureCCW(itemPolygon(it, it.rotation, VERIFY_POLY_SAMPLES)), halfPad(PAD)));
		let x = it.x;
		let guard = 0;
		let poly = translatePolygon(localPoly, x, it.y);
		while (fixedPolys.some((fp) => polygonsOverlap(poly, fp)) && guard++ < 500) {
			x += STEP;
			poly = translatePolygon(localPoly, x, it.y);
		}
		if (typeof window !== "undefined" && guard > 0) {
			console.log(`NEST v16 finalDeclash nudged ${it.id} by guard=${guard} steps (${(guard * STEP).toFixed(2)}")`);
		}
		const bounds = polygonBounds(poly);
		// This is meant to be the final, unconditional guarantee that nothing
		// renders outside the cut zone — but until now it only ever checked
		// the length axis (maxX). An item an upstream pass placed past the
		// roll-WIDTH edge (bounds.maxY/minY) sailed through unflagged, fully
		// opaque, with none of the "won't be cut" styling — exactly what let
		// a mis-sized/mis-rotated shape (e.g. a near-circular custom pattern,
		// whose true bbox can differ from any single upstream approximation
		// of it) end up rendered outside the dashed boundary. Checking both
		// axes here means the guarantee holds regardless of which shape or
		// which upstream stage produced the bad placement.
		const widthOverflow = bounds.maxY > rollWidth + PAD + 1e-6 || bounds.minY < -PAD - 1e-6;
		if (bounds.maxX > maxLength + PAD + 1e-6 || widthOverflow) {
			// Match the same "excluded strip past the width edge" convention
			// bestFitPack's own overflow branch uses, so these items land in
			// the widened oob strip the studio UI already renders for them —
			// not off the far end of a possibly 1200"-long roll where they'd
			// never scroll into view.
			fixed.push({
				...it,
				x: PAD + overflowRow * (it.width + PAD),
				y: rollWidth + PAD,
				outOfBounds: true,
			});
			overflowRow++;
		} else {
			fixed.push({ ...it, x });
			fixedPolys.push(poly);
		}
	}

	const byId = new Map(fixed.map((f) => [f.id, f]));
	return items.map((i) => byId.get(i.id) ?? i);
}

// Slide every piece as close to the origin as the others allow, without
// touching. The initial greedy pass places pieces one at a time against
// only what came before it, so a piece placed early can be left with more
// breathing room than the minimum cut buffer once later pieces are added
// around it. This re-seats each piece — in increasing-x order, so pieces
// already near the origin settle first — against everyone else's CURRENT
// position, repeating a couple of rounds so a piece freed up by its
// neighbor sliding over gets a chance to slide further itself. Rotation is
// held fixed (re-trying all 4 rotations here would be an O(n^2) blow-up on
// top of the initial pass); this only tightens position, never rotation.
function compactTowardOrigin(
	placed: CanvasItem[],
	maxLength: number,
	rollWidth: number,
	PAD: number,
	deadline: number,
): CanvasItem[] {
	let current = [...placed];
	for (let round = 0; round < 2; round++) {
		const order = [...current]
			.filter((i) => !i.outOfBounds)
			.sort((a, b) => a.x - b.x || a.y - b.y)
			.map((i) => i.id);

		for (const id of order) {
			if (Date.now() > deadline) return current;
			const idx = current.findIndex((i) => i.id === id);
			const item = current[idx];
			const others = current.filter((i) => i.id !== id && !i.outOfBounds);
			const best = placeAgainst(item, item.rotation, others, maxLength, rollWidth, PAD);
			if (!best) continue;
			const trial = [...current];
			trial[idx] = { ...item, x: best.x, y: best.y };
			if (layoutLen(trial) < layoutLen(current) - 0.005 ||
				(Math.abs(layoutLen(trial) - layoutLen(current)) <= 0.005 && best.y < item.y - 0.005)) {
				current = trial;
			}
		}
	}
	return current;
}

// Re-evaluate each piece's ROTATION against its final neighbors. The greedy
// placement pass tries all 4 rotations, but only against whatever was
// placed *before* it — a piece placed early (or into a tight gap) can end
// up "stuck" in a rotation that was locally best at the time, even though
// laying it the other way would now cut less roll length once everyone
// else has settled. compactTowardOrigin only ever slides position, never
// reconsiders rotation, so this is the only pass that can catch that.
function rotationRefinePass(
	placed: CanvasItem[],
	maxLength: number,
	rollWidth: number,
	PAD: number,
	deadline: number,
): CanvasItem[] {
	let current = [...placed];
	const ROTS = [0, 90, 180, 270];

	for (let round = 0; round < 2; round++) {
		const order = [...current]
			.filter((i) => !i.outOfBounds)
			.sort((a, b) => a.x - b.x || a.y - b.y)
			.map((i) => i.id);

		for (const id of order) {
			if (Date.now() > deadline) return current;
			const idx = current.findIndex((i) => i.id === id);
			const item = current[idx];
			const others = current.filter((i) => i.id !== id && !i.outOfBounds);

			let best: { x: number; y: number; w: number; h: number; score: number } | null = null;
			let bestRot = item.rotation;
			for (const rot of ROTS) {
				const candidate = placeAgainst(item, rot, others, maxLength, rollWidth, PAD);
				if (candidate && (!best || candidate.score < best.score)) {
					best = candidate;
					bestRot = rot;
				}
			}

			if (best && bestRot !== item.rotation) {
				// Gate on total roll length, not this item's own x: a trailing
				// piece is already at the minimum x its current rotation allows,
				// so "does my own x shrink" can never fire for exactly the piece
				// that needs to rotate to shorten the *overall* roll.
				const trial = [...current];
				trial[idx] = { ...item, x: best.x, y: best.y, width: best.w, height: best.h, rotation: bestRot };
				if (layoutLen(trial) < layoutLen(current) - 0.005) {
					current = trial;
				}
			}
		}
	}
	return current;
}

export function nfpNest(
	items:         CanvasItem[],
	sheet:         MaterialSheet,  // already transposed: widthInches=max-length, heightInches=roll-width
	allowRotation  = true,
	bufferInches   = PADDING_INCHES,
): CanvasItem[] {
	if (!items.length) return items;
	PADDING_INCHES = bufferInches;

	const PAD        = PADDING_INCHES;
	const maxLength  = sheet.widthInches;   // X: roll feed direction (unconstrained)
	const rollWidth  = sheet.heightInches;  // Y: cross-roll direction (bounded)
	const ROTS       = allowRotation ? ([0, 90, 180, 270] as const) : ([0] as const);

	// Sort largest nominal area first — generally best for NFP.
	const sorted = [...items].sort(
		(a, b) =>
			b.pattern.widthInches * b.pattern.heightInches -
			a.pattern.widthInches * a.pattern.heightInches,
	);

	const placedItems: CanvasItem[] = [];

	// Hard wall-clock budget: NFP cost grows with placed-item count and shape
	// complexity, so a pathological set of shapes could otherwise hang the
	// tab. Once the deadline passes, drop remaining items to the bbox
	// fallback below instead of running any more NFP math — bestNest() will
	// then prefer the plain skyline result if it fits more/shorter anyway.
	const deadline = Date.now() + 800;

	for (const item of sorted) {
		if (Date.now() > deadline) {
			placedItems.push({ ...item, x: maxLength + PAD, y: PAD, outOfBounds: true });
			continue;
		}

		let best: { x: number; y: number; w: number; h: number; score: number } | null = null;
		let bestRot = 0;

		for (const rot of ROTS) {
			const candidate = placeAgainst(item, rot, placedItems, maxLength, rollWidth, PAD);
			if (candidate && (!best || candidate.score < best.score)) {
				best = candidate;
				bestRot = rot;
			}
		}

		if (best) {
			placedItems.push({
				...item,
				x:          best.x,
				y:          best.y,
				width:      best.w,
				height:     best.h,
				rotation:   bestRot,
				outOfBounds: false,
			});
		} else {
			// Couldn't fit — mark out-of-bounds with a sensible fallback position.
			placedItems.push({ ...item, x: maxLength + PAD, y: PAD, outOfBounds: true });
		}
	}

	// Squeeze every piece as far toward the origin as its neighbors' final
	// positions allow — the greedy pass above only ever checks a piece
	// against what was placed *before* it, so early pieces can end up with
	// more than the minimum cut buffer once the full layout has settled.
	// Alternate with rotation refinement so each can exploit the other's
	// gains: compaction can free up room that unlocks a better rotation,
	// and a rotation change can free up room compaction can then use.
	let settled = placedItems;
	for (let round = 0; round < 2 && Date.now() < deadline; round++) {
		settled = compactTowardOrigin(settled, maxLength, rollWidth, PAD, deadline);
		settled = rotationRefinePass(settled, maxLength, rollWidth, PAD, deadline);
	}
	const declashed = finalDeclash(settled, maxLength, rollWidth, PAD);

	// Return in the original item order.
	const byId = new Map(declashed.map(r => [r.id, r]));
	return items.map(i => byId.get(i.id) ?? i);
}

// ─── bestNest ─────────────────────────────────
// Default entry point for the studio: true-shape NFP nesting lets pieces
// interlock along their real silhouettes (no bbox/skyline grid), which is
// what the UI should show. autoNest's bbox skyline packer is kept only as a
// safety-net comparison for pathological inputs where NFP's polygon
// candidate search comes up short — but ONLY on fit (does it place strictly
// more pieces?), never on roll length. autoNest positions by tight bounding
// box, not true shape, and carries none of nfpNest's exact-overlap
// verification (finalDeclash) — a shorter bbox layout is not necessarily a
// safe one for non-rectangular pieces, so it must never win a tie-break
// against the verified result just for being more compact.
export function bestNest(
	items: CanvasItem[],
	sheet: MaterialSheet,
	allowRotation = true,
	bufferInches = PADDING_INCHES,
): CanvasItem[] {
	if (!items.length) return items;

	const nfpResult = nfpNest(items, sheet, allowRotation, bufferInches);
	const skylineResult = autoNest(items, sheet, allowRotation, bufferInches);

	const nfpOob = nfpResult.filter((i) => i.outOfBounds).length;
	const skylineOob = skylineResult.filter((i) => i.outOfBounds).length;
	const chosen = nfpOob <= skylineOob ? nfpResult : skylineResult;
	if (typeof window !== "undefined") {
		const len = (arr: CanvasItem[]) => {
			const ib = arr.filter((i) => !i.outOfBounds);
			return ib.length ? Math.max(...ib.map((i) => i.x + i.width)) : 0;
		};
		const geo = (arr: CanvasItem[]) =>
			arr.map((i) => `${i.id}:x=${i.x.toFixed(2)},y=${i.y.toFixed(2)},w=${i.width.toFixed(1)},h=${i.height.toFixed(1)},rot=${i.rotation}`).join(" | ");
		console.log("NEST v16 bestNest " + JSON.stringify({
			nfpOob, skylineOob, nfpLen: len(nfpResult).toFixed(2), skylineLen: len(skylineResult).toFixed(2),
			chose: nfpOob <= skylineOob ? "nfp" : "skyline",
			nfp: geo(nfpResult),
			skyline: geo(skylineResult),
		}, null, 2));
	}

	// Row-balance and gap-fill are pure position/rotation refinements over a
	// bbox layout, so they apply just as well to whichever candidate won
	// above — bestNest is the path handleSmartNest's "nfpAlt" comparison
	// uses, and without this, ties/near-ties would silently fall back to a
	// layout with neither improvement even after smartNest computed them.
	const rowBalanced = rowBalanceGroupPass(chosen, sheet, allowRotation);
	let refined = (rowBalanced && layoutLen(rowBalanced) < layoutLen(chosen) - 0.001) ? rowBalanced : chosen;
	const gapFillDeadline = Date.now() + 800;
	const gapFilled = gapFillPass(refined, sheet, allowRotation, () => Date.now() < gapFillDeadline);
	if (layoutLen(gapFilled) <= layoutLen(refined)) refined = gapFilled;

	// Universal backstop: whichever path won, guarantee the buffer is
	// actually respected in the result the UI renders. autoNest has no
	// exact-overlap verification of its own, and even nfpNest's own
	// declash pass only ran against the OTHER items present when IT was
	// computed — re-run it here, once, against the final chosen set.
	PADDING_INCHES = bufferInches;
	return finalDeclash(refined, sheet.widthInches, sheet.heightInches, bufferInches);
}

// ─── Placement result ─────────────────────────
export interface PlacementResult {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number; // 0 | 90 | 180 | 270
	outOfBounds: boolean;
}

// ─── Find next available position ────────────
// Shelf-based placement for single-item addition.
export function findNextPosition(
	existingItems: CanvasItem[],
	sheet: MaterialSheet,
	itemW: number,
	itemH: number,
	svgPath = "",
): PlacementResult {
	const pad    = PADDING_INCHES;
	const sheetW = sheet.widthInches;
	const sheetH = sheet.heightInches;

	const seen  = new Set<string>();
	const orientations: Array<{ w: number; h: number; rot: number }> = [];

	for (const rot of [0, 90, 180, 270]) {
		let w: number, h: number;
		if (svgPath) {
			const bbox = tightBboxAtRotation(svgPath, itemW, itemH, rot);
			w = bbox.w; h = bbox.h;
		} else {
			w = rot % 180 === 0 ? itemW : itemH;
			h = rot % 180 === 0 ? itemH : itemW;
		}
		const key = `${w.toFixed(3)},${h.toFixed(3)}`;
		if (!seen.has(key) && w <= sheetW + 0.001) {
			seen.add(key);
			orientations.push({ w, h, rot });
		}
	}

	if (orientations.length === 0) {
		return { x: sheetW + pad, y: pad, width: itemW, height: itemH, rotation: 0, outOfBounds: true };
	}

	// Prefer laying the long side sideways: smallest length-wise extent (w)
	// first, so the roll consumes as little length as possible while using
	// as much of the available width (h) as it can.
	orientations.sort((a, b) => a.w - b.w || b.h - a.h);

	if (!existingItems.length) {
		const { w, h, rot } = orientations[0];
		return { x: pad, y: pad, width: w, height: h, rotation: rot, outOfBounds: false };
	}

	const shelves: Array<{ yTop: number; yBot: number; xRight: number }> = [];
	for (const item of existingItems.filter((i) => !i.outOfBounds)) {
		const top = item.y, bot = item.y + item.height, right = item.x + item.width;
		let merged = false;
		for (const shelf of shelves) {
			if (top < shelf.yBot && bot > shelf.yTop) {
				shelf.yTop   = Math.min(shelf.yTop, top);
				shelf.yBot   = Math.max(shelf.yBot, bot);
				shelf.xRight = Math.max(shelf.xRight, right);
				merged = true;
				break;
			}
		}
		if (!merged) shelves.push({ yTop: top, yBot: bot, xRight: right });
	}
	shelves.sort((a, b) => a.yTop - b.yTop);

	const lowestBot = shelves.length ? Math.max(...shelves.map((s) => s.yBot)) : 0;
	const newY      = lowestBot + pad;
	for (const { w, h, rot } of orientations) {
		if (newY + h <= sheetH + 0.01 && w <= sheetW + 0.01) {
			return { x: pad, y: newY, width: w, height: h, rotation: rot, outOfBounds: false };
		}
	}

	for (const { w, h, rot } of orientations) {
		for (const shelf of shelves) {
			const x = shelf.xRight + pad;
			if (x + w <= sheetW + 0.01 && shelf.yTop + h <= sheetH + 0.01) {
				return { x, y: shelf.yTop, width: w, height: h, rotation: rot, outOfBounds: false };
			}
		}
	}

	const { w, h, rot } = orientations[0];
	return { x: sheetW + pad, y: pad, width: w, height: h, rotation: rot, outOfBounds: true };
}

// ─── Calculate bounding box of all items ─────
export function getBoundingBox(items: CanvasItem[]) {
	if (!items.length) return { x: 0, y: 0, width: 0, height: 0 };
	const minX = Math.min(...items.map((i) => i.x));
	const minY = Math.min(...items.map((i) => i.y));
	const maxX = Math.max(...items.map((i) => i.x + i.width));
	const maxY = Math.max(...items.map((i) => i.y + i.height));
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ─── Check for overlapping items ─────────────
export function findOverlaps(items: CanvasItem[]): string[][] {
	const overlaps: string[][] = [];
	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			const a = items[i], b = items[j];
			if (
				a.x < b.x + b.width  && a.x + a.width  > b.x &&
				a.y < b.y + b.height && a.y + a.height > b.y
			) {
				overlaps.push([a.id, b.id]);
			}
		}
	}
	return overlaps;
}
