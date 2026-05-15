// ─────────────────────────────────────────────
// OmniPlot — AUTO-NESTING ALGORITHM
// Skyline bin-packing with 4-rotation support
// and tight polygon bounding boxes.
// ─────────────────────────────────────────────
import type { CanvasItem, MaterialSheet } from "$lib/types";

const PADDING_INCHES = 0.25;

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
		const overlapEnd = Math.min(segEnd, end);
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
		if (
			last &&
			last.y === seg.y &&
			Math.abs(last.x + last.width - seg.x) < 0.001
		) {
			last.width += seg.width;
		} else {
			merged.push({ ...seg });
		}
	}
	return merged;
}

// ─── Tight polygon bounding box ───────────────

// Sample the SVG path into inch-space points via SVGPathElement.getTotalLength.
// Falls back to rectangle corners on SSR or parse failure.
function samplePathInchPoints(
	svgPath: string,
	nominalW: number,
	nominalH: number,
	samples = 120,
): Array<{ x: number; y: number }> {
	if (typeof document === "undefined") {
		return [
			{ x: 0, y: 0 },
			{ x: nominalW, y: 0 },
			{ x: nominalW, y: nominalH },
			{ x: 0, y: nominalH },
		];
	}
	try {
		const ns = "http://www.w3.org/2000/svg";
		const svg = document.createElementNS(ns, "svg");
		const el = document.createElementNS(ns, "path") as SVGPathElement;
		el.setAttribute("d", svgPath);
		svg.appendChild(el);
		document.body.appendChild(svg);

		const total = el.getTotalLength();
		const step = total / samples;
		const bbox = el.getBBox();
		const scaleX = nominalW / (bbox.width || 1);
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
		return pts;
	} catch {
		return [
			{ x: 0, y: 0 },
			{ x: nominalW, y: 0 },
			{ x: nominalW, y: nominalH },
			{ x: 0, y: nominalH },
		];
	}
}

// Tight axis-aligned bounding box of the polygon rotated rotDeg degrees
// around its nominal center (nominalW/2, nominalH/2).
function tightBboxAtRotation(
	pts: Array<{ x: number; y: number }>,
	nominalW: number,
	nominalH: number,
	rotDeg: number,
): { w: number; h: number } {
	const cx = nominalW / 2;
	const cy = nominalH / 2;
	const rad = (rotDeg * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);

	let minX = Infinity,
		maxX = -Infinity,
		minY = Infinity,
		maxY = -Infinity;

	for (const p of pts) {
		const rx =
			rotDeg === 0 ? p.x : cos * (p.x - cx) - sin * (p.y - cy);
		const ry =
			rotDeg === 0 ? p.y : sin * (p.x - cx) + cos * (p.y - cy);
		if (rx < minX) minX = rx;
		if (rx > maxX) maxX = rx;
		if (ry < minY) minY = ry;
		if (ry > maxY) maxY = ry;
	}

	return {
		w: Math.max(0.1, maxX - minX),
		h: Math.max(0.1, maxY - minY),
	};
}

// ─── Main nesting function ────────────────────
// Skyline bin-packing. Tries 0°, 90°, 180°, 270° per item using the actual
// tight polygon bbox — not just the rectangular nominal bbox. Identical bboxes
// (symmetric shapes) are deduplicated so we only try distinct footprints.
export function autoNest(
	items: CanvasItem[],
	sheet: MaterialSheet,
	allowRotation = true,
): CanvasItem[] {
	if (!items.length) return items;

	const sheetW = sheet.widthInches;
	const sheetH = sheet.heightInches;
	const pad = PADDING_INCHES;

	// Sort by nominal area — largest first, best heuristic for skyline packing
	const sorted = [...items].sort(
		(a, b) =>
			b.pattern.widthInches * b.pattern.heightInches -
			a.pattern.widthInches * a.pattern.heightInches,
	);

	let skyline: SkylineSegment[] = [{ x: 0, y: 0, width: sheetW }];
	let overflowRow = 0;
	const placed: CanvasItem[] = [];

	for (const item of sorted) {
		// Sample the polygon from the SVG path in inch space
		const pts = samplePathInchPoints(
			item.pattern.svgPath,
			item.pattern.widthInches,
			item.pattern.heightInches,
		);

		// Build orientation candidates, deduplicating identical tight bboxes
		const angles = allowRotation ? [0, 90, 180, 270] : [0];
		const seen = new Set<string>();
		const orientations: Array<{ w: number; h: number; rot: number }> = [];

		for (const rot of angles) {
			const bbox = tightBboxAtRotation(
				pts,
				item.pattern.widthInches,
				item.pattern.heightInches,
				rot,
			);
			const key = `${bbox.w.toFixed(3)},${bbox.h.toFixed(3)}`;
			if (!seen.has(key)) {
				seen.add(key);
				orientations.push({ w: bbox.w, h: bbox.h, rot });
			}
		}

		let best: {
			x: number;
			y: number;
			w: number;
			h: number;
			rot: number;
			score: number;
		} | null = null;

		for (const { w: iW, h: iH, rot } of orientations) {
			if (iW > sheetW + 0.001) continue;

			for (const seg of skyline) {
				const startX = seg.x;
				if (startX + iW > sheetW + 0.001) continue;

				const maxY = getMaxY(skyline, startX, iW);
				const placeY = maxY + pad;

				if (placeY + iH > sheetH + 0.001) continue;

				// Prefer lowest y, break ties by leftmost x
				const score = placeY * 1e6 + startX;
				if (best === null || score < best.score) {
					best = { x: startX, y: placeY, w: iW, h: iH, rot, score };
				}
			}
		}

		if (best) {
			placed.push({
				...item,
				x: best.x,
				y: best.y,
				width: best.w,
				height: best.h,
				rotation: best.rot, // absolute rotation of the original pattern
				outOfBounds: false,
			});
			skyline = updateSkyline(
				skyline,
				best.x,
				best.w + pad,
				best.y + best.h,
				sheetW,
			);
		} else {
			// Stage overflowing items below the roll boundary (y > sheetH)
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

	const byId = new Map(placed.map((r) => [r.id, r]));
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
// Optionally accepts the pattern's SVG path for tight polygon bbox;
// falls back to rectangular nominal bbox when omitted.
export function findNextPosition(
	existingItems: CanvasItem[],
	sheet: MaterialSheet,
	itemW: number,
	itemH: number,
	svgPath = "",
): PlacementResult {
	const pad = PADDING_INCHES;
	const sheetW = sheet.widthInches;
	const sheetH = sheet.heightInches;

	const pts = svgPath
		? samplePathInchPoints(svgPath, itemW, itemH)
		: [
				{ x: 0, y: 0 },
				{ x: itemW, y: 0 },
				{ x: itemW, y: itemH },
				{ x: 0, y: itemH },
			];

	const seen = new Set<string>();
	const orientations: Array<{ w: number; h: number; rot: number }> = [];

	for (const rot of [0, 90, 180, 270]) {
		const bbox = tightBboxAtRotation(pts, itemW, itemH, rot);
		const key = `${bbox.w.toFixed(3)},${bbox.h.toFixed(3)}`;
		if (!seen.has(key) && bbox.w <= sheetW + 0.001) {
			seen.add(key);
			orientations.push({ w: bbox.w, h: bbox.h, rot });
		}
	}

	if (orientations.length === 0) {
		return {
			x: sheetW + pad,
			y: pad,
			width: itemW,
			height: itemH,
			rotation: 0,
			outOfBounds: true,
		};
	}

	if (!existingItems.length) {
		const { w, h, rot } = orientations[0];
		return { x: pad, y: pad, width: w, height: h, rotation: rot, outOfBounds: false };
	}

	// Group in-bounds items into horizontal shelves by overlapping y-ranges
	const shelves: Array<{ yTop: number; yBot: number; xRight: number }> = [];

	for (const item of existingItems.filter((i) => !i.outOfBounds)) {
		const top = item.y;
		const bot = item.y + item.height;
		const right = item.x + item.width;

		let merged = false;
		for (const shelf of shelves) {
			if (top < shelf.yBot && bot > shelf.yTop) {
				shelf.yTop = Math.min(shelf.yTop, top);
				shelf.yBot = Math.max(shelf.yBot, bot);
				shelf.xRight = Math.max(shelf.xRight, right);
				merged = true;
				break;
			}
		}
		if (!merged) {
			shelves.push({ yTop: top, yBot: bot, xRight: right });
		}
	}

	shelves.sort((a, b) => a.yTop - b.yTop);

	// Try appending to the right of an existing shelf
	for (const { w, h, rot } of orientations) {
		for (const shelf of shelves) {
			const x = shelf.xRight + pad;
			if (x + w <= sheetW + 0.01 && shelf.yTop + h <= sheetH + 0.01) {
				return { x, y: shelf.yTop, width: w, height: h, rotation: rot, outOfBounds: false };
			}
		}
	}

	// Open a new row below all existing content
	const lowestBot = shelves.length
		? Math.max(...shelves.map((s) => s.yBot))
		: 0;
	const newY = lowestBot + pad;

	for (const { w, h, rot } of orientations) {
		if (newY + h <= sheetH + 0.01) {
			return { x: pad, y: newY, width: w, height: h, rotation: rot, outOfBounds: false };
		}
	}

	// Doesn't fit — stage to the right of the sheet
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
			const a = items[i];
			const b = items[j];
			if (
				a.x < b.x + b.width &&
				a.x + a.width > b.x &&
				a.y < b.y + b.height &&
				a.y + a.height > b.y
			) {
				overlaps.push([a.id, b.id]);
			}
		}
	}
	return overlaps;
}
