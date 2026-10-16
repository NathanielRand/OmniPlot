// PRECISION MANUFACTURING — orientation guard: the arrow must never be mirrored
// on screen, and a standard (y-up) plotter must receive it un-mirrored.
import { describe, it, expect } from 'vitest';
import type { MaterialSheet, PlotterConfig } from '$lib/types';
import { orientationTestPreview, orientationTestHpgl, flipsFromAnswers, correctedOrientation, ORIENTATION_TEST_PATH } from './orientationTest';
import { parsePath, flattenSegs } from './pathGeometry';

const sheet: MaterialSheet = { id: 's', name: 'T', widthInches: 24, heightInches: 600, manufacturer: 'T', sku: 'T' };
const config: PlotterConfig = {
	id: 'c', name: 'T', manufacturer: 'G', model: 'H', protocol: 'hpgl', connection: 'download',
	bladeForce: 65, cuttingSpeed: 400, passes: 1, overcut: 0, offsetBlade: 0,
	mediaWidthMm: 600, maxMediaWidthMm: 600, originX: 0, originY: 0, flipH: false, flipV: false,
};
const signedArea = (pts: { x: number; y: number }[]) =>
	pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2;
const nums = (d: string) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => +m[0]);

const artArea = signedArea(flattenSegs(parsePath(ORIENTATION_TEST_PATH), 0.01)[0].points);

describe('orientation test piece', () => {
	it('screen preview is the arrow rotated, never mirrored', () => {
		const n = nums(orientationTestPreview().d);
		const pts = []; for (let i = 0; i < n.length; i += 2) pts.push({ x: n[i], y: n[i + 1] });
		// both in y-down coordinates: same winding sign ⇒ same handedness
		expect(Math.sign(signedArea(pts))).toBe(Math.sign(artArea));
	});
	it('a standard y-up plotter receives the arrow un-mirrored', () => {
		const hpgl = orientationTestHpgl(config, sheet);
		// the piece's own segment: from its first PU to the final park command
		const body = hpgl.slice(hpgl.indexOf('; ---'), hpgl.lastIndexOf('PU0,0;'));
		const loop: { x: number; y: number }[] = [];
		for (const [, b] of body.matchAll(/PD([-\d,]+);/g)) {
			const n = b.split(',').map(Number);
			for (let i = 0; i < n.length; i += 2) loop.push({ x: n[i], y: n[i + 1] });
		}
		// y-up numbers vs y-down art: an un-mirrored copy has the OPPOSITE raw sign
		expect(Math.sign(signedArea(loop))).toBe(-Math.sign(artArea));
	});
	it('answers map to the right correction', () => {
		expect(flipsFromAnswers(true, true)).toEqual({ flipH: false, flipV: false });
		expect(flipsFromAnswers(false, true)).toEqual({ flipH: true, flipV: false });
		expect(flipsFromAnswers(true, false)).toEqual({ flipH: false, flipV: true });
		expect(flipsFromAnswers(false, false)).toEqual({ flipH: true, flipV: true });
	});
	it('corrections compose with the current setting', () => {
		expect(correctedOrientation({ flipH: false, flipV: true }, true, false)).toEqual({ flipH: false, flipV: false });
		expect(correctedOrientation({ flipH: true, flipV: false }, true, true)).toEqual({ flipH: true, flipV: false });
	});

	// The two questions only work if flipH really reverses the arrow and flipV
	// really swaps the roll edge in what the plotter receives.
	function emitted(flipH: boolean, flipV: boolean) {
		const hpgl = orientationTestHpgl({ ...config, flipH, flipV }, sheet);
		const body = hpgl.slice(hpgl.indexOf('; ---'), hpgl.lastIndexOf('PU0,0;'));
		const pts: { x: number; y: number }[] = [];
		for (const [, b] of body.matchAll(/PD([-\d,]+);/g)) {
			const n = b.split(',').map(Number);
			for (let i = 0; i < n.length; i += 2) pts.push({ x: n[i], y: n[i + 1] });
		}
		const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
		const span = (v: number[]) => Math.max(...v) - Math.min(...v);
		// shaft axis = the axis the arrow is longer along; tip = the sharp end of it
		const axis: 'x' | 'y' = span(xs) > span(ys) ? 'x' : 'y';
		const along = pts.map((p) => p[axis]);
		const mid = (Math.max(...along) + Math.min(...along)) / 2;
		const tip = pts.reduce((best, p) => Math.abs(p[axis] - mid) > Math.abs(best[axis] - mid) ? p : best, pts[0]);
		const across = axis === 'x' ? 'y' : 'x';
		const centre = (Math.max(...pts.map((p) => p[across])) + Math.min(...pts.map((p) => p[across]))) / 2;
		return { axis, tipSign: Math.sign(tip[axis] - mid), centre };
	}
	it('flipH reverses the arrow along the roll; flipV moves it to the other edge', () => {
		const base = emitted(false, false);
		const h = emitted(true, false);
		const v = emitted(false, true);
		expect(h.axis).toBe(base.axis);
		expect(h.tipSign).toBe(-base.tipSign);   // arrow reversed
		expect(h.centre).toBe(base.centre);      // same edge
		expect(v.tipSign).toBe(base.tipSign);    // arrow unchanged
		expect(v.centre).not.toBe(base.centre);  // other edge
	});
});
