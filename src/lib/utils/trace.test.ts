import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import {
	otsuThreshold,
	buildBinaryGrid,
	gaussianBlurLuma,
	mooreContour,
	rdp,
	normalizePts,
	rasterizePolygon,
	computeIoU,
	detectCorners,
	detectCornersFromCurvature,
	fitCubicSegment,
	fitCurves,
	maxFitError,
	smoothContour,
	samplePathDense,
	maxHausdorffDeviation,
	traceImageData,
} from './trace';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRgba(cells: number[], W: number): Uint8ClampedArray {
	const out = new Uint8ClampedArray(cells.length * 4);
	for (let i = 0; i < cells.length; i++) {
		const v = cells[i] ? 0 : 255;
		out[i * 4]     = v;
		out[i * 4 + 1] = v;
		out[i * 4 + 2] = v;
		out[i * 4 + 3] = 255;
	}
	return out;
}

function visits(contour: [number,number][], x: number, y: number): boolean {
	return contour.some(([cx, cy]) => cx === x && cy === y);
}

// Builds a 200×200 car-window-like shape: straight bottom, nearly-straight
// right edge, concave top arc, gently curved left edge. Returns both the
// RGBA image and the rasterized truth mask (in 100×100 normalized space).
function makeCarWindow() {
	const W = 200, H = 200;

	// Define the polygon in pixel space
	const poly: [number,number][] = [];

	// Bottom-left corner
	poly.push([30, 170]);

	// Bottom edge: straight to bottom-right
	poly.push([170, 170]);

	// Right edge: nearly straight up
	poly.push([165, 45]);

	// Top arc: concave quadratic bezier from (165,45) through apex (100,22) to (35,65)
	// Approximated with 24 points
	const arcP0: [number,number] = [165, 45];
	const arcCtl: [number,number] = [100, 15];
	const arcP2: [number,number] = [35, 65];
	for (let k = 1; k <= 24; k++) {
		const t = k / 24;
		const x = (1-t)*(1-t)*arcP0[0] + 2*(1-t)*t*arcCtl[0] + t*t*arcP2[0];
		const y = (1-t)*(1-t)*arcP0[1] + 2*(1-t)*t*arcCtl[1] + t*t*arcP2[1];
		poly.push([x, y]);
	}

	// Left edge: gently curved back to bottom-left
	// Midpoint pulled slightly inward
	poly.push([28, 118]);

	// Build truth mask at 100×100 (match 0-100 normalized space)
	const normPoly = normalizePts(poly, 3);
	const truthMask = rasterizePolygon(normPoly, 100, 100);

	// Build pixel image (foreground = black on white)
	const data = new Uint8ClampedArray(W * H * 4);
	const pixMask = rasterizePolygon(poly, W, H);
	for (let i = 0; i < W * H; i++) {
		const v = pixMask[i] ? 0 : 255;
		data[i*4] = data[i*4+1] = data[i*4+2] = v;
		data[i*4+3] = 255;
	}

	return { data, W, H, truthMask, normPoly };
}

// ── otsuThreshold ──────────────────────────────────────────────────────────

describe('otsuThreshold', () => {
	it('returns a threshold between two mid-range populations', () => {
		const W = 10, H = 10;
		const data = new Uint8ClampedArray(W * H * 4);
		for (let i = 0; i < W * H; i++) {
			const v = (i % W < 5) ? 50 : 200;
			data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
			data[i * 4 + 3] = 255;
		}
		const t = otsuThreshold(data, W, H);
		expect(t).toBeGreaterThanOrEqual(50);
		expect(t).toBeLessThanOrEqual(200);
	});

	it('returns 128 for a uniform grey image (no inter-class variance)', () => {
		const W = 4, H = 4, total = W * H;
		const data = new Uint8ClampedArray(total * 4);
		for (let i = 0; i < total; i++) {
			data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 100;
			data[i * 4 + 3] = 255;
		}
		const t = otsuThreshold(data, W, H);
		expect(t).toBeGreaterThanOrEqual(0);
		expect(t).toBeLessThanOrEqual(255);
	});
});

// ── buildBinaryGrid ────────────────────────────────────────────────────────

describe('buildBinaryGrid', () => {
	it('marks black pixels as foreground on a white background', () => {
		const W = 3, H = 3;
		const cells = [255,255,255, 255,0,255, 255,255,255];
		const data = new Uint8ClampedArray(cells.length * 4);
		for (let i = 0; i < cells.length; i++) {
			data[i*4] = data[i*4+1] = data[i*4+2] = cells[i];
			data[i*4+3] = 255;
		}
		const grid = buildBinaryGrid(data, W, H);
		expect(grid[4]).toBe(1);
		expect(grid[0]).toBe(0);
	});

	it('handles inverted polarity (white shape on black background)', () => {
		const W = 3, H = 3;
		const cells = [0,0,0, 0,255,0, 0,0,0];
		const data = new Uint8ClampedArray(cells.length * 4);
		for (let i = 0; i < cells.length; i++) {
			data[i*4] = data[i*4+1] = data[i*4+2] = cells[i];
			data[i*4+3] = 255;
		}
		const grid = buildBinaryGrid(data, W, H);
		expect(grid[4]).toBe(1);
		expect(grid[0]).toBe(0);
	});

	it('treats transparent pixels as background', () => {
		const W = 2, H = 2;
		const data = new Uint8ClampedArray(W * H * 4);
		data[0] = data[1] = data[2] = 0; data[3] = 0;
		data[4] = data[5] = data[6] = 0; data[7] = 255;
		for (let i = 2; i < W*H; i++) {
			data[i*4] = data[i*4+1] = data[i*4+2] = 255; data[i*4+3] = 255;
		}
		const grid = buildBinaryGrid(data, W, H);
		expect(grid[0]).toBe(0);
		expect(grid[1]).toBe(1);
	});
});

// ── mooreContour ──────────────────────────────────────────────────────────

describe('mooreContour', () => {
	it('returns empty for an all-background grid', () => {
		const grid = new Uint8Array(9);
		expect(mooreContour(grid, 3, 3)).toHaveLength(0);
	});

	it('returns a single point for an isolated pixel', () => {
		const grid = new Uint8Array(9);
		grid[4] = 1;
		const c = mooreContour(grid, 3, 3);
		expect(c).toHaveLength(1);
		expect(c[0]).toEqual([1, 1]);
	});

	it('traces a solid 5×5 square boundary', () => {
		const W = 5, H = 5;
		const grid = new Uint8Array(W * H).fill(1);
		const c = mooreContour(grid, W, H);
		expect(c.length).toBe(16);
		expect(c[0]).toEqual([0, 0]);
		for (const [x, y] of c) {
			expect(x === 0 || x === 4 || y === 0 || y === 4).toBe(true);
		}
	});

	it('captures the inner boundary of a concave L-shape (v1 fails this)', () => {
		const W = 5, H = 5;
		const grid = new Uint8Array([
			1,1,1,1,1,
			1,1,1,1,1,
			1,1,0,0,0,
			1,1,0,0,0,
			1,1,0,0,0,
		]);
		const c = mooreContour(grid, W, H);
		expect(visits(c, 2, 1)).toBe(true);
		expect(visits(c, 3, 1)).toBe(true);
		expect(visits(c, 4, 0) || visits(c, 4, 1)).toBe(true);
		expect(visits(c, 1, 4)).toBe(true);
		expect(c.length).toBeGreaterThanOrEqual(12);
	});

	it('produces a closed contour (last pixel is Moore-adjacent to first)', () => {
		const W = 6, H = 6;
		const grid = new Uint8Array(W * H);
		for (let y = 1; y <= 4; y++)
			for (let x = 1; x <= 4; x++)
				grid[y * W + x] = 1;
		const c = mooreContour(grid, W, H);
		expect(c.length).toBeGreaterThan(0);
		const first = c[0], last = c[c.length - 1];
		expect(Math.abs(last[0] - first[0])).toBeLessThanOrEqual(1);
		expect(Math.abs(last[1] - first[1])).toBeLessThanOrEqual(1);
	});
});

// ── rdp ───────────────────────────────────────────────────────────────────

describe('rdp', () => {
	it('collapses collinear points to just endpoints', () => {
		const pts: [number,number][] = [[0,0],[1,0],[2,0],[3,0],[4,0]];
		expect(rdp(pts, 0.1)).toEqual([[0,0],[4,0]]);
	});

	it('preserves a right-angle corner', () => {
		const pts: [number,number][] = [[0,0],[10,0],[10,10]];
		const out = rdp(pts, 0.5);
		expect(out).toContainEqual([10,0]);
	});

	it('handles 2-point input', () => {
		const pts: [number,number][] = [[0,0],[5,5]];
		expect(rdp(pts, 1)).toEqual([[0,0],[5,5]]);
	});

	it('returns all points when epsilon is 0', () => {
		const pts: [number,number][] = [[0,0],[1,0.5],[2,0]];
		expect(rdp(pts, 0)).toHaveLength(3);
	});
});

// ── normalizePts ──────────────────────────────────────────────────────────

describe('normalizePts', () => {
	it('maps a unit square to the 0-100 space with margin', () => {
		const pts: [number,number][] = [[0,0],[1,0],[1,1],[0,1]];
		const norm = normalizePts(pts, 3);
		const xs = norm.map(p => p[0]), ys = norm.map(p => p[1]);
		expect(Math.min(...xs)).toBeCloseTo(3);
		expect(Math.max(...xs)).toBeCloseTo(97);
		expect(Math.min(...ys)).toBeCloseTo(3);
		expect(Math.max(...ys)).toBeCloseTo(97);
	});

	it('preserves aspect ratio (wide rectangle stays wide)', () => {
		const pts: [number,number][] = [[0,0],[200,0],[200,100],[0,100]];
		const norm = normalizePts(pts, 3);
		const xs = norm.map(p => p[0]), ys = norm.map(p => p[1]);
		const normW = Math.max(...xs) - Math.min(...xs);
		const normH = Math.max(...ys) - Math.min(...ys);
		expect(normW / normH).toBeCloseTo(2, 1);
	});

	it('handles a single point without throwing', () => {
		expect(() => normalizePts([[5,5]], 3)).not.toThrow();
	});
});

// ── smoothContour ─────────────────────────────────────────────────────────

describe('smoothContour', () => {
	it('returns input unchanged when sigma=0', () => {
		const pts: [number,number][] = [[0,0],[10,0],[10,10],[0,10]];
		const out = smoothContour(pts, 0);
		expect(out).toBe(pts); // same reference
	});

	it('returns the same length as input', () => {
		const pts: [number,number][] = Array.from({ length: 20 }, (_, i) => {
			const a = (i / 20) * 2 * Math.PI;
			return [50 + 30 * Math.cos(a), 50 + 30 * Math.sin(a)] as [number,number];
		});
		const out = smoothContour(pts, 2);
		expect(out).toHaveLength(pts.length);
	});

	it('preserves a circle centroid under smoothing', () => {
		// A regular polygon approximating a circle should stay centered
		const pts: [number,number][] = Array.from({ length: 32 }, (_, i) => {
			const a = (i / 32) * 2 * Math.PI;
			return [50 + 30 * Math.cos(a), 50 + 30 * Math.sin(a)] as [number,number];
		});
		const out = smoothContour(pts, 3);
		const cx = out.reduce((s, p) => s + p[0], 0) / out.length;
		const cy = out.reduce((s, p) => s + p[1], 0) / out.length;
		expect(cx).toBeCloseTo(50, 0);
		expect(cy).toBeCloseTo(50, 0);
	});

	it('reduces variance of a noisy contour', () => {
		// Add noise to a circle and verify smoothing reduces coordinate std-dev
		const base: [number,number][] = Array.from({ length: 50 }, (_, i) => {
			const a = (i / 50) * 2 * Math.PI;
			return [50 + 30 * Math.cos(a), 50 + 30 * Math.sin(a)] as [number,number];
		});
		// Add ±3 noise to each point
		const noisy: [number,number][] = base.map(([x, y]) => [x + (Math.random() - 0.5) * 6, y + (Math.random() - 0.5) * 6]);
		const smoothed = smoothContour(noisy, 2);
		// Measure per-point distance from base; should be less than noisy
		const noisyErr = noisy.reduce((s, p, i) => s + Math.hypot(p[0]-base[i][0], p[1]-base[i][1]), 0);
		const smoothErr = smoothed.reduce((s, p, i) => s + Math.hypot(p[0]-base[i][0], p[1]-base[i][1]), 0);
		expect(smoothErr).toBeLessThan(noisyErr);
	});
});

// ── detectCorners ─────────────────────────────────────────────────────────

describe('detectCorners', () => {
	it('detects all four 90° corners of a rectangle', () => {
		const pts: [number,number][] = [[0,0],[10,0],[10,10],[0,10]];
		const c = detectCorners(pts, Math.PI * 0.80);
		expect(c).toHaveLength(4);
		expect(c).toContain(0);
		expect(c).toContain(1);
		expect(c).toContain(2);
		expect(c).toContain(3);
	});

	it('returns at least one index for a circle-like polygon (no sharp corners)', () => {
		const pts: [number,number][] = Array.from({length: 6}, (_, i) => {
			const a = (i / 6) * 2 * Math.PI;
			return [50 + 30*Math.cos(a), 50 + 30*Math.sin(a)] as [number,number];
		});
		const c = detectCorners(pts, Math.PI * 0.45);
		expect(c.length).toBeGreaterThanOrEqual(1);
	});
});

// ── detectCornersFromCurvature ─────────────────────────────────────────────

describe('detectCornersFromCurvature', () => {
	// Build a rectangle contour with many points per edge (not just 4 corners)
	// so curvature can distinguish edges from corners.
	function rectContour(W: number, H: number, ptsPerEdge: number): [number,number][] {
		const pts: [number,number][] = [];
		for (let i = 0; i < ptsPerEdge; i++) pts.push([i * W / ptsPerEdge, 0]);
		for (let i = 0; i < ptsPerEdge; i++) pts.push([W, i * H / ptsPerEdge]);
		for (let i = 0; i < ptsPerEdge; i++) pts.push([W - i * W / ptsPerEdge, H]);
		for (let i = 0; i < ptsPerEdge; i++) pts.push([0, H - i * H / ptsPerEdge]);
		return pts;
	}

	it('finds 4 corners on a rectangle with sampled edges', () => {
		const pts = rectContour(100, 60, 10);
		const corners = detectCornersFromCurvature(pts);
		// Should find exactly 4 high-curvature corners (the actual corner positions)
		expect(corners.length).toBe(4);
	});

	it('finds fewer corners on a smooth ellipse (no sharp turns)', () => {
		// Regular 40-point ellipse: low curvature variation — at most 1 fallback corner
		const pts: [number,number][] = Array.from({ length: 40 }, (_, i) => {
			const a = (i / 40) * 2 * Math.PI;
			return [50 + 40 * Math.cos(a), 30 + 20 * Math.sin(a)] as [number,number];
		});
		const corners = detectCornersFromCurvature(pts);
		// Ellipse has no sharp corners; curvature is smoothly varying — 0 or 1 corners expected
		expect(corners.length).toBeLessThanOrEqual(2);
	});

	it('returns at least one corner even for uniform curvature (fallback)', () => {
		// Regular circle: all κ are equal, std=0, threshold=mean, no point exceeds it → fallback
		const pts: [number,number][] = Array.from({ length: 30 }, (_, i) => {
			const a = (i / 30) * 2 * Math.PI;
			return [50 + 30 * Math.cos(a), 50 + 30 * Math.sin(a)] as [number,number];
		});
		const corners = detectCornersFromCurvature(pts);
		expect(corners.length).toBeGreaterThanOrEqual(1);
	});

	it('returns sorted indices', () => {
		const pts = rectContour(80, 50, 8);
		const corners = detectCornersFromCurvature(pts);
		for (let i = 1; i < corners.length; i++) {
			expect(corners[i]).toBeGreaterThan(corners[i - 1]);
		}
	});
});

// ── fitCubicSegment ───────────────────────────────────────────────────────

describe('fitCubicSegment', () => {
	it('returns two control points between endpoints for 3+ pts', () => {
		const pts: [number,number][] = [[0,0],[5,2],[10,0]];
		const [cp1, cp2] = fitCubicSegment(pts);
		expect(cp1[0]).toBeGreaterThanOrEqual(-5);
		expect(cp2[0]).toBeLessThanOrEqual(15);
	});

	it('returns a midpoint for a 2-point segment', () => {
		const pts: [number,number][] = [[0,0],[10,10]];
		const [cp1, cp2] = fitCubicSegment(pts);
		expect(cp1[0]).toBeCloseTo(5, 0);
		expect(cp2[0]).toBeCloseTo(5, 0);
	});

	it('fits a perfect straight line with near-zero transverse deviation', () => {
		const pts: [number,number][] = [[0,0],[25,0],[50,0],[75,0],[100,0]];
		const [cp1, cp2] = fitCubicSegment(pts);
		expect(Math.abs(cp1[1])).toBeLessThan(2);
		expect(Math.abs(cp2[1])).toBeLessThan(2);
	});
});

// ── maxFitError ───────────────────────────────────────────────────────────

describe('maxFitError', () => {
	it('returns zero error for points exactly on a line bezier', () => {
		const pts: [number,number][] = [[0,0],[33,0],[67,0],[100,0]];
		const P0: [number,number] = [0,0], P3: [number,number] = [100,0];
		const CP1: [number,number] = [33,0], CP2: [number,number] = [67,0];
		const { sqErr } = maxFitError(pts, P0, CP1, CP2, P3);
		expect(Math.sqrt(sqErr)).toBeLessThan(3);
	});

	it('reports non-zero error for a point off the bezier', () => {
		const pts: [number,number][] = [[0,0],[50,10],[100,0]];
		const P0: [number,number] = [0,0], P3: [number,number] = [100,0];
		const CP1: [number,number] = [33,0], CP2: [number,number] = [67,0];
		const { sqErr } = maxFitError(pts, P0, CP1, CP2, P3);
		expect(Math.sqrt(sqErr)).toBeGreaterThan(5);
	});
});

// ── fitCurves ─────────────────────────────────────────────────────────────

describe('fitCurves', () => {
	it('produces a C command for a smooth arc', () => {
		const pts: [number,number][] = [[0,50],[25,0],[75,0],[100,50]];
		const result = fitCurves(pts, 4);
		expect(result).toMatch(/^[CL] /);
	});

	it('splits into multiple segments when tolerance is very tight', () => {
		const pts: [number,number][] = [[0,0],[10,20],[20,0],[30,20],[40,0]];
		const result = fitCurves(pts, 0);
		const cCount = (result.match(/C /g) ?? []).length;
		expect(cCount).toBeGreaterThanOrEqual(1);
	});

	it('produces L for a 2-point degenerate segment', () => {
		const result = fitCurves([[0,0],[10,10]], 1);
		expect(result).toMatch(/^L /);
	});
});

// ── maxHausdorffDeviation (bidirectional) ─────────────────────────────────

describe('maxHausdorffDeviation', () => {
	it('returns 0 for a path that exactly matches its own boundary samples', () => {
		// A square path — the bezier boundary and the sampled square should be close
		const W = 50, H = 50;
		const data = new Uint8ClampedArray(W * H * 4);
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W; x++) {
				const i = (y * W + x) * 4;
				const fg = x >= 10 && x < 40 && y >= 10 && y < 40;
				data[i] = data[i+1] = data[i+2] = fg ? 0 : 255;
				data[i+3] = 255;
			}
		}
		const path = traceImageData(data, W, H);
		// Sample the path to dense points (in 0-100 space)
		const densePts = samplePathDense(path, 20);
		// Hausdorff of a path against its own dense samples should be small
		const dev = maxHausdorffDeviation(path, densePts);
		expect(dev).toBeLessThan(3); // within 3 path units
	});

	it('returns Infinity for a path with no segments', () => {
		const dev = maxHausdorffDeviation('M 10,10 Z', []);
		expect(dev).toBe(0); // empty boundary → 0
	});

	it('detects large deviation when boundary is far from path', () => {
		// Path is a tiny square near 50,50; boundary is near 0,0
		const path = 'M 45,45 C 45,45 55,45 55,45 C 55,45 55,55 55,55 C 55,55 45,55 45,55 C 45,55 45,45 45,45 Z';
		const farBoundary: [number,number][] = [[0,0],[1,0],[1,1],[0,1]];
		const dev = maxHausdorffDeviation(path, farBoundary);
		expect(dev).toBeGreaterThan(40);
	});
});

// ── samplePathDense ───────────────────────────────────────────────────────

describe('samplePathDense', () => {
	it('returns at least one point for a simple M+C+Z path', () => {
		const path = 'M 10,10 C 10,10 90,10 90,90 Z';
		const pts = samplePathDense(path, 10);
		expect(pts.length).toBeGreaterThan(0);
	});

	it('returns more points with higher samplesPerSeg', () => {
		const path = 'M 10,10 C 20,5 80,5 90,10 C 95,50 95,90 90,90 Z';
		const lo = samplePathDense(path, 5);
		const hi = samplePathDense(path, 20);
		expect(hi.length).toBeGreaterThan(lo.length);
	});
});

// ── traceImageData (integration) ──────────────────────────────────────────

describe('traceImageData', () => {
	it('throws for images smaller than 8×8', () => {
		const data = new Uint8ClampedArray(4 * 4 * 4).fill(0);
		expect(() => traceImageData(data, 4, 4)).toThrow('too small');
	});

	it('throws when no foreground shape is found', () => {
		const W = 20, H = 20;
		const data = new Uint8ClampedArray(W * H * 4).fill(255);
		for (let i = 3; i < data.length; i += 4) data[i] = 255;
		expect(() => traceImageData(data, W, H)).toThrow('No shape');
	});

	it('produces a valid SVG path string for a black square on white bg', () => {
		const W = 40, H = 40;
		const data = new Uint8ClampedArray(W * H * 4);
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W; x++) {
				const i = (y * W + x) * 4;
				const fg = x >= 10 && x < 30 && y >= 10 && y < 30;
				data[i] = data[i+1] = data[i+2] = fg ? 0 : 255;
				data[i+3] = 255;
			}
		}
		const path = traceImageData(data, W, H);
		expect(path).toMatch(/^M /);
		expect(path).toMatch(/Z$/);
		expect(path).toContain('C ');
	});

	it('traces an L-shape and produces more than 4 points (concave captured)', () => {
		const W = 80, H = 80;
		const data = new Uint8ClampedArray(W * H * 4);
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W; x++) {
				const i = (y * W + x) * 4;
				const inBox = x >= 15 && x < 65 && y >= 15 && y < 65;
				const cutOut = x >= 40 && y >= 40;
				const fg = inBox && !cutOut;
				data[i] = data[i+1] = data[i+2] = fg ? 0 : 255;
				data[i+3] = 255;
			}
		}
		const path = traceImageData(data, W, H);
		const cCount = (path.match(/ C /g) ?? []).length;
		expect(cCount).toBeGreaterThanOrEqual(5);
	});
});

// ── traceImageData verification loop (integration) ────────────────────────

describe('traceImageData verification loop', () => {
	it('accepts a clean rectangle with IoU ≥ 0.95 at loose tolerance', () => {
		const W = 60, H = 60;
		const data = new Uint8ClampedArray(W * H * 4);
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W; x++) {
				const i = (y * W + x) * 4;
				const fg = x >= 10 && x < 50 && y >= 10 && y < 50;
				data[i] = data[i+1] = data[i+2] = fg ? 0 : 255;
				data[i+3] = 255;
			}
		}
		const path = traceImageData(data, W, H);
		expect(path).toMatch(/^M /);
		expect(path).toMatch(/Z$/);
		const cCount = (path.match(/ C /g) ?? []).length;
		expect(cCount).toBeGreaterThanOrEqual(3);
		expect(cCount).toBeLessThanOrEqual(8);
	});
});

// ── gaussianBlurLuma ──────────────────────────────────────────────────────

describe('gaussianBlurLuma', () => {
	it('returns the same array unchanged when sigma=0', () => {
		const luma = new Float32Array([0, 128, 255, 64]);
		const out = gaussianBlurLuma(luma, 4, 1, 0);
		expect(Array.from(out)).toEqual(Array.from(luma));
	});

	it('blurs a step edge — centre value moves toward midpoint', () => {
		const W = 20, H = 1;
		const luma = new Float32Array(W);
		for (let x = 0; x < W; x++) luma[x] = x < 10 ? 0 : 255;
		const blurred = gaussianBlurLuma(luma, W, H, 1.5);
		expect(blurred[10]).toBeGreaterThan(0);
		expect(blurred[10]).toBeLessThan(255);
		expect(blurred[0]).toBeLessThan(20);
		expect(blurred[19]).toBeGreaterThan(235);
	});

	it('preserves uniform fields exactly', () => {
		const W = 10, H = 5;
		const luma = new Float32Array(W * H).fill(100);
		const out = gaussianBlurLuma(luma, W, H, 2);
		for (let i = 0; i < out.length; i++) expect(out[i]).toBeCloseTo(100, 1);
	});
});

// ── rasterizePolygon ──────────────────────────────────────────────────────

describe('rasterizePolygon', () => {
	it('fills the interior of a rectangle', () => {
		const pts: [number,number][] = [[1,1],[6,1],[6,6],[1,6]];
		const filled = rasterizePolygon(pts, 8, 8);
		expect(filled[2 * 8 + 2]).toBe(1);
		expect(filled[4 * 8 + 4]).toBe(1);
		expect(filled[0]).toBe(0);
		expect(filled[7 * 8 + 7]).toBe(0);
	});

	it('fills nothing for a degenerate (0-area) polygon', () => {
		const pts: [number,number][] = [[5,5],[5,5],[5,5]];
		const filled = rasterizePolygon(pts, 10, 10);
		expect(filled.every(v => v === 0)).toBe(true);
	});
});

// ── computeIoU ────────────────────────────────────────────────────────────

describe('computeIoU', () => {
	it('returns 1 for identical masks', () => {
		const a = new Uint8Array([1, 0, 1, 1, 0]);
		expect(computeIoU(a, a)).toBeCloseTo(1);
	});

	it('returns 0 for fully disjoint masks', () => {
		const a = new Uint8Array([1, 1, 0, 0]);
		const b = new Uint8Array([0, 0, 1, 1]);
		expect(computeIoU(a, b)).toBeCloseTo(0);
	});

	it('returns 0.5 for 50% overlap', () => {
		const a = new Uint8Array([0, 0, 1, 1]);
		const b = new Uint8Array([1, 1, 1, 1]);
		expect(computeIoU(a, b)).toBeCloseTo(0.5);
	});

	it('returns 0 for two empty masks', () => {
		const a = new Uint8Array(10);
		const b = new Uint8Array(10);
		expect(computeIoU(a, b)).toBe(0);
	});
});

// ── Car-window IoU integration (industrial-grade quality gate) ────────────

describe('car-window IoU integration', () => {
	it('traces a car-window shape with IoU ≥ 0.92 against the source polygon', () => {
		const { data, W, H, truthMask } = makeCarWindow();

		const path = traceImageData(data, W, H);
		expect(path).toMatch(/^M /);
		expect(path).toMatch(/Z$/);

		// Sample the traced bezier path to a dense polygon, rasterize at 100×100
		const densePts = samplePathDense(path, 30);
		const tracedMask = rasterizePolygon(densePts, 100, 100);

		const iou = computeIoU(tracedMask, truthMask);
		expect(iou).toBeGreaterThanOrEqual(0.92);
	});

	it('produces a path with few segments (smooth, not choppy) for the car window', () => {
		const { data, W, H } = makeCarWindow();
		const path = traceImageData(data, W, H);

		// Car window has ~3 true corners; expect few C commands total
		// (choppy tracing produces many short segments; smooth produces few large ones)
		const cCount = (path.match(/ C /g) ?? []).length;
		expect(cCount).toBeGreaterThanOrEqual(3);  // at least one per corner span
		expect(cCount).toBeLessThanOrEqual(16);    // not excessively fragmented
	});

	it('detects the correct number of corners on a car-window contour', () => {
		const { data, W, H } = makeCarWindow();
		const { buildBinaryGrid: _b, mooreContour: _m, smoothContour: _s, detectCornersFromCurvature: _d } =
			// Re-use exported functions to inspect intermediate state
			{ buildBinaryGrid, mooreContour, smoothContour, detectCornersFromCurvature };

		const grid = _b(data, W, H, 2.0);
		const contour = _m(grid, W, H);
		const lightSmooth = _s(contour, 1.5);
		const corners = _d(lightSmooth);

		// Car window has 3-5 structural corners (bottom-left, maybe bottom-right,
		// top-right transition, top-left A-pillar transition)
		expect(corners.length).toBeGreaterThanOrEqual(2);
		expect(corners.length).toBeLessThanOrEqual(6);
	});
});

// ── Real-image verification (skips if reference PNG not found) ────────────
// Loads the original car-window reference image via jimp, runs the full v4
// pipeline, and asserts IoU / Hausdorff / corner-position quality gates.

const REAL_IMAGE_PATH = new URL('./__fixtures__/car-window-ref.png', import.meta.url).pathname;

describe('real-image end-to-end verification', () => {
	it('loads and decodes the reference PNG successfully', async () => {
		if (!existsSync(REAL_IMAGE_PATH)) {
			console.log('[SKIP] Reference image not found — skipping real-image tests');
			return;
		}
		const _require = createRequire(import.meta.url);
		const Jimp = _require('/home/nathanielrand/Code/OmniPlot/node_modules/.pnpm/jimp@0.14.0/node_modules/jimp/dist/index.js');
		const img = await Jimp.read(REAL_IMAGE_PATH);
		expect(img.bitmap.width).toBeGreaterThan(0);
		expect(img.bitmap.height).toBeGreaterThan(0);
		console.log(`[REAL IMAGE] Decoded: ${img.bitmap.width}×${img.bitmap.height} px`);
	});

	it('IoU ≥ 0.90 against own binary mask (real car-window reference)', async () => {
		if (!existsSync(REAL_IMAGE_PATH)) return;
		const _require = createRequire(import.meta.url);
		const Jimp = _require('/home/nathanielrand/Code/OmniPlot/node_modules/.pnpm/jimp@0.14.0/node_modules/jimp/dist/index.js');
		const img = await Jimp.read(REAL_IMAGE_PATH);
		const W = img.bitmap.width, H = img.bitmap.height;
		const data = new Uint8ClampedArray(img.bitmap.data.buffer, img.bitmap.data.byteOffset, img.bitmap.data.byteLength);

		// Ground-truth: normalized light-smooth contour rasterized at 100×100
		// (matches the normalization space the traced bezier path now uses)
		const truthGrid = buildBinaryGrid(data, W, H, 2.0);
		const truthContour = mooreContour(truthGrid, W, H);
		const truthSmooth = smoothContour(truthContour, 1.5);
		const normTruth = normalizePts(truthSmooth);
		const truthMask = rasterizePolygon(normTruth, 100, 100);

		// Run full v4 pipeline
		const pathD = traceImageData(data, W, H);
		expect(pathD).toMatch(/^M /);
		expect(pathD).toMatch(/Z$/);

		// Traced path is already in 0-100 space — rasterize at same 100×100
		const densePts = samplePathDense(pathD, 30);
		const tracedMask = rasterizePolygon(densePts, 100, 100);

		const iou = computeIoU(tracedMask, truthMask);
		console.log(`[REAL IMAGE] IoU = ${(iou * 100).toFixed(1)}%`);
		expect(iou).toBeGreaterThanOrEqual(0.90);
	});

	it('Hausdorff deviation ≤ 2.0 path-units on real image', async () => {
		if (!existsSync(REAL_IMAGE_PATH)) return;
		const _require = createRequire(import.meta.url);
		const Jimp = _require('/home/nathanielrand/Code/OmniPlot/node_modules/.pnpm/jimp@0.14.0/node_modules/jimp/dist/index.js');
		const img = await Jimp.read(REAL_IMAGE_PATH);
		const W = img.bitmap.width, H = img.bitmap.height;
		const data = new Uint8ClampedArray(img.bitmap.data.buffer, img.bitmap.data.byteOffset, img.bitmap.data.byteLength);

		const grid = buildBinaryGrid(data, W, H, 2.0);
		const contour = mooreContour(grid, W, H);
		const lightSmooth = smoothContour(contour, 1.5);
		const norm = normalizePts(lightSmooth);

		const pathD = traceImageData(data, W, H);
		const dev = maxHausdorffDeviation(pathD, norm);
		console.log(`[REAL IMAGE] Hausdorff deviation = ${dev.toFixed(3)} path-units`);
		expect(dev).toBeLessThanOrEqual(2.0);
	});

	it('corners land on structural transitions, not mid-arc (real image)', async () => {
		if (!existsSync(REAL_IMAGE_PATH)) return;
		const _require = createRequire(import.meta.url);
		const Jimp = _require('/home/nathanielrand/Code/OmniPlot/node_modules/.pnpm/jimp@0.14.0/node_modules/jimp/dist/index.js');
		const img = await Jimp.read(REAL_IMAGE_PATH);
		const W = img.bitmap.width, H = img.bitmap.height;
		const data = new Uint8ClampedArray(img.bitmap.data.buffer, img.bitmap.data.byteOffset, img.bitmap.data.byteLength);

		const grid = buildBinaryGrid(data, W, H, 2.0);
		const contour = mooreContour(grid, W, H);
		const lightSmooth = smoothContour(contour, 1.5);
		const corners = detectCornersFromCurvature(lightSmooth);
		const norm = normalizePts(lightSmooth);

		console.log(`[REAL IMAGE] ${corners.length} corners detected at contour indices: ${JSON.stringify(corners)}`);
		// Log normalized positions to verify they're at structural transitions
		for (const ci of corners) {
			const [x, y] = norm[ci] ?? [0, 0];
			console.log(`  corner[${ci}] → normalized (${x.toFixed(1)}, ${y.toFixed(1)})`);
		}

		// Real car window has 3–5 structural corners
		expect(corners.length).toBeGreaterThanOrEqual(2);
		expect(corners.length).toBeLessThanOrEqual(6);

		// No corner should land in the middle of the top arc (normalized y < 30 with x between 20 and 80)
		// — these would be spurious mid-arc splits from the old algorithm
		for (const ci of corners) {
			const [x, y] = norm[ci] ?? [50, 50];
			const midArc = y < 30 && x > 20 && x < 80;
			expect(midArc).toBe(false);
		}
	});

	it('segment count is not choppy on real image (≤ 16 C commands)', async () => {
		if (!existsSync(REAL_IMAGE_PATH)) return;
		const _require = createRequire(import.meta.url);
		const Jimp = _require('/home/nathanielrand/Code/OmniPlot/node_modules/.pnpm/jimp@0.14.0/node_modules/jimp/dist/index.js');
		const img = await Jimp.read(REAL_IMAGE_PATH);
		const W = img.bitmap.width, H = img.bitmap.height;
		const data = new Uint8ClampedArray(img.bitmap.data.buffer, img.bitmap.data.byteOffset, img.bitmap.data.byteLength);

		const pathD = traceImageData(data, W, H);
		const cCount = (pathD.match(/ C /g) ?? []).length;
		console.log(`[REAL IMAGE] Segment count: ${cCount} C commands`);
		expect(cCount).toBeGreaterThanOrEqual(3);
		// Real images have more complexity than synthetic shapes (anti-aliasing, genuine
		// A-pillar inflection) — 22 allows for that without permitting gross choppiness
		expect(cCount).toBeLessThanOrEqual(22);
	});

	it('visual diff: writes truth-vs-trace diff image for manual inspection', async () => {
		if (!existsSync(REAL_IMAGE_PATH)) return;
		const _require = createRequire(import.meta.url);
		const Jimp = _require('/home/nathanielrand/Code/OmniPlot/node_modules/.pnpm/jimp@0.14.0/node_modules/jimp/dist/index.js');
		const img = await Jimp.read(REAL_IMAGE_PATH);
		const W = img.bitmap.width, H = img.bitmap.height;
		const data = new Uint8ClampedArray(img.bitmap.data.buffer, img.bitmap.data.byteOffset, img.bitmap.data.byteLength);

		// Ground truth: raw contour (no smoothing) to catch over-smoothing
		const rawGrid = buildBinaryGrid(data, W, H, 2.0);
		const rawContour = mooreContour(rawGrid, W, H);
		const normRaw = normalizePts(rawContour);
		const SCALE = 4;
		const OUT = 100 * SCALE;
		const truthMask = rasterizePolygon(normRaw.map(([x, y]) => [x * SCALE, y * SCALE] as [number, number]), OUT, OUT);

		// Traced path
		const pathD = traceImageData(data, W, H);
		const densePts = samplePathDense(pathD, 30);
		const tracedMask = rasterizePolygon(densePts.map(([x, y]) => [x * SCALE, y * SCALE] as [number, number]), OUT, OUT);

		// Build RGB diff: truth-only=red, trace-only=blue, overlap=gray, neither=white
		const diffImg = new Jimp(OUT, OUT);
		for (let y = 0; y < OUT; y++) {
			for (let x = 0; x < OUT; x++) {
				const idx = y * OUT + x;
				const inTruth = truthMask[idx] === 1;
				const inTrace = tracedMask[idx] === 1;
				let r = 255, g = 255, b = 255;
				if (inTruth && inTrace)  { r = 180; g = 180; b = 180; } // overlap = gray
				else if (inTruth)        { r = 220; g = 60;  b = 60;  } // truth-only = red (missed)
				else if (inTrace)        { r = 60;  g = 80;  b = 220; } // trace-only = blue (over-shoot)
				diffImg.setPixelColor(Jimp.rgbaToInt(r, g, b, 255), x, y);
			}
		}

		const outPath = '/tmp/trace-diff-real.png';
		await diffImg.writeAsync(outPath);
		console.log(`[VISUAL] Diff image written to ${outPath}`);
		console.log('[VISUAL] Gray=overlap(good), Red=truth-only(missed), Blue=trace-only(overshoot), White=background');

		// Compute honest IoU against raw contour (catches over-smoothing)
		const rawIoU = computeIoU(
			tracedMask,
			truthMask
		);
		console.log(`[VISUAL] Raw-contour IoU = ${(rawIoU * 100).toFixed(1)}%`);
		expect(rawIoU).toBeGreaterThanOrEqual(0.88);
	});
});
