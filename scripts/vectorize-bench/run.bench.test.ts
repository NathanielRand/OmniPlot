import { test } from 'vitest';
import { readdirSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { loadGT } from './gt';
import { compare } from './metrics';
import { vectorizeRaster, svgToNormalized, keepInner } from './pipeline';
import { smoothBezierJunctions } from '../../src/lib/utils/bezier-smooth';

const ROOT = 'docs/pattern_testing/inputs';
const OUT = 'docs/pattern_testing/outputs';

interface Variant { id: string; long: number; margin: number; jpeg?: number; stroke?: number; blur?: number; }
const VARIANTS: Variant[] = [
	{ id: 'L800-m6',      long: 800,  margin: 0.06 },
	{ id: 'L1600-m6',     long: 1600, margin: 0.06 },
	{ id: 'L3000-jpg70',  long: 3000, margin: 0.03, jpeg: 70 },
	{ id: 'L1600-tight',  long: 1600, margin: 0 },
	{ id: 'L1200-poor',   long: 1200, margin: 0.05, jpeg: 35, blur: 1.4 },   // blurry low-quality JPEG photo-ish
	{ id: 'L1600-stroke', long: 1600, margin: 0.06, stroke: 3 },   // outline-only art (white fill, 3px black line)
];

function findPdfs(dir: string): string[] {
	return readdirSync(dir).flatMap(n => {
		const p = join(dir, n);
		return statSync(p).isDirectory() ? findPdfs(p) : n.toLowerCase().endsWith('.pdf') ? [p] : [];
	});
}

async function render(d: string, W: number, H: number, v: Variant) {
	const pxPerIn = (v.long * (1 - 2 * v.margin)) / Math.max(W, H);
	const w = Math.round(W * pxPerIn + 2 * v.margin * v.long), h = Math.round(H * pxPerIn + 2 * v.margin * v.long);
	const off = v.margin * v.long + (v.stroke ?? 0) / 2;
	const paint = v.stroke ? `fill="#fff" stroke="#000" stroke-width="${v.stroke / pxPerIn}"` : 'fill="#000"';
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fff"/><g transform="translate(${off} ${off}) scale(${pxPerIn})"><path d="${d}" ${paint}/></g></svg>`;
	let img = sharp(Buffer.from(svg)).flatten({ background: '#fff' });
	if (v.blur) img = sharp(await img.png().toBuffer()).blur(v.blur);
	const png = v.jpeg ? await img.jpeg({ quality: v.jpeg }).toBuffer().then(b => sharp(b).png().toBuffer()) : await img.png().toBuffer();
	return { png, pxPerIn };
}

test('vectorize accuracy bench', async () => {
	const only = process.env.BENCH_FILTER;
	const onlyV = process.env.BENCH_VARIANT;
	const rows: string[] = [];
	const summary: Record<string, { n: number; sumSym: number; worstPx: number; worstIn: number; worstName: string }> = {};
	mkdirSync(OUT, { recursive: true });
	for (const f of findPdfs(ROOT)) {
		if (only && !f.includes(only)) continue;
		const gt = loadGT(f);
		for (const v of VARIANTS) {
			if (onlyV && v.id !== onlyV) continue;
			const { png, pxPerIn } = await render(gt.d, gt.widthIn, gt.heightIn, v);
			const { d, rawSvg } = await vectorizeRaster(png);
			const m = compare(gt.d, gt.widthIn, gt.heightIn, d);
			const raw = compare(gt.d, gt.widthIn, gt.heightIn, keepInner(svgToNormalized(rawSvg)));   // before client smoothing
			const px = m.maxDevIn * pxPerIn, rawPx = raw.maxDevIn * pxPerIn;
			const s = (summary[v.id] ??= { n: 0, sumSym: 0, worstPx: 0, worstIn: 0, worstName: '' });
			s.n++; s.sumSym += m.symDiffPct;
			if (px > s.worstPx) { s.worstPx = px; s.worstName = gt.name; }
			s.worstIn = Math.max(s.worstIn, m.maxDevIn);
			rows.push(`${gt.name.slice(0, 24).padEnd(24)} ${v.id.padEnd(12)} IoU ${(m.iou * 100).toFixed(3)}%  maxDev ${m.maxDevIn.toFixed(4)}in = ${px.toFixed(1)}px @(${m.worstAt.x.toFixed(1)},${m.worstAt.y.toFixed(1)})  [raw potrace ${rawPx.toFixed(1)}px]  p99 ${(m.p99DevIn * pxPerIn).toFixed(2)}px  aspectErr ${m.aspectErrPct.toFixed(3)}%  gtBBox ${m.gtBBoxErrPct.toFixed(3)}%`);
			if (process.env.BENCH_SAVE) writeFileSync(join(OUT, `${gt.name.replace(/\.pdf$/, '')} ${v.id}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${d}" fill="none" stroke="red"/></svg>`);
		}
	}
	let sum = '\nSUMMARY (gate: max deviation <= 1 source pixel)\n';
	for (const [id, s] of Object.entries(summary)) sum += `${id.padEnd(13)} n=${s.n} meanSymDiff=${(s.sumSym / s.n).toFixed(3)}%  worstMaxDev=${s.worstPx.toFixed(1)}px / ${s.worstIn.toFixed(4)}in  (${s.worstName})\n`;
	writeFileSync(join(OUT, 'bench-report.txt'), rows.join('\n') + '\n' + sum);
}, 3_600_000);
