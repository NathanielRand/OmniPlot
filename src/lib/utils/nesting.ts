// ─────────────────────────────────────────────
// OmniPlot — NESTING ENGINE v2
//
// Single geometry model, single collision predicate, one placer.
//
// v1 accumulated 12 separate "improvement passes" (skyline, row-balance,
// gap-fill, swap, insertion, rotation, pair-rotation, compaction ×2,
// declash...) each with its own accept/reject gate and its own idea of what
// a shape's footprint was (tight bbox in some passes, NFP polygon at 10
// samples in others, 60 samples in the "verify" step) — they fought each
// other, and none of them was actually the final source of truth. That's
// why patterns could still bleed past the cut-zone edge despite a
// "buffer": one pass's output box already included the buffer, and the
// next pass added it again on top.
//
// v2 replaces all of that with:
//   1. ONE geometry representation per (pattern, rotation, buffer): a
//      rasterized row-span mask of the true silhouette, inflated by
//      buffer/2 (so two pieces placed with masks just touching are
//      exactly `buffer` apart in real inches). Cached — built once per
//      distinct combination, reused everywhere.
//   2. ONE placer: given a mask and a set of candidate anchors (corners of
//      already-placed pieces, à la MaxRects), pick the anchor that
//      minimizes roll length (or Y-then-X for "compact" scoring) with NO
//      collision — checked directly against the same masks, not an
//      approximation of them.
//   3. ONE improvement mechanism: ruin-and-recreate (remove a random
//      subset of placed pieces, reinsert them, keep the result if it's
//      better) under a wall-clock budget. This subsumes what used to be
//      12 different bespoke passes — they were all special cases of "try
//      a different arrangement, keep it if it's shorter."
//   4. A cheap exact-polygon safety sweep at the very end. Because the
//      raster mask is deliberately conservative (grid cells are rounded
//      OUTWARD when inflating), a raster-approved placement can never
//      actually violate the requested buffer — this sweep should never
//      fire. It exists as a backstop, not a repair mechanism.
// ─────────────────────────────────────────────
import type { CanvasItem, MaterialSheet } from "$lib/types";
import {
	type Point,
	type Polygon,
	translatePolygon,
	rotatePoints,
	inflatePolygon,
	ensureCCW,
	polygonsOverlap,
} from "./polygon";

// ─── Buffer / edge margin ──────────────────────
// bufferInches is the user-configurable spacing kept between pieces — it
// can legitimately be 0 (touching) or negative (intentional overlap).
// Clearance from the sheet's own physical edge is never allowed to go
// below a hard floor regardless of that setting.
const MIN_EDGE_MARGIN_INCHES = 0.05;
function edgeMarginFor(bufferInches: number): number {
	return Math.max(bufferInches, MIN_EDGE_MARGIN_INCHES);
}

// ─── Raster grid resolution ───────────────────
// 0.1" cells — finer than any blade kerf that matters, coarse enough that
// per-pattern masks (built once, cached) rasterize in microseconds and
// collision tests are a handful of integer interval comparisons.
const CELL = 0.1;
const toCells = (inches: number) => inches / CELL;

// ─── Module-level caches (pure geometry — safe to share across calls) ──
const _sampleCache  = new Map<string, Array<{ x: number; y: number }>>();
const _bboxCache    = new Map<string, { w: number; h: number }>();
const _areaCache    = new Map<string, number>();
const _svgBBoxCache = new Map<string, { x: number; y: number; w: number; h: number }>();

// ─── Point-sampling a pattern's SVG path into inch-space points ──────────
// A user-uploaded/traced pattern can legitimately contain more than one
// subpath (multiple "M" commands) — e.g. a compound shape, a stray
// duplicate segment from a tracing tool, or a piece with a cutout. Walking
// getTotalLength()/getPointAtLength() across the WHOLE path as one
// continuous sample would silently draw a bogus straight edge bridging the
// end of one subpath to the start of the next (M doesn't consume any
// length, so the sample sequence just jumps) — that fake edge then
// corrupts every downstream shape check (collision mask, area, bbox).
// Sampling each subpath through its OWN <path> element (so its own
// getTotalLength/getPointAtLength never sees the other subpaths) and
// keeping them as separate loops is the fix; a shared bbox/scale (from the
// FULL original path) keeps their relative geometry intact.
function splitSubpaths(svgPath: string): string[] {
	const parts = svgPath.trim().split(/(?=[Mm])/).map((s) => s.trim()).filter(Boolean);
	return parts.length ? parts : [svgPath];
}

const _multiSampleCache = new Map<string, Array<Array<{ x: number; y: number }>>>();

// A polygon built from evenly-spaced samples along a curve is a chord
// approximation — its boundary sits strictly INSIDE any convex bulge of the
// true curve (a chord is always shorter than the arc it spans). A fixed
// sample count is either wasteful on a tiny shape or dangerously coarse on
// a large one (a big swept windshield edge with only ~80 samples spread
// across its whole perimeter can leave visible gaps between chords and the
// true curve — exactly what let two "verified non-colliding" masks still
// cross when actually rendered). Target a fixed chord length in INCHES
// instead of a fixed sample count, so resolution scales with the shape's
// actual size.
const TARGET_CHORD_INCHES = 0.03;
const MIN_SAMPLES_PER_LOOP = 40;
const MAX_SAMPLES_PER_LOOP = 500;

function sampleSubpaths(
	svgPath: string,
	nominalW: number,
	nominalH: number,
): Array<Array<{ x: number; y: number }>> {
	const cacheKey = `${nominalW}|${nominalH}|${svgPath}`;
	if (_multiSampleCache.has(cacheKey)) return _multiSampleCache.get(cacheKey)!;

	const fallback = [[
		{ x: 0, y: 0 }, { x: nominalW, y: 0 }, { x: nominalW, y: nominalH }, { x: 0, y: nominalH },
	]];

	if (typeof document === "undefined") {
		_multiSampleCache.set(cacheKey, fallback);
		return fallback;
	}
	try {
		const ns  = "http://www.w3.org/2000/svg";
		const svg = document.createElementNS(ns, "svg");
		document.body.appendChild(svg);

		const fullEl = document.createElementNS(ns, "path") as SVGPathElement;
		fullEl.setAttribute("d", svgPath);
		svg.appendChild(fullEl);
		const bbox = fullEl.getBBox();
		svg.removeChild(fullEl);
		// Uniform (fit-to-box) scale — independent X/Y factors would stretch
		// any non-axis-aligned edge whenever the stored widthInches/heightInches
		// don't exactly match the traced path's true aspect ratio, distorting
		// polygon geometry. A single scale plus centering keeps the shape
		// undistorted and simply fits it within the nominal box.
		const scale = Math.min(nominalW / (bbox.width || 1), nominalH / (bbox.height || 1));
		const offsetX = (nominalW - bbox.width * scale) / 2;
		const offsetY = (nominalH - bbox.height * scale) / 2;

		const loops: Array<Array<{ x: number; y: number }>> = [];
		for (const sub of splitSubpaths(svgPath)) {
			const el = document.createElementNS(ns, "path") as SVGPathElement;
			el.setAttribute("d", sub);
			svg.appendChild(el);
			let total = 0;
			try { total = el.getTotalLength(); } catch { total = 0; }
			if (total > 0) {
				const estInchLength = total * scale;
				const samplesPerLoop = Math.min(
					MAX_SAMPLES_PER_LOOP,
					Math.max(MIN_SAMPLES_PER_LOOP, Math.ceil(estInchLength / TARGET_CHORD_INCHES)),
				);
				const step = total / samplesPerLoop;
				const pts: Array<{ x: number; y: number }> = [];
				for (let i = 0; i <= samplesPerLoop; i++) {
					const pt = el.getPointAtLength(i * step);
					pts.push({ x: (pt.x - bbox.x) * scale + offsetX, y: (pt.y - bbox.y) * scale + offsetY });
				}
				loops.push(pts);
			}
			svg.removeChild(el);
		}
		document.body.removeChild(svg);

		const result = loops.length ? loops : fallback;
		_multiSampleCache.set(cacheKey, result);
		return result;
	} catch {
		_multiSampleCache.set(cacheKey, fallback);
		return fallback;
	}
}

// Flat single-loop sampling — only safe for uses that don't care about a
// bogus bridging edge between subpaths, i.e. plain bbox extent (min/max
// over points is unaffected by which edges connect them).
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
		// Uniform (fit-to-box) scale — see sampleSubpaths() for why independent
		// X/Y factors are unsafe.
		const scale = Math.min(nominalW / (bbox.width || 1), nominalH / (bbox.height || 1));
		const offsetX = (nominalW - bbox.width * scale) / 2;
		const offsetY = (nominalH - bbox.height * scale) / 2;

		const pts: Array<{ x: number; y: number }> = [];
		for (let i = 0; i <= samples; i++) {
			const pt = el.getPointAtLength(i * step);
			pts.push({
				x: (pt.x - bbox.x) * scale + offsetX,
				y: (pt.y - bbox.y) * scale + offsetY,
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

// ─── Polygon area (shoelace) — used for efficiency % reporting ─────────
export function samplePolygonArea(
	svgPath: string,
	widthInches: number,
	heightInches: number,
): number {
	const cacheKey = `${widthInches}|${heightInches}|${svgPath}`;
	if (_areaCache.has(cacheKey)) return _areaCache.get(cacheKey)!;

	const loops = sampleSubpaths(svgPath, widthInches, heightInches);
	let result = 0;
	for (const pts of loops) {
		let area = 0;
		for (let i = 0; i < pts.length; i++) {
			const j = (i + 1) % pts.length;
			area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
		}
		result += Math.abs(area) / 2;
	}
	_areaCache.set(cacheKey, result);
	return result;
}

// ─── Raw SVG bounding box (path's own coordinate system) ──────────────
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

// ─── Multi-loop bounds ─────────────────────────
function boundsOfLoops(loops: Polygon[]): { minX: number; minY: number; maxX: number; maxY: number } {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const loop of loops) {
		for (const p of loop) {
			if (p.x < minX) minX = p.x;
			if (p.x > maxX) maxX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.y > maxY) maxY = p.y;
		}
	}
	if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
	return { minX, minY, maxX, maxY };
}

// ─── Local polygon(s) for a pattern at a given rotation ────────────────
// Rotates around the nominal centre, then normalizes so the TRUE
// (unbuffered) combined bbox starts at (0, 0). This local frame is what
// item.x/y address — the anchor a piece is placed at is always its true
// bbox's top-left corner, never an inflated one. Returns one loop per
// subpath — see sampleSubpaths for why a multi-subpath pattern can't be
// flattened into a single loop without corrupting its shape.
export function truePolygonsAt(item: CanvasItem, rotDeg: number): Polygon[] {
	const loops = sampleSubpaths(
		item.pattern.svgPath,
		item.pattern.widthInches,
		item.pattern.heightInches,
	) as Point[][];
	const cx = item.pattern.widthInches  / 2;
	const cy = item.pattern.heightInches / 2;
	const rotated = loops.map((loop) => {
		const centred = loop.map((p) => ({ x: p.x - cx, y: p.y - cy }));
		return rotDeg === 0 ? centred : rotatePoints(centred, rotDeg);
	});
	const b = boundsOfLoops(rotated);
	return rotated.map((loop) => translatePolygon(loop, -b.minX, -b.minY));
}

// Local (untranslated) footprint at the item's own rotation, with
// flippedH/flippedV applied — the exact shape in the [0,width]×[0,height]
// box that both the renderer and itemFootprintPolygons (once translated by
// item.x/y) treat as truth. Shared by both so they can never disagree.
function localFootprintPolygons(item: CanvasItem): Polygon[] {
	const local = truePolygonsAt(item, item.rotation);
	if (!item.flippedH && !item.flippedV) return local;
	const b = boundsOfLoops(local);
	const w = b.maxX, h = b.maxY;
	return local.map((loop) =>
		loop.map((p) => ({
			x: item.flippedH ? w - p.x : p.x,
			y: item.flippedV ? h - p.y : p.y,
		})),
	);
}

// ─── Render-ready path for a placed item ──────────────────────────────
// Builds an SVG "d" string directly from the same rotated/flipped/
// normalized geometry the packer used to compute item.width/height and to
// reserve its collision space. The studio renders THIS instead of
// re-deriving a rotation/bbox/flip independently: two different formulas
// for "the transformed bbox of this shape" agree only for actual
// rectangles, and disagreeing for anything else is exactly what let a
// piece's on-screen outline drift outside the box the packer reserved for
// it — real, non-overlapping allocated space, rendered as if it
// overlapped. A consumer only ever needs to set
// `viewBox="0 0 {item.width} {item.height}"` with no further rotation or
// flip transform — both are already baked into these coordinates.
export function tightPathAt(item: CanvasItem): string {
	const loops = localFootprintPolygons(item);
	return loops
		.map((loop) => {
			if (loop.length === 0) return "";
			const [first, ...rest] = loop;
			const cmds = rest.map((p) => `L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(" ");
			return `M ${first.x.toFixed(3)} ${first.y.toFixed(3)} ${cmds} Z`;
		})
		.filter(Boolean)
		.join(" ");
}

// ─── Tight bbox at an arbitrary rotation ───────────────────────────────
// The true (unbuffered) footprint size a piece would have if rotated to
// `rotDeg` — NOT the current item.width/height, which reflect whatever
// rotation the piece was last placed/rotated at. Any caller that changes an
// already-placed piece's rotation (a manual rotate button, for instance)
// MUST recompute width/height through this before committing the change:
// leaving the OLD rotation's box size paired with the NEW rotation's shape
// is exactly what let a manually-rotated piece's real outline spill outside
// the box everything else was placed around it.
export function trueBBoxAt(item: CanvasItem, rotDeg: number): { width: number; height: number } {
	const b = boundsOfLoops(truePolygonsAt(item, rotDeg));
	return { width: b.maxX, height: b.maxY };
}

// ─── Absolute footprint polygons — rotation + flip + placement ────────
// The single definitive answer to "where is this piece's real ink right
// now," accounting for every transform the studio lets a user apply
// (rotation, horizontal/vertical flip, position) — not just whatever
// subset the packer happened to reason about when it placed the piece.
// Anything that needs to know a placed piece's true occupied space (the
// renderer, a manual-edit overlap guard) should call this rather than
// re-deriving its own notion of the transform chain.
export function itemFootprintPolygons(item: CanvasItem): Polygon[] {
	return localFootprintPolygons(item).map((loop) => translatePolygon(loop, item.x, item.y));
}

// ─── Manual-edit overlap guard ──────────────────────────────────────
// The packer guarantees non-overlapping output, but nothing enforced that
// invariant once a piece could be moved/rotated/flipped by hand afterward
// (drag, position inputs, rotate/flip buttons) — those paths just wrote the
// new transform straight to the store with no check at all. This is the
// shared predicate every manual-edit call site should run the CANDIDATE
// (proposed) item through before committing it.
export function wouldOverlapAny(
	candidate: CanvasItem,
	others: CanvasItem[],
	bufferInches: number,
): boolean {
	const half = Math.max(0, bufferInches / 2);
	const candidatePolys = itemFootprintPolygons(candidate).map((loop) =>
		inflatePolygon(ensureCCW(loop), half),
	);
	for (const other of others) {
		if (other.id === candidate.id || other.outOfBounds) continue;
		const otherPolys = itemFootprintPolygons(other).map((loop) =>
			inflatePolygon(ensureCCW(loop), half),
		);
		for (const a of candidatePolys) {
			for (const b of otherPolys) {
				if (polygonsOverlap(a, b)) return true;
			}
		}
	}
	return false;
}

// ─── Row-span raster mask ──────────────────────
// Standard scanline polygon fill: for each row, find edge crossings across
// ALL loops combined, sort them, pair them up (even-odd rule) into
// inside-spans. Correct for concave shapes AND multi-subpath patterns
// (holes, compound pieces) without ever enumerating individual cells —
// cost is rows × total-edges, not rows × cols.
interface RasterMask {
	rows: Map<number, Array<[number, number]>>; // row -> [colStart, colEndExclusive][]
	minRow: number;
	maxRow: number;
	minCol: number;
	maxCol: number;
}

function rasterizeSpans(loops: Polygon[]): RasterMask {
	const b = boundsOfLoops(loops);
	const minRow = Math.floor(b.minY / CELL);
	const maxRow = Math.ceil(b.maxY / CELL);
	const rows = new Map<number, Array<[number, number]>>();
	let minCol = Infinity, maxCol = -Infinity;

	for (let r = minRow; r < maxRow; r++) {
		const y = (r + 0.5) * CELL;
		const xs: number[] = [];
		for (const poly of loops) {
			const n = poly.length;
			for (let i = 0; i < n; i++) {
				const a = poly[i], c = poly[(i + 1) % n];
				if ((a.y <= y && c.y > y) || (c.y <= y && a.y > y)) {
					const t = (y - a.y) / (c.y - a.y);
					xs.push(a.x + t * (c.x - a.x));
				}
			}
		}
		xs.sort((p, q) => p - q);
		const spans: Array<[number, number]> = [];
		for (let i = 0; i + 1 < xs.length; i += 2) {
			const cs = Math.floor(xs[i] / CELL);
			const ce = Math.ceil(xs[i + 1] / CELL);
			if (ce > cs) {
				spans.push([cs, ce]);
				if (cs < minCol) minCol = cs;
				if (ce > maxCol) maxCol = ce;
			}
		}
		if (spans.length) rows.set(r, spans);
	}

	if (!isFinite(minCol)) { minCol = 0; maxCol = 0; }
	return { rows, minRow, maxRow, minCol, maxCol };
}

// ─── Mask cache: one raster per (pattern, rotation, buffer) ───────────
const _maskCache = new Map<string, { mask: RasterMask; trueW: number; trueH: number }>();

function getMask(
	item: CanvasItem,
	rotDeg: number,
	bufferInches: number,
): { mask: RasterMask; trueW: number; trueH: number } {
	const key = `${item.pattern.id}|${rotDeg}|${bufferInches.toFixed(3)}`;
	const cached = _maskCache.get(key);
	if (cached) return cached;

	const trueLocal = truePolygonsAt(item, rotDeg);
	const tb = boundsOfLoops(trueLocal);
	const trueW = tb.maxX, trueH = tb.maxY;

	// Beyond the user's requested buffer, always inflate the COLLISION mask
	// (never the reported true bbox) by a small fixed safety pad. Even with
	// TARGET_CHORD_INCHES sampling, a curve's true boundary always lies
	// slightly outside its chord-sampled polygon — this floor guarantees the
	// mask stays a conservative (never-undershooting) stand-in for the real
	// rendered shape regardless of residual sampling/rasterization error.
	const CURVE_SAFETY_HALF = 0.01;
	const half = Math.max(0, bufferInches / 2) + CURVE_SAFETY_HALF;
	// Inflating the ALREADY true-local-normalized loops (rather than
	// re-normalizing after inflation) preserves the offset between the
	// true bbox's (0,0) corner and the inflated silhouette — the mask's
	// negative-row/negative-col cells are exactly "how far the buffer
	// extends behind the true top-left corner." That relationship is what
	// lets item.x/item.y always mean "true bbox top-left," never a
	// buffer-inflated stand-in for it (the bug that corrupted item
	// width/height in v1).
	const inflated = trueLocal.map((loop) => inflatePolygon(ensureCCW(loop), half));
	const mask = rasterizeSpans(inflated);

	const result = { mask, trueW, trueH };
	_maskCache.set(key, result);
	return result;
}

// ─── Occupancy grid ────────────────────────────
// Sparse: only rows that actually have a placed piece exist as map entries,
// so this costs nothing for a mostly-empty roll regardless of roll length.
class OccGrid {
	private rows = new Map<number, Array<{ start: number; end: number; id: string }>>();

	add(mask: RasterMask, ax: number, ay: number, id: string): void {
		for (const [r, spans] of mask.rows) {
			const absRow = ay + r;
			let arr = this.rows.get(absRow);
			if (!arr) { arr = []; this.rows.set(absRow, arr); }
			for (const [s, e] of spans) arr.push({ start: ax + s, end: ax + e, id });
		}
	}

	remove(id: string): void {
		for (const arr of this.rows.values()) {
			for (let i = arr.length - 1; i >= 0; i--) {
				if (arr[i].id === id) arr.splice(i, 1);
			}
		}
	}

	collides(mask: RasterMask, ax: number, ay: number, skipId: string): boolean {
		for (const [r, spans] of mask.rows) {
			const arr = this.rows.get(ay + r);
			if (!arr) continue;
			for (const [s, e] of spans) {
				const cs = ax + s, ce = ax + e;
				for (const seg of arr) {
					if (seg.id === skipId) continue;
					if (cs < seg.end && ce > seg.start) return true;
				}
			}
		}
		return false;
	}
}

// ─── Bounds check (cut-zone edges) ─────────────
// Both axes are treated as a hard physical edge inset by the margin — the
// engine has no notion of "this axis is basically infinite" baked in;
// callers that want a generously long roll just pass a generously large
// sheet.widthInches. (mask.minRow/minCol can be negative — the buffer
// inflation extends slightly behind the item's true top-left corner — so
// the bound check is against the mask's absolute extent, not the anchor
// itself.)
function withinBounds(
	mask: RasterMask, ax: number, ay: number,
	marginCells: number, rollWidthCells: number, maxLenCells: number,
): boolean {
	const absMinRow = ay + mask.minRow;
	const absMaxRow = ay + mask.maxRow;
	if (absMinRow < marginCells) return false;
	if (absMaxRow > rollWidthCells - marginCells) return false;
	const absMinCol = ax + mask.minCol;
	if (absMinCol < marginCells) return false;
	const absMaxCol = ax + mask.maxCol;
	if (absMaxCol > maxLenCells - marginCells) return false;
	return true;
}

// A placed piece's OCCUPIED footprint (the buffer-inflated mask's absolute
// cell extent) — not its true bbox. Anchor generation must target this, not
// the true edge: the true edge underestimates where the piece actually
// blocks space by exactly the buffer inflation, which would make every
// neighbor-adjacent anchor collide (there'd be nothing closer to fall back
// to, since a single anchor point either hits or misses).
interface OccupiedGeom { left: number; right: number; top: number; bottom: number; }

// ─── Candidate anchor positions (MaxRects-style corners) ──────────────
// Anchors are expressed as a TARGET for the mask's own occupied edge (not
// the item's true-bbox corner) — origin's target is the margin itself; a
// neighbor-edge target is that neighbor's actual occupied edge. Placing a
// new piece so its occupied edge lands exactly on another's occupied edge
// is precisely "touching with the full requested buffer," regardless of
// how much of that buffer was contributed by which piece's own inflation.
function candidateAnchors(
	occupied: OccupiedGeom[],
	marginCells: number,
): Array<{ x: number; y: number }> {
	const seen = new Set<string>();
	const list: Array<{ x: number; y: number }> = [];
	const push = (x: number, y: number) => {
		const key = `${x},${y}`;
		if (!seen.has(key)) { seen.add(key); list.push({ x, y }); }
	};

	push(marginCells, marginCells);
	for (const p of occupied) {
		push(p.right, p.top);
		push(p.left, p.bottom);
	}
	for (const p1 of occupied) {
		for (const p2 of occupied) {
			if (p1 === p2) continue;
			push(p1.right, p2.bottom);
		}
	}
	return list;
}

// ─── Placing one item against a partially-placed layout ───────────────
interface PlaceResult {
	ax: number; ay: number; rot: number;
	trueW: number; trueH: number; mask: RasterMask; score: number;
}

function placeOneItem(
	item: CanvasItem,
	occupied: OccupiedGeom[],
	occ: OccGrid,
	opts: {
		allowRotation: boolean; bufferInches: number;
		marginCells: number; rollWidthCells: number; maxLenCells: number;
		scoring: "left" | "compact"; preferredRot?: number;
	},
): PlaceResult | null {
	const rotations = opts.allowRotation ? [0, 90, 180, 270] : [0];
	const rotOrder = opts.preferredRot !== undefined
		? [opts.preferredRot, ...rotations.filter((r) => r !== opts.preferredRot)]
		: rotations;
	const targets = candidateAnchors(occupied, opts.marginCells);

	let best: PlaceResult | null = null;
	for (const rot of rotOrder) {
		const { mask, trueW, trueH } = getMask(item, rot, opts.bufferInches);
		if (Math.round(trueW / CELL) > opts.maxLenCells) continue;

		for (const t of targets) {
			// t names where this mask's own occupied left/top edge should sit;
			// the anchor we actually place at (the item's true bbox corner) is
			// offset back by the mask's own negative-relative extent.
			const ax = t.x - mask.minCol;
			const ay = t.y - mask.minRow;
			if (!withinBounds(mask, ax, ay, opts.marginCells, opts.rollWidthCells, opts.maxLenCells)) continue;
			if (occ.collides(mask, ax, ay, item.id)) continue;
			const score = opts.scoring === "compact"
				? ay * 1e7 + ax
				: ax * 1e7 + ay;
			if (!best || score < best.score) {
				best = { ax, ay, rot, trueW, trueH, mask, score };
			}
		}
	}
	return best;
}

// ─── Full-order pack: place every item in a given sequence ────────────
function packOrder(
	items: CanvasItem[],
	sheet: MaterialSheet,
	allowRotation: boolean,
	bufferInches: number,
	scoring: "left" | "compact",
	rotHints?: Map<string, number>,
): CanvasItem[] {
	const occ = new OccGrid();
	const marginCells   = Math.round(toCells(edgeMarginFor(bufferInches)));
	const rollWidthCells = Math.round(toCells(sheet.heightInches));
	const maxLenCells    = Math.round(toCells(sheet.widthInches));

	const placed: CanvasItem[] = [];
	const occupied: OccupiedGeom[] = [];
	let overflowRow = 0;

	for (const item of items) {
		const best = placeOneItem(item, occupied, occ, {
			allowRotation, bufferInches, marginCells, rollWidthCells, maxLenCells,
			scoring, preferredRot: rotHints?.get(item.id),
		});

		if (best) {
			occ.add(best.mask, best.ax, best.ay, item.id);
			const x = best.ax * CELL, y = best.ay * CELL;
			placed.push({
				...item, x, y, width: best.trueW, height: best.trueH,
				rotation: best.rot, outOfBounds: false,
			});
			occupied.push({
				left: best.ax + best.mask.minCol, right: best.ax + best.mask.maxCol,
				top: best.ay + best.mask.minRow, bottom: best.ay + best.mask.maxRow,
			});
		} else {
			placed.push({
				...item,
				x: maxLenCells * CELL + edgeMarginFor(bufferInches) + overflowRow * (item.pattern.widthInches + 0.1),
				y: rollWidthCells * CELL + 0.1,
				width: item.pattern.widthInches, height: item.pattern.heightInches,
				rotation: 0, outOfBounds: true,
			});
			overflowRow++;
		}
	}
	return placed;
}

function usedLength(placed: CanvasItem[]): number {
	const ib = placed.filter((i) => !i.outOfBounds);
	return ib.length ? Math.max(...ib.map((i) => i.x + i.width)) : 0;
}
function oobCount(placed: CanvasItem[]): number {
	return placed.filter((i) => i.outOfBounds).length;
}
// Fewer out-of-bounds pieces always wins; among equal OOB counts, shorter
// roll length wins. This single comparator is the ONLY acceptance rule in
// the whole engine — every trial, every ruin-and-recreate iteration is
// judged by it.
function better(a: CanvasItem[], b: CanvasItem[]): boolean {
	const oa = oobCount(a), ob = oobCount(b);
	if (oa !== ob) return oa < ob;
	return usedLength(a) < usedLength(b) - 0.001;
}

// ─── Sort heuristics — seed different initial orderings ──────────────
type SortFn = (a: CanvasItem, b: CanvasItem) => number;
function getSortHeuristics(): SortFn[] {
	const area   = (i: CanvasItem) => i.pattern.widthInches * i.pattern.heightInches;
	const maxDim = (i: CanvasItem) => Math.max(i.pattern.widthInches, i.pattern.heightInches);
	const minDim = (i: CanvasItem) => Math.min(i.pattern.widthInches, i.pattern.heightInches);
	const aspect = (i: CanvasItem) => maxDim(i) / (minDim(i) || 0.01);

	return [
		(a, b) => area(b) - area(a),                       // largest area first
		(a, b) => b.pattern.heightInches - a.pattern.heightInches,
		(a, b) => b.pattern.widthInches - a.pattern.widthInches,
		(a, b) => maxDim(b) - maxDim(a),
		(a, b) => aspect(b) - aspect(a),                    // most elongated first
		(a, b) => aspect(a) - aspect(b),                    // most square first
		(a, b) => area(a) - area(b),                        // smallest first
	];
}

// ─── Complementary pair detection ────────────
// A left/right pair: two items sharing the same vehicleId and nominal
// dimensions whose zone names differ only in the "-left" / "-right" suffix.
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

// ─── Group rotation hints ──────────────────────
// For a group of identical-footprint items (e.g. 6 copies of the same
// window), the length-minimizing arrangement is usually an UNBALANCED split
// between "long side crosswise" and "long side along the roll" — not the
// even split a pure greedy placer tends to converge on. Rather than a
// dedicated pass with its own accept/reject gate (v1's rowBalanceGroupPass),
// this just seeds the preferred rotation for each item as a HINT — the
// actual placer still verifies every placement against the real raster
// mask, so a bad hint costs nothing but falls back to trying every other
// rotation anyway.
function computeGroupRotationHints(
	items: CanvasItem[],
	allowRotation: boolean,
): Map<string, number> | undefined {
	if (!allowRotation) return undefined;
	const groups = new Map<string, CanvasItem[]>();
	for (const it of items) {
		const key = [it.pattern.widthInches, it.pattern.heightInches]
			.sort((a, b) => a - b).map((n) => n.toFixed(2)).join("x");
		const g = groups.get(key);
		if (g) g.push(it); else groups.set(key, [it]);
	}

	const hints = new Map<string, number>();
	for (const arr of groups.values()) {
		if (arr.length < 2) continue;
		const w = arr[0].pattern.widthInches, h = arr[0].pattern.heightInches;
		if (Math.abs(w - h) < 0.01) continue; // square — rotation is moot
		const long = Math.max(w, h), short = Math.min(w, h);
		const k = arr.length;

		let bestSplit: { n1: number; maxLen: number } | null = null;
		for (let n1 = 0; n1 <= k; n1++) {
			const n2 = k - n1;
			const len1 = n1 > 0 ? n1 * short : 0;
			const len2 = n2 > 0 ? n2 * long : 0;
			const maxLen = Math.max(len1, len2);
			if (!bestSplit || maxLen < bestSplit.maxLen) bestSplit = { n1, maxLen };
		}
		arr.forEach((it, i) => hints.set(it.id, i < bestSplit!.n1 ? 90 : 0));
	}
	return hints.size ? hints : undefined;
}

// ─── Pair-adjacent orderings ──────────────────
// Keeps detected left/right pairs consecutive in the placement order, which
// nudges them into the same band — pure ordering hint, no dedicated pass.
function buildPairedOrderings(
	items: CanvasItem[],
	pairs: Array<[CanvasItem, CanvasItem]>,
): CanvasItem[][] {
	if (pairs.length === 0) return [];
	const pairedIds = new Set<string>(pairs.flatMap(([a, b]) => [a.id, b.id]));
	const singles = items.filter((i) => !pairedIds.has(i.id));
	return [
		[...pairs.flatMap(([l, r]) => [l, r]), ...singles],
		[...singles, ...pairs.flatMap(([l, r]) => [l, r])],
	];
}

// ─── Seeded shuffle (for random-restart trials) ───────────────────────
function shuffled<T>(arr: T[], seed: number): T[] {
	const out = [...arr];
	let s = seed | 0;
	for (let i = out.length - 1; i > 0; i--) {
		s = (Math.imul(s, 1664525) + 1013904223) | 0;
		const j = Math.abs(s) % (i + 1);
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

// ─── Run a batch of orderings, keep the best ──────────────────────────
function runTrials(
	orderings: Array<{ order: CanvasItem[]; scoring: "left" | "compact"; hints?: Map<string, number> }>,
	sheet: MaterialSheet,
	allowRotation: boolean,
	bufferInches: number,
	withinBudget?: () => boolean,
): CanvasItem[] {
	let best: CanvasItem[] | null = null;
	for (const { order, scoring, hints } of orderings) {
		if (best !== null && withinBudget && !withinBudget()) break;
		const result = packOrder(order, sheet, allowRotation, bufferInches, scoring, hints);
		if (!best || better(result, best)) best = result;
	}
	return best!;
}

// ─── Ruin-and-recreate improvement loop ───────────────────────────────
// Removes a random subset of placed pieces, reinserts them (in a shuffled
// order, trying both scoring modes), keeps the result only if it's better
// under the SAME comparator every other trial uses. This single mechanism
// covers what v1 needed 8+ dedicated passes for (rotation flips, pairwise
// swaps, insertion search, gap-filling, compaction) — all of those are just
// "try a different arrangement, keep it if it wins."
function ruinAndRecreate(
	current: CanvasItem[],
	sheet: MaterialSheet,
	allowRotation: boolean,
	bufferInches: number,
	deadline: number,
	rotHints?: Map<string, number>,
): CanvasItem[] {
	const marginCells    = Math.round(toCells(edgeMarginFor(bufferInches)));
	const rollWidthCells = Math.round(toCells(sheet.heightInches));
	const maxLenCells    = Math.round(toCells(sheet.widthInches));
	let seed = 1;

	while (Date.now() < deadline) {
		const inBounds = current.filter((i) => !i.outOfBounds);
		if (inBounds.length < 2) break;

		seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
		const frac = 0.15 + (Math.abs(seed) % 1000) / 1000 * 0.35; // 15%–50%
		const ruinCount = Math.max(1, Math.round(inBounds.length * frac));
		const shuffledIds = shuffled(inBounds.map((i) => i.id), seed);
		const ruinSet = new Set(shuffledIds.slice(0, ruinCount));

		const kept   = current.filter((i) => !ruinSet.has(i.id));
		const removed = current.filter((i) => ruinSet.has(i.id));

		// Rebuild occupancy from the kept pieces at their existing positions.
		const occ = new OccGrid();
		const occupied: OccupiedGeom[] = [];
		for (const it of kept) {
			if (it.outOfBounds) continue;
			const { mask } = getMask(it, it.rotation, bufferInches);
			const ax = Math.round(toCells(it.x)), ay = Math.round(toCells(it.y));
			occ.add(mask, ax, ay, it.id);
			occupied.push({
				left: ax + mask.minCol, right: ax + mask.maxCol,
				top: ay + mask.minRow, bottom: ay + mask.maxRow,
			});
		}

		const reinsertOrder = shuffled(removed, seed + 7919);
		const scoring: "left" | "compact" = (Math.abs(seed) % 2 === 0) ? "left" : "compact";
		const rebuilt: CanvasItem[] = kept.filter((i) => i.outOfBounds ? false : true);
		// Keep already-placed OOB pieces in the output too (they'll be
		// re-tried below alongside the ruined set).
		const stillOob = kept.filter((i) => i.outOfBounds);

		let overflowRow = 0;
		for (const item of [...reinsertOrder, ...stillOob]) {
			const best = placeOneItem(item, occupied, occ, {
				allowRotation, bufferInches, marginCells, rollWidthCells, maxLenCells,
				scoring, preferredRot: rotHints?.get(item.id),
			});
			if (best) {
				occ.add(best.mask, best.ax, best.ay, item.id);
				const x = best.ax * CELL, y = best.ay * CELL;
				rebuilt.push({ ...item, x, y, width: best.trueW, height: best.trueH, rotation: best.rot, outOfBounds: false });
				occupied.push({
					left: best.ax + best.mask.minCol, right: best.ax + best.mask.maxCol,
					top: best.ay + best.mask.minRow, bottom: best.ay + best.mask.maxRow,
				});
			} else {
				rebuilt.push({
					...item,
					x: maxLenCells * CELL + edgeMarginFor(bufferInches) + overflowRow * (item.pattern.widthInches + 0.1),
					y: rollWidthCells * CELL + 0.1,
					width: item.pattern.widthInches, height: item.pattern.heightInches,
					rotation: 0, outOfBounds: true,
				});
				overflowRow++;
			}
		}

		if (better(rebuilt, current)) current = rebuilt;
	}

	return current;
}

// ─── Exact-polygon safety sweep ────────────────
// The raster mask is deliberately conservative (cells rounded outward when
// inflating), so a raster-approved placement can never actually violate the
// requested buffer — this should be a no-op in practice. It exists as a
// backstop against the one thing rasterization can't fully guarantee: a
// piece landing outside the cut zone due to a rounding edge case. Unlike
// v1's finalDeclash, this does not nudge pieces into new collisions (the
// raster layout is already collision-free) — it only ever reclassifies a
// piece as out-of-bounds if it truly doesn't fit.
function verifySafety(
	items: CanvasItem[],
	sheet: MaterialSheet,
	bufferInches: number,
): CanvasItem[] {
	const rollWidth = sheet.heightInches;
	const maxLength = sheet.widthInches;
	const margin = edgeMarginFor(bufferInches);

	return items.map((it) => {
		if (it.outOfBounds) return it;
		const loops = truePolygonsAt(it, it.rotation).map((loop) => translatePolygon(loop, it.x, it.y));
		const b = boundsOfLoops(loops);
		const fits =
			b.minX >= -0.01 &&
			b.minY >= margin - 0.02 &&
			b.maxY <= rollWidth - margin + 0.02 &&
			b.maxX <= maxLength + 0.01;
		if (fits) return it;
		return {
			...it,
			x: maxLength + margin,
			y: margin,
			outOfBounds: true,
		};
	});
}

// ─── Shared trial-set builder ──────────────────
function buildOrderings(
	items: CanvasItem[],
	hints: Map<string, number> | undefined,
	sortCount: number,
): Array<{ order: CanvasItem[]; scoring: "left" | "compact"; hints?: Map<string, number> }> {
	const pairs = detectComplementaryPairs(items);
	const sortFns = getSortHeuristics().slice(0, sortCount);
	const baseOrderings = [
		...sortFns.map((fn) => [...items].sort(fn)),
		...buildPairedOrderings(items, pairs),
	];
	const orderings: Array<{ order: CanvasItem[]; scoring: "left" | "compact"; hints?: Map<string, number> }> = [];
	for (const order of baseOrderings) {
		orderings.push({ order, scoring: "left", hints });
		orderings.push({ order, scoring: "compact", hints });
	}
	return orderings;
}

// ─── bestNest ─────────────────────────────────
// Fast path: called on every canvas edit. A handful of deterministic
// orderings, no ruin-and-recreate — must stay well under 100ms.
// Hard diagnostic, not a repair mechanism: the packer's own collision check
// (OccGrid, exact against the raster mask) should make this impossible, and
// the manual-edit guard (wouldOverlapAny in the studio) should make it
// impossible for hand-edits too — so if this ever actually fires, it means
// one of those two guarantees has a real bug, and the logged ids/coordinates
// are enough to reproduce it directly in a script instead of guessing from a
// screenshot again.
function logAnyOverlaps(items: CanvasItem[], source: string): void {
	if (typeof window === "undefined") return;
	const inBounds = items.filter((i) => !i.outOfBounds);
	for (let i = 0; i < inBounds.length; i++) {
		const a = inBounds[i];
		const aPolys = itemFootprintPolygons(a);
		for (let j = i + 1; j < inBounds.length; j++) {
			const b = inBounds[j];
			const bPolys = itemFootprintPolygons(b);
			for (const pa of aPolys) {
				for (const pb of bPolys) {
					if (polygonsOverlap(pa, pb)) {
						console.error(`NEST OVERLAP BUG [${source}]`, {
							a: { id: a.id, x: a.x, y: a.y, width: a.width, height: a.height, rotation: a.rotation, flippedH: a.flippedH, flippedV: a.flippedV },
							b: { id: b.id, x: b.x, y: b.y, width: b.width, height: b.height, rotation: b.rotation, flippedH: b.flippedH, flippedV: b.flippedV },
						});
					}
				}
			}
		}
	}
}

export function bestNest(
	items: CanvasItem[],
	sheet: MaterialSheet,
	allowRotation = true,
	bufferInches = 0.05,
): CanvasItem[] {
	if (!items.length) return items;
	const hints = computeGroupRotationHints(items, allowRotation);
	const orderings = buildOrderings(items, hints, 5);
	const best = runTrials(orderings, sheet, allowRotation, bufferInches);
	const result = verifySafety(best, sheet, bufferInches);
	logAnyOverlaps(result, "bestNest");
	return result;
}

// ─── SmartNestResult ─────────────────────────
export interface SmartNestResult {
	items: CanvasItem[];
	improvementPct: number; // efficiency gain vs a naive first-fit baseline
	trialsRun: number;
}

// ─── smartNest ───────────────────────────────
// Thorough, user-triggered optimization: full ordering sweep + random
// restarts + a ruin-and-recreate loop under a wall-clock budget.
export function smartNest(
	items: CanvasItem[],
	sheet: MaterialSheet,
	allowRotation = true,
	bufferInches = 0.05,
): SmartNestResult {
	if (!items.length) {
		return { items, improvementPct: 0, trialsRun: 0 };
	}

	const deadline = Date.now() + 3000;
	const withinBudget = () => Date.now() < deadline;

	// Naive baseline: original order, no optimization, to report the gain against.
	const baseline = packOrder(items, sheet, allowRotation, bufferInches, "left");
	const baselineLen = usedLength(baseline);

	const hints = computeGroupRotationHints(items, allowRotation);
	const orderings = buildOrderings(items, hints, getSortHeuristics().length);
	const RANDOM_TRIALS = items.length <= 15 ? 40 : items.length <= 30 ? 20 : 10;
	for (let seed = 0; seed < RANDOM_TRIALS; seed++) {
		const order = shuffled(items, seed * 7919 + 1);
		orderings.push({ order, scoring: "left", hints });
		orderings.push({ order, scoring: "compact", hints });
	}

	let best = runTrials(orderings, sheet, allowRotation, bufferInches, withinBudget);
	best = ruinAndRecreate(best, sheet, allowRotation, bufferInches, deadline, hints);
	best = verifySafety(best, sheet, bufferInches);
	logAnyOverlaps(best, "smartNest");

	const finalLen = usedLength(best);
	const improvementPct = baselineLen > 0
		? Math.max(0, ((baselineLen - finalLen) / baselineLen) * 100)
		: 0;

	return { items: best, improvementPct, trialsRun: orderings.length };
}

// ─── Placement result (single-item preview) ───
export interface PlacementResult {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number; // 0 | 90 | 180 | 270
	outOfBounds: boolean;
}

// ─── Find next available position ────────────
// Lightweight preview placement for a single freshly-added item — its
// result is superseded by the next real bestNest() call, so this only
// needs to be a reasonable-looking shelf placement, not exact-optimal.
const PREVIEW_PAD = 0.05;
export function findNextPosition(
	existingItems: CanvasItem[],
	sheet: MaterialSheet,
	itemW: number,
	itemH: number,
	svgPath = "",
): PlacementResult {
	const pad    = PREVIEW_PAD;
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

// ─── finalDeclash ─────────────────────────────
// Kept as a standalone correctness backstop with the same contract as
// before: given an arbitrary set of item boxes (not necessarily produced by
// this engine), flag anything that overflows the roll-width axis, even if
// upstream never set outOfBounds. Operates on plain bounding boxes (not the
// raster masks) because it exists to catch garbage from OUTSIDE this
// engine, not to re-verify this engine's own output (verifySafety does
// that, against the true polygon).
export function finalDeclash(
	items: CanvasItem[],
	maxLength: number,
	rollWidth: number,
	PAD: number,
): CanvasItem[] {
	let overflowRow = 0;
	return items.map((it) => {
		const overflowsWidth  = it.y + it.height > rollWidth + 1e-6 || it.y < -1e-6;
		const overflowsLength = it.x + it.width > maxLength + PAD + 1e-6;
		if (!overflowsWidth && !overflowsLength) return it;
		const fixed = {
			...it,
			x: PAD + overflowRow * (it.width + PAD),
			y: rollWidth + PAD,
			outOfBounds: true,
		};
		overflowRow++;
		return fixed;
	});
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

// ─── Check for overlapping items (coarse bbox check) ─────────────────
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

// Re-export for anything that wants an exact polygon overlap test.
export { polygonsOverlap };
