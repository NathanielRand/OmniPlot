// ─────────────────────────────────────────────
// OmniPlot — POLYGON MATH LIBRARY
//
// Pure computational geometry — no DOM, no Svelte, no side effects.
// All coordinates are in inches.
// Winding convention: CCW = positive (exterior) polygon.
// ─────────────────────────────────────────────

export type Point   = { x: number; y: number };
export type Polygon = Point[];

// ─── Basic operations ─────────────────────────

export function signedArea(pts: Polygon): number {
	let a = 0;
	const n = pts.length;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
	}
	return a / 2;
}

export function ensureCCW(pts: Polygon): Polygon {
	return signedArea(pts) < 0 ? [...pts].reverse() : [...pts];
}

export function centroid(pts: Polygon): Point {
	let x = 0, y = 0;
	for (const p of pts) { x += p.x; y += p.y; }
	return { x: x / pts.length, y: y / pts.length };
}

export function polygonBounds(pts: Polygon): {
	minX: number; minY: number; maxX: number; maxY: number;
} {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const p of pts) {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
	}
	return { minX, minY, maxX, maxY };
}

export function translatePolygon(pts: Polygon, dx: number, dy: number): Polygon {
	return pts.map(p => ({ x: p.x + dx, y: p.y + dy }));
}

export function rotatePoints(pts: Polygon, deg: number): Polygon {
	if (deg === 0) return pts;
	const rad = (deg * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	return pts.map(p => ({
		x: cos * p.x - sin * p.y,
		y: sin * p.x + cos * p.y,
	}));
}

// Shift polygon so its bbox starts at (0, 0).
export function normalizeToBBox(pts: Polygon): Polygon {
	const { minX, minY } = polygonBounds(pts);
	return translatePolygon(pts, -minX, -minY);
}

// Reflect through origin: used to compute NFP = Minkowski(A, -B).
export function reflectPolygon(pts: Polygon): Polygon {
	return pts.map(p => ({ x: -p.x, y: -p.y }));
}

// Expand each vertex outward from the polygon's centroid by `amount` inches.
// Approximation for convex shapes; used to add inter-piece spacing.
// True polygon offset: push every EDGE outward by `amount` along its own
// normal, then re-derive each vertex as the miter intersection of its two
// adjacent offset edges. (The previous implementation scaled each vertex
// radially away from the centroid — for anything but a near-circular shape
// that under/over-shoots the intended clearance, worst at elongated
// rectangles' corners. Two items placed exactly PAD apart could then still
// register as overlapping here, sending finalDeclash's nudge loop to its
// 500-iteration cap and silently adding up to 5" of bogus extra gap.)
// Requires `pts` to be CCW (wrap callers with ensureCCW first).
export function inflatePolygon(pts: Polygon, amount: number): Polygon {
	if (amount === 0 || pts.length < 3) return pts;
	const n = pts.length;
	const edgeNormal = (a: Point, b: Point): Point => {
		const dx = b.x - a.x, dy = b.y - a.y;
		const len = Math.sqrt(dx * dx + dy * dy);
		if (len < 1e-9) return { x: 0, y: 0 };
		// Outward normal for a CCW polygon: rotate the edge vector -90°.
		return { x: dy / len, y: -dx / len };
	};
	return pts.map((p, i) => {
		const prev = pts[(i - 1 + n) % n];
		const next = pts[(i + 1) % n];
		const n1 = edgeNormal(prev, p);
		const n2 = edgeNormal(p, next);
		let bis = { x: n1.x + n2.x, y: n1.y + n2.y };
		const bisLen = Math.sqrt(bis.x * bis.x + bis.y * bis.y);
		if (bisLen < 1e-9) bis = n1; // ~180° turn — normals cancel, fall back
		else bis = { x: bis.x / bisLen, y: bis.y / bisLen };
		// Miter length = amount / cos(half the turn angle between edges).
		// Cap the miter at sharp/reflex corners so it can't blow up.
		const cosHalf = bis.x * n1.x + bis.y * n1.y;
		const miter = cosHalf > 0.15 ? amount / cosHalf : amount;
		return { x: p.x + bis.x * miter, y: p.y + bis.y * miter };
	});
}

// ─── Convex hull — Graham scan ────────────────

export function convexHull(pts: Polygon): Polygon {
	if (pts.length < 3) return [...pts];
	const pivot = [...pts].sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x)[0];
	const sorted = [...pts]
		.filter(p => p !== pivot)
		.sort((a, b) => {
			const angA = Math.atan2(a.y - pivot.y, a.x - pivot.x);
			const angB = Math.atan2(b.y - pivot.y, b.x - pivot.x);
			if (Math.abs(angA - angB) > 1e-10) return angA - angB;
			return ((a.x - pivot.x) ** 2 + (a.y - pivot.y) ** 2) -
			       ((b.x - pivot.x) ** 2 + (b.y - pivot.y) ** 2);
		});
	const hull: Polygon = [pivot];
	for (const p of sorted) {
		while (hull.length >= 2) {
			const a = hull[hull.length - 2];
			const b = hull[hull.length - 1];
			const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
			if (cross <= 0) hull.pop(); else break;
		}
		hull.push(p);
	}
	return hull;
}

// ─── Point in polygon — winding number ───────

export function pointInPolygon(p: Point, poly: Polygon): boolean {
	let winding = 0;
	const n = poly.length;
	for (let i = 0; i < n; i++) {
		const a = poly[i];
		const b = poly[(i + 1) % n];
		if (a.y <= p.y) {
			if (b.y > p.y) {
				const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
				if (cross > 0) winding++;
			}
		} else {
			if (b.y <= p.y) {
				const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
				if (cross < 0) winding--;
			}
		}
	}
	return winding !== 0;
}

// ─── Minkowski sum — convex polygons only ─────
// Both inputs must be convex and in CCW winding.
// Returns the Minkowski sum A ⊕ B (also convex, CCW).

function bottomIdx(pts: Polygon): number {
	let idx = 0;
	for (let i = 1; i < pts.length; i++) {
		if (pts[i].y < pts[idx].y || (pts[i].y === pts[idx].y && pts[i].x < pts[idx].x))
			idx = i;
	}
	return idx;
}

// Build edge vectors starting from `start`, with angles unwrapped to be
// monotonically non-decreasing (handles the -π/+π wrap-around).
function buildEdges(poly: Polygon, start: number): Array<{ dx: number; dy: number; angle: number }> {
	const edges: Array<{ dx: number; dy: number; angle: number }> = [];
	let prevAng = -Infinity;
	for (let i = 0; i < poly.length; i++) {
		const cur  = (start + i)     % poly.length;
		const next = (start + i + 1) % poly.length;
		const dx = poly[next].x - poly[cur].x;
		const dy = poly[next].y - poly[cur].y;
		let ang = Math.atan2(dy, dx);
		while (ang < prevAng - 1e-9) ang += 2 * Math.PI;
		prevAng = ang;
		edges.push({ dx, dy, angle: ang });
	}
	return edges;
}

export function minkowskiSumConvex(A: Polygon, B: Polygon): Polygon {
	if (A.length < 2 || B.length < 2) return [...A];

	const a = ensureCCW([...A]);
	const b = ensureCCW([...B]);

	const edgesA = buildEdges(a, bottomIdx(a));
	const edgesB = buildEdges(b, bottomIdx(b));

	const start: Point = {
		x: a[bottomIdx(a)].x + b[bottomIdx(b)].x,
		y: a[bottomIdx(a)].y + b[bottomIdx(b)].y,
	};
	const result: Polygon = [{ ...start }];

	let i = 0, j = 0;
	const EPS = 1e-9;

	while (i < edgesA.length || j < edgesB.length) {
		const cur  = result[result.length - 1];
		const angA = i < edgesA.length ? edgesA[i].angle : Infinity;
		const angB = j < edgesB.length ? edgesB[j].angle : Infinity;

		let dx = 0, dy = 0;
		if (Math.abs(angA - angB) < EPS) {
			dx = edgesA[i].dx + edgesB[j].dx;
			dy = edgesA[i].dy + edgesB[j].dy;
			i++; j++;
		} else if (angA < angB) {
			dx = edgesA[i].dx; dy = edgesA[i].dy; i++;
		} else {
			dx = edgesB[j].dx; dy = edgesB[j].dy; j++;
		}
		result.push({ x: cur.x + dx, y: cur.y + dy });
	}

	if (result.length > 1) result.pop(); // last == first for closed polygon
	return result;
}

// ─── NFP — convex polygons ────────────────────
// Returns the No-Fit Polygon: positions for B's (0,0) anchor such that
// B just touches A without overlapping. Points INSIDE the NFP = collision.
// Uses convex hull approximation for near-convex inputs.

export function nfpConvex(A: Polygon, B: Polygon): Polygon {
	const hullA = ensureCCW(convexHull(A));
	const hullB = ensureCCW(convexHull(B));
	const reflected = ensureCCW(reflectPolygon(hullB));
	return ensureCCW(minkowskiSumConvex(hullA, reflected));
}

// ─── Convex decomposition — ear-clipping ─────
// Decomposes a simple polygon (possibly non-convex) into convex triangles.
// Returns an array of triangles whose union covers the original polygon.
// Falls back to convex hull if decomposition stalls (degenerate input).

function cross2D(O: Point, A: Point, B: Point): number {
	return (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
}

function isEar(pts: Polygon, i: number): boolean {
	const n = pts.length;
	const a = pts[(i - 1 + n) % n];
	const b = pts[i];
	const c = pts[(i + 1) % n];
	if (cross2D(a, b, c) <= 0) return false;
	for (let j = 0; j < n; j++) {
		if (j === (i - 1 + n) % n || j === i || j === (i + 1) % n) continue;
		const p = pts[j];
		if (cross2D(a, b, p) >= 0 && cross2D(b, c, p) >= 0 && cross2D(c, a, p) >= 0)
			return false;
	}
	return true;
}

// Defense in depth: full ear-clip triangulation is O(n^2), and nfpGeneral
// then pairs every triangle of A against every triangle of B (O(n^2 * m^2)
// total). Callers are expected to hand in already-coarse polygons, but if
// something ever slips through with a large vertex count, fall back to a
// single convex-hull piece rather than triangulating it — an approximation
// beats hanging the tab.
const MAX_DECOMPOSE_VERTICES = 30;

export function convexDecompose(pts: Polygon): Polygon[] {
	const poly = ensureCCW([...pts]);
	if (poly.length < 3) return [];
	if (poly.length > MAX_DECOMPOSE_VERTICES) return [ensureCCW(convexHull(poly))];

	// Already convex? return as-is.
	let convex = true;
	for (let i = 0; i < poly.length; i++) {
		const a = poly[(i - 1 + poly.length) % poly.length];
		const b = poly[i];
		const c = poly[(i + 1) % poly.length];
		if (cross2D(a, b, c) < -1e-9) { convex = false; break; }
	}
	if (convex) return [poly];

	const triangles: Polygon[] = [];
	let remaining = [...poly];
	let safety = remaining.length * 3;

	while (remaining.length > 3 && safety-- > 0) {
		let clipped = false;
		for (let i = 0; i < remaining.length; i++) {
			if (isEar(remaining, i)) {
				const n = remaining.length;
				triangles.push([
					remaining[(i - 1 + n) % n],
					remaining[i],
					remaining[(i + 1) % n],
				]);
				remaining = remaining.filter((_, idx) => idx !== i);
				clipped = true;
				break;
			}
		}
		if (!clipped) break;
	}
	if (remaining.length >= 3) triangles.push(remaining.slice(0, 3));

	return triangles.length > 0 ? triangles : [ensureCCW(convexHull(poly))];
}

// ─── NFP — general (non-convex) polygons ─────
// Decomposes A and B into convex triangles, computes pairwise convex NFPs.
// Returns an array of NFP polygons; check point-in-ANY for collision.

export function nfpGeneral(A: Polygon, B: Polygon): Polygon[] {
	const partsA = convexDecompose(ensureCCW(A));
	const partsB = convexDecompose(ensureCCW(B));
	const nfps: Polygon[] = [];
	for (const pa of partsA) {
		for (const pb of partsB) {
			try {
				const nfp = nfpConvex(pa, pb);
				if (nfp.length >= 3) nfps.push(nfp);
			} catch { /* degenerate pair — skip */ }
		}
	}
	return nfps;
}

// ─── Inner Fit Bounds ─────────────────────────
// Returns the rectangle of valid anchor positions for polygon B
// inside a containerW × containerH axis-aligned box.
// Anchor convention: B's local coordinates are normalized so minX=minY=0.
// Returns null if B is too large to fit in any orientation.

export function innerFitBounds(
	containerW: number,
	containerH: number,
	B: Polygon,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
	const { minX, minY, maxX, maxY } = polygonBounds(B);
	const ifpMinX = -minX;              // = 0 after normalization
	const ifpMaxX = containerW - maxX;
	const ifpMinY = -minY;              // = 0 after normalization
	const ifpMaxY = containerH - maxY;
	if (ifpMaxX < ifpMinX - 1e-6 || ifpMaxY < ifpMinY - 1e-6) return null;
	return {
		minX: Math.max(0, ifpMinX),
		minY: Math.max(0, ifpMinY),
		maxX: ifpMaxX,
		maxY: ifpMaxY,
	};
}

// ─── Segment intersection ─────────────────────

function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
	const d1 = { x: p2.x - p1.x, y: p2.y - p1.y };
	const d2 = { x: p4.x - p3.x, y: p4.y - p3.y };
	const denom = d1.x * d2.y - d1.y * d2.x;
	if (Math.abs(denom) < 1e-12) return null;
	const t = ((p3.x - p1.x) * d2.y - (p3.y - p1.y) * d2.x) / denom;
	const u = ((p3.x - p1.x) * d1.y - (p3.y - p1.y) * d1.x) / denom;
	if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
	return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
}

// ─── Candidate anchor positions ───────────────
// Optimal NFP placement is always at a vertex of some NFP or IFP boundary,
// or at an intersection of two NFP boundaries. We collect all of these.

export function nfpCandidates(
	nfpGroups: Polygon[][],   // [groupIndex][polygonIndex] — absolute coords
	ifp: { minX: number; minY: number; maxX: number; maxY: number },
): Point[] {
	const pts: Point[] = [
		// IFP corners
		{ x: ifp.minX, y: ifp.minY },
		{ x: ifp.maxX, y: ifp.minY },
		{ x: ifp.minX, y: ifp.maxY },
		{ x: ifp.maxX, y: ifp.maxY },
	];

	// All NFP vertices
	for (const group of nfpGroups) {
		for (const nfp of group) {
			for (const v of nfp) pts.push(v);
		}
	}

	// Intersections between NFP edges from different groups (capped for performance)
	if (nfpGroups.length <= 10) {
		for (let gi = 0; gi < nfpGroups.length; gi++) {
			for (const nfpA of nfpGroups[gi]) {
				const na = nfpA.length;
				for (let ei = 0; ei < na; ei++) {
					const p1 = nfpA[ei], p2 = nfpA[(ei + 1) % na];
					for (let gj = gi + 1; gj < nfpGroups.length; gj++) {
						for (const nfpB of nfpGroups[gj]) {
							const nb = nfpB.length;
							for (let ej = 0; ej < nb; ej++) {
								const p3 = nfpB[ej], p4 = nfpB[(ej + 1) % nb];
								const ix = segmentsIntersect(p1, p2, p3, p4);
								if (ix) pts.push(ix);
							}
						}
					}
				}
			}
		}
	}

	return pts;
}

// ─── True overlap verification ───────────────
// nfpGeneral's forbidden zone is a UNION of pairwise convex-part NFPs — at
// the seams between decomposed parts that union can have small false-free
// gaps (a point that reads as "outside every part-NFP" while the full
// concave shapes actually still overlap there). That's a real correctness
// gap, not floating-point noise: the anchor-search can and does pick points
// a few hundredths of an inch inside the true silhouette.
//
// This is the final authoritative check after the candidate search, so it
// deliberately does NOT go through convex decomposition again — decompose
// is itself triangulation-based (ear-clipping) and can produce a bad/stale
// triangle on degenerate input (see MAX_DECOMPOSE_VERTICES fallback above),
// which would make a "verification" step trust the same kind of imperfect
// approximation it exists to catch. Two SIMPLE polygons (convex or concave)
// overlap iff any edge of one crosses any edge of the other, OR one is
// entirely inside the other with no edges crossing at all — operating
// directly on the real (sampled) boundary is exact for both cases and
// doesn't depend on triangulation being correct.
export function polygonsOverlap(A: Polygon, B: Polygon): boolean {
	if (A.length < 3 || B.length < 3) return false;

	const na = A.length, nb = B.length;
	for (let i = 0; i < na; i++) {
		const a1 = A[i], a2 = A[(i + 1) % na];
		for (let j = 0; j < nb; j++) {
			const b1 = B[j], b2 = B[(j + 1) % nb];
			if (segmentsIntersect(a1, a2, b1, b2)) return true;
		}
	}
	// No edges cross — either fully separate, or one wholly contains the
	// other (e.g. a tiny piece nested inside a large one). One containment
	// check per side is enough since no edge crossing means "inside" is
	// all-or-nothing for a given pair.
	if (pointInPolygon(A[0], B)) return true;
	if (pointInPolygon(B[0], A)) return true;
	return false;
}
