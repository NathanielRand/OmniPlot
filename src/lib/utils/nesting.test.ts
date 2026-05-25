import { describe, it, expect } from 'vitest';
import type { CanvasItem, MaterialSheet, Pattern } from '$lib/types';
import {
	detectComplementaryPairs,
	getBoundingBox, findOverlaps,
	samplePolygonArea, getSvgPathBBox,
	autoNest, smartNest, findNextPosition,
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
