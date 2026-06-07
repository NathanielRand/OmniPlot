import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { trace } from 'potrace';

// Vectorizes any raster image (PNG / JPEG / WebP / BMP / GIF) to SVG using
// potrace, which produces smooth bezier curves instead of pixel-traced paths.
// The caller is expected to normalise the returned path to 0–100 space.
const TRACE_OPTIONS = {
	turdSize:     4,    // suppress noise islands below 4 px²
	optCurve:     true,
	optTolerance: 0.1,  // tight tolerance — preserves curve precision
	blackOnWhite: true, // dark shape on light background
	background:   '#ffffff',
	color:        '#000000',
};

const ALLOWED_TYPES = new Set([
	'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
	'image/bmp', 'image/gif', 'image/tiff',
]);

export const POST: RequestHandler = async ({ request }) => {
	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		throw error(400, 'Expected multipart/form-data.');
	}

	const file = formData.get('image');
	if (!(file instanceof File)) throw error(400, 'Missing image field.');
	if (file.size === 0) throw error(400, 'Uploaded file is empty.');
	if (!ALLOWED_TYPES.has(file.type)) throw error(415, `Unsupported image type: ${file.type}`);

	const buffer = Buffer.from(await file.arrayBuffer());

	const svg = await new Promise<string>((resolve, reject) => {
		trace(buffer, TRACE_OPTIONS, (err, result) => {
			if (err) reject(err); else resolve(result);
		});
	}).catch((err) => {
		throw error(422, `Vectorization failed: ${err?.message ?? 'unknown error'}`);
	});

	return json({ svg });
};
