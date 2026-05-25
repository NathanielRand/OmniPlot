import { describe, it, expect } from 'vitest';
import {
	signedArea, ensureCCW, centroid, polygonBounds,
	translatePolygon, rotatePoints, normalizeToBBox, reflectPolygon,
	inflatePolygon, convexHull, pointInPolygon, minkowskiSumConvex,
	nfpConvex, convexDecompose, nfpGeneral, innerFitBounds, nfpCandidates,
} from './polygon';

// Shared fixtures — CCW unit square and triangle
const sq = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const sqCW = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }];
const tri = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 2 }];

describe('signedArea', () => {
	it('returns positive for CCW polygon', () => {
		expect(signedArea(sq)).toBeCloseTo(1);
	});
	it('returns negative for CW polygon', () => {
		expect(signedArea(sqCW)).toBeCloseTo(-1);
	});
	it('correct area for triangle', () => {
		expect(signedArea(tri)).toBeCloseTo(2);
	});
});

describe('ensureCCW', () => {
	it('preserves CCW winding', () => {
		expect(signedArea(ensureCCW(sq))).toBeGreaterThan(0);
	});
	it('reverses CW winding', () => {
		expect(signedArea(ensureCCW(sqCW))).toBeGreaterThan(0);
	});
});

describe('centroid', () => {
	it('center of unit square', () => {
		const c = centroid(sq);
		expect(c.x).toBeCloseTo(0.5);
		expect(c.y).toBeCloseTo(0.5);
	});
});

describe('polygonBounds', () => {
	it('correct bounds for unit square', () => {
		const b = polygonBounds(sq);
		expect(b).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
	});
	it('tracks translated polygon', () => {
		const b = polygonBounds(translatePolygon(sq, 5, 3));
		expect(b.minX).toBe(5);
		expect(b.minY).toBe(3);
		expect(b.maxX).toBe(6);
		expect(b.maxY).toBe(4);
	});
});

describe('translatePolygon', () => {
	it('shifts all points', () => {
		const r = translatePolygon([{ x: 1, y: 2 }], 10, 20);
		expect(r[0]).toEqual({ x: 11, y: 22 });
	});
	it('zero translation is identity', () => {
		expect(translatePolygon(sq, 0, 0)).toEqual(sq);
	});
});

describe('rotatePoints', () => {
	it('0 deg is identity', () => {
		expect(rotatePoints(sq, 0)).toEqual(sq);
	});
	it('90 deg rotates (1,0) → (0,1)', () => {
		const r = rotatePoints([{ x: 1, y: 0 }], 90);
		expect(r[0].x).toBeCloseTo(0);
		expect(r[0].y).toBeCloseTo(1);
	});
	it('180 deg negates', () => {
		const r = rotatePoints([{ x: 3, y: 4 }], 180);
		expect(r[0].x).toBeCloseTo(-3);
		expect(r[0].y).toBeCloseTo(-4);
	});
	it('360 deg is identity', () => {
		const r = rotatePoints([{ x: 1, y: 1 }], 360);
		expect(r[0].x).toBeCloseTo(1);
		expect(r[0].y).toBeCloseTo(1);
	});
});

describe('normalizeToBBox', () => {
	it('shifts so bbox starts at (0,0)', () => {
		const shifted = translatePolygon(sq, 7, 3);
		const norm = normalizeToBBox(shifted);
		const b = polygonBounds(norm);
		expect(b.minX).toBeCloseTo(0);
		expect(b.minY).toBeCloseTo(0);
	});
});

describe('reflectPolygon', () => {
	it('negates all coordinates', () => {
		const r = reflectPolygon([{ x: 2, y: 5 }]);
		expect(r[0]).toEqual({ x: -2, y: -5 });
	});
});

describe('inflatePolygon', () => {
	it('amount=0 is identity', () => {
		expect(inflatePolygon(sq, 0)).toEqual(sq);
	});
	it('positive amount expands bounds', () => {
		const inflated = inflatePolygon(sq, 0.5);
		const ib = polygonBounds(inflated);
		expect(ib.maxX).toBeGreaterThan(1);
		expect(ib.maxY).toBeGreaterThan(1);
		expect(ib.minX).toBeLessThan(0);
		expect(ib.minY).toBeLessThan(0);
	});
});

describe('convexHull', () => {
	it('hull of convex polygon has same vertex count', () => {
		const hull = convexHull(sq);
		expect(hull.length).toBe(4);
	});
	it('hull of 3 points is a triangle', () => {
		const hull = convexHull(tri);
		expect(hull.length).toBe(3);
	});
	it('interior point is excluded from hull', () => {
		const pts = [...sq, { x: 0.5, y: 0.5 }];
		const hull = convexHull(pts);
		expect(hull.length).toBe(4);
	});
});

describe('pointInPolygon', () => {
	it('center of square is inside', () => {
		expect(pointInPolygon({ x: 0.5, y: 0.5 }, sq)).toBe(true);
	});
	it('far outside point returns false', () => {
		expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(false);
	});
	it('does not throw for edge-touching point', () => {
		expect(() => pointInPolygon({ x: 0, y: 0.5 }, sq)).not.toThrow();
	});
});

describe('minkowskiSumConvex', () => {
	it('sum of two unit squares spans [0,2]×[0,2]', () => {
		const result = minkowskiSumConvex(sq, sq);
		const b = polygonBounds(result);
		expect(b.maxX).toBeCloseTo(2);
		expect(b.maxY).toBeCloseTo(2);
		expect(b.minX).toBeCloseTo(0);
		expect(b.minY).toBeCloseTo(0);
	});
	it('handles degenerate empty input', () => {
		expect(() => minkowskiSumConvex([], sq)).not.toThrow();
	});
});

describe('innerFitBounds', () => {
	it('unit square fits in 2×2 container', () => {
		const ifp = innerFitBounds(2, 2, sq);
		expect(ifp).not.toBeNull();
		expect(ifp!.maxX).toBeCloseTo(1);
		expect(ifp!.maxY).toBeCloseTo(1);
		expect(ifp!.minX).toBeCloseTo(0);
		expect(ifp!.minY).toBeCloseTo(0);
	});
	it('exact fit: IFP is a single point', () => {
		const ifp = innerFitBounds(1, 1, sq);
		expect(ifp).not.toBeNull();
		expect(ifp!.maxX).toBeCloseTo(0);
		expect(ifp!.maxY).toBeCloseTo(0);
	});
	it('too-large piece returns null', () => {
		const big = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }];
		expect(innerFitBounds(2, 2, big)).toBeNull();
	});
});

describe('convexDecompose', () => {
	it('convex polygon returns itself as single part', () => {
		const parts = convexDecompose(sq);
		expect(parts.length).toBe(1);
	});
	it('concave L-shape decomposes into triangles', () => {
		const lShape = [
			{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 },
			{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 },
		];
		const parts = convexDecompose(lShape);
		expect(parts.length).toBeGreaterThan(0);
		for (const p of parts) expect(p.length).toBeGreaterThanOrEqual(3);
	});
});

describe('nfpGeneral', () => {
	it('returns at least one NFP polygon for two squares', () => {
		const nfps = nfpGeneral(sq, sq);
		expect(nfps.length).toBeGreaterThan(0);
	});
	it('each NFP has at least 3 vertices', () => {
		for (const nfp of nfpGeneral(sq, sq)) {
			expect(nfp.length).toBeGreaterThanOrEqual(3);
		}
	});
	it('NFP of unit square spans the correct collision zone', () => {
		const nfps = nfpGeneral(sq, sq);
		let minX = Infinity, maxX = -Infinity;
		for (const nfp of nfps) {
			for (const p of nfp) {
				if (p.x < minX) minX = p.x;
				if (p.x > maxX) maxX = p.x;
			}
		}
		// NFP = A ⊕ (-B): for [0,1]×[0,1] with -[0,1]×[0,1] = [-1,0]×[-1,0]
		// result spans [-1,1]×[-1,1]
		expect(minX).toBeCloseTo(-1);
		expect(maxX).toBeCloseTo(1);
	});
});

describe('nfpConvex', () => {
	it('does not throw for valid convex polygons', () => {
		expect(() => nfpConvex(sq, sq)).not.toThrow();
	});
	it('result has at least 3 vertices', () => {
		expect(nfpConvex(sq, sq).length).toBeGreaterThanOrEqual(3);
	});
});

describe('nfpCandidates', () => {
	it('always includes IFP corners', () => {
		const ifp = { minX: 0, minY: 0, maxX: 10, maxY: 5 };
		const pts = nfpCandidates([], ifp);
		expect(pts.length).toBe(4);
		expect(pts).toContainEqual({ x: 0, y: 0 });
		expect(pts).toContainEqual({ x: 10, y: 5 });
	});
	it('includes NFP vertices when provided', () => {
		const ifp = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
		const nfpGroups = [[sq]];
		const pts = nfpCandidates(nfpGroups, ifp);
		expect(pts.length).toBeGreaterThan(4);
	});
});
