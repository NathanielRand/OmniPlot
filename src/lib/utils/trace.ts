export type Point = [number, number];

// ── Directions: N NE E SE S SW W NW ─────────────────────────────────────────
const DX = [ 0, 1, 1, 1, 0,-1,-1,-1];
const DY = [-1,-1, 0, 1, 1, 1, 0,-1];

// ── Separable Gaussian blur on a Float32 luma array ─────────────────────────
export function gaussianBlurLuma(luma: Float32Array, W: number, H: number, sigma: number): Float32Array {
	if (sigma <= 0) return luma;
	const r = Math.round(sigma * 2.5);
	const kernel: number[] = [];
	let ksum = 0;
	for (let i = -r; i <= r; i++) {
		const v = Math.exp(-0.5 * (i / sigma) ** 2);
		kernel.push(v);
		ksum += v;
	}
	const k = kernel.map(v => v / ksum);

	const tmp = new Float32Array(W * H);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			let s = 0;
			for (let d = 0; d < k.length; d++) {
				s += luma[y * W + Math.max(0, Math.min(W - 1, x + d - r))] * k[d];
			}
			tmp[y * W + x] = s;
		}
	}
	const out = new Float32Array(W * H);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			let s = 0;
			for (let d = 0; d < k.length; d++) {
				s += tmp[Math.max(0, Math.min(H - 1, y + d - r)) * W + x] * k[d];
			}
			out[y * W + x] = s;
		}
	}
	return out;
}

// ── Otsu's threshold (public, RGBA data) ─────────────────────────────────────
export function otsuThreshold(data: Uint8ClampedArray, W: number, H: number): number {
	const hist = new Uint32Array(256);
	for (let i = 0; i < W * H; i++) {
		const luma = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
		hist[luma]++;
	}
	return otsuOnHist(hist, W * H);
}

function otsuOnLuma(luma: Float32Array): number {
	const hist = new Uint32Array(256);
	for (let i = 0; i < luma.length; i++) hist[Math.round(luma[i])]++;
	return otsuOnHist(hist, luma.length);
}

function otsuOnHist(hist: Uint32Array, total: number): number {
	let sum = 0;
	for (let i = 0; i < 256; i++) sum += i * hist[i];
	let sumB = 0, wB = 0, maxVar = 0, threshold = 128;
	for (let t = 0; t < 256; t++) {
		wB += hist[t];
		if (wB === 0) continue;
		const wF = total - wB;
		if (wF === 0) break;
		sumB += t * hist[t];
		const mB = sumB / wB;
		const mF = (sum - sumB) / wF;
		const variance = wB * wF * (mB - mF) ** 2;
		if (variance > maxVar) { maxVar = variance; threshold = t; }
	}
	return threshold;
}

// ── Binary grid from RGBA pixel data ─────────────────────────────────────────
export function buildBinaryGrid(data: Uint8ClampedArray, W: number, H: number, sigma = 0): Uint8Array {
	let luma = new Float32Array(W * H);
	for (let i = 0; i < W * H; i++) {
		luma[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
	}
	if (sigma > 0) luma = gaussianBlurLuma(luma, W, H, sigma);

	const threshold = otsuOnLuma(luma);

	const corners = [0, W - 1, (H - 1) * W, (H - 1) * W + (W - 1)];
	let cornerTotal = 0, cornerCount = 0;
	for (const ci of corners) {
		if (data[ci * 4 + 3] < 128) continue;
		cornerTotal += luma[ci];
		cornerCount++;
	}
	const cornerLuma = cornerCount > 0 ? cornerTotal / cornerCount : 128;
	const darkBg = cornerLuma < 128;

	const grid = new Uint8Array(W * H);
	for (let i = 0; i < W * H; i++) {
		if (data[i * 4 + 3] < 128) { grid[i] = 0; continue; }
		grid[i] = darkBg ? (luma[i] > threshold ? 1 : 0) : (luma[i] <= threshold ? 1 : 0);
	}
	return grid;
}

// ── Moore-neighborhood contour tracing ───────────────────────────────────────
export function mooreContour(grid: Uint8Array, W: number, H: number): Point[] {
	const inBounds = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H;
	const isFg = (x: number, y: number) => inBounds(x, y) && grid[y * W + x] === 1;

	let sx = -1, sy = -1;
	outer: for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++)
			if (grid[y * W + x]) { sx = x; sy = y; break outer; }
	if (sx < 0) return [];

	let bx = sx, by = sy - 1;
	let cx = sx, cy = sy;
	const contour: Point[] = [];
	const maxSteps = W * H * 2;

	do {
		contour.push([cx, cy]);
		const dx = bx - cx, dy = by - cy;
		let bDir = -1;
		for (let d = 0; d < 8; d++) {
			if (DX[d] === dx && DY[d] === dy) { bDir = d; break; }
		}
		if (bDir < 0) break;

		let prevX = bx, prevY = by;
		let found = false;
		for (let k = 1; k <= 8; k++) {
			const d = (bDir + k) % 8;
			const nx = cx + DX[d], ny = cy + DY[d];
			if (isFg(nx, ny)) {
				bx = prevX; by = prevY;
				cx = nx; cy = ny;
				found = true;
				break;
			}
			prevX = nx; prevY = ny;
		}
		if (!found) break;
	} while (contour.length < maxSteps && (cx !== sx || cy !== sy || contour.length < 2));

	return contour;
}

// ── Circular 1D Gaussian smoothing of contour coordinates ────────────────────
// Convolves x and y independently with a Gaussian kernel, wrapping at the ends
// so the contour stays closed. Use σ ≈ 1.5 for corner-detection input.
export function smoothContour(pts: Point[], sigma: number): Point[] {
	if (sigma <= 0 || pts.length < 3) return pts;
	const n = pts.length;
	const r = Math.round(sigma * 2.5);
	const kernel: number[] = [];
	let ksum = 0;
	for (let i = -r; i <= r; i++) {
		const v = Math.exp(-0.5 * (i / sigma) ** 2);
		kernel.push(v);
		ksum += v;
	}
	const k = kernel.map(v => v / ksum);
	const out = new Array<Point>(n);
	for (let i = 0; i < n; i++) {
		let sx = 0, sy = 0;
		for (let d = 0; d < k.length; d++) {
			const j = ((i + d - r) % n + n) % n;
			sx += pts[j][0] * k[d];
			sy += pts[j][1] * k[d];
		}
		out[i] = [sx, sy];
	}
	return out;
}

// ── Open Gaussian smoothing for a span with anchored endpoints ───────────────
// Unlike smoothContour (circular wrap), this clamps at boundaries and pins
// the first and last points exactly — so corner positions are never displaced.
function smoothSpanInterior(pts: Point[], sigma: number): Point[] {
	if (sigma <= 0 || pts.length <= 2) return pts;
	const n = pts.length;
	const r = Math.round(sigma * 2.5);
	const kernel: number[] = [];
	for (let i = -r; i <= r; i++) kernel.push(Math.exp(-0.5 * (i / sigma) ** 2));
	const out = new Array<Point>(n);
	out[0] = pts[0];
	out[n - 1] = pts[n - 1];
	for (let i = 1; i < n - 1; i++) {
		let sx = 0, sy = 0, wsum = 0;
		for (let d = 0; d < kernel.length; d++) {
			const j = Math.max(0, Math.min(n - 1, i + d - r));
			sx += pts[j][0] * kernel[d];
			sy += pts[j][1] * kernel[d];
			wsum += kernel[d];
		}
		out[i] = [sx / wsum, sy / wsum];
	}
	return out;
}

// ── Ramer-Douglas-Peucker ────────────────────────────────────────────────────
export function rdp(pts: Point[], eps: number): Point[] {
	if (pts.length <= 2) return pts;
	const [p1, pn] = [pts[0], pts[pts.length - 1]];
	let maxD = 0, maxI = 0;
	for (let i = 1; i < pts.length - 1; i++) {
		const d = perpDist(pts[i], p1, pn);
		if (d > maxD) { maxD = d; maxI = i; }
	}
	if (maxD > eps) {
		const L = rdp(pts.slice(0, maxI + 1), eps);
		const R = rdp(pts.slice(maxI), eps);
		return [...L.slice(0, -1), ...R];
	}
	return [p1, pn];
}

function perpDist([px, py]: Point, [x1, y1]: Point, [x2, y2]: Point): number {
	const dx = x2 - x1, dy = y2 - y1;
	const len = Math.hypot(dx, dy);
	if (len === 0) return Math.hypot(px - x1, py - y1);
	return Math.abs((py - y1) * dx - (px - x1) * dy) / len;
}

// ── Scanline polygon rasterization ───────────────────────────────────────────
export function rasterizePolygon(pts: Point[], W: number, H: number): Uint8Array {
	const filled = new Uint8Array(W * H);
	const n = pts.length;
	for (let y = 0; y < H; y++) {
		const xs: number[] = [];
		for (let i = 0; i < n; i++) {
			const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
			if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
				xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
			}
		}
		xs.sort((a, b) => a - b);
		for (let k = 0; k + 1 < xs.length; k += 2) {
			const x0 = Math.max(0, Math.ceil(xs[k]));
			const x1 = Math.min(W - 1, Math.floor(xs[k + 1]));
			for (let x = x0; x <= x1; x++) filled[y * W + x] = 1;
		}
	}
	return filled;
}

// ── IoU of two binary pixel masks ────────────────────────────────────────────
export function computeIoU(a: Uint8Array, b: Uint8Array): number {
	let inter = 0, union = 0;
	for (let i = 0; i < a.length; i++) {
		if (a[i] && b[i]) inter++;
		if (a[i] || b[i]) union++;
	}
	return union > 0 ? inter / union : 0;
}

// ── Normalize points to 0-100 coordinate space ───────────────────────────────
export function normalizePts(pts: Point[], margin = 3): Point[] {
	if (pts.length === 0) return [];
	const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
	const minX = Math.min(...xs), maxX = Math.max(...xs);
	const minY = Math.min(...ys), maxY = Math.max(...ys);
	const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
	const size = 100 - margin * 2;
	const scale = size / Math.max(rangeX, rangeY);
	return pts.map(([x, y]): Point => [
		(x - minX) * scale + margin + (size - rangeX * scale) / 2,
		(y - minY) * scale + margin + (size - rangeY * scale) / 2,
	]);
}

// ── Vertex angle at p1 (angle between incoming p0 and outgoing p2) ────────────
function vertexAngle(p0: Point, p1: Point, p2: Point): number {
	const v1x = p0[0] - p1[0], v1y = p0[1] - p1[1];
	const v2x = p2[0] - p1[0], v2y = p2[1] - p1[1];
	const dot = v1x * v2x + v1y * v2y;
	const len = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
	if (len === 0) return Math.PI;
	return Math.acos(Math.max(-1, Math.min(1, dot / len)));
}

// ── Corner detection on a simplified polygon (kept for compatibility) ─────────
export function detectCorners(pts: Point[], angleThreshold = Math.PI * 0.80): number[] {
	const n = pts.length;
	const corners: number[] = [];
	let minAngle = Infinity, minIdx = 0;

	for (let i = 0; i < n; i++) {
		const angle = vertexAngle(pts[(i - 1 + n) % n], pts[i], pts[(i + 1) % n]);
		if (angle < angleThreshold) corners.push(i);
		if (angle < minAngle) { minAngle = angle; minIdx = i; }
	}

	if (corners.length === 0) corners.push(minIdx);
	corners.sort((a, b) => a - b);
	return corners;
}

// ── Menger curvature at point B given flanking points A and C ────────────────
function mengerCurvature(A: Point, B: Point, C: Point): number {
	const ax = B[0] - A[0], ay = B[1] - A[1];
	const bx = C[0] - B[0], by = C[1] - B[1];
	const area = Math.abs(ax * by - ay * bx) * 0.5;
	const ab = Math.hypot(ax, ay);
	const bc = Math.hypot(bx, by);
	const ca = Math.hypot(C[0] - A[0], C[1] - A[1]);
	const denom = ab * bc * ca;
	return denom < 1e-10 ? 0 : area / denom;
}

// ── Curvature-based corner detection ─────────────────────────────────────────
// Computes Menger curvature at each contour point using adaptive look-ahead,
// then finds local maxima exceeding mean + 1.5 × std with non-maximum suppression.
// More reliable than RDP+angle on real image contours because it measures
// bending rate directly rather than via a coarse polygon approximation.
export function detectCornersFromCurvature(
	pts: Point[],
	lookAheadFrac = 0.015,
	minSpacingFrac = 0.06
): number[] {
	const n = pts.length;

	// Fallback for degenerate inputs: treat every point as a corner
	if (n < 10) return Array.from({ length: n }, (_, i) => i);

	const lookAhead = Math.max(3, Math.round(n * lookAheadFrac));
	const minSpacing = Math.max(3, Math.round(n * minSpacingFrac));

	const kappa = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		kappa[i] = mengerCurvature(
			pts[(i - lookAhead + n) % n],
			pts[i],
			pts[(i + lookAhead) % n]
		);
	}

	// Threshold: mean + 1.5 × std (corners are statistical outliers above average)
	let mean = 0;
	for (let i = 0; i < n; i++) mean += kappa[i];
	mean /= n;
	let variance = 0;
	for (let i = 0; i < n; i++) variance += (kappa[i] - mean) ** 2;
	const std = Math.sqrt(variance / n);
	const threshold = mean + 1.5 * std;

	// Non-maximum suppression within minSpacing window
	const corners: number[] = [];
	for (let i = 0; i < n; i++) {
		if (kappa[i] <= threshold) continue;
		let isMax = true;
		for (let d = 1; d <= minSpacing && isMax; d++) {
			if (kappa[(i + d) % n] >= kappa[i]) isMax = false;
			if (kappa[(i - d + n) % n] >= kappa[i]) isMax = false;
		}
		if (isMax) corners.push(i);
	}

	// Fallback: return the single highest-curvature point
	if (corners.length === 0) {
		let maxK = 0, maxI = 0;
		for (let i = 0; i < n; i++) if (kappa[i] > maxK) { maxK = kappa[i]; maxI = i; }
		corners.push(maxI);
	}

	corners.sort((a, b) => a - b);
	return corners;
}

// ── Multi-point weighted tangent estimation ───────────────────────────────────
// Averages unit directions from `base` to the nearest `radius` neighbors,
// weighted by 1/rank. More stable than single-neighbor on noisy pixel contours.
function multiPointTangent(pts: Point[], fromStart: boolean, radius: number): [number, number] {
	const n = pts.length;
	const base = fromStart ? pts[0] : pts[n - 1];
	let tx = 0, ty = 0;
	const count = Math.min(radius, n - 1);
	for (let k = 1; k <= count; k++) {
		const p = fromStart ? pts[k] : pts[n - 1 - k];
		const dx = p[0] - base[0], dy = p[1] - base[1];
		const dist = Math.hypot(dx, dy);
		if (dist < 1e-10) continue;
		const w = 1.0 / k;
		tx += (dx / dist) * w;
		ty += (dy / dist) * w;
	}
	if (tx === 0 && ty === 0) {
		// Fallback: single nearest neighbor
		const p = fromStart
			? (n > 1 ? pts[1] : pts[0])
			: (n > 1 ? pts[n - 2] : pts[0]);
		return unitVec(p[0] - base[0], p[1] - base[1]);
	}
	return unitVec(tx, ty);
}

// ── Schneider parametric cubic bezier fitting ────────────────────────────────
export function fitCubicSegment(pts: Point[]): [Point, Point] {
	const n = pts.length;
	const P0 = pts[0], P3 = pts[n - 1];

	if (n <= 2) {
		const m: Point = [(P0[0] + P3[0]) / 2, (P0[1] + P3[1]) / 2];
		return [m, m];
	}

	// Chord-length parameterisation
	const params = new Float64Array(n);
	for (let i = 1; i < n; i++) {
		params[i] = params[i - 1] + Math.hypot(pts[i][0] - pts[i-1][0], pts[i][1] - pts[i-1][1]);
	}
	const total = params[n - 1] || 1;
	const t = Array.from(params, p => p / total);

	// Multi-point tangent (4 neighbors) — more stable than single-neighbor on pixel contours
	const [lx, ly] = multiPointTangent(pts, true, 4);
	const [rx, ry] = multiPointTangent(pts, false, 4);

	let C00=0, C01=0, C11=0, X0=0, X1=0;
	for (let i = 0; i < n; i++) {
		const ti = t[i];
		const b0=(1-ti)**3, b1=3*ti*(1-ti)**2, b2=3*ti**2*(1-ti), b3=ti**3;
		const A1x=b1*lx, A1y=b1*ly, A2x=b2*rx, A2y=b2*ry;
		C00 += A1x*A1x + A1y*A1y;
		C01 += A1x*A2x + A1y*A2y;
		C11 += A2x*A2x + A2y*A2y;
		const Tx = pts[i][0] - ((b0+b1)*P0[0] + (b2+b3)*P3[0]);
		const Ty = pts[i][1] - ((b0+b1)*P0[1] + (b2+b3)*P3[1]);
		X0 += A1x*Tx + A1y*Ty;
		X1 += A2x*Tx + A2y*Ty;
	}

	const det = C00*C11 - C01*C01;
	let a1 = 0, a2 = 0;
	if (Math.abs(det) > 1e-10) {
		a1 = (C11*X0 - C01*X1) / det;
		a2 = (C00*X1 - C01*X0) / det;
	} else {
		const chord = Math.hypot(P3[0]-P0[0], P3[1]-P0[1]) / 3;
		a1 = chord; a2 = chord;
	}

	return [
		[P0[0] + a1 * lx, P0[1] + a1 * ly],
		[P3[0] + a2 * rx, P3[1] + a2 * ry],
	];
}

function unitVec(dx: number, dy: number): [number, number] {
	const len = Math.hypot(dx, dy) || 1;
	return [dx / len, dy / len];
}

// ── Point on cubic bezier at parameter t ─────────────────────────────────────
function bezierPt(P0: Point, CP1: Point, CP2: Point, P3: Point, t: number): Point {
	const b0=(1-t)**3, b1=3*t*(1-t)**2, b2=3*t**2*(1-t), b3=t**3;
	return [b0*P0[0]+b1*CP1[0]+b2*CP2[0]+b3*P3[0], b0*P0[1]+b1*CP1[1]+b2*CP2[1]+b3*P3[1]];
}

// ── Maximum fitting error between pts[] and the fitted bezier ────────────────
export function maxFitError(pts: Point[], P0: Point, CP1: Point, CP2: Point, P3: Point): { sqErr: number; idx: number } {
	let maxSq = 0, maxIdx = 1;
	for (let i = 1; i < pts.length - 1; i++) {
		let minSq = Infinity;
		for (let k = 0; k <= 20; k++) {
			const bp = bezierPt(P0, CP1, CP2, P3, k / 20);
			const sq = (pts[i][0]-bp[0])**2 + (pts[i][1]-bp[1])**2;
			if (sq < minSq) minSq = sq;
		}
		if (minSq > maxSq) { maxSq = minSq; maxIdx = i; }
	}
	return { sqErr: maxSq, idx: maxIdx };
}

// ── Bezier segment as a 4-tuple ───────────────────────────────────────────────
type BezierSeg = [Point, Point, Point, Point]; // [P0, CP1, CP2, P3]

// ── Recursive Schneider fitting returning structured bezier segments ──────────
function fitCurvesSegs(pts: Point[], sqTolerance: number): BezierSeg[] {
	const P0 = pts[0], P3 = pts[pts.length - 1];

	if (pts.length <= 2) {
		// Degenerate: represent as a line using a collapsed bezier
		return [[P0, P0, P3, P3]];
	}

	const [CP1, CP2] = fitCubicSegment(pts);
	const { sqErr, idx } = maxFitError(pts, P0, CP1, CP2, P3);

	if (sqErr <= sqTolerance || pts.length <= 3) {
		return [[P0, CP1, CP2, P3]];
	}

	return [
		...fitCurvesSegs(pts.slice(0, idx + 1), sqTolerance),
		...fitCurvesSegs(pts.slice(idx), sqTolerance),
	];
}

// ── G1 tangent continuity at internal junctions within a span ────────────────
// At each junction between two consecutive bezier segments, aligns the outgoing
// CP2 direction and the incoming CP1 direction to a shared average tangent.
// Preserves control-point magnitudes (smoothness, not stiffness).
function applyG1(segs: BezierSeg[]): BezierSeg[] {
	if (segs.length <= 1) return segs;
	const out: BezierSeg[] = segs.map(([P0, CP1, CP2, P3]) =>
		[P0, [CP1[0], CP1[1]] as Point, [CP2[0], CP2[1]] as Point, P3]
	);
	for (let i = 0; i < out.length - 1; i++) {
		const P = out[i][3];
		const CP2 = out[i][2];
		const CP1next = out[i + 1][1];

		// Outgoing tangent direction: from CP2 toward endpoint P
		const t1 = unitVec(P[0] - CP2[0], P[1] - CP2[1]);
		// Incoming tangent direction: from P toward CP1next
		const t2 = unitVec(CP1next[0] - P[0], CP1next[1] - P[1]);

		// Skip if already G1 (within ~5 degrees, cos(5°) ≈ 0.996)
		if (t1[0] * t2[0] + t1[1] * t2[1] > 0.996) continue;

		// Average tangent direction
		const [tx, ty] = unitVec(t1[0] + t2[0], t1[1] + t2[1]);
		// Exactly opposite tangents → can't blend meaningfully
		if (tx === 0 && ty === 0) continue;

		// Adjust: preserve magnitudes, align to shared tangent
		const mag2 = Math.hypot(P[0] - CP2[0], P[1] - CP2[1]);
		const mag1 = Math.hypot(CP1next[0] - P[0], CP1next[1] - P[1]);
		out[i][2] = [P[0] - tx * mag2, P[1] - ty * mag2];
		out[i + 1][1] = [P[0] + tx * mag1, P[1] + ty * mag1];
	}
	return out;
}

// ── Recursive Schneider fitting (string output, backward compatible) ──────────
export function fitCurves(pts: Point[], sqTolerance: number): string {
	const r = (v: number) => Math.round(v * 100) / 100;
	const P3last = pts[pts.length - 1];

	if (pts.length <= 2) {
		return `L ${r(P3last[0])},${r(P3last[1])}`;
	}

	const segs = fitCurvesSegs(pts, sqTolerance);
	let result = '';
	for (const [segP0, CP1, CP2, P3] of segs) {
		const isLine = Math.hypot(CP1[0] - segP0[0], CP1[1] - segP0[1]) < 1e-10
		            && Math.hypot(CP2[0] - P3[0], CP2[1] - P3[1]) < 1e-10;
		if (isLine) {
			result += `L ${r(P3[0])},${r(P3[1])} `;
		} else {
			result += `C ${r(CP1[0])},${r(CP1[1])} ${r(CP2[0])},${r(CP2[1])} ${r(P3[0])},${r(P3[1])} `;
		}
	}
	return result.trim();
}

// ── Build the SVG path from a contour + corner list ──────────────────────────
// Uses fitCurvesSegs + applyG1 for smooth inter-segment tangent continuity.
function buildPathFromCorners(pts: Point[], cornerIdxs: number[], sqTolerance: number): string {
	const r = (v: number) => Math.round(v * 100) / 100;
	const n = pts.length;
	const nc = cornerIdxs.length;
	let path = `M ${r(pts[cornerIdxs[0]][0])},${r(pts[cornerIdxs[0]][1])}`;

	for (let ci = 0; ci < nc; ci++) {
		const start = cornerIdxs[ci];
		const end   = cornerIdxs[(ci + 1) % nc];

		const seg: Point[] = [];
		let i = start;
		while (true) {
			seg.push(pts[i]);
			if (i === end && seg.length > 1) break;
			i = (i + 1) % n;
			if (seg.length > n + 1) break;
		}

		const spanSegs = fitCurvesSegs(smoothSpanInterior(seg, 3.0), sqTolerance);
		const smoothedSegs = applyG1(spanSegs);

		for (const [segP0, CP1, CP2, P3] of smoothedSegs) {
			const isLine = Math.hypot(CP1[0] - segP0[0], CP1[1] - segP0[1]) < 1e-10
			            && Math.hypot(CP2[0] - P3[0], CP2[1] - P3[1]) < 1e-10;
			if (isLine) {
				path += ` L ${r(P3[0])},${r(P3[1])}`;
			} else {
				path += ` C ${r(CP1[0])},${r(CP1[1])} ${r(CP2[0])},${r(CP2[1])} ${r(P3[0])},${r(P3[1])}`;
			}
		}
	}

	return path + ' Z';
}

// ── Hausdorff-style max edge deviation (bidirectional) ────────────────────────
// Returns the true (bidirectional) Hausdorff distance between the bezier path
// and the normalized boundary in 0-100 path units.
export function maxHausdorffDeviation(
	pathD: string,
	normBoundary: Point[]
): number {
	if (normBoundary.length === 0) return 0;

	// Extract all bezier/line segments from the SVG path
	const beziers: [Point, Point, Point, Point][] = [];
	let cur: Point = [0, 0];
	const re = /([MCLZz])\s*([-\d.,\s]*)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(pathD)) !== null) {
		const cmd = m[1];
		const nums = m[2].trim().split(/[\s,]+/).map(Number).filter(v => !isNaN(v));
		if (cmd === 'M') { cur = [nums[0], nums[1]]; }
		else if (cmd === 'C') {
			for (let j = 0; j + 5 < nums.length; j += 6) {
				const cp1: Point = [nums[j],   nums[j+1]];
				const cp2: Point = [nums[j+2], nums[j+3]];
				const end: Point = [nums[j+4], nums[j+5]];
				beziers.push([cur, cp1, cp2, end]);
				cur = end;
			}
		} else if (cmd === 'L') {
			if (nums.length >= 2) {
				const end: Point = [nums[0], nums[1]];
				beziers.push([cur, cur, end, end]);
				cur = end;
			}
		}
	}
	if (beziers.length === 0) return Infinity;

	// Pre-sample all bezier points for direction-2 check
	const bpCache: Point[] = [];
	for (const [P0, CP1, CP2, P3] of beziers) {
		for (let k = 0; k <= 20; k++) {
			bpCache.push(bezierPt(P0, CP1, CP2, P3, k / 20));
		}
	}

	// Direction 1: bezier → boundary (path samples vs boundary points)
	let maxDev1 = 0;
	for (const [P0, CP1, CP2, P3] of beziers) {
		for (let k = 0; k <= 40; k++) {
			const bp = bezierPt(P0, CP1, CP2, P3, k / 40);
			let minDist = Infinity;
			for (const nb of normBoundary) {
				const d = Math.hypot(bp[0] - nb[0], bp[1] - nb[1]);
				if (d < minDist) minDist = d;
			}
			if (minDist > maxDev1) maxDev1 = minDist;
		}
	}

	// Direction 2: boundary → bezier (boundary points vs bezier samples)
	let maxDev2 = 0;
	for (const nb of normBoundary) {
		let minDist = Infinity;
		for (const bp of bpCache) {
			const d = Math.hypot(nb[0] - bp[0], nb[1] - bp[1]);
			if (d < minDist) minDist = d;
		}
		if (minDist > maxDev2) maxDev2 = minDist;
	}

	return Math.max(maxDev1, maxDev2);
}

// ── Sample a path string to dense polygon points ─────────────────────────────
// Used in tests to rasterize a traced path for IoU measurement.
export function samplePathDense(pathD: string, samplesPerSeg = 20): Point[] {
	const points: Point[] = [];
	let cur: Point = [0, 0];
	const re = /([MCLZz])\s*([-\d.,\s]*)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(pathD)) !== null) {
		const cmd = m[1];
		const nums = m[2].trim().split(/[\s,]+/).map(Number).filter(v => !isNaN(v));
		if (cmd === 'M') {
			cur = [nums[0], nums[1]];
			points.push([...cur] as Point);
		} else if (cmd === 'C') {
			for (let j = 0; j + 5 < nums.length; j += 6) {
				const cp1: Point = [nums[j],   nums[j+1]];
				const cp2: Point = [nums[j+2], nums[j+3]];
				const end: Point = [nums[j+4], nums[j+5]];
				for (let k = 1; k <= samplesPerSeg; k++) {
					points.push(bezierPt(cur, cp1, cp2, end, k / samplesPerSeg));
				}
				cur = end;
			}
		} else if (cmd === 'L') {
			if (nums.length >= 2) {
				cur = [nums[0], nums[1]];
				points.push([...cur] as Point);
			}
		}
	}
	return points;
}

// ── PCA line fit through a point set ─────────────────────────────────────────
// Returns [cx, cy, dx, dy]: centroid + unit direction of principal axis.
function fitLine(pts: Point[]): [number, number, number, number] | null {
	const n = pts.length;
	if (n < 2) return null;
	let sx = 0, sy = 0;
	for (const [x, y] of pts) { sx += x; sy += y; }
	const cx = sx / n, cy = sy / n;
	let sxx = 0, sxy = 0, syy = 0;
	for (const [x, y] of pts) {
		const dx = x - cx, dy = y - cy;
		sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
	}
	const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
	return [cx, cy, Math.cos(angle), Math.sin(angle)];
}

// ── Line-line intersection (parametric) ──────────────────────────────────────
function lineLineIntersect(
	cx1: number, cy1: number, dx1: number, dy1: number,
	cx2: number, cy2: number, dx2: number, dy2: number
): Point | null {
	const denom = dx1 * dy2 - dy1 * dx2;
	if (Math.abs(denom) < 1e-8) return null;
	const t = ((cx2 - cx1) * dy2 - (cy2 - cy1) * dx2) / denom;
	return [cx1 + t * dx1, cy1 + t * dy1];
}

// ── Snap corners to adjacent edge-line intersections ─────────────────────────
// For each corner, fits a line to a window of points sampled from WITHIN the
// body of each adjacent span — skipping the near-corner transition zone so the
// line accurately captures the edge direction, not the transition curve.
// Moves the corner to where the two edge lines intersect.
// Only accepts moves ≤ maxMove path-units to guard against bad fits.
function refineCornerPositions(pts: Point[], cornerIdxs: number[], maxMove = 5.0): Point[] {
	const n = pts.length;
	const nc = cornerIdxs.length;
	const out = pts.slice();

	for (let ci = 0; ci < nc; ci++) {
		const idx      = cornerIdxs[ci];
		const prevIdx  = cornerIdxs[(ci - 1 + nc) % nc];
		const nextIdx  = cornerIdxs[(ci + 1) % nc];

		const spanBefore = ((idx - prevIdx + n) % n);
		const spanAfter  = ((nextIdx - idx + n) % n);

		// Before window: no skip — last wb points before the corner.
		// Captures the incoming tangent direction at the actual corner location.
		const wb = Math.max(3, Math.min(15, Math.floor(spanBefore * 0.15)));
		const before: Point[] = [];
		for (let k = wb; k >= 1; k--) before.push(pts[(idx - k + n) % n]);

		// After window: skip the near-corner transition zone, then sample the span body.
		// This lets the line fit accurately represent straight outgoing edges.
		const skipA = Math.max(2, Math.floor(spanAfter * 0.05));
		const wa    = Math.max(3, Math.min(15, Math.floor(spanAfter * 0.15)));
		const after: Point[] = [];
		for (let k = skipA + 1; k <= skipA + wa; k++) after.push(pts[(idx + k) % n]);

		const lb = fitLine(before);
		const la = fitLine(after);
		if (!lb || !la) continue;

		const inter = lineLineIntersect(lb[0], lb[1], lb[2], lb[3], la[0], la[1], la[2], la[3]);
		if (!inter) continue;

		const dist = Math.hypot(inter[0] - pts[idx][0], inter[1] - pts[idx][1]);
		if (dist < maxMove) {
			const Δx = inter[0] - pts[idx][0];
			const Δy = inter[1] - pts[idx][1];
			out[idx] = inter;
			// Taper the displacement across both transition zones so the bezier
			// fitter sees a smooth ramp into the refined corner, not a kink.
			// Outgoing span: first skipA steps after the corner.
			for (let k = 1; k <= skipA; k++) {
				const frac = (skipA - k + 1) / (skipA + 1);
				const j = (idx + k) % n;
				out[j] = [pts[j][0] + frac * Δx, pts[j][1] + frac * Δy];
			}
			// Incoming span: last tapB steps before the corner.
			const tapB = Math.min(skipA, Math.floor(spanBefore * 0.05));
			for (let k = 1; k <= tapB; k++) {
				const frac = (tapB - k + 1) / (tapB + 1);
				const j = (idx - k + n) % n;
				out[j] = [pts[j][0] + frac * Δx, pts[j][1] + frac * Δy];
			}
		}
	}
	return out;
}

// ── Bounding range of a contour ───────────────────────────────────────────────
function contourRange(pts: Point[]): number {
	if (pts.length === 0) return 1;
	let minX = pts[0][0], maxX = pts[0][0], minY = pts[0][1], maxY = pts[0][1];
	for (const [x, y] of pts) {
		if (x < minX) minX = x; if (x > maxX) maxX = x;
		if (y < minY) minY = y; if (y > maxY) maxY = y;
	}
	return Math.max(maxX - minX, maxY - minY, 1);
}

// ── Main entry point ──────────────────────────────────────────────────────────
// v4 pipeline:
//   Pass 1  Gaussian blur (σ_image) + Otsu → binary mask
//   Pass 2  Moore contour trace → full pixel boundary
//   Pass 3  smoothContour (σ=1.5) → light-smooth for corner detection + normalization
//   Pass 4  detectCornersFromCurvature on light-smooth → Menger curvature corners
//   Pass 5  normalizePts(light-smooth) → 0-100 space (corner coords stay sharp)
//   Pass 6  buildPathFromCorners: fitCurvesSegs + applyG1
//   Pass 7  bidirectional Hausdorff gate; retry with tighter σ_image if needed
export function traceImageData(data: Uint8ClampedArray, W: number, H: number): string {
	if (W < 8 || H < 8) throw new Error('Image too small — minimum 8×8 px.');

	for (const sigmaImg of [2.0, 1.5, 1.0] as number[]) {
		const grid    = buildBinaryGrid(data, W, H, sigmaImg);
		const contour = mooreContour(grid, W, H);
		if (contour.length < 3) continue;

		// Light smooth for corner detection and normalization
		const lightSmooth = smoothContour(contour, 1.5);
		const fineCorners = detectCornersFromCurvature(lightSmooth);

		// Normalize lightly-smoothed contour, then snap corners to adjacent
		// edge-line intersections (corrects the Moore-contour "notch" artifact).
		const norm  = normalizePts(lightSmooth);
		const normR = refineCornerPositions(norm, fineCorners);

		// Tolerance: 2.0px in path units (span pre-smoothing removes staircase noise,
		// so fitter no longer needs to subdivide to chase 1px artifacts)
		const range   = contourRange(contour);
		const pxToUnit = 94 / range;
		const sqTol   = (2.0 * pxToUnit) ** 2;

		const pathD = buildPathFromCorners(normR, fineCorners, sqTol);

		// Hausdorff gate vs refined contour (normR is the authoritative target after
		// corner snapping; comparing vs normR keeps the fitter honest without penalising
		// the intentional ≤5 path-unit corner shifts)
		const deviation = maxHausdorffDeviation(pathD, normR);
		if (deviation <= 2.0 * pxToUnit) return pathD;
	}

	// Final fallback: tightest pass
	const grid    = buildBinaryGrid(data, W, H, 1.0);
	const contour = mooreContour(grid, W, H);
	if (contour.length < 3) throw new Error('No shape detected.');
	const lightSmooth = smoothContour(contour, 1.0);
	const fineCorners = detectCornersFromCurvature(lightSmooth);
	const norm        = normalizePts(lightSmooth);
	const normR       = refineCornerPositions(norm, fineCorners);
	const range       = contourRange(contour);
	const sqTol       = (1.5 * 94 / range) ** 2;
	return buildPathFromCorners(normR, fineCorners, sqTol);
}
