import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { trace } from 'potrace';
import Jimp from 'jimp';

export const config = {
	runtime:     'nodejs20.x',
	maxDuration: 60,
};

const TARGET_LONG_EDGE = 6000;

const TRACE_OPTIONS = {
	turdSize:     2,
	turnPolicy:   'minority' as const,
	alphaMax:     1.0,
	optCurve:     true,
	optTolerance: 1.0,
	blackOnWhite: true,
	background:   '#ffffff',
	color:        '#000000',
};

const ALLOWED_TYPES = new Set([
	'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
	'image/bmp', 'image/gif', 'image/tiff',
]);

// Morphological open on a thresholded binary image (black-on-white).
// Removes up to `radius`-pixel-scale protrusions from edges (staircase micro-bumps).
// Erosion = (2r+1)×(2r+1) max-filter, dilation = same-size min-filter.
function morphOpen(img: Jimp, radius = 1): void {
	const { width, height } = img.bitmap;
	const data    = img.bitmap.data as unknown as Buffer;
	const stride  = width * 4;
	const eroded  = Buffer.alloc(data.length);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let maxV = 0;
			for (let dy = -radius; dy <= radius; dy++) {
				const ny = Math.max(0, Math.min(height - 1, y + dy));
				for (let dx = -radius; dx <= radius; dx++) {
					const nx = Math.max(0, Math.min(width - 1, x + dx));
					const v  = data[ny * stride + nx * 4];
					if (v > maxV) maxV = v;
				}
			}
			const i = y * stride + x * 4;
			eroded[i] = eroded[i + 1] = eroded[i + 2] = maxV;
			eroded[i + 3] = 255;
		}
	}

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let minV = 255;
			for (let dy = -radius; dy <= radius; dy++) {
				const ny = Math.max(0, Math.min(height - 1, y + dy));
				for (let dx = -radius; dx <= radius; dx++) {
					const nx = Math.max(0, Math.min(width - 1, x + dx));
					const v  = eroded[ny * stride + nx * 4];
					if (v < minV) minV = v;
				}
			}
			const i = y * stride + x * 4;
			data[i] = data[i + 1] = data[i + 2] = minV;
		}
	}
}

async function preprocessForTrace(inputBuffer: Buffer): Promise<Buffer> {
	const img = await new Promise<Jimp>((resolve, reject) => {
		Jimp.read(inputBuffer, (err, image) => {
			if (err) reject(err); else resolve(image);
		});
	});

	const { width, height } = img.bitmap;
	const longEdge = Math.max(width, height);

	if (longEdge > 0 && longEdge < TARGET_LONG_EDGE) {
		const scale = TARGET_LONG_EDGE / longEdge;
		img.resize(
			Math.round(width  * scale),
			Math.round(height * scale),
			Jimp.RESIZE_BICUBIC,
		);
	}

	img
		.greyscale()
		.normalize()
		.gaussian(2)
		.threshold({ max: 128, autoGreyscale: false });

	morphOpen(img, 3);

	return new Promise<Buffer>((resolve, reject) => {
		img.getBase64(Jimp.MIME_PNG, (err, data) => {
			if (err) { reject(err); return; }
			const b64 = data.replace(/^data:image\/png;base64,/, '');
			resolve(Buffer.from(b64, 'base64'));
		});
	});
}

export const POST: RequestHandler = async ({ request }) => {
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

		const processed = await preprocessForTrace(raw).catch((err) => {
			const msg = err?.message ?? 'unknown error';
			console.error('[vectorize] preprocessing failed:', msg);
			throw error(422, `Image preprocessing failed: ${msg}`);
		});

		const svg = await new Promise<string>((resolve, reject) => {
			trace(processed, TRACE_OPTIONS, (err, result) => {
				if (err) reject(err); else resolve(result);
			});
		}).catch((err) => {
			const msg = err?.message ?? 'unknown error';
			console.error('[vectorize] potrace failed:', msg);
			throw error(422, `Vectorization failed: ${msg}`);
		});

		return json({ svg });

	} catch (err: unknown) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[vectorize] unexpected error:', err);
		throw error(500, `Vectorization service error: ${msg}`);
	}
};
