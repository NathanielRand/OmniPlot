// PRECISION MANUFACTURING — packing guard: rotation may only ever SAVE roll,
// pieces (including mirrored ones) never overlap, and sizes never change.
import { describe, it, expect } from 'vitest';
import type { CanvasItem, MaterialSheet } from '$lib/types';
import { bestNest, itemFootprintPolygons } from './nesting';
import { polygonsOverlap } from './polygon';

// Packer frame: widthInches = roll LENGTH (x), heightInches = roll WIDTH (y).
const sheet = { id: 's', name: 'T', widthInches: 1200, heightInches: 60, manufacturer: 'T', sku: 'T' } as MaterialSheet;

function piece(id: string, d: string, w: number, h: number, extra: Partial<CanvasItem> = {}): CanvasItem {
	return {
		id, patternId: id, pattern: { id, vehicleId: 'v', category: 'ppf', zone: 'hood', name: id, coverage: 'full', svgPath: d, widthInches: w, heightInches: h, revision: '', isPublished: true, createdAt: new Date(), updatedAt: new Date() },
		x: 0, y: 0, width: w, height: h, rotation: 0, flippedH: false, flippedV: false, scale: 1, layer: 0, locked: false, color: '#000', outOfBounds: false,
		...extra,
	} as CanvasItem;
}
const used = (items: CanvasItem[]) => Math.max(...items.filter((i) => !i.outOfBounds).map((i) => i.x + i.width));
function overlaps(items: CanvasItem[]): number {
	const ib = items.filter((i) => !i.outOfBounds);
	let n = 0;
	for (let a = 0; a < ib.length; a++) for (let b = a + 1; b < ib.length; b++)
		for (const pa of itemFootprintPolygons(ib[a])) for (const pb of itemFootprintPolygons(ib[b])) if (polygonsOverlap(pa, pb)) n++;
	return n;
}

describe('rotation packing', () => {
	it('uses fine angles when they genuinely save roll (squares drawn as diamonds → 45°)', () => {
		const d = 'M50 0 L100 50 L50 100 L0 50 Z';
		const items = Array.from({ length: 8 }, (_, i) => piece(`d${i}`, d, 14.142, 14.142));
		const right = bestNest(items, sheet, false, 0.25); // no rotation at all
		const res = bestNest(items, sheet, true, 0.25);
		expect(used(res)).toBeLessThan(used(right) * 0.8);
		expect(res.every((i) => i.outOfBounds || i.rotation % 90 === 45)).toBe(true);
		expect(overlaps(res)).toBe(0);
	}, 20000);

	it('never overlaps mirrored pieces (driver/passenger pairs)', () => {
		const L = 'M0 0 L100 0 L100 30 L30 30 L30 100 L0 100 Z';
		const items = Array.from({ length: 10 }, (_, i) => piece(`m${i}`, L, 12, 12, { flippedH: i % 2 === 1, flippedV: i % 3 === 0 }));
		const res = bestNest(items, sheet, true, 0.1);
		expect(res.filter((i) => i.outOfBounds)).toHaveLength(0);
		expect(overlaps(res)).toBe(0);
	}, 20000);

	it('rotation never changes a piece’s stored size', () => {
		const res = bestNest([piece('a', 'M4,90 L19,8 Q55,5 93,6 L95,88 Q50,93 4,90 Z', 26, 22)], sheet, true, 0.25);
		expect(res[0].pattern.widthInches).toBe(26);
		expect(res[0].pattern.heightInches).toBe(22);
	});
});
