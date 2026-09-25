// PRECISION MANUFACTURING — exact geometry guard. Never loosen these
// tolerances to make a change pass: a failure means shapes would be altered.
import { describe, it, expect } from 'vitest';
import {
	parsePath, serializePath, transformSegs, pathBBox, flattenSegs, splitIntoPieces,
	pathToInchSegs, sizeMatchesOutline, heightForWidth, normalizeOutline, rectSegs, ellipseSegs,
	type Seg, type Pt,
} from './pathGeometry';

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe('parsePath', () => {
	it('handles relative commands, implicit repeats and H/V', () => {
		const s = parsePath('m10 10 20 0 v5 h-20z');
		expect(s).toEqual([
			{ t: 'M', x: 10, y: 10 }, { t: 'L', x: 30, y: 10 }, { t: 'L', x: 30, y: 15 }, { t: 'L', x: 10, y: 15 }, { t: 'Z' },
		]);
	});
	it('relative subpath after Z starts from the previous subpath start', () => {
		const s = parsePath('M10 10 L20 10 L20 20 Z m5 5 l1 0');
		expect(s[4]).toEqual({ t: 'M', x: 15, y: 15 });
		expect(s[5]).toEqual({ t: 'L', x: 16, y: 15 });
	});
	it('reads compact numbers and compact arc flags', () => {
		const s = parsePath('M0,0L.5.5-1e1,2a5 5 0 0110 10');
		expect(s[1]).toEqual({ t: 'L', x: 0.5, y: 0.5 });
		expect(s[2]).toEqual({ t: 'L', x: -10, y: 2 });
		expect(s[3]).toMatchObject({ t: 'A', rx: 5, ry: 5, large: 0, sweep: 1, x: 0, y: 12 });
	});
	it('S and T reflect the previous control point exactly', () => {
		const s = parsePath('M0 0 C0 10 10 10 10 0 S20 -10 20 0 Q25 5 30 0 T40 0');
		expect(s[2]).toMatchObject({ t: 'C', x1: 10, y1: -10 });
		expect(s[4]).toMatchObject({ t: 'Q', x1: 35, y1: -5 });
	});
	it('round-trips through serialize without losing precision', () => {
		const d = 'M0.123456789012 1 L2.5 3.75 C1 2 3 4 5 6 A1 2 30 1 0 7 8 Z';
		expect(parsePath(serializePath(parsePath(d)))).toEqual(parsePath(d));
	});
	it('rejects garbage instead of guessing', () => {
		expect(() => parsePath('M0 0 L1')).toThrow();
		expect(() => parsePath('M0 0 A1 1 0 2 0 1 1')).toThrow();
	});
});

describe('pathBBox (analytic)', () => {
	it('uses curve extrema, not the control-point hull', () => {
		const b = pathBBox(parsePath('M0 0 C0 100 100 100 100 0'));
		close(b.height, 75); // true peak of this cubic is 0.75 × 100
		close(b.width, 100);
	});
	it('circle bbox is exact', () => {
		const b = pathBBox(ellipseSegs(50, 50, 20, 10));
		close(b.x, 30); close(b.y, 40); close(b.width, 40); close(b.height, 20);
	});
	it('rotated ellipse arc bbox is exact', () => {
		// rx=10 along the rotated (vertical) axis, ry=5 horizontal: extents x ±5, y ±10
		const b = pathBBox(parsePath('M0 10 A10 5 90 1 1 0 -10 A10 5 90 1 1 0 10 Z'));
		close(b.x, -5, 1e-9); close(b.width, 10, 1e-9);
		close(b.y, -10, 1e-9); close(b.height, 20, 1e-9);
	});
});

describe('transformSegs (exact affine)', () => {
	const pointsOf = (segs: Seg[]) => flattenSegs(segs, 1e-6).flatMap((l) => l.points);
	const apply = (p: Pt, m: { a: number; b: number; c: number; d: number; e: number; f: number }) =>
		({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });

	for (const [name, m] of [
		['rotation 37°', { a: Math.cos(0.6458), b: Math.sin(0.6458), c: -Math.sin(0.6458), d: Math.cos(0.6458), e: 3, f: -4 }],
		['mirror + non-uniform scale', { a: -2, b: 0, c: 0, d: 0.5, e: 10, f: 1 }],
		['skew', { a: 1, b: 0.3, c: 0.7, d: 1, e: 0, f: 0 }],
	] as const) {
		it(`arcs stay exact under ${name}`, () => {
			const segs = parsePath('M20 10 A15 8 25 1 1 5 30 A15 8 25 0 1 20 10 Z');
			const moved = transformSegs(segs, m);
			// Every point of the transformed flattening must lie on the image of
			// the original curve: compare against the original points mapped.
			const original = pointsOf(segs).map((p) => apply(p, m));
			const bb = pathBBox(moved);
			const bo = { minX: Math.min(...original.map((p) => p.x)), maxX: Math.max(...original.map((p) => p.x)) };
			close(bb.x, bo.minX, 1e-5);
			close(bb.x + bb.width, bo.maxX, 1e-5);
			// endpoints exact
			const last = moved.filter((s) => s.t === 'A').at(-1) as Extract<Seg, { t: 'A' }>;
			const endOrig = apply({ x: 20, y: 10 }, m);
			close(last.x, endOrig.x, 1e-12); close(last.y, endOrig.y, 1e-12);
		});
	}
});

describe('flattenSegs', () => {
	it('keeps every corner vertex exactly (sharp points are never shaved)', () => {
		const star = 'M50 0 L61 35 L98 35 L68 57 L79 91 L50 70 L21 91 L32 57 L2 35 L39 35 Z';
		const pts = flattenSegs(parsePath(star), 0.0005)[0].points;
		for (const v of [[50, 0], [61, 35], [98, 35], [68, 57], [79, 91], [50, 70], [21, 91], [32, 57], [2, 35], [39, 35]]) {
			expect(pts.some((p) => p.x === v[0] && p.y === v[1])).toBe(true);
		}
	});
	it('holds curves within tolerance (circle radius check)', () => {
		const tol = 0.0005;
		const pts = flattenSegs(ellipseSegs(0, 0, 30, 30), tol)[0].points;
		// every chord midpoint is within tol of the true circle
		for (let i = 1; i < pts.length; i++) {
			const m = { x: (pts[i].x + pts[i - 1].x) / 2, y: (pts[i].y + pts[i - 1].y) / 2 };
			expect(30 - Math.hypot(m.x, m.y)).toBeLessThanOrEqual(tol + 1e-12);
		}
	});
	it('cubic stays within tolerance', () => {
		const tol = 0.0005;
		const segs = parsePath('M0 0 C0 40 60 40 60 0');
		const pts = flattenSegs(segs, tol)[0].points;
		// sample the true curve densely; each true point must be within tol of the polyline
		const B = (t: number) => ({ x: 3 * (1 - t) * t * t * 60 + t * t * t * 60, y: 3 * (1 - t) * (1 - t) * t * 40 + 3 * (1 - t) * t * t * 40 });
		const distToPoly = (p: Pt) => Math.min(...pts.slice(1).map((b, i) => {
			const a = pts[i]; const dx = b.x - a.x, dy = b.y - a.y; const L = dx * dx + dy * dy;
			const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
			return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
		}));
		for (let i = 0; i <= 400; i++) expect(distToPoly(B(i / 400))).toBeLessThanOrEqual(tol + 1e-12);
	});
	it('open subpaths stay open, closed ones return to start', () => {
		const loops = flattenSegs(parsePath('M0 0 L10 0 M0 5 L10 5 L10 10 Z'), 0.01);
		expect(loops[0]).toEqual({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false });
		expect(loops[1].closed).toBe(true);
		expect(loops[1].points.at(-1)).toEqual({ x: 0, y: 5 });
	});
});

describe('pattern sizing', () => {
	it('maps the outline bbox to exactly W × H', () => {
		const b = pathBBox(pathToInchSegs('M3 20 L97 20 L97 80 L3 80 Z', 47, 30));
		close(b.x, 0); close(b.y, 0); close(b.width, 47); close(b.height, 30);
	});
	it('size check accepts only the outline\'s exact proportions', () => {
		const d = 'M0 0 L200 0 L200 50 L0 50 Z';
		expect(sizeMatchesOutline(d, 40, 10)).toBe(true);
		expect(sizeMatchesOutline(d, 40, heightForWidth(d, 40))).toBe(true);
		expect(sizeMatchesOutline(d, 40, 10.01)).toBe(false);
		expect(sizeMatchesOutline(d, 40, 0)).toBe(false);
	});
	it('normalizeOutline is a pure similarity (proportions unchanged)', () => {
		const src = rectSegs(-1000, 5, 37, 6, 0.5, 0.5);
		const out = pathBBox(parsePath(normalizeOutline(src)));
		close(out.width / out.height, 37 / 6, 1e-10);
	});
});

describe('splitIntoPieces', () => {
	it('keeps holes with their outer contour', () => {
		const d = 'M0 0 L10 0 L10 10 L0 10 Z M3 3 L7 3 L7 7 L3 7 Z M20 0 L30 0 L30 10 L20 10 Z';
		const pieces = splitIntoPieces(d);
		expect(pieces).toHaveLength(2);
		expect(parsePath(pieces[0]).filter((s) => s.t === 'M')).toHaveLength(2); // square + its hole
	});
});
