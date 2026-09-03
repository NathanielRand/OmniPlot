import { describe, it, expect } from 'vitest';
import type { CanvasItem, MaterialSheet, Pattern } from '$lib/types';
import {
	detectComplementaryPairs,
	getBoundingBox, findOverlaps,
	samplePolygonArea, getSvgPathBBox,
	autoNest, smartNest, findNextPosition,
	finalDeclash, gapFillPass, rowBalanceGroupPass,
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

// ─── autoNest ─────────────────────────────────

describe('autoNest', () => {
	it('returns empty array for empty input', () => {
		expect(autoNest([], sheet)).toHaveLength(0);
	});

	it('returns same number of items as input', () => {
		const items = [
			makeItem('a', makePattern('p1', 10, 5)),
			makeItem('b', makePattern('p2', 8, 4)),
			makeItem('c', makePattern('p3', 6, 3)),
		];
		expect(autoNest(items, sheet)).toHaveLength(3);
	});

	it('preserves all item IDs', () => {
		const items = [
			makeItem('x', makePattern('p1', 10, 5)),
			makeItem('y', makePattern('p2', 8, 4)),
		];
		const result = autoNest(items, sheet);
		const ids = result.map(i => i.id).sort();
		expect(ids).toEqual(['x', 'y']);
	});

	it('in-bounds items stay within sheet dimensions', () => {
		const items = Array.from({ length: 5 }, (_, i) =>
			makeItem(String(i), makePattern(`p${i}`, 10, 5))
		);
		for (const item of autoNest(items, sheet).filter(i => !i.outOfBounds)) {
			expect(item.x).toBeGreaterThanOrEqual(0);
			expect(item.y).toBeGreaterThanOrEqual(0);
			expect(item.x + item.width).toBeLessThanOrEqual(sheet.widthInches + 0.1);
			expect(item.y + item.height).toBeLessThanOrEqual(sheet.heightInches + 0.1);
		}
	});

	it('single item is placed in bounds on large sheet', () => {
		const items = [makeItem('a', makePattern('p1', 10, 5))];
		const [result] = autoNest(items, sheet);
		expect(result.outOfBounds).toBeFalsy();
	});

	it('square item too large for sheet is marked outOfBounds', () => {
		// A square item (10×10) can't fit at any rotation on a 5"-wide sheet
		const narrowSheet: MaterialSheet = { ...sheet, widthInches: 5 };
		const items = [makeItem('a', makePattern('p', 10, 10))];
		const [result] = autoNest(items, narrowSheet);
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
describe('gapFillPass', () => {
	it('pulls a trailing item into an interior void instead of leaving it past the tail', () => {
		const sheet: MaterialSheet = { id: 's', name: 'roll', widthInches: 1200, heightInches: 60, manufacturer: 'T', sku: 'T' };
		const col = (w: number, h: number) => makePattern('col', w, h);

		// Left column (y 0..30): 2 items stacked along length, ends at x=60.
		// Right column (y 30..60): 3 items stacked along length, ends at x=90.
		// This leaves a 30(length) x 30(width) void at x=60..90, y=0..30.
		const items: CanvasItem[] = [
			makeItem('a1', col(30, 30), { x: 0,  y: 0,  width: 30, height: 30 }),
			makeItem('a2', col(30, 30), { x: 30, y: 0,  width: 30, height: 30 }),
			makeItem('b1', col(30, 30), { x: 0,  y: 30, width: 30, height: 30 }),
			makeItem('b2', col(30, 30), { x: 30, y: 30, width: 30, height: 30 }),
			makeItem('b3', col(30, 30), { x: 60, y: 30, width: 30, height: 30 }),
			// Small item, currently appended past everything (x=100) — the
			// "circle placed past the end instead of in the gap" bug.
			makeItem('small', col(20, 20), { x: 100, y: 0, width: 20, height: 20 }),
		];

		const result = gapFillPass(items, sheet, true);
		const small = result.find((i) => i.id === 'small')!;

		// It must have moved into the void, not stayed past the tail.
		expect(small.x + small.width).toBeLessThanOrEqual(90 + 0.01);
		expect(findOverlaps(result)).toHaveLength(0);
	});

	// Regression for a live bug: an item already flagged outOfBounds (by an
	// upstream fallback packer that couldn't find it a spot) was NEVER
	// reconsidered here — both `order` and `others` filtered out
	// outOfBounds items entirely, so a flagged item could sit excluded
	// forever even with a wide-open pocket sitting right next to it.
	it('rescues an outOfBounds item into an open pocket, clearing the flag', () => {
		const rollWidth = 60;
		const sheet: MaterialSheet = { id: 's', name: 'roll', widthInches: 1200, heightInches: rollWidth, manufacturer: 'T', sku: 'T' };
		const win = (w: number, h: number) => makePattern('window', w, h);

		// Two bands, mirroring the live scenario: rot-90 band (y 0..34.1) runs
		// to x=120.86; rot-0 band (y 34.16..58.3) runs to x=136.58. That
		// leaves an open pocket at roughly x=120.91..136.59, y=0..34.16 —
		// about 15.7" wide, 34" tall. A 10x10 custom item, flagged
		// outOfBounds by whatever upstream fallback couldn't find it a spot,
		// should be rescued into that pocket at ZERO added roll length.
		const items: CanvasItem[] = [
			makeItem('r0', win(24.1, 34.1), { x: 0,     y: 0,     width: 24.1, height: 34.1 }),
			makeItem('r1', win(24.1, 34.1), { x: 24.19, y: 0,     width: 24.1, height: 34.1 }),
			makeItem('r2', win(24.1, 34.1), { x: 48.38, y: 0,     width: 24.1, height: 34.1 }),
			makeItem('r3', win(24.1, 34.1), { x: 72.57, y: 0,     width: 24.1, height: 34.1 }),
			makeItem('r4', win(24.1, 34.1), { x: 96.76, y: 0,     width: 24.1, height: 34.1 }),
			makeItem('l0', win(34.1, 24.1), { x: 0,     y: 34.16, width: 34.1, height: 24.1 }),
			makeItem('l1', win(34.1, 24.1), { x: 34.16, y: 34.16, width: 34.1, height: 24.1 }),
			makeItem('l2', win(34.1, 24.1), { x: 68.32, y: 34.16, width: 34.1, height: 24.1 }),
			makeItem('l3', win(34.1, 24.1), { x: 102.48, y: 34.16, width: 34.1, height: 24.1 }),
			makeItem('custom', win(10, 10), {
				x: 0.05, y: rollWidth + 0.05, width: 10, height: 10, outOfBounds: true,
			}),
		];
		const lenBefore = Math.max(...items.filter((i) => !i.outOfBounds).map((i) => i.x + i.width));

		const result = gapFillPass(items, sheet, true);
		const custom = result.find((i) => i.id === 'custom')!;

		expect(custom.outOfBounds).toBe(false);
		expect(findOverlaps(result.filter((i) => !i.outOfBounds))).toHaveLength(0);
		// Rescued at zero (or negligible) added roll length — it fit inside
		// the existing envelope, it didn't get appended past the tail.
		const lenAfter = Math.max(...result.filter((i) => !i.outOfBounds).map((i) => i.x + i.width));
		expect(lenAfter).toBeLessThanOrEqual(lenBefore + 0.5);
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
describe('rowBalanceGroupPass rejects splits that exceed the true roll width', () => {
	it('picks the pure single-orientation split over a shorter-looking but unfittable mixed split', () => {
		// long=50, short=25: every mixed split (n1>0 AND n2>0) sums to a row
		// height of 50+25+2*pad = 75.1", which exceeds a 60"-wide roll no
		// matter how the 4 items are divided between orientations. Only the
		// two "pure" splits (all-crosswise or all-along) actually fit.
		const rollWidth = 60;
		const sheet: MaterialSheet = { id: 's', name: 'roll', widthInches: 1200, heightInches: rollWidth, manufacturer: 'T', sku: 'T' };
		const pat = makePattern('panel', 50, 25);
		const items = Array.from({ length: 4 }, (_, i) => makeItem(`p${i}`, pat));

		const result = rowBalanceGroupPass(items, sheet, true);
		expect(result).not.toBeNull();

		for (const item of result!) {
			expect(item.y + item.height).toBeLessThanOrEqual(rollWidth + 0.01);
		}
		// The best VALID split is n1=4 (all crosswise): length ≈ 100.15".
		// The buggy version would have picked n1=3 (length ≈ 75.10") — a
		// shorter number, but only reachable by violating the width bound.
		const len = Math.max(...result!.map((i) => i.x + i.width));
		expect(len).toBeGreaterThan(99);
		expect(len).toBeLessThan(101);
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
		expect(len).toBeLessThan(97); // was 102.43 before rowBalanceGroupPass
		expect(len).toBeGreaterThan(96); // sanity: shouldn't overshoot the theoretical 96.71 optimum
	});
});
