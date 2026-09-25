// ─────────────────────────────────────────────
// PRECISION MANUFACTURING — pattern fidelity guard.
//
// These tests lock in the rule that a pattern is cut EXACTLY as stored and
// EXACTLY as shown on the studio canvas:
//   • svgPath bbox → exactly widthInches × heightInches (never letterboxed)
//   • HPGL / DXF / SVG output == the canvas outline (itemFootprintPolygons)
//     for every rotation and flip, and stays inside the space the packer
//     reserved for the piece.
// If one of these fails, do NOT loosen the test — a failure here means the
// plotter would cut something other than what the operator approved.
//
// Geometry is pure TypeScript (pathGeometry.ts), so these run on the real
// engine with no DOM.
// ─────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import type { CanvasItem, CanvasState, MaterialSheet, PlotterConfig } from '$lib/types';
import { trueBBoxAt, itemFootprintPolygons, samplePolygonArea, canvasPathAt } from './nesting';
import { generateHpglSegments, generateHpgl, generateDxf, generateSvg } from './hpgl';

type Pt = { x: number; y: number };

// ─── Fixtures ─────────────────────────────────

const sheet: MaterialSheet = {
	id: 's', name: 'Test 60"', widthInches: 60, heightInches: 1200, manufacturer: 'T', sku: 'T',
};
const config: PlotterConfig = {
	id: 'c', name: 'Test', manufacturer: 'Generic', model: 'HPGL', protocol: 'hpgl',
	connection: 'download', bladeForce: 65, cuttingSpeed: 400, passes: 1, overcut: 0,
	offsetBlade: 0, mediaWidthMm: 1524, maxMediaWidthMm: 1524, originX: 0, originY: 0,
	flipH: false, flipV: false,
};

// Asymmetric L — any wrong rotation or mirror changes its outline.
const L_SHAPE = 'M 0 0 L 100 0 L 100 30 L 30 30 L 30 100 L 0 100 Z';

function makeItem(svgPath: string, w: number, h: number, extra: Partial<CanvasItem> = {}): CanvasItem {
	const base: CanvasItem = {
		id: `i-${Math.random()}`, patternId: 'p',
		pattern: {
			id: 'p', vehicleId: 'v', category: 'ppf', zone: 'hood', name: 'P', coverage: 'full',
			svgPath, widthInches: w, heightInches: h, revision: '2026-09', isPublished: true,
			createdAt: new Date(), updatedAt: new Date(),
		},
		x: 0, y: 0, width: w, height: h, rotation: 0, flippedH: false, flippedV: false,
		scale: 1, layer: 0, locked: false, color: '#000', outOfBounds: false,
		...extra,
	};
	// Placed exactly as the packer does it: width/height = true bbox at rotation.
	return { ...base, ...trueBBoxAt(base, base.rotation) };
}

const state = (items: CanvasItem[]): CanvasState => ({
	items, sheet, selectedIds: [], zoom: 100, panX: 0, panY: 0, tool: 'select',
	showGrid: true, showRulers: true, rulerStepInches: 5, snapToGrid: false,
	gridSizeInches: 0.5, bufferInches: 0.05,
});

function hpglPoints(item: CanvasItem): Pt[] {
	const { hpgl } = generateHpglSegments(state([item]), config).segments[0];
	const pts: Pt[] = [];
	for (const [, body] of hpgl.matchAll(/P[UD]([-\d,]+);/g)) {
		const n = body.split(',').map(Number);
		for (let i = 0; i < n.length; i += 2) pts.push({ x: n[i], y: n[i + 1] });
	}
	return pts;
}

// ─── Size & proportion are never altered ──────

describe('pattern geometry is exactly widthInches × heightInches', () => {
	it('square-box catalog path stretches to its stored 60" × 6" (not letterboxed to 6" × 6")', () => {
		const item = makeItem('M 0 0 L 100 0 L 100 100 L 0 100 Z', 60, 6);
		expect(item.width).toBeCloseTo(60, 6);
		expect(item.height).toBeCloseTo(6, 6);
	});

	it('path with margin still maps its bbox edge-to-edge onto the stored size', () => {
		const item = makeItem('M 10 20 L 90 20 L 90 80 L 10 80 Z', 30, 5);
		expect(item.width).toBeCloseTo(30, 6);
		expect(item.height).toBeCloseTo(5, 6);
	});

	it('rotating 90° swaps the footprint, never resizes it', () => {
		const item = makeItem(L_SHAPE, 20, 10, { rotation: 90 });
		expect(item.width).toBeCloseTo(10, 6);
		expect(item.height).toBeCloseTo(20, 6);
	});

	it('area is the true shape area at stored size', () => {
		// L covers 51% of its bbox: (100·30 + 30·70) / 100². Samples don't land
		// exactly on the inner corner, so allow ±0.005 sq in (reporting only).
		expect(samplePolygonArea(L_SHAPE, 20, 10)).toBeCloseTo(0.51 * 200, 2);
	});
});

// ─── What is cut == what is shown ─────────────

const ROTATIONS = [0, 90, 180, 270, 37];
const FLIPS = [
	{ flippedH: false, flippedV: false },
	{ flippedH: true,  flippedV: false },
	{ flippedH: false, flippedV: true  },
	{ flippedH: true,  flippedV: true  },
];

describe('exports cut exactly the canvas outline', () => {
	for (const rotation of ROTATIONS) {
		for (const flip of FLIPS) {
			const tag = `rot ${rotation}° flipH=${flip.flippedH} flipV=${flip.flippedV}`;

			it(`HPGL == canvas outline and stays in reserved box (${tag})`, () => {
				const item = makeItem(L_SHAPE, 20, 10, { rotation, ...flip, x: 5, y: 3 });
				const canvas = itemFootprintPolygons(item).flat()
					.map((p) => ({ x: Math.round(p.x * 1016), y: Math.round(p.y * 1016) }));
				const cut = hpglPoints(item);

				// PU to first point + every PD point — identical sequence to the canvas.
				expect(cut.slice(1)).toEqual(canvas);

				const U = 1016, tol = 1;
				const xs = cut.map((p) => p.x), ys = cut.map((p) => p.y);
				expect(Math.min(...xs)).toBeGreaterThanOrEqual(Math.round(item.x * U) - tol);
				expect(Math.max(...xs)).toBeLessThanOrEqual(Math.round((item.x + item.width) * U) + tol);
				expect(Math.min(...ys)).toBeGreaterThanOrEqual(Math.round(item.y * U) - tol);
				expect(Math.max(...ys)).toBeLessThanOrEqual(Math.round((item.y + item.height) * U) + tol);
			});

			it(`DXF == canvas outline (${tag})`, () => {
				const item = makeItem(L_SHAPE, 20, 10, { rotation, ...flip, x: 5, y: 3 });
				const lines = generateDxf(state([item])).split('\n');
				const dxf: Pt[] = [];
				for (let i = 0; i < lines.length - 3; i++) {
					if (lines[i] === '10' && lines[i + 2] === '20') dxf.push({ x: +lines[i + 1], y: +lines[i + 3] });
				}
				const canvas = itemFootprintPolygons(item).flat()
					.map((p) => ({ x: +(p.x * 25.4).toFixed(4), y: +(p.y * 25.4).toFixed(4) }));
				expect(dxf).toEqual(canvas);
			});
		}
	}

	it('SVG export uses the canvas outline, converted to y-down', () => {
		const item = makeItem(L_SHAPE, 20, 10, { rotation: 90, flippedH: true, x: 5, y: 3 });
		const svg = generateSvg(state([item]));
		expect(svg).not.toContain('transform=');
		const first = itemFootprintPolygons(item)[0][0];
		expect(svg).toContain(`M ${(first.x * 96).toFixed(4)} ${((60 - first.y) * 96).toFixed(4)}`);
	});
});

// ─── Orientation: never mirrored ──────────────
// The model is y-up (plotter/HPGL convention); artwork is y-down (SVG). The
// L's top-right corner in the artwork must be the top-right corner of the cut.
describe('orientation — the cut is the art, never its mirror image', () => {
	it('HPGL (standard y-up) receives the art un-mirrored', () => {
		const item = makeItem(L_SHAPE, 20, 10, { x: 5, y: 3 });
		const pts = hpglPoints(item).map((p) => `${p.x},${p.y}`);
		// art (100,0) = top-right → sheet (5+20, 3+10); art (0,100) = bottom-left → (5, 3)
		expect(pts).toContain(`${25 * 1016},${13 * 1016}`);
		expect(pts).toContain(`${5 * 1016},${3 * 1016}`);
		// the inner corner of the L is at art (30,30) → local (6, 7)
		expect(pts).toContain(`${11 * 1016},${10 * 1016}`);
	});

	it('canvas path at rotation 0 is the uploaded art itself (y-down, same corners)', () => {
		const item = makeItem(L_SHAPE, 20, 10);
		const d = canvasPathAt(item);
		for (const [x, y] of [[0, 0], [20, 0], [20, 3], [6, 3], [6, 10], [0, 10]]) {
			expect(d).toContain(`${x.toFixed(4)} ${y.toFixed(4)}`);
		}
	});

	it('flipV mirrors across the roll width, flipH along the job length', () => {
		const item = makeItem(L_SHAPE, 20, 10, { x: 5, y: 3 });
		const read = (cfg: PlotterConfig) => {
			const out: string[] = [];
			for (const [, body] of generateHpglSegments(state([item]), cfg).segments[0].hpgl.matchAll(/P[UD]([-\d,]+);/g)) {
				const n = body.split(',').map(Number);
				for (let i = 0; i < n.length; i += 2) out.push(`${n[i]},${n[i + 1]}`);
			}
			return out;
		};
		const W = 60, L = 25; // roll width, job length (x + width)
		expect(read({ ...config, flipV: true })).toContain(`${25 * 1016},${Math.round((W - 13) * 1016)}`);
		expect(read({ ...config, flipH: true })).toContain(`${Math.round((L - 25) * 1016)},${13 * 1016}`);
	});

	it('resuming a partial job with flipH cuts each piece in the same place', () => {
		const a = makeItem(L_SHAPE, 20, 10, { id: 'a', x: 1, y: 1 });
		const b = makeItem(L_SHAPE, 20, 10, { id: 'b', x: 30, y: 1 });
		const cfg = { ...config, flipH: true };
		const full = generateHpglSegments(state([a, b]), cfg).segments.find((s) => s.itemId === 'b')!.hpgl;
		const partial = generateHpglSegments({ ...state([b]), jobLengthInches: 50 }, cfg).segments[0].hpgl;
		expect(partial).toBe(full);
	});

	it('overcut never extends an open cut line', () => {
		const open = makeItem('M 0 0 L 100 50', 10, 5); // a single open diagonal cut
		const hpgl = generateHpgl(state([open]), { ...config, overcut: 5 });
		const pd = [...hpgl.matchAll(/PD([-\d,]+);/g)].map((m) => m[1]);
		expect(pd).toEqual([`${10 * 1016},${0}`]); // one stroke, no extra overcut segment
	});
});
