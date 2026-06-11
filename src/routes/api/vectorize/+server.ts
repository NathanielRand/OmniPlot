import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { trace } from 'potrace';
import sharp from 'sharp';

// Target resolution for tracing — upsample small images to this so potrace
// has more pixels to work with, which directly improves edge accuracy.
const TARGET_LONG_EDGE = 3000;

// Potrace options.
// alphaMax 1.0 is potrace's natural per-point corner detector — it classifies
// high-curvature junctions as hard corners and low-curvature as curves.
// The client-side smoothBezierJunctions pass then refines near-smooth junctions
// (<20°) to G1, handling the noise case without rounding genuine corners.
const TRACE_OPTIONS = {
	turdSize:     2,
	turnPolicy:   'minority' as const,
	alphaMax:     1.0,
	optCurve:     true,
	optTolerance: 0.8,   // 0.2 → 0.8: looser curve fit = fewer micro-wiggles on straight edges
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

	// Preprocessing pipeline designed to give potrace the cleanest binary edge:
	// 1. median(3) — removes pixel noise while preserving edge position
	//    (superior to pure blur for salt-and-pepper and JPEG compression artifacts)
	// 2. normalize — stretches histogram to full contrast range
	// 3. blur(1.5) — smooths the anti-aliased transition zone before thresholding;
	//    this is the primary fix for staircase edges on the binary boundary
	// 4. threshold — binarize at midpoint
	// 5. blur(1.2) + threshold — second pass further smooths the binary edge itself,
	//    rounding off any remaining micro-jaggedness before potrace sees it
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

	const raw = Buffer.from(await file.arrayBuffer());
	const processed = await preprocessForTrace(raw).catch((err) => {
		throw error(422, `Image preprocessing failed: ${err?.message ?? 'unknown error'}`);
	});

	const svg = await new Promise<string>((resolve, reject) => {
		trace(processed, TRACE_OPTIONS, (err, result) => {
			if (err) reject(err); else resolve(result);
		});
	}).catch((err) => {
		throw error(422, `Vectorization failed: ${err?.message ?? 'unknown error'}`);
	});

	return json({ svg });
};
