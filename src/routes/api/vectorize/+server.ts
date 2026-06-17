import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { preprocessForTrace, runTrace } from '$lib/server/vectorize';

export const config = {
	runtime:     'nodejs20.x',
	maxDuration: 60,
};

const ALLOWED_TYPES = new Set([
	'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
	'image/bmp', 'image/gif', 'image/tiff',
]);

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

		const targetEdgeStr = formData.get('targetEdge');
		const targetEdge = targetEdgeStr && Number(targetEdgeStr) > 0 ? Number(targetEdgeStr) : undefined;

		const processed = await preprocessForTrace(raw, targetEdge).catch((err) => {
			const msg = err?.message ?? 'unknown error';
			console.error('[vectorize] preprocessing failed:', msg);
			throw error(422, `Image preprocessing failed: ${msg}`);
		});

		const svg = await runTrace(processed).catch((err) => {
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
