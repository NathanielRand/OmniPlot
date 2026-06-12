// Post-processes a cubic bezier SVG path by analyzing each inter-segment junction.
// Junctions where the exit and entry tangents deviate by less than `cornerThresholdDeg`
// are G1-smoothed (control points averaged to the bisector direction).
// Genuine corners — high-angle junctions — are left entirely untouched.
//
// Designed for potrace output: handles M/C/L/Z (absolute) and m/c/l/z (relative).
// Safe to run on either raw or normalized paths — all operations are affine-invariant.

interface Pt { x: number; y: number }

// Cubic bezier segment in absolute coordinates.
interface Seg { p0: Pt; p1: Pt; p2: Pt; p3: Pt }

// ─── Vector math ─────────────────────────────────────────────────────────────

function add(a: Pt, b: Pt): Pt { return { x: a.x + b.x, y: a.y + b.y }; }
function sub(a: Pt, b: Pt): Pt { return { x: a.x - b.x, y: a.y - b.y }; }
function scl(p: Pt, s: number): Pt { return { x: p.x * s, y: p.y * s }; }
function mag(p: Pt): number { return Math.sqrt(p.x * p.x + p.y * p.y); }
function unit(p: Pt): Pt | null {
	const m = mag(p);
	return m < 1e-10 ? null : { x: p.x / m, y: p.y / m };
}
function dot(a: Pt, b: Pt): number { return a.x * b.x + a.y * b.y; }

function angleBetween(a: Pt, b: Pt): number {
	const ua = unit(a), ub = unit(b);
	if (!ua || !ub) return 0;
	return Math.acos(Math.max(-1, Math.min(1, dot(ua, ub)))) * (180 / Math.PI);
}

// ─── Tangent helpers ──────────────────────────────────────────────────────────

// Exit tangent of a cubic segment: from p2 toward p3.
// Falls back to p3-p0 for degenerate segments where p2 ≈ p3.
function exitTangent(s: Seg): Pt {
	const t = sub(s.p3, s.p2);
	return mag(t) > 1e-10 ? t : sub(s.p3, s.p0);
}

// Entry tangent of a cubic segment: from p0 toward p1.
// Falls back to p3-p0 for degenerate segments where p0 ≈ p1.
function entryTangent(s: Seg): Pt {
	const t = sub(s.p1, s.p0);
	return mag(t) > 1e-10 ? t : sub(s.p3, s.p0);
}

// ─── Chord-projection helpers ─────────────────────────────────────────────────

function perpDistToChord(p: Pt, a: Pt, b: Pt): number {
	const dx = b.x - a.x, dy = b.y - a.y;
	const len = Math.sqrt(dx * dx + dy * dy);
	if (len < 1e-10) return Math.hypot(p.x - a.x, p.y - a.y);
	return Math.abs((p.y - a.y) * dx - (p.x - a.x) * dy) / len;
}

function projectOntoChord(p: Pt, a: Pt, b: Pt): Pt {
	const dx = b.x - a.x, dy = b.y - a.y;
	const lenSq = dx * dx + dy * dy;
	if (lenSq < 1e-10) return { ...a };
	const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
	return { x: a.x + t * dx, y: a.y + t * dy };
}

// For a curved run: smooth junction positions with 6-pass Laplacian (0.25/0.5/0.25),
// then re-derive all control points with Catmull-Rom tangents so the full run is
// C1-smooth end-to-end — not just positionally smoothed, but tangent-smooth too.
function smoothCurvedRunEndpoints(segs: Seg[], run: number[]): void {
	const m = run.length - 1; // number of interior junctions
	if (m < 1) return;

	const p0 = segs[run[0]].p0;
	const pn = segs[run[run.length - 1]].p3;

	// Smooth junction positions with 6 Laplacian passes (endpoints pinned).
	let jx: Pt[] = run.slice(0, m).map(k => ({ ...segs[k].p3 }));
	for (let pass = 0; pass < 6; pass++) {
		jx = jx.map((j, i) => {
			const prev = i === 0     ? p0 : jx[i - 1];
			const next = i === m - 1 ? pn : jx[i + 1];
			return {
				x: 0.25 * prev.x + 0.5 * j.x + 0.25 * next.x,
				y: 0.25 * prev.y + 0.5 * j.y + 0.25 * next.y,
			};
		});
	}

	// Build knot array: [p0, jx[0]…jx[m-1], pn] — length m+2.
	const pts: Pt[] = [p0, ...jx, pn];

	// Catmull-Rom tangent at knot i: central difference for interior, one-sided at ends.
	const tanAt = (i: number): Pt => {
		if (i === 0)     return sub(pts[1], pts[0]);
		if (i === m + 1) return sub(pts[m + 1], pts[m]);
		return scl(sub(pts[i + 1], pts[i - 1]), 0.5);
	};

	// Re-derive each segment with C1-smooth control points (1/3 rule).
	for (let k = 0; k <= m; k++) {
		const s = segs[run[k]];
		s.p0 = pts[k];
		s.p1 = add(pts[k],     scl(tanAt(k),     1 / 3));
		s.p2 = sub(pts[k + 1], scl(tanAt(k + 1), 1 / 3));
		s.p3 = pts[k + 1];
	}
}

// Partitions the segment chain into runs bounded by genuine corners (angle ≥
// cornerThreshDeg), then for each run:
//   • Collinear run (all endpoints within maxRunDevFrac of chord): replaced
//     with a single straight segment p0→pn — zero intermediate joints means
//     zero seam artifacts, and the result is immune to internal endpoint noise.
//   • Curved run: mild Gaussian endpoint smoothing applied in place, then all
//     original segments are kept.
// Returns a new Seg[] (may be shorter than input when runs are collapsed).
function collapseCollinearRuns(segs: Seg[], cornerThreshDeg: number, maxRunDevFrac = 0.03): Seg[] {
	const n = segs.length;
	if (n < 2) return segs.slice();

	// Mark run-start indices (corner junctions or geometric gaps).
	const isBoundary = new Uint8Array(n);
	for (let i = 0; i < n; i++) {
		const prev = (i - 1 + n) % n;
		if (mag(sub(segs[prev].p3, segs[i].p0)) > 1e-6) { isBoundary[i] = 1; continue; }
		if (angleBetween(exitTangent(segs[prev]), entryTangent(segs[i])) >= cornerThreshDeg) {
			isBoundary[i] = 1;
		}
	}

	const starts: number[] = [];
	for (let i = 0; i < n; i++) if (isBoundary[i]) starts.push(i);
	if (starts.length === 0) starts.push(0);

	const nr     = starts.length;
	const result: Seg[] = [];

	for (let ri = 0; ri < nr; ri++) {
		const runStart  = starts[ri];
		const nextStart = starts[(ri + 1) % nr];

		const run: number[] = [];
		for (let i = runStart; ; i = (i + 1) % n) {
			run.push(i);
			if ((i + 1) % n === nextStart || run.length >= n) break;
		}

		const p0   = segs[run[0]].p0;
		const pn   = segs[run[run.length - 1]].p3;
		const span = Math.hypot(pn.x - p0.x, pn.y - p0.y);

		if (span < 1e-10) { for (const k of run) result.push(segs[k]); continue; }

		// Max perpendicular deviation of any endpoint from the run chord.
		let maxDev = 0;
		for (const k of run) {
			const d = perpDistToChord(segs[k].p3, p0, pn);
			if (d > maxDev) maxDev = d;
		}
		// Also check the run's own start point.
		{
			const d = perpDistToChord(p0, p0, pn);
			if (d > maxDev) maxDev = d;
		}

		if (maxDev <= maxRunDevFrac * span) {
			// Collinear: emit one straight segment for the whole run.
			const dx = pn.x - p0.x, dy = pn.y - p0.y;
			result.push({
				p0,
				p1: { x: p0.x + dx / 3,       y: p0.y + dy / 3       },
				p2: { x: p0.x + dx * 2 / 3,    y: p0.y + dy * 2 / 3   },
				p3: pn,
			});
		} else {
			// Curved: smooth endpoint noise, keep all segments.
			smoothCurvedRunEndpoints(segs, run);
			for (const k of run) result.push(segs[k]);
		}
	}

	return result;
}

// ─── G1 enforcement ───────────────────────────────────────────────────────────

// Adjusts p2 of `cur` and p1 of `nxt` so both tangents align to their bisector.
// When both arms are real (curve-to-curve junction), arm lengths are averaged so
// curvature transitions continuously rather than jumping at the junction.
function enforceG1(cur: Seg, nxt: Seg): void {
	const exitDir  = exitTangent(cur);
	const entryDir = entryTangent(nxt);

	const eu = unit(exitDir);
	const nu = unit(entryDir);
	if (!eu || !nu) return;

	// Bisector of the two unit directions — the smoothed tangent line.
	const bisector = unit(add(eu, nu));
	if (!bisector) return; // exactly antiparallel → genuine cusp, skip

	const exitLen  = mag(sub(cur.p3, cur.p2));
	const entryLen = mag(sub(nxt.p1, nxt.p0));

	// For curve-to-curve junctions, average arm lengths to reduce curvature jumps.
	// For straight-to-curve junctions (one arm ≈ 0), keep each arm as-is.
	const len = (exitLen > 1e-4 && entryLen > 1e-4)
		? (exitLen + entryLen) / 2
		: undefined;

	cur.p2 = sub(cur.p3, scl(bisector, len ?? exitLen));
	nxt.p1 = add(nxt.p0, scl(bisector, len ?? entryLen));
}

// ─── SVG path parser ──────────────────────────────────────────────────────────

function tokenize(d: string): string[] {
	const re = /([MmCcLlHhVvZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
	const out: string[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(d)) !== null) out.push(m[0]);
	return out;
}

const CMD_RE = /^[MmCcLlHhVvZz]$/;

function parsePath(d: string): Seg[][] {
	const tokens = tokenize(d);
	const subpaths: Seg[][] = [];
	let current: Seg[] = [];
	let cx = 0, cy = 0;       // current pen
	let sx = 0, sy = 0;       // subpath start (for Z)
	let i  = 0;

	function num() { return parseFloat(tokens[i++]); }
	function hasNum() { return i < tokens.length && !CMD_RE.test(tokens[i]); }

	while (i < tokens.length) {
		const cmd = tokens[i++];
		switch (cmd) {
			case 'M':
				if (current.length) subpaths.push(current);
				current = [];
				cx = num(); cy = num();
				sx = cx; sy = cy;
				// Implicit L after M
				while (hasNum()) {
					const p0 = { x: cx, y: cy };
					const x3 = num(), y3 = num();
					current.push({ p0, p1: p0, p2: { x: x3, y: y3 }, p3: { x: x3, y: y3 } });
					cx = x3; cy = y3;
				}
				break;
			case 'm':
				if (current.length) subpaths.push(current);
				current = [];
				cx += num(); cy += num();
				sx = cx; sy = cy;
				while (hasNum()) {
					const p0 = { x: cx, y: cy };
					const dx = num(), dy = num();
					const x3 = cx + dx, y3 = cy + dy;
					current.push({ p0, p1: p0, p2: { x: x3, y: y3 }, p3: { x: x3, y: y3 } });
					cx = x3; cy = y3;
				}
				break;
			case 'C':
				while (hasNum()) {
					const p0 = { x: cx, y: cy };
					const p1 = { x: num(), y: num() };
					const p2 = { x: num(), y: num() };
					const p3 = { x: num(), y: num() };
					current.push({ p0, p1, p2, p3 });
					cx = p3.x; cy = p3.y;
				}
				break;
			case 'c':
				while (hasNum()) {
					const p0 = { x: cx, y: cy };
					const p1 = { x: cx + num(), y: cy + num() };
					const p2 = { x: cx + num(), y: cy + num() };
					const x3 = cx + num(), y3 = cy + num();
					const p3 = { x: x3, y: y3 };
					current.push({ p0, p1, p2, p3 });
					cx = x3; cy = y3;
				}
				break;
			case 'L':
				while (hasNum()) {
					const p0 = { x: cx, y: cy };
					const x3 = num(), y3 = num();
					const p3 = { x: x3, y: y3 };
					// Degenerate cubic — tangent falls back to p3-p0 in helpers
					current.push({ p0, p1: p0, p2: p3, p3 });
					cx = x3; cy = y3;
				}
				break;
			case 'l':
				while (hasNum()) {
					const p0 = { x: cx, y: cy };
					const dx = num(), dy = num();
					const p3 = { x: cx + dx, y: cy + dy };
					current.push({ p0, p1: p0, p2: p3, p3 });
					cx = p3.x; cy = p3.y;
				}
				break;
			case 'H':
				while (hasNum()) {
					const p0 = { x: cx, y: cy };
					cx = num();
					const p3 = { x: cx, y: cy };
					current.push({ p0, p1: p0, p2: p3, p3 });
				}
				break;
			case 'h':
				while (hasNum()) {
					const p0 = { x: cx, y: cy };
					cx += num();
					const p3 = { x: cx, y: cy };
					current.push({ p0, p1: p0, p2: p3, p3 });
				}
				break;
			case 'V':
				while (hasNum()) {
					const p0 = { x: cx, y: cy };
					cy = num();
					const p3 = { x: cx, y: cy };
					current.push({ p0, p1: p0, p2: p3, p3 });
				}
				break;
			case 'v':
				while (hasNum()) {
					const p0 = { x: cx, y: cy };
					cy += num();
					const p3 = { x: cx, y: cy };
					current.push({ p0, p1: p0, p2: p3, p3 });
				}
				break;
			case 'Z': case 'z':
				cx = sx; cy = sy;
				break;
		}
	}
	if (current.length) subpaths.push(current);
	return subpaths;
}

// ─── Serializer ───────────────────────────────────────────────────────────────

function r(n: number): string { return String(Math.round(n * 1000) / 1000); }
function ptStr(p: Pt): string { return `${r(p.x)},${r(p.y)}`; }

function serializePath(subpaths: Seg[][]): string {
	return subpaths.map(segs => {
		if (!segs.length) return '';
		let d = `M ${ptStr(segs[0].p0)}`;
		for (const s of segs) {
			// Emit L for collapsed straight segments (CPs on the chord).
			if (perpDistToChord(s.p1, s.p0, s.p3) < 1e-4 &&
			    perpDistToChord(s.p2, s.p0, s.p3) < 1e-4) {
				d += ` L ${ptStr(s.p3)}`;
			} else {
				d += ` C ${ptStr(s.p1)} ${ptStr(s.p2)} ${ptStr(s.p3)}`;
			}
		}
		d += ' Z';
		return d;
	}).filter(Boolean).join(' ');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Smooths near-collinear bezier junctions in an SVG path string.
 *
 * For each junction between segment[i] and segment[i+1] in a closed subpath:
 * - If the angle between exit tangent (seg[i]) and entry tangent (seg[i+1])
 *   is below `cornerThresholdDeg`: enforce G1 continuity by aligning both
 *   control-point arms to their bisector direction (arm lengths unchanged).
 * - If the angle is at or above the threshold: leave the junction as a hard
 *   corner — no modification.
 *
 * The threshold default of 25° means: wiggles and near-smooth transitions from
 * tracing noise get smoothed, while genuine geometry changes (45°, 90° corners,
 * etc.) are preserved exactly.
 */
export function smoothBezierJunctions(svgPath: string, cornerThresholdDeg = 25): string {
	const subpaths  = parsePath(svgPath);
	const processed = subpaths.map(segs => {
		if (segs.length < 2) return segs;

		// Pass 1: collapse collinear runs to single segments; smooth curved run
		// endpoints.  Returns a new (possibly shorter) Seg[] so intermediate
		// joints on straight edges are fully eliminated.
		const collapsed = collapseCollinearRuns(segs, cornerThresholdDeg);
		const n = collapsed.length;

		// Passes 2–4: G1 junction smoothing run three times for convergence.
		for (let pass = 0; pass < 3; pass++) {
			for (let i = 0; i < n; i++) {
				const j   = (i + 1) % n;
				const cur = collapsed[i];
				const nxt = collapsed[j];
				if (mag(sub(cur.p3, nxt.p0)) > 1e-6) continue;
				if (angleBetween(exitTangent(cur), entryTangent(nxt)) < cornerThresholdDeg) {
					enforceG1(cur, nxt);
				}
			}
		}

		return collapsed;
	});

	return serializePath(processed);
}
