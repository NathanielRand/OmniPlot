import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Jimp from 'jimp';
import { morphOpen, readJimp } from '$lib/server/vectorize';
import { checkRateLimit, rateLimitedResponse } from '$lib/server/rate-limit';
import { logServerError } from '$lib/server/log-error';

export const config = {
	runtime:     'nodejs20.x',
	maxDuration: 30,
};

const DETECT_LONG_EDGE = 1500;
const DETECT_PADDING   = 25;
const MIN_BLOB_AREA    = 300;

const ALLOWED_TYPES = new Set([
	'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
	'image/bmp', 'image/gif', 'image/tiff',
]);

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
			if (data[startFlat * 4] > 128) continue;

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
					cy > 0          ? flat - width : -1,
					cy < height - 1 ? flat + width : -1,
					cx > 0          ? flat - 1     : -1,
					cx < width - 1  ? flat + 1     : -1,
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

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const limit = await checkRateLimit(`vectorize:${getClientAddress()}`, { max: 20, windowSeconds: 60 });
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

		const original = await readJimp(raw).catch(e => {
			throw error(422, `Could not load image: ${e?.message ?? e}`);
		});
		const origW    = original.bitmap.width;
		const origH    = original.bitmap.height;
		const origLong = Math.max(origW, origH);

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

		const blobs = findShapeBboxes(detect, MIN_BLOB_AREA);
		if (blobs.length === 0) {
			throw error(422, 'No shapes detected in image. Make sure the image has dark shapes on a light background.');
		}

		const scaleX   = origW / detectW;
		const scaleY   = origH / detectH;
		const padOrigX = Math.round(DETECT_PADDING * scaleX);
		const padOrigY = Math.round(DETECT_PADDING * scaleY);

		const crops = blobs.map(blob => {
			const ox  = Math.max(0, Math.floor(blob.x * scaleX) - padOrigX);
			const oy  = Math.max(0, Math.floor(blob.y * scaleY) - padOrigY);
			const ox2 = Math.min(origW - 1, Math.ceil((blob.x + blob.w) * scaleX) + padOrigX);
			const oy2 = Math.min(origH - 1, Math.ceil((blob.y + blob.h) * scaleY) + padOrigY);
			return { x: ox, y: oy, w: ox2 - ox + 1, h: oy2 - oy + 1 };
		});

		return json({ crops });

	} catch (err: unknown) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[vectorize-detect] unexpected error:', err);
		await logServerError(err, { source: 'api', route: '/api/vectorize-detect', severity: 'warning' });
		throw error(500, `Detection service error: ${msg}`);
	}
};
