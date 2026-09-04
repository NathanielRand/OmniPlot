import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Jimp from 'jimp';
import { morphOpen, readJimp, jimpToBuffer, runTrace, preprocessForTrace } from '$lib/server/vectorize';
import { checkRateLimit, rateLimitedResponse } from '$lib/server/rate-limit';
import { logServerError } from '$lib/server/log-error';

export const config = {
	runtime:     'nodejs20.x',
	maxDuration: 120,
};

// Lower detection resolution keeps BFS cheap; accuracy only needs to be within ~10px.
const DETECT_LONG_EDGE    = 1500;
// Per-crop upscale target — each shape gets the equivalent of a full single-shape upload.
const MULTI_TARGET_LONG_EDGE = 3600;
// White border (original-space px) ensures potrace always sees white surrounding the shape.
const BORDER_PX           = 20;
// Padding (detect-space px) around each detected bbox before mapping to original coords.
const DETECT_PADDING      = 25;
// Minimum connected-component area (detect-space px²) — filters noise specks.
const MIN_BLOB_AREA       = 300;

const ALLOWED_TYPES = new Set([
	'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
	'image/bmp', 'image/gif', 'image/tiff',
]);

// Connected-component BFS on a thresholded Jimp image.
// Dark pixels (value ≤ 128) are shapes; white is background.
// Returns bboxes of every component whose bounding-box area ≥ minArea.
function findShapeBboxes(
	img: Jimp,
	minArea: number,
): Array<{ x: number; y: number; w: number; h: number }> {
	const { width, height } = img.bitmap;
	const data    = img.bitmap.data as unknown as Buffer;
	const visited = new Uint8Array(width * height);
	const bboxes: Array<{ x: number; y: number; w: number; h: number }> = [];

	for (let startY = 0; startY < height; startY++) {
		for (let startX = 0; startX < width; startX++) {
			const startFlat = startY * width + startX;
			if (visited[startFlat]) continue;
			visited[startFlat] = 1;
			if (data[startFlat * 4] > 128) continue; // background pixel

			// Dark pixel — BFS to find the full component
			const queue: number[] = [startFlat];
			let qHead = 0;
			let x1 = startX, y1 = startY, x2 = startX, y2 = startY;

			while (qHead < queue.length) {
				const flat = queue[qHead++];
				const cx = flat % width;
				const cy = (flat / width) | 0;
				if (cx < x1) x1 = cx;
				if (cx > x2) x2 = cx;
				if (cy < y1) y1 = cy;
				if (cy > y2) y2 = cy;

				const neighbors = [
					cy > 0           ? flat - width : -1,
					cy < height - 1  ? flat + width : -1,
					cx > 0           ? flat - 1     : -1,
					cx < width  - 1  ? flat + 1     : -1,
				];
				for (const n of neighbors) {
					if (n < 0 || visited[n]) continue;
					visited[n] = 1;
					if (data[n * 4] <= 128) queue.push(n);
				}
			}

			const area = (x2 - x1 + 1) * (y2 - y1 + 1);
			if (area >= minArea) {
				bboxes.push({ x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 });
			}
		}
	}

	return bboxes;
}

function createWhiteJimp(w: number, h: number): Promise<Jimp> {
	return new Promise<Jimp>((resolve, reject) => {
		new Jimp(w, h, 0xffffffff, (err: Error | null, img: Jimp) => {
			if (err) reject(err); else resolve(img);
		});
	});
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	// Heaviest of the vectorize endpoints (multi-blob potrace) — tighter cap.
	const limit = await checkRateLimit(`vectorize-multi:${getClientAddress()}`, { max: 10, windowSeconds: 60 });
	if (!limit.allowed) return rateLimitedResponse(limit);

	try {
		let formData: FormData;
		try {
			formData = await request.formData();
		} catch {
			throw error(400, 'Expected multipart/form-data.');
		}

		const file = formData.get('image');
		if (!(file instanceof File)) throw error(400, 'Missing image field.');
		if (file.size === 0)         throw error(400, 'Uploaded file is empty.');
		if (!ALLOWED_TYPES.has(file.type)) throw error(415, `Unsupported image type: ${file.type}`);

		const raw = Buffer.from(await file.arrayBuffer());

		// ── 1. Load original image (keep color for high-quality per-crop preprocess) ──
		const original = await readJimp(raw).catch(e => {
			throw error(422, `Could not load image: ${e?.message ?? e}`);
		});
		const origW    = original.bitmap.width;
		const origH    = original.bitmap.height;
		const origLong = Math.max(origW, origH);

		// ── 2. Downscaled binary copy for cheap blob detection ──
		const detect = original.clone();
		if (origLong > DETECT_LONG_EDGE) {
			const s = DETECT_LONG_EDGE / origLong;
			detect.resize(Math.round(origW * s), Math.round(origH * s), Jimp.RESIZE_BICUBIC);
		}
		detect
			.greyscale()
			.normalize()
			.gaussian(2)
			.threshold({ max: 128, autoGreyscale: false });
		morphOpen(detect, 2);

		const detectW = detect.bitmap.width;
		const detectH = detect.bitmap.height;

		// ── 3. Connected-component blob detection ──
		const blobs = findShapeBboxes(detect, MIN_BLOB_AREA);
		if (blobs.length === 0) {
			throw error(422, 'No shapes detected in image. Make sure the image has high-contrast shapes on a uniform background.');
		}

		// ── 4. Map detect-space bboxes → original-space with padding ──
		const scaleX  = origW / detectW;
		const scaleY  = origH / detectH;
		const padOrigX = Math.round(DETECT_PADDING * scaleX);
		const padOrigY = Math.round(DETECT_PADDING * scaleY);

		// Pipeline potrace (native C on Node's threadpool) with the next blob's
		// Jimp preprocessing (JS main thread). While runTrace awaits a threadpool
		// slot, the event loop is free to run the next blob's synchronous work —
		// giving ~40-50% speedup over pure sequential for typical blob counts.
		// Peak memory per in-flight blob: ~150 MB (3600px RGBA + 2 morphOpen bufs).
		const CONCURRENCY = 2;

		async function processBlob(blob: (typeof blobs)[0]): Promise<string> {
			const ox  = Math.max(0, Math.floor(blob.x * scaleX) - padOrigX);
			const oy  = Math.max(0, Math.floor(blob.y * scaleY) - padOrigY);
			const ox2 = Math.min(origW - 1, Math.ceil((blob.x + blob.w) * scaleX) + padOrigX);
			const oy2 = Math.min(origH - 1, Math.ceil((blob.y + blob.h) * scaleY) + padOrigY);
			const ow  = ox2 - ox + 1;
			const oh  = oy2 - oy + 1;

			// Crop from the original color image.
			const crop = original.clone().crop(ox, oy, ow, oh);

			// Surround with white so potrace always sees a closed outer contour
			// even when the crop edge coincides with the original image boundary.
			const canvas = await createWhiteJimp(ow + BORDER_PX * 2, oh + BORDER_PX * 2);
			canvas.composite(crop, BORDER_PX, BORDER_PX);

			// preprocessForTrace handles Lanczos3 resize, USM, adaptive threshold,
			// and dynamic morphOpen radius — all scaled to the original crop size.
			const rawBuf   = await jimpToBuffer(canvas);
			const processed = await preprocessForTrace(rawBuf, MULTI_TARGET_LONG_EDGE);
			return runTrace(processed).catch((e: Error) => {
				throw error(422, `Vectorization failed for a shape: ${e?.message ?? e}`);
			});
		}

		const svgsOrdered = new Array<string>(blobs.length);
		let nextBlob = 0;

		async function worker(): Promise<void> {
			while (nextBlob < blobs.length) {
				const i = nextBlob++;
				svgsOrdered[i] = await processBlob(blobs[i]);
			}
		}

		await Promise.all(Array.from({ length: Math.min(CONCURRENCY, blobs.length) }, worker));
		const svgs = svgsOrdered;

		return json({ svgs });

	} catch (err: unknown) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[vectorize-multi] unexpected error:', err);
		await logServerError(err, { source: 'api', route: '/api/vectorize-multi', severity: 'warning' });
		throw error(500, `Vectorization service error: ${msg}`);
	}
};
