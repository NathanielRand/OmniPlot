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

// ─── G1 enforcement ───────────────────────────────────────────────────────────

// Adjusts p2 of `cur` and p1 of `nxt` so both tangents align to their bisector.
// Control point distances (arm lengths) are preserved — only direction changes.
function enforceG1(cur: Seg, nxt: Seg): void {
	const exitDir  = exitTangent(cur);
	const entryDir = entryTangent(nxt);

	const eu = unit(exitDir);
	const nu = unit(entryDir);
	if (!eu || !nu) return;

	// Bisector of the two unit directions — the smoothed tangent line.
	const bisector = unit(add(eu, nu));
	if (!bisector) return; // exactly antiparallel → genuine cusp, skip

	const exitLen  = mag(sub(cur.p3,  cur.p2));
	const entryLen = mag(sub(nxt.p1,  nxt.p0));

	// Preserve arm lengths, align both to bisector.
	cur.p2  = sub(cur.p3,  scl(bisector, exitLen));
	nxt.p1  = add(nxt.p0,  scl(bisector, entryLen));
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
		for (const s of segs) d += ` C ${ptStr(s.p1)} ${ptStr(s.p2)} ${ptStr(s.p3)}`;
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
 * The threshold default of 20° means: wiggles from tracing noise get smoothed,
 * while genuine geometry changes (45°, 90° corners, etc.) are preserved exactly.
 */
export function smoothBezierJunctions(svgPath: string, cornerThresholdDeg = 20): string {
	const subpaths = parsePath(svgPath);

	for (const segs of subpaths) {
		const n = segs.length;
		if (n < 2) continue;

		for (let i = 0; i < n; i++) {
			const j = (i + 1) % n;        // wraps: last seg → first seg (closed path)
			const cur = segs[i];
			const nxt = segs[j];

			// Verify the junction is geometrically connected.
			if (mag(sub(cur.p3, nxt.p0)) > 1e-6) continue;

			const angle = angleBetween(exitTangent(cur), entryTangent(nxt));

			if (angle < cornerThresholdDeg) {
				enforceG1(cur, nxt);
			}
			// else: genuine corner — both control points stay exactly as-is
		}
	}

	return serializePath(subpaths);
}
