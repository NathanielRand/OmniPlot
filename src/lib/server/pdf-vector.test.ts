import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { extractPdfVector } from './pdf-vector';
import { loadGT } from '../../../scripts/vectorize-bench/gt';
import { compare } from '../../../scripts/vectorize-bench/metrics';
import { parsePath, flattenSegs, pathBBox, transformSegs } from '../utils/pathGeometry';

const ROOT = 'docs/pattern_testing/inputs';
const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const pdfs = (dir: string): string[] => isDir(dir) ? readdirSync(dir).flatMap(n => {
	const p = join(dir, n);
	return isDir(p) ? pdfs(p) : n.toLowerCase().endsWith('.pdf') ? [p] : [];
}) : [];

describe('extractPdfVector: exact geometry from vector PDFs', () => {
	for (const f of pdfs(ROOT)) {
		const m = /\((\d+(?:\.\d+)?),(\d+(?:\.\d+)?)\)/.exec(f);
		it(f.split(/[\\/]/).pop()!, async () => {
			const v = await extractPdfVector(readFileSync(f));
			expect(v).not.toBeNull();
			expect(v!.pathCount).toBe(1);
			const d = /<path d="([^"]+)"/.exec(v!.svg)![1];
			const inch = transformSegs(parsePath(d), { a: 1 / 72, b: 0, c: 0, d: 1 / 72, e: 0, f: 0 });
			const b = pathBBox(inch);
			// Size in the filename matches the geometry (filenames are rounded to 0.1").
			if (m) {
				expect(Math.abs(v!.widthInches - Number(m[1]))).toBeLessThan(0.05);
				expect(Math.abs(v!.heightInches - Number(m[2]))).toBeLessThan(0.05);
				expect(Math.abs(b.width - Number(m[1]))).toBeLessThan(0.05);
				expect(Math.abs(b.height - Number(m[2]))).toBeLessThan(0.05);
			}
			expect(flattenSegs(inch, 0.0005).length).toBe(1);
			// Independent decode of the PDF content stream: geometry is identical (<0.0005", the cut tolerance).
			const gt = loadGT(f);
			const mm = compare(gt.d, gt.widthIn, gt.heightIn, d);
			expect(mm.maxDevIn).toBeLessThan(0.0005);
			expect(mm.iou).toBeGreaterThan(0.99999);
		});
	}

	it('returns null when there is nothing drawn', async () => {
		const empty = Buffer.from('%PDF-1.3\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF');
		expect(await extractPdfVector(empty).catch(() => null)).toBeNull();
	});
});
