import Jimp from 'jimp';
import sharp from 'sharp';
import { trace } from 'potrace';

export const TARGET_LONG_EDGE = 6000;

export const TRACE_OPTIONS = {
	turdSize:     5,
	turnPolicy:   'minority' as const,
	alphaMax:     0.8,     // below default (1.0): preserves genuine hard corners as L vertices so
	                       // collapseCollinearRuns detects them via the ≥50° angle threshold;
	                       // at 1.0 potrace smooths even 90° corners into C curves whose
	                       // pairwise tangent angles stay below 50°, causing over-rounding.
	optCurve:     true,
	optTolerance: 0.8,     // tighter than 1.5 — prevents overshoot/undershoot near corners
	blackOnWhite: true,
	background:   '#ffffff',
	color:        '#000000',
};

// Morphological open on a thresholded binary image (black-on-white).
// Removes up to `radius`-pixel-scale protrusions from edges (staircase micro-bumps).
// Uses separable 1-D passes (H then V for each of erode/dilate) — O(n·r) instead
// of O(n·r²), ~3.5× faster than a 2-D kernel while producing identical results for
// a square structuring element.
export function morphOpen(img: Jimp, radius: number): void {
	const { width, height } = img.bitmap;
	const src    = img.bitmap.data as unknown as Buffer;
	const stride = width * 4;
	const tmp    = Buffer.alloc(src.length);
	const mid    = Buffer.alloc(src.length);

	// Erosion (max-filter) — horizontal pass into tmp
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let v = 0;
			for (let d = -radius; d <= radius; d++) {
				const nx = Math.max(0, Math.min(width - 1, x + d));
				const s = src[y * stride + nx * 4];
				if (s > v) v = s;
			}
			const i = y * stride + x * 4;
			tmp[i] = tmp[i+1] = tmp[i+2] = v; tmp[i+3] = 255;
		}
	}
	// Erosion — vertical pass into mid
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let v = 0;
			for (let d = -radius; d <= radius; d++) {
				const ny = Math.max(0, Math.min(height - 1, y + d));
				const s = tmp[ny * stride + x * 4];
				if (s > v) v = s;
			}
			const i = y * stride + x * 4;
			mid[i] = mid[i+1] = mid[i+2] = v; mid[i+3] = 255;
		}
	}

	// Dilation (min-filter) — horizontal pass into tmp
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let v = 255;
			for (let d = -radius; d <= radius; d++) {
				const nx = Math.max(0, Math.min(width - 1, x + d));
				const s = mid[y * stride + nx * 4];
				if (s < v) v = s;
			}
			const i = y * stride + x * 4;
			tmp[i] = tmp[i+1] = tmp[i+2] = v; tmp[i+3] = 255;
		}
	}
	// Dilation — vertical pass back into src
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let v = 255;
			for (let d = -radius; d <= radius; d++) {
				const ny = Math.max(0, Math.min(height - 1, y + d));
				const s = tmp[ny * stride + x * 4];
				if (s < v) v = s;
			}
			const i = y * stride + x * 4;
			src[i] = src[i+1] = src[i+2] = v;
		}
	}
}

// Sauvola adaptive threshold using downsampled (1/4-scale) integral images.
// Adapts the threshold to local brightness, handling uneven illumination or contrast.
// Memory: ~20 MB extra at 6000 px (vs ~288 MB for full-scale float64 integral images).
export function adaptiveThreshold(img: Jimp, windowHalfPx = 40, k = 0.18): void {
	const { width, height } = img.bitmap;
	const data   = img.bitmap.data as unknown as Buffer;
	const stride = width * 4;

	// Downsample by DS for integral image memory efficiency
	const DS = 4;
	const sw = Math.max(1, Math.ceil(width  / DS));
	const sh = Math.max(1, Math.ceil(height / DS));
	const IW = sw + 1;
	const IH = sh + 1;

	// Sample the grayscale channel at 1/4 resolution
	const small = new Uint8Array(sw * sh);
	for (let sy = 0; sy < sh; sy++) {
		for (let sx = 0; sx < sw; sx++) {
			const fy = Math.min(height - 1, sy * DS);
			const fx = Math.min(width  - 1, sx * DS);
			small[sy * sw + sx] = data[fy * stride + fx * 4];
		}
	}

	// Build summed-area tables (Float32 precision is sufficient at 1/4 scale)
	const S  = new Float32Array(IW * IH);
	const S2 = new Float32Array(IW * IH);
	for (let sy = 0; sy < sh; sy++) {
		for (let sx = 0; sx < sw; sx++) {
			const v   = small[sy * sw + sx];
			const idx = (sy + 1) * IW + (sx + 1);
			S[idx]  = v     + S[sy * IW + sx + 1]  + S[(sy + 1) * IW + sx]  - S[sy * IW + sx];
			S2[idx] = v * v + S2[sy * IW + sx + 1] + S2[(sy + 1) * IW + sx] - S2[sy * IW + sx];
		}
	}

	// Precompute threshold at downsampled resolution
	const half        = Math.max(1, Math.round(windowHalfPx / DS));
	const threshMap   = new Uint8Array(sw * sh);
	for (let sy = 0; sy < sh; sy++) {
		for (let sx = 0; sx < sw; sx++) {
			const ix1 = Math.max(0, sx - half);
			const iy1 = Math.max(0, sy - half);
			const ix2 = Math.min(sw - 1, sx + half);
			const iy2 = Math.min(sh - 1, sy + half);
			const cnt = (ix2 - ix1 + 1) * (iy2 - iy1 + 1);
			const a   = (iy2 + 1) * IW + ix2 + 1;
			const b   = (iy2 + 1) * IW + ix1;
			const c   = iy1       * IW + ix2 + 1;
			const d   = iy1       * IW + ix1;
			const sum  = S[a]  - S[b]  - S[c]  + S[d];
			const sum2 = S2[a] - S2[b] - S2[c] + S2[d];
			const mean = sum / cnt;
			const std  = Math.sqrt(Math.max(0, sum2 / cnt - mean * mean));
			const sauvola = mean * (1 + k * (std / 128 - 1));
			// Global floor: Sauvola can drop too low in uniformly dark regions,
			// misclassifying solid dark shapes as background and creating artificial holes.
			// Clamping to 128 ensures the global black-on-white assumption holds.
			threshMap[sy * sw + sx] = Math.max(0, Math.min(255, Math.round(Math.min(sauvola, 128))));
		}
	}

	// Precompute full-res → small-res lookup to avoid redundant arithmetic in hot path
	const syMap = new Uint16Array(height);
	for (let y = 0; y < height; y++) syMap[y] = Math.min(sh - 1, Math.round(y / DS));
	const sxMap = new Uint16Array(width);
	for (let x = 0; x < width; x++) sxMap[x] = Math.min(sw - 1, Math.round(x / DS));

	// Apply threshold at full resolution (O(1) per pixel via lookup)
	for (let y = 0; y < height; y++) {
		const sy = syMap[y];
		for (let x = 0; x < width; x++) {
			const thresh = threshMap[sy * sw + sxMap[x]];
			const pixel  = data[y * stride + x * 4];
			const out    = pixel < thresh ? 0 : 255;
			const i      = y * stride + x * 4;
			data[i] = data[i + 1] = data[i + 2] = out;
		}
	}
}

export function readJimp(buf: Buffer): Promise<Jimp> {
	return new Promise<Jimp>((resolve, reject) => {
		Jimp.read(buf, (err, img) => {
			if (err) reject(err); else resolve(img);
		});
	});
}

export function jimpToBuffer(img: Jimp): Promise<Buffer> {
	return new Promise<Buffer>((resolve, reject) => {
		img.getBase64(Jimp.MIME_PNG, (err, data) => {
			if (err) { reject(err); return; }
			resolve(Buffer.from(data.replace(/^data:image\/png;base64,/, ''), 'base64'));
		});
	});
}

// ─── SVG path smoother ───────────────────────────────────────────────────────
//
// Applies Laplacian smoothing to the anchor points of each cubic Bezier subpath
// from potrace output. Control points are translated by the same delta as their
// adjacent anchor so local curve shape is preserved (G1 continuity maintained).

interface Cmd { type: string; args: number[] }

function parseD(d: string): Cmd[] {
	const cmds: Cmd[] = [];
	const re = /([MCLZz])([-\d.\s,e]+)?/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(d)) !== null) {
		const type = m[1].toUpperCase();
		const args = m[2]
			? m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number)
			: [];
		cmds.push({ type, args });
	}
	return cmds;
}

function cmdsToD(cmds: Cmd[]): string {
	return cmds.map(cmd => {
		if (cmd.type === 'Z') return 'Z';
		return cmd.type + cmd.args.map(v => +v.toFixed(4)).join(' ');
	}).join('');
}

function smoothSubpath(sub: Cmd[], w: number): void {
	// Extract anchor points (M endpoint + each C/L endpoint)
	const anchors: { x: number; y: number; ci: number }[] = [];
	anchors.push({ x: sub[0].args[0], y: sub[0].args[1], ci: 0 });
	for (let k = 1; k < sub.length; k++) {
		const cmd = sub[k];
		if (cmd.type === 'C') {
			anchors.push({ x: cmd.args[4], y: cmd.args[5], ci: k });
		} else if (cmd.type === 'L') {
			anchors.push({ x: cmd.args[0], y: cmd.args[1], ci: k });
		}
	}
	if (anchors.length < 3) return;

	// Laplacian smoothing (skip first and last to preserve start/end position).
	// Corner detection: vectors from anchor to its two neighbors are nearly opposite
	// (cos ≈ -1) on smooth segments, but close to perpendicular (cos ≈ 0) at sharp
	// corners. Skip corners to prevent Laplacian from pulling the anchor inward and
	// creating a visible notch. Threshold cos > -0.5 catches anything sharper than 120°.
	const deltas = anchors.map((a, idx) => {
		if (idx === 0 || idx === anchors.length - 1) return { dx: 0, dy: 0 };
		const prev = anchors[idx - 1];
		const next = anchors[idx + 1];
		const v1x = prev.x - a.x, v1y = prev.y - a.y;
		const v2x = next.x - a.x, v2y = next.y - a.y;
		const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
		const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
		if (len1 > 0.001 && len2 > 0.001 && (v1x * v2x + v1y * v2y) / (len1 * len2) > -0.5) {
			return { dx: 0, dy: 0 };
		}
		return {
			dx: w * 0.5 * (prev.x + next.x - 2 * a.x),
			dy: w * 0.5 * (prev.y + next.y - 2 * a.y),
		};
	});

	// Apply deltas — move anchor + its adjacent control points by the same vector
	for (let k = 0; k < anchors.length; k++) {
		const { dx, dy } = deltas[k];
		if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) continue;
		const ci  = anchors[k].ci;
		const cmd = sub[ci];

		if (cmd.type === 'M') {
			cmd.args[0] += dx; cmd.args[1] += dy;
		} else if (cmd.type === 'C') {
			// Move cp2 and endpoint; preserves local outgoing tangent direction
			cmd.args[2] += dx; cmd.args[3] += dy;
			cmd.args[4] += dx; cmd.args[5] += dy;
		} else if (cmd.type === 'L') {
			cmd.args[0] += dx; cmd.args[1] += dy;
		}

		// Move cp1 of the next segment so the tangent through the moved anchor stays smooth
		if (ci + 1 < sub.length && sub[ci + 1].type === 'C') {
			sub[ci + 1].args[0] += dx;
			sub[ci + 1].args[1] += dy;
		}
	}
}

function smoothPathD(d: string, iterations: number): string {
	const cmds = parseD(d);
	if (cmds.length < 4) return d;

	for (let iter = 0; iter < iterations; iter++) {
		let i = 0;
		while (i < cmds.length) {
			if (cmds[i].type !== 'M') { i++; continue; }
			let j = i + 1;
			while (j < cmds.length && cmds[j].type !== 'M') j++;
			const sub = cmds.slice(i, j);
			if (sub.length >= 4) smoothSubpath(sub, 0.25);
			// Write smoothed commands back in-place
			for (let k = 0; k < sub.length; k++) cmds[i + k] = sub[k];
			i = j;
		}
	}

	return cmdsToD(cmds);
}

// ─── Outer-subpath filter ─────────────────────────────────────────────────────
//
// Potrace traces BOTH the outer boundary (CW in SVG) and inner holes (CCW) of
// any shape that has a white interior, producing a multi-subpath d="M…Z M…Z".
// For PPF/tint patterns we only want the outer cutting outline.
// We detect winding direction via the shoelace signed-area formula:
//   positive → CW in SVG (Y-down) → outer boundary → keep
//   negative → CCW → inner hole   → discard

function approxSignedArea(subpathD: string): number {
	const pts: [number, number][] = [];
	const re = /([MCLZz])([-\d.\s,e]+)?/g;
	let m: RegExpExecArray | null;
	let cx = 0, cy = 0;
	while ((m = re.exec(subpathD)) !== null) {
		const type = m[1].toUpperCase();
		const args = m[2] ? m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number) : [];
		if (type === 'M' && args.length >= 2) { cx = args[0]; cy = args[1]; pts.push([cx, cy]); }
		else if (type === 'L' && args.length >= 2) { cx = args[0]; cy = args[1]; pts.push([cx, cy]); }
		else if (type === 'C' && args.length >= 6) { cx = args[4]; cy = args[5]; pts.push([cx, cy]); }
	}
	if (pts.length < 3) return 0;
	let area = 0;
	for (let i = 0; i < pts.length; i++) {
		const j = (i + 1) % pts.length;
		area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
	}
	return area / 2;
}

function keepOuterSubpaths(d: string): string {
	const subpaths = (d.match(/M[^Mm]*/gi) ?? []).map(s => s.trim()).filter(Boolean);
	if (subpaths.length <= 1) return d;
	const outer = subpaths.filter(s => approxSignedArea(s) >= 0);
	// Keep only the SINGLE largest-area outer subpath.
	// Multiple positive-area subpaths arise when a thin bridge in the binary image is
	// broken by morphological processing, yielding two separate CW contours. Joining
	// them both produces a d="M…Z M…Z" that renders as two disconnected stroke paths.
	// Taking the largest-area piece gives the true pattern outline.
	const pool = outer.length > 0 ? outer : subpaths;
	return pool.reduce((best, s) =>
		Math.abs(approxSignedArea(s)) > Math.abs(approxSignedArea(best)) ? s : best
	);
}

function filterSvgOuterPaths(svg: string): string {
	return svg.replace(/\bd="([^"]+)"/g, (_, d: string) => `d="${keepOuterSubpaths(d)}"`);
}

export function smoothSvgPaths(svg: string, iterations = 3): string {
	return svg.replace(/\bd="([^"]+)"/g, (_, d: string) => `d="${smoothPathD(d, iterations)}"`);
}

// ─────────────────────────────────────────────────────────────────────────────

export function runTrace(buf: Buffer): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		trace(buf, TRACE_OPTIONS, (err, result) => {
			if (err) reject(err);
			// filterSvgOuterPaths: keeps only the largest-area CW subpath.
			// Path smoothing is handled client-side by bezier-smooth (collapseCollinearRuns
			// + Catmull-Rom endpoints + G1 junctions) — no server-side Laplacian needed.
			else resolve(filterSvgOuterPaths(result));
		});
	});
}

// ─── Background-removal cutout ────────────────────────────────────────────────
//
// Alternative to preprocessForTrace's global threshold: instead of assuming a
// black shape on a white background, this flood-fills from the four image
// corners over pixels similar in color to the corner, marking everything
// reachable as "background". What's left (unreached) is the foreground
// silhouette — works well for product-style photos shot against a fairly
// uniform backdrop, and unlike a global threshold it tolerates midtone or
// colored backgrounds. The output binary mask is fed through the same
// morphOpen + runTrace path used by preprocessForTrace, so it gets the same
// anti-aliased edge quality and outer-contour filtering.

// BFS flood fill over 4-connected neighbors whose color is within `tolerance`
// of the running region-average color (so gentle gradients/vignettes in a
// "solid" backdrop don't stop the fill early). Marks visited pixels in `bg`.
function floodFillBackground(
	data: Buffer, width: number, height: number, stride: number,
	seeds: [number, number][], tolerance: number,
): Uint8Array {
	const bg = new Uint8Array(width * height);
	const stack: number[] = [];
	for (const [sx, sy] of seeds) {
		const idx = sy * width + sx;
		if (!bg[idx]) { bg[idx] = 1; stack.push(idx); }
	}

	const colorAt = (idx: number) => {
		const i = idx * 4;
		return [data[i], data[i + 1], data[i + 2]] as const;
	};

	while (stack.length) {
		const idx = stack.pop()!;
		const x = idx % width, y = (idx / width) | 0;
		const [r, g, b] = colorAt(idx);

		const tryNeighbor = (nx: number, ny: number) => {
			if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
			const nidx = ny * width + nx;
			if (bg[nidx]) return;
			const [nr, ng, nb] = colorAt(nidx);
			const dist = Math.abs(nr - r) + Math.abs(ng - g) + Math.abs(nb - b);
			if (dist <= tolerance) { bg[nidx] = 1; stack.push(nidx); }
		};
		tryNeighbor(x - 1, y);
		tryNeighbor(x + 1, y);
		tryNeighbor(x, y - 1);
		tryNeighbor(x, y + 1);
	}

	return bg;
}

export async function preprocessCutout(inputBuffer: Buffer, targetLongEdge = TARGET_LONG_EDGE, tolerance = 24): Promise<Buffer> {
	const meta     = await sharp(inputBuffer).metadata();
	const origLong = Math.max(meta.width ?? 1, meta.height ?? 1);
	const scaleRatio = Math.max(1, targetLongEdge / origLong);
	const usmM2 = Math.max(0.5, Math.min(2.0, scaleRatio * 0.4));

	// Upscale + sharpen, keep full color (background removal needs it) —
	// mirrors preprocessForTrace's resize/sharpen but skips grayscale/threshold.
	const { data, info } = await sharp(inputBuffer)
		.resize(targetLongEdge, targetLongEdge, { fit: 'inside', kernel: sharp.kernel.lanczos3 })
		.sharpen({ sigma: 1.5, m1: 0, m2: usmM2 })
		.removeAlpha()
		.ensureAlpha(1) // normalise to RGBA so raw buffer stride is predictable
		.raw()
		.toBuffer({ resolveWithObject: true });

	const { width, height } = info;
	const stride = width * 4;

	// Seed the flood fill from a strip of border pixels (not just 4 corners) so a
	// backdrop with slight lighting variation across the frame still connects.
	const seeds: [number, number][] = [];
	const step = Math.max(1, Math.round(Math.min(width, height) / 100));
	for (let x = 0; x < width; x += step) { seeds.push([x, 0]); seeds.push([x, height - 1]); }
	for (let y = 0; y < height; y += step) { seeds.push([0, y]); seeds.push([width - 1, y]); }

	const bg = floodFillBackground(data, width, height, stride, seeds, tolerance);

	// Build binary mask: white = foreground (kept), black = background (removed).
	// blackOnWhite tracing expects black shape on white — invert here so the
	// foreground silhouette is what potrace traces.
	const mask = Buffer.alloc(stride * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = y * width + x;
			const v = bg[idx] ? 255 : 0; // background → white, foreground → black
			const i = y * stride + x * 4;
			mask[i] = mask[i + 1] = mask[i + 2] = v; mask[i + 3] = 255;
		}
	}

	// Anti-alias the mask boundary the same way preprocessForTrace does, then
	// morphOpen to clean up flood-fill noise at the silhouette edge.
	const antialiased = await sharp(mask, { raw: { width, height, channels: 4 } })
		.blur(1.5)
		.threshold(128)
		.toFormat('png')
		.toBuffer();

	const img = await readJimp(antialiased);
	const morphRadius = Math.max(2, Math.min(5, Math.round(2 * Math.sqrt(scaleRatio))));
	morphOpen(img, morphRadius);

	return jimpToBuffer(img);
}

export async function preprocessForTrace(inputBuffer: Buffer, targetLongEdge = TARGET_LONG_EDGE): Promise<Buffer> {
	const meta     = await sharp(inputBuffer).metadata();
	const origLong = Math.max(meta.width ?? 1, meta.height ?? 1);
	const scaleRatio = Math.max(1, targetLongEdge / origLong);

	// USM edge strength: scaled with upscale factor but capped low.
	// High m2 creates ringing (overshoot halos) at edges — after threshold these
	// oscillations produce a jagged binary boundary that potrace traces faithfully.
	const usmM2 = Math.max(0.5, Math.min(2.0, scaleRatio * 0.4));

	// Pipeline: Lanczos3 resize → USM → mild de-ringing blur → grayscale → normalise.
	// The blur after sharpen suppresses high-frequency ringing before the threshold decision.
	// NOTE: normalise and threshold must run in separate sharp pipelines. When chained in one
	// pipeline, sharp/libvips applies threshold against pre-normalised pixel values, so any
	// shape color with luminance > 128 (orange, yellow, cyan, etc.) becomes white instead of
	// black. Splitting into two pipelines ensures threshold always sees the normalised values.
	const normalisedBuf = await sharp(inputBuffer)
		.resize(targetLongEdge, targetLongEdge, {
			fit:    'inside',
			kernel: sharp.kernel.lanczos3,
		})
		.sharpen({ sigma: 1.5, m1: 0, m2: usmM2 })
		.blur(0.6)
		.grayscale()
		.normalise()
		.toFormat('png')
		.toBuffer();

	// Double-threshold: blur the binary image to anti-alias the pixel staircase,
	// then re-threshold at the 50% point. The result is the same binary topology
	// but the edge follows the smooth average of each staircase step — potrace
	// then traces a much cleaner diagonal than it would from the raw staircase.
	// sigma=1.5 (up from 1.0) smooths staircases up to ~3px wide, reducing the
	// waviness amplitude that reaches potrace for gently-curved edges.
	const binaryBuf = await sharp(normalisedBuf)
		.threshold(128)
		.blur(1.5)
		.threshold(128)
		.toFormat('png')
		.toBuffer();

	// MorphOpen: remove remaining pixel-scale protrusions from the binary edge.
	const img = await readJimp(binaryBuf);
	const morphRadius = Math.max(2, Math.min(5, Math.round(2 * Math.sqrt(scaleRatio))));
	morphOpen(img, morphRadius);

	return jimpToBuffer(img);
}
