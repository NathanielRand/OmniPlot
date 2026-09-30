import { parsePath, flattenSegs, pathBBox, transformSegs, type Pt } from '../../src/lib/utils/pathGeometry';

export interface Metrics {
	iou: number;            // area intersection / union
	symDiffPct: number;     // symmetric-difference area as % of GT area
	maxDevIn: number;       // symmetric Hausdorff, inches
	p99DevIn: number;
	meanDevIn: number;
	widthIn: number; heightIn: number;   // traced outline scaled so width == filename W
	aspectErrPct: number;   // |H' - H| / H
	worstAt: Pt;            // where (inches, GT frame) the max deviation is
	gtBBoxErrPct: number;   // sanity: GT bbox height vs filename H
}

function loops(d: string, tol = 0.0005): Pt[][] {
	return flattenSegs(parsePath(d), tol).map(l => l.points);
}

// Exact-in-x scanline area (even-odd) at fine y resolution.
function scanIntervals(polys: Pt[][], y: number): [number, number][] {
	const xs: number[] = [];
	for (const p of polys) {
		for (let i = 0, n = p.length; i < n; i++) {
			const a = p[i], b = p[(i + 1) % n];
			if ((a.y <= y) !== (b.y <= y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
		}
	}
	xs.sort((u, v) => u - v);
	const iv: [number, number][] = [];
	for (let i = 0; i + 1 < xs.length; i += 2) iv.push([xs[i], xs[i + 1]]);
	return iv;
}
const len = (iv: [number, number][]) => iv.reduce((s, [a, b]) => s + (b - a), 0);
function inter(a: [number, number][], b: [number, number][]): number {
	let s = 0, j = 0;
	for (const [a0, a1] of a) {
		while (j < b.length && b[j][1] <= a0) j++;
		for (let k = j; k < b.length && b[k][0] < a1; k++) s += Math.max(0, Math.min(a1, b[k][1]) - Math.max(a0, b[k][0]));
	}
	return s;
}

function resample(polys: Pt[][], step: number): Pt[] {
	const out: Pt[] = [];
	for (const p of polys) for (let i = 0, n = p.length; i < n; i++) {
		const a = p[i], b = p[(i + 1) % n];
		const L = Math.hypot(b.x - a.x, b.y - a.y);
		const k = Math.max(1, Math.ceil(L / step));
		for (let t = 0; t < k; t++) out.push({ x: a.x + (b.x - a.x) * t / k, y: a.y + (b.y - a.y) * t / k });
	}
	return out;
}

class SegIndex {
	private cells = new Map<string, number[]>();
	private segs: [Pt, Pt][] = [];
	constructor(polys: Pt[][], private cell = 0.25) {
		for (const p of polys) for (let i = 0, n = p.length; i < n; i++) {
			const a = p[i], b = p[(i + 1) % n];
			const id = this.segs.push([a, b]) - 1;
			const x0 = Math.floor(Math.min(a.x, b.x) / cell), x1 = Math.floor(Math.max(a.x, b.x) / cell);
			const y0 = Math.floor(Math.min(a.y, b.y) / cell), y1 = Math.floor(Math.max(a.y, b.y) / cell);
			for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
				const k = `${x},${y}`; (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(id);
			}
		}
	}
	dist(p: Pt): number {
		let best = Infinity;
		const cx = Math.floor(p.x / this.cell), cy = Math.floor(p.y / this.cell);
		for (let r = 0; r < 400; r++) {
			if (best < (r - 1) * this.cell) break;
			for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) {
				if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
				for (const id of this.cells.get(`${x},${y}`) ?? []) {
					const [a, b] = this.segs[id];
					const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
					const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
					const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
					if (d < best) best = d;
				}
			}
		}
		return best;
	}
}

/** Scale+translate `d` (any units) so its bbox is width W at origin. Returns inch path. */
export function fitToWidth(d: string, W: number): { d: string; w: number; h: number } {
	const segs = parsePath(d);
	const b = pathBBox(segs);
	const s = W / b.width;
	const out = transformSegs(segs, { a: s, b: 0, c: 0, d: s, e: -b.x * s, f: -b.y * s });
	return { d: out.map(seg => seg.t === 'Z' ? 'Z' : seg.t === 'M' ? `M${seg.x} ${seg.y}` : seg.t === 'L' ? `L${seg.x} ${seg.y}` : seg.t === 'C' ? `C${seg.x1} ${seg.y1} ${seg.x2} ${seg.y2} ${seg.x} ${seg.y}` : '').join(''), w: b.width * s, h: b.height * s };
}

export function compare(gtD: string, gtW: number, gtH: number, tracedD: string): Metrics {
	const fit = fitToWidth(tracedD, gtW);
	const gtFit = fitToWidth(gtD, gtW);
	const A = loops(gtFit.d), B = loops(fit.d);

	// area via scanline
	const y1 = Math.max(gtFit.h, fit.h) + 0.01, dy = 1 / 400;
	let aA = 0, aB = 0, aI = 0;
	for (let y = dy / 2; y < y1; y += dy) {
		const ia = scanIntervals(A, y), ib = scanIntervals(B, y);
		aA += len(ia) * dy; aB += len(ib) * dy; aI += inter(ia, ib) * dy;
	}
	const union = aA + aB - aI;

	const idxA = new SegIndex(A), idxB = new SegIndex(B);
	let worst: Pt = { x: 0, y: 0 }, wd = -1;
	const devs: number[] = [];
	for (const [pts, idx] of [[resample(B, 0.01), idxA], [resample(A, 0.01), idxB]] as const) for (const p of pts) {
		const dd = idx.dist(p); devs.push(dd); if (dd > wd) { wd = dd; worst = p; }
	}
	devs.sort((x, y) => x - y);
	const q = (f: number) => devs[Math.min(devs.length - 1, Math.floor(devs.length * f))];
	return {
		iou: aI / union,
		symDiffPct: ((aA + aB - 2 * aI) / aA) * 100,
		maxDevIn: devs[devs.length - 1],
		p99DevIn: q(0.99),
		meanDevIn: devs.reduce((s, v) => s + v, 0) / devs.length,
		widthIn: fit.w, heightIn: fit.h,
		aspectErrPct: (Math.abs(fit.h - gtFit.h) / gtFit.h) * 100,
		worstAt: worst,
		gtBBoxErrPct: (Math.abs(gtFit.h - gtH) / gtH) * 100,
	};
}
