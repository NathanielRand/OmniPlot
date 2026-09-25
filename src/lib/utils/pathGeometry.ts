// ─────────────────────────────────────────────
// ⚠ PRECISION MANUFACTURING SOFTWARE — exact SVG path geometry. ⚠
//
// Every pattern outline in OmniPlot passes through this file: when it is
// uploaded, saved, previewed, placed on the canvas, nested and cut. The rule
// it exists to enforce: a pattern is reproduced EXACTLY as the user drew it —
// every corner, every angle, every curve, at exactly its stated size. The
// user may be an artist uploading wild shapes with razor-sharp points; they
// must come out of the plotter identical to what they uploaded.
//
// So this file:
//   • parses every SVG path command (M L H V C S Q T A Z, absolute and
//     relative, implicit repeats, compact number/flag syntax) exactly;
//   • applies affine transforms EXACTLY — including arcs under rotation,
//     skew and mirroring (via an exact ellipse re-fit), never approximated;
//   • computes the TRUE bounding box analytically (curve extrema, not
//     control-point hulls);
//   • flattens to polylines only at the very end, in real inches, keeping
//     EVERY vertex exactly (sharp corners are never shaved) and holding every
//     curve within a tolerance of half a plotter step.
//   • never rounds coordinates to a coarse grid and never smooths, simplifies
//     or "cleans up" anything.
//
// It is pure TypeScript — no DOM — so the browser, the server and the tests
// all compute identical geometry. Do not replace any of this with
// getBBox()/getPointAtLength() sampling: evenly-spaced sampling skips corner
// vertices (it cuts them off) and browsers disagree on curve bounding boxes.
// ─────────────────────────────────────────────

export type Pt = { x: number; y: number };

// Absolute, normalized segment list. H/V become L, S becomes C, T becomes Q —
// all exact rewrites. Every subpath starts with an explicit M.
export type Seg =
	| { t: "M"; x: number; y: number }
	| { t: "L"; x: number; y: number }
	| { t: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
	| { t: "Q"; x1: number; y1: number; x: number; y: number }
	| { t: "A"; rx: number; ry: number; rot: number; large: 0 | 1; sweep: 0 | 1; x: number; y: number }
	| { t: "Z" };

/** 2-D affine matrix, SVG/DOMMatrix convention: x' = a·x + c·y + e, y' = b·x + d·y + f */
export type Mat = { a: number; b: number; c: number; d: number; e: number; f: number };

export const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * Cut tolerance: the furthest a flattened curve may sit from the true curve,
 * in inches. Half of one HPGL plotter step (1/1016") — below what any cutter
 * can physically resolve. Vertices are always exact regardless.
 */
export const CUT_TOLERANCE_INCHES = 0.0005;

// ─── Parsing ─────────────────────────────────

const CMD_RE = /[MmLlHhVvCcSsQqTtAaZz]/;

/** Parse SVG path data into an absolute, normalized segment list. Exact. */
export function parsePath(d: string): Seg[] {
	const tokens = tokenize(d);
	const segs: Seg[] = [];
	let cx = 0, cy = 0;       // current point
	let sx = 0, sy = 0;       // subpath start
	let open = false;         // inside a subpath (an M has been emitted)
	let lastC: Pt | null = null; // last cubic 2nd control point (for S)
	let lastQ: Pt | null = null; // last quadratic control point (for T)
	let cmd = "";
	let k = 0;

	const num = (): number => {
		const v = tokens[k];
		if (typeof v !== "number") throw new Error(`Path command "${cmd}" is missing numbers.`);
		k++;
		return v;
	};
	const ensureOpen = () => {
		if (!open) { segs.push({ t: "M", x: cx, y: cy }); sx = cx; sy = cy; open = true; }
	};

	while (k < tokens.length) {
		const tok = tokens[k];
		if (typeof tok === "string") { cmd = tok; k++; }
		else if (!cmd || cmd === "Z" || cmd === "z") throw new Error("Path data has numbers without a command.");
		const rel = cmd === cmd.toLowerCase();
		const C = cmd.toUpperCase();

		switch (C) {
			case "M": {
				const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
				segs.push({ t: "M", x, y });
				cx = sx = x; cy = sy = y; open = true;
				lastC = lastQ = null;
				cmd = rel ? "l" : "L"; // implicit lineto for following pairs
				break;
			}
			case "L": {
				ensureOpen();
				const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
				segs.push({ t: "L", x, y }); cx = x; cy = y; lastC = lastQ = null;
				break;
			}
			case "H": {
				ensureOpen();
				const x = num() + (rel ? cx : 0);
				segs.push({ t: "L", x, y: cy }); cx = x; lastC = lastQ = null;
				break;
			}
			case "V": {
				ensureOpen();
				const y = num() + (rel ? cy : 0);
				segs.push({ t: "L", x: cx, y }); cy = y; lastC = lastQ = null;
				break;
			}
			case "C": {
				ensureOpen();
				const ox = rel ? cx : 0, oy = rel ? cy : 0;
				const x1 = num() + ox, y1 = num() + oy, x2 = num() + ox, y2 = num() + oy, x = num() + ox, y = num() + oy;
				segs.push({ t: "C", x1, y1, x2, y2, x, y });
				lastC = { x: x2, y: y2 }; lastQ = null; cx = x; cy = y;
				break;
			}
			case "S": {
				ensureOpen();
				const ox = rel ? cx : 0, oy = rel ? cy : 0;
				const x1: number = lastC ? 2 * cx - lastC.x : cx, y1: number = lastC ? 2 * cy - lastC.y : cy;
				const x2 = num() + ox, y2 = num() + oy, x = num() + ox, y = num() + oy;
				segs.push({ t: "C", x1, y1, x2, y2, x, y });
				lastC = { x: x2, y: y2 }; lastQ = null; cx = x; cy = y;
				break;
			}
			case "Q": {
				ensureOpen();
				const ox = rel ? cx : 0, oy = rel ? cy : 0;
				const x1 = num() + ox, y1 = num() + oy, x = num() + ox, y = num() + oy;
				segs.push({ t: "Q", x1, y1, x, y });
				lastQ = { x: x1, y: y1 }; lastC = null; cx = x; cy = y;
				break;
			}
			case "T": {
				ensureOpen();
				const x1: number = lastQ ? 2 * cx - lastQ.x : cx, y1: number = lastQ ? 2 * cy - lastQ.y : cy;
				const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
				segs.push({ t: "Q", x1, y1, x, y });
				lastQ = { x: x1, y: y1 }; lastC = null; cx = x; cy = y;
				break;
			}
			case "A": {
				ensureOpen();
				const rx = Math.abs(num()), ry = Math.abs(num()), rot = num();
				const large = flagAt(); const sweep = flagAt();
				const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
				if (x === cx && y === cy) { /* zero-length arc: omitted per spec */ }
				else if (rx === 0 || ry === 0) segs.push({ t: "L", x, y }); // per spec
				else segs.push({ t: "A", rx, ry, rot, large, sweep, x, y });
				cx = x; cy = y; lastC = lastQ = null;
				break;
			}
			case "Z": {
				if (open) segs.push({ t: "Z" });
				cx = sx; cy = sy; open = false; lastC = lastQ = null;
				break;
			}
		}
	}
	return segs;

	function flagAt(): 0 | 1 {
		const v = tokens[k];
		if (v !== 0 && v !== 1) throw new Error("Invalid arc flag in path data.");
		k++;
		return v;
	}
}

// Tokenizer. Arc flags are single 0/1 characters that may run straight into
// the next number ("a1 1 0 0110 10" = rx1 ry1 rot0 large0 sweep1 x10 y10),
// so inside an arc the 4th and 5th argument of each group is read as one char.
function tokenize(d: string): Array<string | number> {
	// Walk the raw string; inside an arc command, positions 4 and 5 of each
	// 7-argument group are single-character flags.
	const out: Array<string | number> = [];
	let i = 0;
	const n = d.length;
	let cmd = "";
	let argIdx = 0;
	const isSep = (c: string) => c === " " || c === "," || c === "\t" || c === "\n" || c === "\r" || c === "\f";
	while (i < n) {
		const ch = d[i];
		if (isSep(ch)) { i++; continue; }
		if (CMD_RE.test(ch)) { cmd = ch; argIdx = 0; out.push(ch); i++; continue; }
		const inArc = cmd === "A" || cmd === "a";
		const pos = argIdx % 7;
		if (inArc && (pos === 3 || pos === 4)) {
			if (ch !== "0" && ch !== "1") throw new Error("Invalid arc flag in path data.");
			out.push(ch === "1" ? 1 : 0);
			i++; argIdx++;
			continue;
		}
		// Regular number — reuse the main tokenizer on the remaining slice.
		const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(d.slice(i));
		if (!m) throw new Error(`Invalid path data near "${d.slice(i, i + 12)}"`);
		out.push(parseFloat(m[0]));
		i += m[0].length;
		argIdx++;
	}
	return out;
}

// ─── Serialization ───────────────────────────

/** Full-precision number formatting — never a coarse grid. */
function fmt(v: number): string {
	const s = Number(v.toPrecision(12)).toString();
	return s === "-0" ? "0" : s;
}

export function serializePath(segs: Seg[]): string {
	const parts: string[] = [];
	for (const s of segs) {
		switch (s.t) {
			case "M": case "L": parts.push(`${s.t}${fmt(s.x)} ${fmt(s.y)}`); break;
			case "C": parts.push(`C${fmt(s.x1)} ${fmt(s.y1)} ${fmt(s.x2)} ${fmt(s.y2)} ${fmt(s.x)} ${fmt(s.y)}`); break;
			case "Q": parts.push(`Q${fmt(s.x1)} ${fmt(s.y1)} ${fmt(s.x)} ${fmt(s.y)}`); break;
			case "A": parts.push(`A${fmt(s.rx)} ${fmt(s.ry)} ${fmt(s.rot)} ${s.large} ${s.sweep} ${fmt(s.x)} ${fmt(s.y)}`); break;
			case "Z": parts.push("Z"); break;
		}
	}
	return parts.join(" ");
}

// ─── Exact affine transform ──────────────────

const ap = (m: Mat, x: number, y: number): Pt => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });

export function multiply(m1: Mat, m2: Mat): Mat {
	// m1 ∘ m2 (apply m2 first)
	return {
		a: m1.a * m2.a + m1.c * m2.b,
		b: m1.b * m2.a + m1.d * m2.b,
		c: m1.a * m2.c + m1.c * m2.d,
		d: m1.b * m2.c + m1.d * m2.d,
		e: m1.a * m2.e + m1.c * m2.f + m1.e,
		f: m1.b * m2.e + m1.d * m2.f + m1.f,
	};
}

/**
 * Transform an arc's ellipse exactly: the image of an ellipse under a linear
 * map is an ellipse whose axes/radii are the SVD of (M · R(rot) · diag(rx,ry)).
 */
function transformArc(s: Extract<Seg, { t: "A" }>, m: Mat, end: Pt): Seg {
	const phi = (s.rot * Math.PI) / 180;
	const cos = Math.cos(phi), sin = Math.sin(phi);
	// N = M_lin · R(phi) · diag(rx, ry)   (column-vector convention)
	const n00 = (m.a * cos + m.c * sin) * s.rx;
	const n10 = (m.b * cos + m.d * sin) * s.rx;
	const n01 = (-m.a * sin + m.c * cos) * s.ry;
	const n11 = (-m.b * sin + m.d * cos) * s.ry;
	const E = (n00 + n11) / 2, F = (n00 - n11) / 2, G = (n10 + n01) / 2, H = (n10 - n01) / 2;
	const Qv = Math.hypot(E, H), Rv = Math.hypot(F, G);
	const s1 = Qv + Rv, s2 = Math.abs(Qv - Rv);
	const a1 = Math.atan2(G, F), a2 = Math.atan2(H, E);
	const newRot = ((a2 + a1) / 2) * (180 / Math.PI);
	const det = m.a * m.d - m.b * m.c;
	const sweep = (det < 0 ? 1 - s.sweep : s.sweep) as 0 | 1;
	if (s2 === 0) return { t: "L", x: end.x, y: end.y }; // degenerate (collapsed) ellipse
	return { t: "A", rx: s1, ry: s2, rot: newRot, large: s.large, sweep, x: end.x, y: end.y };
}

export function transformSegs(segs: Seg[], m: Mat): Seg[] {
	return segs.map((s) => {
		switch (s.t) {
			case "M": case "L": { const p = ap(m, s.x, s.y); return { t: s.t, x: p.x, y: p.y }; }
			case "C": {
				const p1 = ap(m, s.x1, s.y1), p2 = ap(m, s.x2, s.y2), p = ap(m, s.x, s.y);
				return { t: "C", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y };
			}
			case "Q": {
				const p1 = ap(m, s.x1, s.y1), p = ap(m, s.x, s.y);
				return { t: "Q", x1: p1.x, y1: p1.y, x: p.x, y: p.y };
			}
			case "A": return transformArc(s, m, ap(m, s.x, s.y));
			case "Z": return s;
		}
	});
}

// ─── Arc → centre parametrization (SVG spec F.6.5 / F.6.6) ──

interface ArcCenter { cx: number; cy: number; rx: number; ry: number; phi: number; t1: number; dt: number }

function arcCenter(x1: number, y1: number, s: Extract<Seg, { t: "A" }>): ArcCenter {
	const phi = (s.rot * Math.PI) / 180;
	const cos = Math.cos(phi), sin = Math.sin(phi);
	const dx = (x1 - s.x) / 2, dy = (y1 - s.y) / 2;
	const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
	let rx = s.rx, ry = s.ry;
	const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
	if (lam > 1) { const k = Math.sqrt(lam); rx *= k; ry *= k; } // radii correction (spec)
	const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
	const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
	let coef = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
	if (s.large === s.sweep) coef = -coef;
	const cxp = (coef * rx * y1p) / ry, cyp = (-coef * ry * x1p) / rx;
	const cx = cos * cxp - sin * cyp + (x1 + s.x) / 2;
	const cy = sin * cxp + cos * cyp + (y1 + s.y) / 2;
	const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
	const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
	let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
	if (!s.sweep && dt > 0) dt -= 2 * Math.PI;
	else if (s.sweep && dt < 0) dt += 2 * Math.PI;
	return { cx, cy, rx, ry, phi, t1, dt };
}

function arcPoint(a: ArcCenter, t: number): Pt {
	const cos = Math.cos(a.phi), sin = Math.sin(a.phi);
	const ct = Math.cos(t), st = Math.sin(t);
	return { x: a.cx + a.rx * cos * ct - a.ry * sin * st, y: a.cy + a.rx * sin * ct + a.ry * cos * st };
}

// ─── Exact bounding box ──────────────────────

export interface BBox { x: number; y: number; width: number; height: number }

function cubicExtremaT(p0: number, p1: number, p2: number, p3: number): number[] {
	// derivative: 3[(p1-p0)(1-t)^2 + 2(p2-p1)(1-t)t + (p3-p2)t^2]
	const a = -p0 + 3 * p1 - 3 * p2 + p3;
	const b = 2 * (p0 - 2 * p1 + p2);
	const c = p1 - p0;
	const out: number[] = [];
	if (Math.abs(a) < 1e-12) {
		if (Math.abs(b) > 1e-12) out.push(-c / b);
	} else {
		const disc = b * b - 4 * a * c;
		if (disc >= 0) {
			const sq = Math.sqrt(disc);
			out.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
		}
	}
	return out.filter((t) => t > 0 && t < 1);
}

const cubicAt = (p0: number, p1: number, p2: number, p3: number, t: number) => {
	const u = 1 - t;
	return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

function quadToCubic(x0: number, y0: number, s: Extract<Seg, { t: "Q" }>): Extract<Seg, { t: "C" }> {
	return {
		t: "C",
		x1: x0 + (2 / 3) * (s.x1 - x0), y1: y0 + (2 / 3) * (s.y1 - y0),
		x2: s.x + (2 / 3) * (s.x1 - s.x), y2: s.y + (2 / 3) * (s.y1 - s.y),
		x: s.x, y: s.y,
	};
}

/** True (tight, analytic) bounding box of the whole path. */
export function pathBBox(segs: Seg[]): BBox {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	const add = (x: number, y: number) => {
		if (x < minX) minX = x; if (x > maxX) maxX = x;
		if (y < minY) minY = y; if (y > maxY) maxY = y;
	};
	let cx = 0, cy = 0, sx = 0, sy = 0;
	for (const s of segs) {
		switch (s.t) {
			case "M": add(s.x, s.y); cx = sx = s.x; cy = sy = s.y; break;
			case "L": add(s.x, s.y); cx = s.x; cy = s.y; break;
			case "Q": case "C": {
				const c = s.t === "Q" ? quadToCubic(cx, cy, s) : s;
				add(c.x, c.y);
				for (const t of cubicExtremaT(cx, c.x1, c.x2, c.x)) add(cubicAt(cx, c.x1, c.x2, c.x, t), cubicAt(cy, c.y1, c.y2, c.y, t));
				for (const t of cubicExtremaT(cy, c.y1, c.y2, c.y)) add(cubicAt(cx, c.x1, c.x2, c.x, t), cubicAt(cy, c.y1, c.y2, c.y, t));
				cx = c.x; cy = c.y;
				break;
			}
			case "A": {
				add(s.x, s.y);
				const a = arcCenter(cx, cy, s);
				const cos = Math.cos(a.phi), sin = Math.sin(a.phi);
				const tx = Math.atan2(-a.ry * sin, a.rx * cos);
				const ty = Math.atan2(a.ry * cos, a.rx * sin);
				for (const base of [tx, ty]) {
					for (let k = -4; k <= 4; k++) {
						const t = base + k * Math.PI;
						// is t within [t1, t1+dt] (in the sweep direction)?
						const rel = (t - a.t1) / a.dt;
						if (rel > 0 && rel < 1) { const p = arcPoint(a, t); add(p.x, p.y); }
					}
				}
				cx = s.x; cy = s.y;
				break;
			}
			case "Z": cx = sx; cy = sy; break;
		}
	}
	if (!isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ─── Flattening (exact vertices, bounded curve error) ──

export interface Loop { points: Pt[]; closed: boolean }

function flattenCubic(out: Pt[], p0: Pt, p1: Pt, p2: Pt, p3: Pt, tol: number, depth = 0): void {
	// Flat enough when both control points lie within tol of the chord (the
	// curve lies in their convex hull, so its deviation is bounded by that).
	const dx = p3.x - p0.x, dy = p3.y - p0.y;
	const len = Math.hypot(dx, dy);
	let d1: number, d2: number;
	if (len < 1e-12) {
		d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
		d2 = Math.hypot(p2.x - p0.x, p2.y - p0.y);
	} else {
		d1 = Math.abs((p1.x - p0.x) * dy - (p1.y - p0.y) * dx) / len;
		d2 = Math.abs((p2.x - p0.x) * dy - (p2.y - p0.y) * dx) / len;
	}
	if ((d1 <= tol && d2 <= tol) || depth >= 30) { out.push(p3); return; }
	const m01 = mid(p0, p1), m12 = mid(p1, p2), m23 = mid(p2, p3);
	const m012 = mid(m01, m12), m123 = mid(m12, m23), m = mid(m012, m123);
	flattenCubic(out, p0, m01, m012, m, tol, depth + 1);
	flattenCubic(out, m, m123, m23, p3, tol, depth + 1);
}
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Flatten to polylines. Every path vertex (segment endpoint) is emitted
 * EXACTLY; curves are subdivided so no point of the true curve is farther
 * than `tol` from the polyline. Units are the path's own units — transform
 * to inches first, then pass an inch tolerance.
 */
export function flattenSegs(segs: Seg[], tol: number): Loop[] {
	const loops: Loop[] = [];
	let cur: Pt[] | null = null;
	let cx = 0, cy = 0, sx = 0, sy = 0;
	const finish = (closed: boolean) => {
		if (cur && cur.length > 1) loops.push({ points: cur, closed });
		cur = null;
	};
	for (const s of segs) {
		switch (s.t) {
			case "M":
				finish(false);
				cur = [{ x: s.x, y: s.y }];
				cx = sx = s.x; cy = sy = s.y;
				break;
			case "L":
				cur!.push({ x: s.x, y: s.y }); cx = s.x; cy = s.y;
				break;
			case "Q": case "C": {
				const c = s.t === "Q" ? quadToCubic(cx, cy, s) : s;
				flattenCubic(cur!, { x: cx, y: cy }, { x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }, { x: c.x, y: c.y }, tol);
				cur![cur!.length - 1] = { x: c.x, y: c.y }; // endpoint exact
				cx = c.x; cy = c.y;
				break;
			}
			case "A": {
				const a = arcCenter(cx, cy, s);
				const r = Math.max(a.rx, a.ry);
				const maxStep = tol >= r ? Math.PI / 2 : 2 * Math.acos(1 - tol / r);
				const n = Math.max(1, Math.ceil(Math.abs(a.dt) / Math.min(maxStep, Math.PI / 2)));
				for (let i = 1; i < n; i++) cur!.push(arcPoint(a, a.t1 + (a.dt * i) / n));
				cur!.push({ x: s.x, y: s.y }); // endpoint exact
				cx = s.x; cy = s.y;
				break;
			}
			case "Z": {
				if (cur) {
					const last = cur[cur.length - 1];
					if (last.x !== sx || last.y !== sy) cur.push({ x: sx, y: sy });
				}
				finish(true);
				cx = sx; cy = sy;
				break;
			}
		}
	}
	finish(false);
	return loops;
}

/** Split into subpaths (each starting with its M) — correct for relative data. */
export function splitSubpathSegs(segs: Seg[]): Seg[][] {
	const out: Seg[][] = [];
	for (const s of segs) {
		if (s.t === "M") out.push([s]);
		else if (out.length) out[out.length - 1].push(s);
	}
	return out;
}

// ─── Pattern-level helpers ───────────────────

/** Exact map of a pattern outline into real inches: bbox → [0,W]×[0,H]. */
export function pathToInchSegs(d: string, widthInches: number, heightInches: number): Seg[] {
	const segs = parsePath(d);
	const b = pathBBox(segs);
	if (!b.width || !b.height) throw new Error("Outline has no width or height.");
	const sx = widthInches / b.width, sy = heightInches / b.height;
	return transformSegs(segs, { a: sx, b: 0, c: 0, d: sy, e: -b.x * sx, f: -b.y * sy });
}

/** Outline proportions (width ÷ height of the true bounding box). */
export function pathAspect(d: string): number {
	const b = pathBBox(parsePath(d));
	if (!b.width || !b.height) return NaN;
	return b.width / b.height;
}

/**
 * Relative tolerance for "W × H matches the outline's proportions". Derived
 * dimensions are stored at full precision, so a correct pattern matches to
 * ~1e-12; this only absorbs float noise, never a real difference.
 */
export const ASPECT_TOLERANCE = 1e-6;

/** True when widthInches × heightInches has exactly the outline's proportions. */
export function sizeMatchesOutline(d: string, widthInches: number, heightInches: number): boolean {
	if (!(widthInches > 0) || !(heightInches > 0)) return false;
	let asp: number;
	try { asp = pathAspect(d); } catch { return false; }
	if (!isFinite(asp) || asp <= 0) return false;
	return Math.abs(widthInches / heightInches / asp - 1) <= ASPECT_TOLERANCE;
}

/** Height that matches the outline for a given width (full precision). */
export function heightForWidth(d: string, widthInches: number): number {
	return widthInches / pathAspect(d);
}
/** Width that matches the outline for a given height (full precision). */
export function widthForHeight(d: string, heightInches: number): number {
	return heightInches * pathAspect(d);
}

/**
 * Store an outline in the canonical 0–100 box with ONE uniform scale — an
 * exact similarity transform (no stretch, no rounding), so the saved shape
 * is the uploaded shape. `m` is applied first (the element's placement in
 * the source file).
 */
export function normalizeOutline(segs: Seg[], margin = 3): string {
	const b = pathBBox(segs);
	if (!b.width || !b.height) throw new Error("Outline has no width or height.");
	const size = 100 - margin * 2;
	const s = size / Math.max(b.width, b.height);
	const tx = margin + (size - b.width * s) / 2 - b.x * s;
	const ty = margin + (size - b.height * s) / 2 - b.y * s;
	return serializePath(transformSegs(segs, { a: s, b: 0, c: 0, d: s, e: tx, f: ty }));
}

// ─── Basic shapes → exact path segments ──────
// Used when importing SVG files: <rect>, <circle>, <ellipse>, <line>,
// <polyline>, <polygon> are converted to the identical path (arcs for
// rounded corners/circles — exact, not approximated).

export function rectSegs(x: number, y: number, w: number, h: number, rx = 0, ry = 0): Seg[] {
	rx = Math.min(Math.abs(rx), w / 2);
	ry = Math.min(Math.abs(ry), h / 2);
	if (rx === 0 || ry === 0) {
		return [
			{ t: "M", x, y }, { t: "L", x: x + w, y }, { t: "L", x: x + w, y: y + h }, { t: "L", x, y: y + h }, { t: "Z" },
		];
	}
	const arc = (ex: number, ey: number): Seg => ({ t: "A", rx, ry, rot: 0, large: 0, sweep: 1, x: ex, y: ey });
	return [
		{ t: "M", x: x + rx, y },
		{ t: "L", x: x + w - rx, y }, arc(x + w, y + ry),
		{ t: "L", x: x + w, y: y + h - ry }, arc(x + w - rx, y + h),
		{ t: "L", x: x + rx, y: y + h }, arc(x, y + h - ry),
		{ t: "L", x, y: y + ry }, arc(x + rx, y),
		{ t: "Z" },
	];
}

export function ellipseSegs(cx: number, cy: number, rx: number, ry: number): Seg[] {
	return [
		{ t: "M", x: cx + rx, y: cy },
		{ t: "A", rx, ry, rot: 0, large: 0, sweep: 1, x: cx - rx, y: cy },
		{ t: "A", rx, ry, rot: 0, large: 0, sweep: 1, x: cx + rx, y: cy },
		{ t: "Z" },
	];
}

export function polySegs(points: Pt[], closed: boolean): Seg[] {
	if (!points.length) return [];
	const segs: Seg[] = [{ t: "M", x: points[0].x, y: points[0].y }];
	for (const p of points.slice(1)) segs.push({ t: "L", x: p.x, y: p.y });
	if (closed) segs.push({ t: "Z" });
	return segs;
}

// ─── Grouping contours into physical pieces ──
// A compound outline (a shape with a hole, a letter "O") is ONE piece: the
// hole belongs to it. When a combined file is split into separate patterns,
// contours are grouped by containment — an outer contour keeps every hole
// inside it — so no piece ever loses its cut-outs.

function pointInPolygon(p: Pt, poly: Pt[]): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const a = poly[i], b = poly[j];
		if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
	}
	return inside;
}

/** Split an outline into physical pieces (outer contour + its holes). */
export function splitIntoPieces(d: string): string[] {
	const subs = splitSubpathSegs(parsePath(d));
	if (subs.length <= 1) return subs.map(serializePath);
	const b = pathBBox(subs.flat());
	const tol = Math.max(b.width, b.height) * 1e-5;
	const polys = subs.map((s) => flattenSegs(s, tol)[0]?.points ?? []);
	// depth = number of other contours containing this one (test a vertex).
	const depth = polys.map((poly, i) =>
		poly.length ? polys.reduce((n, other, j) => (j !== i && other.length > 2 && pointInPolygon(poly[0], other) ? n + 1 : n), 0) : 0,
	);
	const pieces: number[][] = [];
	const owner = new Map<number, number>();
	polys.forEach((_, i) => { if (depth[i] % 2 === 0) { owner.set(i, pieces.length); pieces.push([i]); } });
	polys.forEach((poly, i) => {
		if (depth[i] % 2 === 0 || !poly.length) return;
		// attach a hole to the innermost even-depth contour that contains it
		let best = -1;
		polys.forEach((other, j) => {
			if (depth[j] % 2 === 0 && depth[j] === depth[i] - 1 && other.length > 2 && pointInPolygon(poly[0], other)) best = j;
		});
		if (best >= 0) pieces[owner.get(best)!].push(i);
		else { owner.set(i, pieces.length); pieces.push([i]); }
	});
	return pieces.map((idx) => serializePath(idx.flatMap((i) => subs[i])));
}
