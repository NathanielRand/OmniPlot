import { describe, it, expect } from 'vitest';
import { smoothBezierJunctions, SMOOTH_MAX_DEV } from './bezier-smooth';
import { parsePath, flattenSegs, pathBBox } from './pathGeometry';

// Max distance from every vertex/sample of `a` to polyline `b`.
function maxDist(a: { x: number; y: number }[], b: { x: number; y: number }[]): number {
	let worst = 0;
	for (const p of a) {
		let best = Infinity;
		for (let i = 0; i < b.length; i++) {
			const q0 = b[i], q1 = b[(i + 1) % b.length];
			const dx = q1.x - q0.x, dy = q1.y - q0.y, l2 = dx * dx + dy * dy;
			const t = l2 ? Math.max(0, Math.min(1, ((p.x - q0.x) * dx + (p.y - q0.y) * dy) / l2)) : 0;
			best = Math.min(best, Math.hypot(p.x - q0.x - t * dx, p.y - q0.y - t * dy));
		}
		worst = Math.max(worst, best);
	}
	return worst;
}

const pts = (d: string) => flattenSegs(parsePath(d), 0.001)[0].points;

describe('smoothBezierJunctions precision guard', () => {
	// Small chamfers / shallow kinks are exactly what the smoothing passes like to
	// "clean up"; whatever they do, the cut outline must stay within the budget.
	const shapes: Record<string, string> = {
		chamfered: 'M10 3L90 3L97 10L97 90L90 97L10 97L3 90L3 10Z',
		shallowKinks: 'M3 3L50 3.6L97 3L97.6 50L97 97L50 97.6L3 97L3.6 50Z',
		stairs: 'M3 3L97 3L97 50L96 50L96 51L95 51L95 97L3 97Z',
	};
	for (const [name, d] of Object.entries(shapes)) {
		it(`${name} stays within ${SMOOTH_MAX_DEV * 100}% of long edge`, () => {
			const out = smoothBezierJunctions(d);
			const b = pathBBox(parsePath(d));
			const tol = Math.max(b.width, b.height) * SMOOTH_MAX_DEV * 1.05;
			const A = pts(d), B = pts(out);
			expect(maxDist(B, A)).toBeLessThanOrEqual(tol);
			expect(maxDist(A, B)).toBeLessThanOrEqual(tol);
		});
	}
});
