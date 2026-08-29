import { describe, it, expect } from 'vitest';
import type { CanvasItem, CanvasState, MaterialSheet, PlotterConfig } from '$lib/types';
import {
	generateHpgl, generateSvg, generateDxf,
	calcEfficiency, estimateCutTime,
} from './hpgl';

// ─── Fixtures ─────────────────────────────────

const sheet: MaterialSheet = {
	id: 'sheet-1', name: 'Test 60"', widthInches: 60, heightInches: 1200,
	manufacturer: 'Test', sku: 'T-60',
};

function makeItem(overrides: Partial<CanvasItem> = {}): CanvasItem {
	return {
		id: 'item-1',
		patternId: 'pat-1',
		pattern: {
			id: 'pat-1', vehicleId: 'v1', category: 'ppf', zone: 'hood',
			name: 'Test Hood', coverage: 'full',
			svgPath: 'M 0 0 L 100 0 L 100 100 L 0 100 Z',
			widthInches: 2, heightInches: 1,
			revision: '2024-01', isPublished: true,
			createdAt: new Date(), updatedAt: new Date(),
		},
		x: 0, y: 0, width: 2, height: 1,
		rotation: 0, flippedH: false, flippedV: false,
		scale: 1, layer: 0, locked: false, color: '#000000',
		outOfBounds: false,
		...overrides,
	};
}

const baseConfig: PlotterConfig = {
	id: 'cfg-1', name: 'Test Plotter', manufacturer: 'Generic', model: 'HPGL',
	protocol: 'hpgl', connection: 'download',
	bladeForce: 65, cuttingSpeed: 400, passes: 1,
	overcut: 0, offsetBlade: 0,
	mediaWidthMm: 1524, maxMediaWidthMm: 1524, originX: 0, originY: 0,
	flipH: false, flipV: false,
};

function makeState(items: CanvasItem[] = [makeItem()]): CanvasState {
	return {
		items, sheet,
		selectedIds: [], zoom: 100, panX: 0, panY: 0,
		tool: 'select', showGrid: true, showRulers: true,
		snapToGrid: false, gridSizeInches: 0.5,
	};
}

// ─── calcEfficiency ────────────────────────────

describe('calcEfficiency', () => {
	it('returns 0 for no items', () => {
		expect(calcEfficiency([], sheet)).toBe(0);
	});
	it('returns 0 when all items are out of bounds', () => {
		const item = makeItem({ outOfBounds: true });
		expect(calcEfficiency([item], sheet)).toBe(0);
	});
	it('50% efficiency: rectangular item occupies half the consumed area', () => {
		// Rectangular SVG path → polygon area == bbox area == 2"×1" = 2 sq in.
		// narrowSheet width=2": denominator = 2 * usedLen(2) = 4. eff = 2/4 = 0.5.
		const narrowSheet: MaterialSheet = { ...sheet, widthInches: 2 };
		const item = makeItem({ width: 2, height: 1 });
		const eff = calcEfficiency([item], narrowSheet);
		expect(eff).toBeCloseTo(0.5);
	});
	it('capped at 1', () => {
		const item = makeItem({ width: 60, height: 1200 });
		expect(calcEfficiency([item], sheet)).toBeLessThanOrEqual(1);
	});
	it('larger items produce higher efficiency than smaller ones in same used length', () => {
		const big = makeItem({ id: 'big', width: 10, height: 5, x: 0 });
		const small = makeItem({ id: 'small', width: 10, height: 1, x: 0 });
		expect(calcEfficiency([big], sheet)).toBeGreaterThan(calcEfficiency([small], sheet));
	});
});

// ─── estimateCutTime ──────────────────────────

describe('estimateCutTime', () => {
	it('returns 0 for no items', () => {
		expect(estimateCutTime([], 500)).toBe(0);
	});
	it('returns 0 for all out-of-bounds items', () => {
		expect(estimateCutTime([makeItem({ outOfBounds: true })], 500)).toBe(0);
	});
	it('higher speed → less time', () => {
		const items = [makeItem()];
		expect(estimateCutTime(items, 1000)).toBeLessThan(estimateCutTime(items, 100));
	});
	it('more items → more time', () => {
		const one = [makeItem()];
		const two = [makeItem({ id: 'a' }), makeItem({ id: 'b' })];
		expect(estimateCutTime(two, 500)).toBeGreaterThan(estimateCutTime(one, 500));
	});
	it('returns integer seconds', () => {
		const t = estimateCutTime([makeItem()], 500);
		expect(Number.isInteger(t)).toBe(true);
	});
});

// ─── generateSvg ──────────────────────────────

describe('generateSvg', () => {
	it('returns minimal SVG for empty canvas', () => {
		const svg = generateSvg(makeState([]));
		expect(svg).toContain('<svg');
		expect(svg).toContain('width="0"');
	});
	it('includes svg and path elements for in-bounds items', () => {
		const svg = generateSvg(makeState());
		expect(svg).toContain('<svg');
		expect(svg).toContain('<path');
	});
	it('excludes out-of-bounds items', () => {
		const oob = makeItem({ outOfBounds: true });
		const svg = generateSvg(makeState([oob]));
		expect(svg).not.toContain('<path');
	});
	it('contains dimensions in mm', () => {
		const svg = generateSvg(makeState());
		expect(svg).toMatch(/width="[\d.]+mm"/);
		expect(svg).toMatch(/height="[\d.]+mm"/);
	});
	it('contains pattern name in comment', () => {
		const svg = generateSvg(makeState());
		expect(svg).toContain('Test Hood');
	});
	it('contains OmniPlot attribution comment', () => {
		const svg = generateSvg(makeState());
		expect(svg).toContain('OmniPlot');
	});
});

// ─── generateHpgl ─────────────────────────────
// DOM is unavailable in node env → sampleSvgPath falls back to rectPoints.

describe('generateHpgl', () => {
	it('contains HPGL initialization sequence', () => {
		const hpgl = generateHpgl(makeState(), baseConfig);
		expect(hpgl).toContain('IN;');
		expect(hpgl).toContain('SP1;');
		expect(hpgl).toContain('PA;');
	});
	it('contains speed command VS for hpgl protocol', () => {
		// baseConfig.cuttingSpeed = 400 mm/s; HPGL VS is in cm/s → 400/10 = 40
		const hpgl = generateHpgl(makeState(), baseConfig);
		expect(hpgl).toContain('VS40;');
	});
	it('contains force command FS for generic hpgl', () => {
		const hpgl = generateHpgl(makeState(), baseConfig);
		expect(hpgl).toContain('FS65;');
	});
	it('uses FC for hpgl2 protocol', () => {
		const cfg: PlotterConfig = { ...baseConfig, protocol: 'hpgl2', bladeForce: 80 };
		const hpgl = generateHpgl(makeState(), cfg);
		expect(hpgl).toContain('FC');
		expect(hpgl).not.toContain('FS');
	});
	it('no force command for gpgl protocol', () => {
		const cfg: PlotterConfig = { ...baseConfig, protocol: 'gpgl' };
		const hpgl = generateHpgl(makeState(), cfg);
		expect(hpgl).not.toContain('FS');
	});
	it('contains pen up/down commands', () => {
		const hpgl = generateHpgl(makeState(), baseConfig);
		expect(hpgl).toContain('PU');
		expect(hpgl).toContain('PD');
	});
	it('ends with park and reset commands', () => {
		const hpgl = generateHpgl(makeState(), baseConfig);
		expect(hpgl).toContain('PU0,0;');
		expect(hpgl).toContain('SP0;');
	});
	it('excludes out-of-bounds items from output', () => {
		const oob = makeItem({ outOfBounds: true });
		const hpgl = generateHpgl(makeState([oob]), baseConfig);
		expect(hpgl).not.toContain('PD');
	});
	it('origin offset adds IP command', () => {
		const cfg: PlotterConfig = { ...baseConfig, originX: 1, originY: 0 };
		const hpgl = generateHpgl(makeState(), cfg);
		expect(hpgl).toContain('IP');
	});
	it('coordinates scale to 1016 plotter units/inch', () => {
		// item width=2" → rightmost point at x=2 → 2*1016=2032 units
		const hpgl = generateHpgl(makeState(), baseConfig);
		expect(hpgl).toContain('2032');
	});
});

// ─── generateDxf ──────────────────────────────

describe('generateDxf', () => {
	it('contains DXF header', () => {
		const dxf = generateDxf(makeState());
		expect(dxf).toContain('AC1015');   // R2000
		expect(dxf).toContain('INSUNITS');
	});
	it('contains ENTITIES section', () => {
		const dxf = generateDxf(makeState());
		expect(dxf).toContain('ENTITIES');
		expect(dxf).toContain('LWPOLYLINE');
	});
	it('ends with EOF', () => {
		const dxf = generateDxf(makeState());
		expect(dxf.trim().endsWith('EOF')).toBe(true);
	});
	it('empty canvas produces no LWPOLYLINE', () => {
		const dxf = generateDxf(makeState([]));
		expect(dxf).not.toContain('LWPOLYLINE');
	});
	it('coordinates are in mm (1 inch = 25.4mm)', () => {
		// item width=2" → x of rightmost point = 2" = 50.8mm
		const dxf = generateDxf(makeState());
		expect(dxf).toContain('50.8');
	});
});

