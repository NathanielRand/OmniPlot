// Exact vector extraction from PDFs for the pattern uploader.
//
// ⚠ PRECISION: a PDF exported from a design tool already contains the exact
// cut geometry (lines and cubic béziers, in points). Rasterizing it and tracing
// the picture can only ever approximate that, so when the page is pure vector
// art we read the path data directly and hand it on as an SVG in real units
// (1 pt = 1/72 in). Nothing is traced, smoothed or simplified.
//
// Returns null when the page can't be reproduced exactly this way (embedded
// images, text, shadings, or no drawn paths) — the caller then falls back to
// the raster route in ./pdf.ts.
import './pdf'; // registers the pdfjs worker shim + Promise.withResolvers polyfill

export interface PdfVector { svg: string; widthInches: number; heightInches: number; pathCount: number }

// pdfjs operator codes (pdfjs-dist OPS) — pinned here so a changed export can
// never silently change behavior. A test covers real PDFs against these.
const OP = {
	save: 10, restore: 11, transform: 12,
	stroke: 20, closeStroke: 21, fill: 22, eoFill: 23, fillStroke: 24, eoFillStroke: 25,
	closeFillStroke: 26, closeEOFillStroke: 27,
	beginText: 31, showText: 44,
	setFillColor: 54, setFillColorN: 55, setFillGray: 57, setFillRGBColor: 59, setFillCMYKColor: 61,
	shadingFill: 62,
	paintImageMaskXObject: 83, paintImageMaskXObjectGroup: 84, paintImageXObject: 85, paintInlineImageXObject: 86,
	paintImageXObjectRepeat: 88, paintSolidColorImageMask: 90, constructPath: 91,
} as const;

const UNSUPPORTED_OPS = new Set<number>([
	OP.beginText, OP.showText, OP.shadingFill, OP.paintImageMaskXObject, OP.paintImageMaskXObjectGroup,
	OP.paintImageXObject, OP.paintInlineImageXObject, OP.paintImageXObjectRepeat, OP.paintSolidColorImageMask,
]);
const FILL_OPS = new Set<number>([OP.fill, OP.eoFill, OP.fillStroke, OP.eoFillStroke, OP.closeFillStroke, OP.closeEOFillStroke]);
const STROKE_OPS = new Set<number>([OP.stroke, OP.closeStroke, OP.fillStroke, OP.eoFillStroke, OP.closeFillStroke, OP.closeEOFillStroke]);
const PAINT_OPS = new Set<number>([...FILL_OPS, ...STROKE_OPS]);

type M6 = [number, number, number, number, number, number];
// PDF row-vector convention: the result applies `m` first, then `base`.
const concat = (m: M6, base: M6): M6 => [
	m[0] * base[0] + m[1] * base[2], m[0] * base[1] + m[1] * base[3],
	m[2] * base[0] + m[3] * base[2], m[2] * base[1] + m[3] * base[3],
	m[4] * base[0] + m[5] * base[2] + base[4], m[4] * base[1] + m[5] * base[3] + base[5],
];
const num = (v: number) => String(+v.toFixed(5));

export async function extractPdfVector(pdfBuffer: Buffer): Promise<PdfVector | null> {
	const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
	const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), useSystemFonts: true, isOffscreenCanvasSupported: false });
	try {
		const doc = await loadingTask.promise;
		if (doc.numPages < 1) return null;
		const page = await doc.getPage(1);
		const unit = (page as unknown as { userUnit?: number }).userUnit || 1;
		const viewport = page.getViewport({ scale: 1 });        // PDF space → y-down page space; honours rotation/origin
		const base = viewport.transform as unknown as M6;
		const ops = await page.getOperatorList();

		let ctm: M6 = [1, 0, 0, 1, 0, 0];
		let fillWhite = false;
		const stack: { ctm: M6; fillWhite: boolean }[] = [];
		const paths: string[] = [];

		for (let i = 0; i < ops.fnArray.length; i++) {
			const fn = ops.fnArray[i];
			const args = ops.argsArray[i] as unknown[];
			if (UNSUPPORTED_OPS.has(fn)) return null;
			switch (fn) {
				case OP.save: stack.push({ ctm, fillWhite }); break;
				case OP.restore: { const s = stack.pop(); if (s) { ctm = s.ctm; fillWhite = s.fillWhite; } break; }
				case OP.transform: ctm = concat(args as unknown as M6, ctm); break;
				case OP.setFillRGBColor: case OP.setFillGray: case OP.setFillCMYKColor:
				case OP.setFillColor: case OP.setFillColorN:
					fillWhite = typeof args?.[0] === 'string' && (args[0] as string).toLowerCase() === '#ffffff';
					break;
				case OP.constructPath: {
					const paint = args[0] as number;
					if (!PAINT_OPS.has(paint)) break;                 // clip / endPath only: geometry isn't drawn
					// A white fill with no stroke is page background / knock-out, not a cut line.
					if (fillWhite && FILL_OPS.has(paint) && !STROKE_OPS.has(paint)) break;
					const data = (args[1] as ArrayLike<number>[])[0];
					const m = concat(ctm, base);
					const P = (x: number, y: number) => `${num((m[0] * x + m[2] * y + m[4]) * unit)} ${num((m[1] * x + m[3] * y + m[5]) * unit)}`;
					const d: string[] = [];
					for (let k = 0; k < data.length;) {
						const c = data[k++];
						if (c === 0) { d.push(`M${P(data[k], data[k + 1])}`); k += 2; }
						else if (c === 1) { d.push(`L${P(data[k], data[k + 1])}`); k += 2; }
						else if (c === 2) { d.push(`C${P(data[k], data[k + 1])} ${P(data[k + 2], data[k + 3])} ${P(data[k + 4], data[k + 5])}`); k += 6; }
						else if (c === 3) { d.push(`Q${P(data[k], data[k + 1])} ${P(data[k + 2], data[k + 3])}`); k += 4; }
						else if (c === 4) { d.push('Z'); }
						else return null;                              // unknown path code: never guess
					}
					if (d.length) paths.push(d.join(''));
					break;
				}
			}
		}
		if (!paths.length) return null;
		const w = viewport.width * unit, h = viewport.height * unit;
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w / 72)}in" height="${num(h / 72)}in" viewBox="0 0 ${num(w)} ${num(h)}">`
			+ paths.map(p => `<path d="${p}" fill="none" stroke="#000"/>`).join('') + '</svg>';
		return { svg, widthInches: w / 72, heightInches: h / 72, pathCount: paths.length };
	} finally {
		await loadingTask.destroy();
	}
}
