// PDF → PNG conversion for the pattern uploader: lets a user drop in a PDF
// (common export format from vector design tools) the same way they'd drop
// in a PNG/JPG. We render the first page to a raster image at high enough
// resolution to trace well, then hand it off to the exact same raster
// pipeline (preprocessForTrace / preprocessCutout / preprocessEnhance) used
// for any other photo — no separate PDF-specific tracing path to maintain.
//
// pdfjs-dist does the parsing/rendering (Mozilla's PDF engine, pure JS/WASM —
// no native PDF library needed); @napi-rs/canvas supplies the Canvas2D
// surface pdfjs draws into (prebuilt native binary, same deployment story
// as sharp — works on Vercel's Linux/x64 Node runtime).
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

// pdfjs normally runs its parser on a worker thread, spun up by dynamically
// import()-ing pdf.worker.mjs by path at runtime (pdfjsLib.getDocument() call
// site below). That path resolution works in a normal node_modules install,
// but not inside a Vercel serverless function bundle: the dynamic import
// target is just a runtime string, so Vercel's dependency tracer never sees
// it and doesn't include the file — producing "Cannot find module
// .../pdf.worker.mjs" in production even though it works locally.
// Registering the worker's exports on globalThis.pdfjsWorker short-circuits
// that dynamic import (pdfjs checks for it first — see PDFWorker's
// #mainThreadWorkerMessageHandler) — and because this import is a normal
// static ESM import, Vite/Rollup bundle it and Vercel's tracer includes it
// like any other dependency.
(globalThis as unknown as { pdfjsWorker: typeof pdfjsWorker }).pdfjsWorker = pdfjsWorker;

// pdfjs-dist (as of v6) uses Promise.withResolvers, which landed in V8/Node 22 —
// the api routes here run on the nodejs20.x runtime, so it's missing there.
// Polyfilling once at module load keeps every route on the pinned Node 20
// runtime instead of needing a version bump just for this one dependency.
if (typeof Promise.withResolvers !== 'function') {
	(Promise as unknown as { withResolvers: <T>() => { promise: Promise<T>; resolve: (v: T) => void; reject: (e?: unknown) => void } }).withResolvers = function withResolvers<T>() {
		let resolve!: (v: T) => void;
		let reject!: (e?: unknown) => void;
		const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
		return { promise, resolve, reject };
	};
}

export const MAX_PDF_PAGES_NOTE = 'Only the first page of a multi-page PDF is used.';

export async function renderPdfFirstPageToPng(pdfBuffer: Buffer, targetLongEdge = 3000): Promise<Buffer> {
	// Legacy build targets Node (no DOM/Worker assumptions) — the standard
	// entry point for using pdfjs-dist outside a browser.
	const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

	const loadingTask = pdfjsLib.getDocument({
		data: new Uint8Array(pdfBuffer),
		useSystemFonts: true,
		isOffscreenCanvasSupported: false,
	});

	try {
		const doc = await loadingTask.promise;
		if (doc.numPages < 1) throw new Error('PDF has no pages.');
		const page = await doc.getPage(1);

		const baseViewport = page.getViewport({ scale: 1 });
		const longEdge = Math.max(baseViewport.width, baseViewport.height);
		if (!longEdge || !Number.isFinite(longEdge)) throw new Error('PDF page has no drawable extent.');
		const scale = targetLongEdge / longEdge;
		const viewport = page.getViewport({ scale });

		const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
		const ctx = canvas.getContext('2d');
		// White background — PDFs with transparent regions would otherwise
		// composite onto whatever the raw canvas buffer defaults to.
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		await page.render({
			// @napi-rs/canvas's context is Canvas2D-API-compatible but not the
			// exact DOM type pdfjs's TS types expect — cast at the boundary.
			// canvas: null tells pdfjs to render via canvasContext alone,
			// since there's no real HTMLCanvasElement outside a browser DOM.
			canvas: null,
			canvasContext: ctx as unknown as CanvasRenderingContext2D,
			viewport,
		}).promise;

		return canvas.toBuffer('image/png');
	} finally {
		await loadingTask.destroy();
	}
}
