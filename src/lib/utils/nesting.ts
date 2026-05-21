// ─────────────────────────────────────────────
// OmniPlot — AUTO-NESTING ALGORITHM
// Skyline bin-packing with:
//   • 4-rotation support + tight polygon bboxes
//   • Multi-heuristic sort trials (5 orders)
//   • Pairwise swap improvement pass
//   • Module-level caches (path sampling, bbox, polygon area)
// ─────────────────────────────────────────────
import type { CanvasItem, MaterialSheet } from "$lib/types";

const PADDING_INCHES = 0.25;

// ─── Module-level caches ──────────────────────
// Key: "${svgPath}|${w}|${h}" — survives across nesting calls in a session.
const _sampleCache = new Map<string, Array<{ x: number; y: number }>>();
const _bboxCache   = new Map<string, { w: number; h: number }>();
const _areaCache   = new Map<string, number>();

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

// Sample the SVG path into inch-space points.
// Falls back to rectangle corners on SSR or parse failure.
// Results are cached at the module level.
function samplePathInchPoints(
	svgPath: string,
	nominalW: number,
	nominalH: number,
	samples = 120,
): Array<{ x: number; y: number }> {
	const cacheKey = `${nominalW}|${nominalH}|${svgPath}`;
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

// Tight axis-aligned bounding box of the polygon rotated rotDeg degrees.
// Cached.
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
// Actual enclosed area of the pattern in square inches.
// Independent of rotation (area is rotation-invariant).
// Used for accurate material-utilization reporting.
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

// ─── Orientation candidates ───────────────────
// Tries 0°, 90°, 180°, 270°; deduplicates by tight bbox dimensions.
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

// ─── Single-pass skyline packer ───────────────
// Items MUST already be in the desired order.
// Scoring: prefer leftmost X (minimize roll length), break ties by lowest Y.
function skylinePack(
	items: CanvasItem[],
	sheet: MaterialSheet,
	allowRotation: boolean,
): CanvasItem[] {
	const sheetW = sheet.widthInches;
	const sheetH = sheet.heightInches;
	const pad    = PADDING_INCHES;

	let skyline: SkylineSegment[] = [{ x: 0, y: 0, width: sheetW }];
	let overflowRow = 0;
	const placed: CanvasItem[] = [];

	for (const item of items) {
		const orientations = buildOrientations(item, sheetW, allowRotation);

		let best: {
			x: number; y: number; w: number; h: number; rot: number; score: number;
		} | null = null;

		for (const { w: iW, h: iH, rot } of orientations) {
			for (const seg of skyline) {
				const startX = seg.x;
				if (startX + iW > sheetW + 0.001) continue;

				const maxY   = getMaxY(skyline, startX, iW);
				const placeY = maxY + pad;
				if (placeY + iH > sheetH + 0.001) continue;

				// Prefer leftmost X (minimize roll length used), break ties by lowest Y
				const score = startX * 1e6 + placeY;
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

// Maximum X extent of in-bounds items — our minimization objective.
function layoutLen(placed: CanvasItem[]): number {
	const ib = placed.filter((i) => !i.outOfBounds);
	return ib.length ? Math.max(...ib.map((i) => i.x + i.width)) : 0;
}

// ─── Pairwise swap improvement pass ──────────
// After the best multi-sort result, tries swapping every pair of items in the
// placement order and repacking. Keeps any swap that reduces total roll length.
// Skipped for large sets (≥ 20 items) where multi-sort gains are already good.
function swapImprovementPass(
	placed: CanvasItem[],
	sheet: MaterialSheet,
	allowRotation: boolean,
): CanvasItem[] {
	// Work in placement order (x-ascending as a proxy for insertion order)
	let current = [...placed].sort((a, b) => a.x - b.x || a.y - b.y);
	let curLen  = layoutLen(current);

	const n = current.length;
	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			const trial = [...current];
			[trial[i], trial[j]] = [trial[j], trial[i]];
			const repacked = skylinePack(trial, sheet, allowRotation);
			const len = layoutLen(repacked);
			if (len < curLen - 0.01) {
				// Accept swap — resort for next iteration
				current = repacked.sort((a, b) => a.x - b.x || a.y - b.y);
				curLen  = len;
			}
		}
	}

	return current;
}

// ─── Main nesting function ────────────────────
// Tries five sort heuristics (area-desc, height-desc, width-desc,
// perimeter-desc, area-asc) and keeps the layout using the least roll length.
// Then runs a pairwise swap improvement pass for smaller item sets.
export function autoNest(
	items: CanvasItem[],
	sheet: MaterialSheet,
	allowRotation = true,
): CanvasItem[] {
	if (!items.length) return items;

	const sortFns: Array<(a: CanvasItem, b: CanvasItem) => number> = [
		// Largest area first (best general heuristic for skyline)
		(a, b) => b.pattern.widthInches * b.pattern.heightInches - a.pattern.widthInches * a.pattern.heightInches,
		// Tallest first (prioritise filling the height constraint early)
		(a, b) => b.pattern.heightInches - a.pattern.heightInches,
		// Widest first
		(a, b) => b.pattern.widthInches - a.pattern.widthInches,
		// Largest perimeter first
		(a, b) => (b.pattern.widthInches + b.pattern.heightInches) - (a.pattern.widthInches + a.pattern.heightInches),
		// Smallest area first (sometimes packs gaps better)
		(a, b) => a.pattern.widthInches * a.pattern.heightInches - b.pattern.widthInches * b.pattern.heightInches,
	];

	let best: CanvasItem[] | null = null;
	let bestLen = Infinity;

	for (const sortFn of sortFns) {
		const result = skylinePack([...items].sort(sortFn), sheet, allowRotation);
		const len    = layoutLen(result);
		if (len < bestLen) {
			bestLen = len;
			best    = result;
		}
	}

	// Improvement pass for smaller sets (all bboxes already cached — fast)
	if (items.length < 20) {
		const improved    = swapImprovementPass(best!, sheet, allowRotation);
		const improvedLen = layoutLen(improved);
		if (improvedLen < bestLen) best = improved;
	}

	const byId = new Map(best!.map((r) => [r.id, r]));
	return items.map((item) => byId.get(item.id) ?? item);
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
// Column-first: fills the current column downward before starting a new one.
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
		// For rectangular fallback (no svgPath) just swap dimensions at 90°/270°
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

	if (!existingItems.length) {
		const { w, h, rot } = orientations[0];
		return { x: pad, y: pad, width: w, height: h, rotation: rot, outOfBounds: false };
	}

	// Group in-bounds items into shelves by overlapping y-ranges
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

	// Fill column downward first (minimize roll length used)
	const lowestBot = shelves.length ? Math.max(...shelves.map((s) => s.yBot)) : 0;
	const newY      = lowestBot + pad;
	for (const { w, h, rot } of orientations) {
		if (newY + h <= sheetH + 0.01 && w <= sheetW + 0.01) {
			return { x: pad, y: newY, width: w, height: h, rotation: rot, outOfBounds: false };
		}
	}

	// Column full — start a new column to the right
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
