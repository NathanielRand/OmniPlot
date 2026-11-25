// The production raster→outline pipeline, headless. Mirrors SvgPathInput.runVectorize:
//   server: preprocessForTrace → runTrace          (src/lib/server/vectorize.ts)
//   client: importSvgExact (DOM-free here) → normalizeOutline → smoothBezierJunctions
import { preprocessForTrace, runTrace } from '../../src/lib/server/vectorize';
import { parsePath, transformSegs, normalizeOutline, splitSubpathSegs, innerLineSelection, serializePath, type Mat } from '../../src/lib/utils/pathGeometry';
import { smoothBezierJunctions } from '../../src/lib/utils/bezier-smooth';

function matFromTransform(t: string | null): Mat {
	const I: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
	if (!t) return I;
	const m = /matrix\(([^)]+)\)/.exec(t);
	if (m) { const [a, b, c, d, e, f] = m[1].split(/[\s,]+/).map(Number); return { a, b, c, d, e, f }; }
	const tr = /translate\(([^)]+)\)/.exec(t), sc = /scale\(([^)]+)\)/.exec(t);
	let r = I;
	if (tr) { const [x, y = 0] = tr[1].split(/[\s,]+/).map(Number); r = { ...r, e: x, f: y }; }
	if (sc) { const [x, y = x] = sc[1].split(/[\s,]+/).map(Number); r = { a: x, b: 0, c: 0, d: y, e: r.e * x, f: r.f * y }; }
	return r;
}

export function svgToNormalized(svg: string): string {
	const tag = /<path\b[^>]*>/g;
	const segs = [];
	let m: RegExpExecArray | null;
	while ((m = tag.exec(svg))) {
		const d = /\bd="([^"]+)"/.exec(m[0])?.[1];
		if (!d) continue;
		const tf = /\btransform="([^"]+)"/.exec(m[0])?.[1] ?? null;
		segs.push(...transformSegs(parsePath(d), matFromTransform(tf)));
	}
	if (!segs.length) throw new Error('no path in trace output');
	return normalizeOutline(segs);
}

// Mirrors SvgPathInput.processDetectedLayers with its default contour option ("Keep inner only").
export function keepInner(d: string): string {
	const subs = splitSubpathSegs(parsePath(d));
	if (subs.length <= 1) return d;
	const keep = innerLineSelection(subs);
	return subs.filter((_, i) => keep[i]).map(serializePath).join(' ');
}

export async function vectorizeRaster(png: Buffer): Promise<{ d: string; rawSvg: string }> {
	const processed = await preprocessForTrace(png);
	const rawSvg = await runTrace(processed);
	return { d: smoothBezierJunctions(keepInner(svgToNormalized(rawSvg))), rawSvg };
}
