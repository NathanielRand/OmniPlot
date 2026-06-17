import Jimp from 'jimp';
import { trace } from 'potrace';

export const TARGET_LONG_EDGE = 6000;

export const TRACE_OPTIONS = {
	turdSize:     2,
	turnPolicy:   'minority' as const,
	alphaMax:     1.0,
	optCurve:     true,
	optTolerance: 1.0,
	blackOnWhite: true,
	background:   '#ffffff',
	color:        '#000000',
};

// Morphological open on a thresholded binary image (black-on-white).
// Removes up to `radius`-pixel-scale protrusions from edges (staircase micro-bumps).
// Uses separable 1-D passes (H then V for each of erode/dilate) — O(n·r) instead
// of O(n·r²), ~3.5× faster than a 2-D kernel while producing identical results for
// a square structuring element.
export function morphOpen(img: Jimp, radius: number): void {
	const { width, height } = img.bitmap;
	const src    = img.bitmap.data as unknown as Buffer;
	const stride = width * 4;
	const tmp    = Buffer.alloc(src.length);
	const mid    = Buffer.alloc(src.length);

	// Erosion (max-filter) — horizontal pass into tmp
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let v = 0;
			for (let d = -radius; d <= radius; d++) {
				const nx = Math.max(0, Math.min(width - 1, x + d));
				const s = src[y * stride + nx * 4];
				if (s > v) v = s;
			}
			const i = y * stride + x * 4;
			tmp[i] = tmp[i+1] = tmp[i+2] = v; tmp[i+3] = 255;
		}
	}
	// Erosion — vertical pass into mid
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let v = 0;
			for (let d = -radius; d <= radius; d++) {
				const ny = Math.max(0, Math.min(height - 1, y + d));
				const s = tmp[ny * stride + x * 4];
				if (s > v) v = s;
			}
			const i = y * stride + x * 4;
			mid[i] = mid[i+1] = mid[i+2] = v; mid[i+3] = 255;
		}
	}

	// Dilation (min-filter) — horizontal pass into tmp
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let v = 255;
			for (let d = -radius; d <= radius; d++) {
				const nx = Math.max(0, Math.min(width - 1, x + d));
				const s = mid[y * stride + nx * 4];
				if (s < v) v = s;
			}
			const i = y * stride + x * 4;
			tmp[i] = tmp[i+1] = tmp[i+2] = v; tmp[i+3] = 255;
		}
	}
	// Dilation — vertical pass back into src
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let v = 255;
			for (let d = -radius; d <= radius; d++) {
				const ny = Math.max(0, Math.min(height - 1, y + d));
				const s = tmp[ny * stride + x * 4];
				if (s < v) v = s;
			}
			const i = y * stride + x * 4;
			src[i] = src[i+1] = src[i+2] = v;
		}
	}
}

export function readJimp(buf: Buffer): Promise<Jimp> {
	return new Promise<Jimp>((resolve, reject) => {
		Jimp.read(buf, (err, img) => {
			if (err) reject(err); else resolve(img);
		});
	});
}

export function jimpToBuffer(img: Jimp): Promise<Buffer> {
	return new Promise<Buffer>((resolve, reject) => {
		img.getBase64(Jimp.MIME_PNG, (err, data) => {
			if (err) { reject(err); return; }
			resolve(Buffer.from(data.replace(/^data:image\/png;base64,/, ''), 'base64'));
		});
	});
}

export function runTrace(buf: Buffer): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		trace(buf, TRACE_OPTIONS, (err, result) => {
			if (err) reject(err); else resolve(result);
		});
	});
}

export async function preprocessForTrace(inputBuffer: Buffer, targetLongEdge = TARGET_LONG_EDGE): Promise<Buffer> {
	const img = await readJimp(inputBuffer);

	const { width, height } = img.bitmap;
	const longEdge = Math.max(width, height);

	if (longEdge > 0 && longEdge !== targetLongEdge) {
		const scale = targetLongEdge / longEdge;
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

	return jimpToBuffer(img);
}
