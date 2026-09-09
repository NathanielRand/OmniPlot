import { describe, it, expect } from 'vitest';
import type { CanvasItem, MaterialSheet, Pattern } from '$lib/types';
import {
	detectComplementaryPairs,
	getBoundingBox, findOverlaps,
	samplePolygonArea, getSvgPathBBox,
	smartNest, findNextPosition,
	finalDeclash, bestNest,
} from './nesting';

// ─── Fixtures ─────────────────────────────────

const sheet: MaterialSheet = {
	id: 'sheet', name: '60" Roll', widthInches: 60, heightInches: 1200,
	manufacturer: 'Test', sku: 'T',
};

function makePattern(id: string, w: number, h: number, zone = 'hood', vehicleId = 'v1'): Pattern {
	return {
		id, vehicleId, category: 'ppf', zone: zone as Pattern['zone'],
		name: `Pattern ${id}`, coverage: 'full',
		svgPath: 'M 0 0 L 100 0 L 100 100 L 0 100 Z',
		widthInches: w, heightInches: h,
		revision: '2024-01', isPublished: true,
		createdAt: new Date(), updatedAt: new Date(),
	};
}

function makeItem(id: string, pattern: Pattern, overrides: Partial<CanvasItem> = {}): CanvasItem {
	return {
		id, patternId: pattern.id, pattern,
		x: 0, y: 0, width: pattern.widthInches, height: pattern.heightInches,
		rotation: 0, flippedH: false, flippedV: false,
		scale: 1, layer: 0, locked: false, color: '#000',
		outOfBounds: false,
		...overrides,
	};
}

// ─── detectComplementaryPairs ─────────────────

describe('detectComplementaryPairs', () => {
	it('returns empty for items without -left/-right zones', () => {
		const items = [
			makeItem('a', makePattern('p1', 10, 5, 'hood')),
			makeItem('b', makePattern('p2', 10, 5, 'roof')),
		];
		expect(detectComplementaryPairs(items)).toHaveLength(0);
	});

	it('detects matching left/right pair', () => {
		const leftPat  = makePattern('pl', 8, 4, 'door-front-left',  'v1');
		const rightPat = makePattern('pr', 8, 4, 'door-front-right', 'v1');
		const items = [makeItem('a', leftPat), makeItem('b', rightPat)];
		const pairs = detectComplementaryPairs(items);
		expect(pairs).toHaveLength(1);
		expect(pairs[0][0].id).toBe('a');
		expect(pairs[0][1].id).toBe('b');
	});

	it('no pair when vehicle IDs differ', () => {
		const l = makePattern('pl', 8, 4, 'fender-front-left',  'v1');
		const r = makePattern('pr', 8, 4, 'fender-front-right', 'v2');
		expect(detectComplementaryPairs([makeItem('a', l), makeItem('b', r)])).toHaveLength(0);
	});

	it('no pair when dimensions differ', () => {
		const l = makePattern('pl', 8, 4, 'rocker-left',  'v1');
		const r = makePattern('pr', 9, 4, 'rocker-right', 'v1'); // width differs
		expect(detectComplementaryPairs([makeItem('a', l), makeItem('b', r)])).toHaveLength(0);
	});

	it('detects multiple independent pairs', () => {
		const pats = [
			makePattern('l1', 8, 4, 'door-front-left',  'v1'),
			makePattern('r1', 8, 4, 'door-front-right', 'v1'),
			makePattern('l2', 6, 3, 'door-rear-left',   'v1'),
			makePattern('r2', 6, 3, 'door-rear-right',  'v1'),
		];
		const items = pats.map((p, i) => makeItem(String(i), p));
		expect(detectComplementaryPairs(items)).toHaveLength(2);
	});
});

// ─── getBoundingBox ───────────────────────────

describe('getBoundingBox', () => {
	it('returns zero rect for empty array', () => {
		expect(getBoundingBox([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
	});

	it('single item returns its own bounds', () => {
		const item = makeItem('a', makePattern('p', 10, 5), { x: 3, y: 7, width: 10, height: 5 });
		const box = getBoundingBox([item]);
		expect(box).toEqual({ x: 3, y: 7, width: 10, height: 5 });
	});

	it('multiple items — enclosing bounds', () => {
		const items = [
			makeItem('a', makePattern('p1', 4, 2), { x: 0, y: 0, width: 4, height: 2 }),
			makeItem('b', makePattern('p2', 3, 3), { x: 5, y: 4, width: 3, height: 3 }),
		];
		const box = getBoundingBox(items);
		expect(box.x).toBe(0);
		expect(box.y).toBe(0);
		expect(box.width).toBe(8);  // max(0+4, 5+3) - 0 = 8
		expect(box.height).toBe(7); // max(0+2, 4+3) - 0 = 7
	});
});

// ─── findOverlaps ─────────────────────────────

describe('findOverlaps', () => {
	it('no overlaps for non-touching items', () => {
		const items = [
			makeItem('a', makePattern('p1', 4, 2), { x: 0, y: 0, width: 4, height: 2 }),
			makeItem('b', makePattern('p2', 4, 2), { x: 5, y: 0, width: 4, height: 2 }),
		];
		expect(findOverlaps(items)).toHaveLength(0);
	});

	it('detects overlapping items', () => {
		const items = [
			makeItem('a', makePattern('p1', 5, 5), { x: 0, y: 0, width: 5, height: 5 }),
			makeItem('b', makePattern('p2', 5, 5), { x: 3, y: 3, width: 5, height: 5 }),
		];
		const overlaps = findOverlaps(items);
		expect(overlaps).toHaveLength(1);
		expect(overlaps[0]).toContain('a');
		expect(overlaps[0]).toContain('b');
	});

	it('returns empty for single item', () => {
		expect(findOverlaps([makeItem('a', makePattern('p', 5, 5))])).toHaveLength(0);
	});
});

// ─── samplePolygonArea (node fallback → rectangle) ──

describe('samplePolygonArea', () => {
	it('returns area of bounding rectangle in node env', () => {
		// Falls back to rectPoints(w, h) — shoelace area of 10×5 rect = 50
		const area = samplePolygonArea('M 0 0 L 100 0 L 100 100 L 0 100 Z', 10, 5);
		expect(area).toBeCloseTo(50);
	});
	it('scales proportionally with dimensions', () => {
		const a1 = samplePolygonArea('M 0 0 L 100 0 L 100 100 L 0 100 Z', 2, 3);
		const a2 = samplePolygonArea('M 0 0 L 100 0 L 100 100 L 0 100 Z', 4, 3);
		expect(a2).toBeCloseTo(a1 * 2);
	});
});

// ─── getSvgPathBBox (node fallback) ──────────

describe('getSvgPathBBox', () => {
	it('returns fallback {x:0,y:0,w:100,h:100} in node env', () => {
		const bbox = getSvgPathBBox('M 0 0 L 100 0 L 100 100 L 0 100 Z');
		expect(bbox).toEqual({ x: 0, y: 0, w: 100, h: 100 });
	});
});

// ─── bestNest ─────────────────────────────────

describe('bestNest', () => {
	it('returns empty array for empty input', () => {
		expect(bestNest([], sheet)).toHaveLength(0);
	});

	it('returns same number of items as input', () => {
		const items = [
			makeItem('a', makePattern('p1', 10, 5)),
			makeItem('b', makePattern('p2', 8, 4)),
			makeItem('c', makePattern('p3', 6, 3)),
		];
		expect(bestNest(items, sheet)).toHaveLength(3);
	});

	it('preserves all item IDs', () => {
		const items = [
			makeItem('x', makePattern('p1', 10, 5)),
			makeItem('y', makePattern('p2', 8, 4)),
		];
		const result = bestNest(items, sheet);
		const ids = result.map(i => i.id).sort();
		expect(ids).toEqual(['x', 'y']);
	});

	it('in-bounds items stay within sheet dimensions', () => {
		const items = Array.from({ length: 5 }, (_, i) =>
			makeItem(String(i), makePattern(`p${i}`, 10, 5))
		);
		for (const item of bestNest(items, sheet).filter(i => !i.outOfBounds)) {
			expect(item.x).toBeGreaterThanOrEqual(0);
			expect(item.y).toBeGreaterThanOrEqual(0);
			expect(item.x + item.width).toBeLessThanOrEqual(sheet.widthInches + 0.1);
			expect(item.y + item.height).toBeLessThanOrEqual(sheet.heightInches + 0.1);
		}
	});

	it('single item is placed in bounds on large sheet', () => {
		const items = [makeItem('a', makePattern('p1', 10, 5))];
		const [result] = bestNest(items, sheet);
		expect(result.outOfBounds).toBeFalsy();
	});

	it('square item too large for sheet is marked outOfBounds', () => {
		// A square item (10×10) can't fit at any rotation on a 5"-wide sheet
		const narrowSheet: MaterialSheet = { ...sheet, widthInches: 5 };
		const items = [makeItem('a', makePattern('p', 10, 10))];
		const [result] = bestNest(items, narrowSheet);
		expect(result.outOfBounds).toBe(true);
	});
});

// ─── smartNest ────────────────────────────────

describe('smartNest', () => {
	it('returns empty result for empty input', () => {
		const r = smartNest([], sheet);
		expect(r.items).toHaveLength(0);
		expect(r.improvementPct).toBe(0);
		expect(r.trialsRun).toBe(0);
	});

	it('returns all items', () => {
		const items = [
			makeItem('a', makePattern('p1', 10, 5)),
			makeItem('b', makePattern('p2', 8, 3)),
		];
		expect(smartNest(items, sheet).items).toHaveLength(2);
	});

	it('improvementPct is non-negative', () => {
		const items = [
			makeItem('a', makePattern('p1', 10, 5)),
			makeItem('b', makePattern('p2', 8, 4)),
		];
		expect(smartNest(items, sheet).improvementPct).toBeGreaterThanOrEqual(0);
	});

	it('trialsRun is positive for non-empty input', () => {
		const items = [makeItem('a', makePattern('p1', 10, 5))];
		expect(smartNest(items, sheet).trialsRun).toBeGreaterThan(0);
	});

	it('in-bounds items fit within sheet', () => {
		const items = Array.from({ length: 4 }, (_, i) =>
			makeItem(String(i), makePattern(`p${i}`, 12, 6))
		);
		for (const item of smartNest(items, sheet).items.filter(i => !i.outOfBounds)) {
			expect(item.x + item.width).toBeLessThanOrEqual(sheet.widthInches + 0.1);
			expect(item.y + item.height).toBeLessThanOrEqual(sheet.heightInches + 0.1);
		}
	});
});

// ─── findNextPosition ─────────────────────────

describe('findNextPosition', () => {
	it('places first item at pad offset with no existing items', () => {
		const pos = findNextPosition([], sheet, 10, 5);
		expect(pos.outOfBounds).toBe(false);
		expect(pos.x).toBeGreaterThanOrEqual(0);
		expect(pos.y).toBeGreaterThanOrEqual(0);
	});

	it('marks out-of-bounds when square item is too large for sheet', () => {
		// Square 10×10 can't fit at any rotation on a 5"-wide sheet
		const pos = findNextPosition([], { ...sheet, widthInches: 5 }, 10, 10);
		expect(pos.outOfBounds).toBe(true);
	});

	it('returns valid dimensions', () => {
		const pos = findNextPosition([], sheet, 10, 5);
		expect(pos.width).toBeGreaterThan(0);
		expect(pos.height).toBeGreaterThan(0);
	});
});

// ─── Row-balance regression (6 identical windows, 60" roll) ──
// Reproduces the exact live-app scenario: 6 copies of a 34.11×24.14 window
// pattern on a 60"-wide roll. A symmetric 3-portrait/3-landscape split
// (bestFitPack's greedy default) uses 102.43" of roll; the true optimum is
// an unbalanced 4-portrait/2-landscape split at 96.71" — about 6" shorter.
// This is the case that motivated rowBalanceGroupPass: single-item rotation
// swaps (rotationImprovementPass) can't discover it because repacking after
// one flip just re-converges on the same greedy symmetric split.
// ─── finalDeclash: width-axis (roll-width) overflow ──
// Regression for a live bug: a mis-sized/mis-rotated shape from an upstream
// packer stage could end up with y + height past the 60"-wide roll without
// ever being marked outOfBounds — finalDeclash, the supposed final
// correctness backstop, only ever checked the length axis (x), so it let
// that item through untouched and it rendered fully opaque outside the
// dashed cut-zone boundary. This reproduces that shape directly (no need
// to go through a real packer / real SVG sampling) and asserts the backstop
// now catches it.
describe('finalDeclash catches width-axis (roll-width) overflow', () => {
	it('flags an item whose y + height exceeds rollWidth, even if outOfBounds was never set upstream', () => {
		const rollWidth = 60;
		const maxLength = 1200;
		const pad = 0.05;
		const pat = makePattern('circle', 10, 10);
		// Placed near the top-right — y + height (55 + 10 = 65) overflows the
		// 60"-wide roll, but outOfBounds is (incorrectly, as an upstream bug
		// would leave it) still false.
		const badItem = makeItem('circle-1', pat, { x: 50, y: 55, width: 10, height: 10, outOfBounds: false });
		const goodItem = makeItem('window-1', makePattern('window', 34.11, 24.14), { x: 0, y: 0, width: 34.11, height: 24.14 });

		const result = finalDeclash([goodItem, badItem], maxLength, rollWidth, pad);
		const fixedBad = result.find((i) => i.id === 'circle-1')!;

		expect(fixedBad.outOfBounds).toBe(true);
		// Relocated into the excluded strip past the roll-width edge, not
		// left sitting at its original out-of-bounds position.
		expect(fixedBad.y).toBeGreaterThanOrEqual(rollWidth);
	});

	it('leaves an in-bounds item untouched (no false positives)', () => {
		const rollWidth = 60;
		const maxLength = 1200;
		const pad = 0.05;
		const item = makeItem('a', makePattern('window', 34.11, 24.14), { x: 0, y: 0, width: 34.11, height: 24.14 });
		const result = finalDeclash([item], maxLength, rollWidth, pad);
		expect(result[0].outOfBounds).toBe(false);
	});
});

// ─── gapFillPass: interior-void rescue ────────
// Reproduces the exact live scenario: two columns of different length leave
// a rectangular void where the shorter column ends early, and a small
// trailing item sits appended past BOTH columns instead of dropped into
// that void. Every packer upstream of gapFillPass is a shelf/band packer
// that can't represent an interior void at all — this is the one pass that
// explicitly searches for it.
describe('bestNest fills interior voids (black-box, v2 raster + ruin-recreate)', () => {
	it('does not leave a trailing item stranded past a void it could fit into', () => {
		const sheet: MaterialSheet = { id: 's', name: 'roll', widthInches: 1200, heightInches: 60, manufacturer: 'T', sku: 'T' };
		const col = (w: number, h: number) => makePattern('col', w, h);

		const items: CanvasItem[] = [
			makeItem('a1', col(30, 30)),
			makeItem('a2', col(30, 30)),
			makeItem('b1', col(30, 30)),
			makeItem('b2', col(30, 30)),
			makeItem('b3', col(30, 30)),
			makeItem('small', col(20, 20)),
		];

		const result = bestNest(items, sheet, true, 0.05);
		expect(result.every((i) => !i.outOfBounds)).toBe(true);
		expect(findOverlaps(result)).toHaveLength(0);
	});
});

// ─── rowBalanceGroupPass: true width bound, not the length axis ──
// Regression for a latent bug: the row-height budget check read
// sheet.widthInches (the ~1200"-long, effectively unbounded length axis)
// instead of sheet.heightInches (the real, tightly-bounded ~60" width) —
// so it never actually rejected a split whose row heights summed past the
// true roll width. For same-footprint groups where every "mixed" split has
// an IDENTICAL row-height sum (long+pad+short+pad, regardless of the n1/n2
// counts), the raw "minimize length" search would happily pick a mixed
// split with a shorter apparent length even when that row-height sum
// exceeds the roll — an unfittable result that only got caught later, by
// accident, when finalDeclash's own (separately fixed) width check
// discarded it outright.
describe('bestNest never violates the true roll width for same-footprint groups', () => {
	it('keeps every item within the 60"-wide roll even when no split fits crosswise+along mixed', () => {
		// long=50, short=25: every mixed split (n1>0 AND n2>0) sums to a row
		// height of 50+25+2*pad, which exceeds a 60"-wide roll no matter how
		// the 4 items are divided between orientations. Only "pure" splits fit.
		const rollWidth = 60;
		const sheet: MaterialSheet = { id: 's', name: 'roll', widthInches: 1200, heightInches: rollWidth, manufacturer: 'T', sku: 'T' };
		const pat = makePattern('panel', 50, 25);
		const items = Array.from({ length: 4 }, (_, i) => makeItem(`p${i}`, pat));

		const result = bestNest(items, sheet, true, 0.05);
		expect(result.every((i) => !i.outOfBounds)).toBe(true);
		for (const item of result) {
			expect(item.y + item.height).toBeLessThanOrEqual(rollWidth + 0.01);
		}
	});
});

describe('smartNest row-balance (same-footprint group rebalance)', () => {
	it('finds the unbalanced split that beats the greedy symmetric one', () => {
		// Nesting internally treats widthInches as the (loosely-bounded) length
		// axis and heightInches as the tightly-bounded 60" cross-width — this is
		// the "transposed" sheet the studio passes in for real. See
		// transposedSheet() in +page.svelte.
		const transposedSheet: MaterialSheet = { ...sheet, widthInches: 1200, heightInches: 60 };
		const pat = makePattern('window', 34.11, 24.14);
		const items = Array.from({ length: 6 }, (_, i) => makeItem(`w${i}`, pat));
		const result = smartNest(items, transposedSheet, true, 0.05);

		expect(result.items.every((i) => !i.outOfBounds)).toBe(true);
		const len = Math.max(...result.items.map((i) => i.x + i.width));
		// v1's dedicated row-balance pass topped out at 96.71" (rectangle-row
		// math only); v2's raster placer can interlock more finely than a pure
		// row split, so beating that further here is a good sign, not a bug.
		expect(len).toBeLessThan(97); // was 102.43 with no rebalancing at all
	});
});

describe('bestNest: rowBalanceGroupPass must not strand items out of bounds', () => {
	it('does not let a shorter row-balanced repack push another item into overflow', () => {
		// rowBalanceGroupPass repacks same-footprint items into rectangle rows
		// purely by bounding box (ignoring true polygon shape/interlock) and
		// can spend width axis it doesn't own. This regresses layoutLen (the
		// length axis) while leaving no width for other items — which
		// bestNest's length-only comparison used to accept anyway. Two
		// same-size tapered window shapes plus a small circle reproduces it:
		// nfpNest alone places all 3 in-bounds, but rowBalanceGroupPass used
		// to shorten the layout by consuming the roll width, bumping the
		// circle into the overflow bin.
		const sheet: MaterialSheet = {
			id: 's', name: '60in Roll', widthInches: 1200, heightInches: 60,
			manufacturer: 'T', sku: 'T',
		};
		const pat = (id: string, w: number, h: number, svgPath: string): Pattern => ({
			id, vehicleId: 'v1', category: 'ppf', zone: 'hood' as Pattern['zone'],
			name: id, coverage: 'full', svgPath, widthInches: w, heightInches: h,
			revision: '1', isPublished: true, createdAt: new Date(), updatedAt: new Date(),
		});
		const taperBR = 'M 0 0 L 26 0 L 26 20 L 13 30 L 0 25 Z';
		const taperTL = 'M 13 0 L 26 5 L 26 30 L 0 30 L 0 10 Z';
		const pTop = pat('top', 26, 30, taperBR);
		const pBot = pat('bot', 26, 30, taperTL);
		const pCircle = pat('circ', 5, 5, 'M 2.5 0 A 2.5 2.5 0 1 1 2.5 5 A 2.5 2.5 0 1 1 2.5 0 Z');
		const items: CanvasItem[] = [
			makeItem('top', pTop, { x: 0, y: 0 }),
			makeItem('bot', pBot, { x: 0, y: 30.2 }),
			makeItem('circle', pCircle, { x: 200, y: 0 }),
		];

		const result = bestNest(items, sheet, true, 0.5);
		expect(result.every((i) => !i.outOfBounds)).toBe(true);
	});
});

// ─── Sheet-edge clearance ─────────────────────
// Regression for a live bug: every packer in this file enforces PAD between
// ITEMS but happily placed a piece flush against x=0 or the rollWidth edges
// — the buffer was never applied against the sheet's own physical boundary,
// so a shape (a near-circular custom pattern in the reported case) could
// render touching or crossing the dashed cut-zone line. bestNest/smartNest
// now shrink the roll width they pack into by the buffer on both sides and
// shift the finished layout outward by the same amount (shrinkForEdgeMargin
// / applyEdgeMargin) — a uniform translation, so it can't introduce new
// item-to-item collisions the way a per-item post-hoc nudge did the first
// time this was attempted (see git history: it ate into an already-correct
// inter-row gap and produced an unresolvable collision).
describe('sheet-edge clearance', () => {
	function circlePath(): string {
		const cx = 20, cy = 20, r = 20;
		const pts: string[] = [];
		for (let i = 0; i <= 64; i++) {
			const a = (i / 64) * Math.PI * 2;
			pts.push(`${(cx + r * Math.cos(a)).toFixed(3)},${(cy + r * Math.sin(a)).toFixed(3)}`);
		}
		return `M ${pts.join(' L ')} Z`;
	}

	it('keeps a lone circle off the sheet edges by the configured buffer', () => {
		const pattern: Pattern = {
			...makePattern('circle', 40, 40),
			svgPath: circlePath(),
		};
		const item = makeItem('c1', pattern);
		const bufferInches = 0.05;
		const [placed] = bestNest([item], sheet, true, bufferInches);
		expect(placed.outOfBounds).toBe(false);
		expect(placed.x).toBeGreaterThanOrEqual(bufferInches - 0.01);
		expect(placed.y).toBeGreaterThanOrEqual(bufferInches - 0.01);
		expect(placed.y + placed.height).toBeLessThanOrEqual(sheet.heightInches - bufferInches + 0.01);
	});

	it('still finds the unbalanced row-split optimum with edge margin applied (no cascading collision)', () => {
		const pat = makePattern('window', 34.11, 24.14);
		const items = Array.from({ length: 6 }, (_, i) => makeItem(`w${i}`, pat));
		const result = smartNest(items, sheet, true, 0.05);

		expect(result.items.every((i) => !i.outOfBounds)).toBe(true);
		for (const it of result.items) {
			expect(it.x).toBeGreaterThanOrEqual(0.05 - 0.01);
			expect(it.y).toBeGreaterThanOrEqual(0.05 - 0.01);
			expect(it.y + it.height).toBeLessThanOrEqual(sheet.heightInches - 0.05 + 0.01);
		}
		const len = Math.max(...result.items.map((i) => i.x + i.width));
		expect(len).toBeLessThan(97.2); // ~96.71 optimum + margin, still far from the 102.43 greedy baseline
	});
});
