import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { renderPdfFirstPageToPng } from '$lib/server/pdf';
import { checkRateLimit, rateLimitedResponse } from '$lib/server/rate-limit';
import { logServerError } from '$lib/server/log-error';

export const config = {
	runtime:     'nodejs20.x',
	maxDuration: 30,
};

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const limit = await checkRateLimit(`pdf-convert:${getClientAddress()}`, { max: 20, windowSeconds: 60 });
	if (!limit.allowed) return rateLimitedResponse(limit);

	try {
		let formData: FormData;
		try {
			formData = await request.formData();
		} catch {
			throw error(400, 'Expected multipart/form-data.');
		}

		const file = formData.get('file');
		if (!(file instanceof File)) throw error(400, 'Missing file field.');
		if (file.size === 0)         throw error(400, 'Uploaded file is empty.');
		const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
		if (!isPdf) throw error(415, `Expected a PDF, got: ${file.type || 'unknown type'}`);

		const raw = Buffer.from(await file.arrayBuffer());

		const png = await renderPdfFirstPageToPng(raw).catch((err) => {
			const msg = err?.message ?? 'unknown error';
			console.error('[pdf-convert] render failed:', msg);
			throw error(422, `Could not read PDF: ${msg}`);
		});

		return json({ image: `data:image/png;base64,${png.toString('base64')}` });

	} catch (err: unknown) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[pdf-convert] unexpected error:', err);
		await logServerError(err, { source: 'api', route: '/api/pdf-convert', severity: 'warning' });
		throw error(500, `PDF conversion service error: ${msg}`);
	}
};
