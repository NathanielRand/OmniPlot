// Ground truth: read the exact CutContour geometry out of a sample PDF.
// Output is in INCHES, y-down, translated so the bbox min is (0,0).
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { inflateSync } from 'node:zlib';

export interface GT {
	name: string;
	widthIn: number;     // from the filename "(W,H)"
	heightIn: number;
	d: string;           // SVG path, inches, y-down
	mediaW: number;      // PDF points
	mediaH: number;
}

export function parseName(file: string): { w: number; h: number } {
	const m = /\((\d+(?:\.\d+)?),(\d+(?:\.\d+)?)\)/.exec(file);
	if (!m) throw new Error(`no (W,H) in ${file}`);
	return { w: Number(m[1]), h: Number(m[2]) };
}

export function loadGT(file: string): GT {
	const buf = readFileSync(file);
	const txt = buf.toString('latin1');
	const mb = /\/MediaBox \[\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)/.exec(txt)!;
	const mediaW = Number(mb[3]) - Number(mb[1]);
	const mediaH = Number(mb[4]) - Number(mb[2]);
	const sm = /stream\r?\n/.exec(txt)!;
	const start = sm.index + sm[0].length;
	const end = txt.indexOf('endstream', start);
	const content = inflateSync(buf.subarray(start, end).subarray(0, buf.subarray(start, end).length)).toString('latin1');
	const toks = content.split(/\s+/).filter(Boolean);
	const H = mediaH;
	const out: string[] = [];
	const nums: number[] = [];
	const f = (v: number) => +(v).toFixed(6);
	const X = (x: number) => f(x / 72), Y = (y: number) => f((H - y) / 72);
	for (const t of toks) {
		if (/^-?[\d.]+$/.test(t)) { nums.push(Number(t)); continue; }
		if (t === 'm') out.push(`M${X(nums[0])} ${Y(nums[1])}`);
		else if (t === 'l') out.push(`L${X(nums[0])} ${Y(nums[1])}`);
		else if (t === 'c') out.push(`C${X(nums[0])} ${Y(nums[1])} ${X(nums[2])} ${Y(nums[3])} ${X(nums[4])} ${Y(nums[5])}`);
		else if (t === 'h') out.push('Z');
		nums.length = 0;
	}
	const { w, h } = parseName(file);
	return { name: basename(file), widthIn: w, heightIn: h, d: out.join(''), mediaW, mediaH };
}
