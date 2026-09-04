import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { preprocessCutout, runTrace } from '$lib/server/vectorize';
import { checkRateLimit, rateLimitedResponse } from '$lib/server/rate-limit';
import { logServerError } from '$lib/server/log-error';

export const config = {
	runtime:     'nodejs20.x',
	maxDuration: 60,
};

const ALLOWED_TYPES = new Set([
	'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
	'image/bmp', 'image/gif', 'image/tiff',
]);

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

		const targetEdgeStr = formData.get('targetEdge');
		const targetEdge = targetEdgeStr && Number(targetEdgeStr) > 0 ? Number(targetEdgeStr) : undefined;

		const toleranceStr = formData.get('tolerance');
		const tolerance = toleranceStr && Number(toleranceStr) > 0 ? Number(toleranceStr) : undefined;

		const processed = await preprocessCutout(raw, targetEdge, tolerance).catch((err) => {
			const msg = err?.message ?? 'unknown error';
			console.error('[vectorize-cutout] preprocessing failed:', msg);
			throw error(422, `Background removal failed: ${msg}`);
		});

		const svg = await runTrace(processed).catch((err) => {
			const msg = err?.message ?? 'unknown error';
			console.error('[vectorize-cutout] potrace failed:', msg);
			throw error(422, `Vectorization failed: ${msg}`);
		});

		return json({ svg });

	} catch (err: unknown) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[vectorize-cutout] unexpected error:', err);
		await logServerError(err, { source: 'api', route: '/api/vectorize-cutout', severity: 'warning' });
		throw error(500, `Cutout service error: ${msg}`);
	}
};
