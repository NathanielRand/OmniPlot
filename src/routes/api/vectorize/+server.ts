import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { trace } from 'potrace';
import sharp from 'sharp';

// Pin the Vercel serverless function to Node.js 20 and give enough headroom
// for sharp + potrace on large upsampled images.
export const config = {
	runtime:     'nodejs20.x',
	maxDuration: 30,
};

// Target resolution for tracing — upsample small images to this so potrace
// has more pixels to work with, which directly improves edge accuracy.
const TARGET_LONG_EDGE = 3000;

// Potrace options.
// alphaMax 1.0 is potrace's natural per-point corner detector — it classifies
// high-curvature junctions as hard corners and low-curvature as curves.
// The client-side smoothBezierJunctions pass then refines near-smooth junctions
// (<25°) to G1, handling the noise case without rounding genuine corners.
const TRACE_OPTIONS = {
	turdSize:     2,
	turnPolicy:   'minority' as const,
	alphaMax:     1.0,
	optCurve:     true,
	optTolerance: 1.0,   // higher = fewer segments, smoother curves on noisy binary edges
	blackOnWhite: true,
	background:   '#ffffff',
	color:        '#000000',
};

const ALLOWED_TYPES = new Set([
	'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
	'image/bmp', 'image/gif', 'image/tiff',
]);

async function preprocessForTrace(inputBuffer: Buffer): Promise<Buffer> {
	const meta = await sharp(inputBuffer).metadata();
	const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);

	let pipeline = sharp(inputBuffer);

	// Upsample if below target — more pixels → cleaner binary → better curves.
	if (longEdge > 0 && longEdge < TARGET_LONG_EDGE) {
		const scale = TARGET_LONG_EDGE / longEdge;
		pipeline = pipeline.resize({
			width:  Math.round((meta.width  ?? 0) * scale),
			height: Math.round((meta.height ?? 0) * scale),
			kernel: sharp.kernel.cubic,
		});
	}

	// Preprocessing pipeline:
	// 1. median(3)   — removes salt-and-pepper noise while preserving edge position
	// 2. normalize   — stretches histogram to full contrast range
	// 3. blur(2.2)   — smooths anti-aliased transition before thresholding
	// 4. threshold   — binarize
	// 5. blur(1.8) + threshold — second pass smooths the binary edge itself
	return pipeline
		.grayscale()
		.median(3)
		.normalize()
		.blur(2.2)
		.threshold(128)
		.blur(1.8)
		.threshold(128)
		.png()
		.toBuffer();
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
		// Re-throw SvelteKit HttpErrors (400/415/422 above) unchanged.
		if (err && typeof err === 'object' && 'status' in err) throw err;

		// Unexpected error (e.g. native module load failure, OOM).
		// Log the full stack so it appears in Vercel's function log, then
		// return a 500 with a human-readable message the client can display.
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[vectorize] unexpected error:', err);
		throw error(500, `Vectorization service error: ${msg}`);
	}
};
