// ─────────────────────────────────────────────
// OmniPlot — HPGL EXPORT ENGINE
// Converts canvas items → HPGL/PLT plotter file
// Reference: HP-GL standard, 1016 units/inch
// ─────────────────────────────────────────────
import type {
	CanvasItem,
	CanvasState,
	PlotterConfig,
	MaterialSheet,
} from "$lib/types";
import { HPGL_UNITS_PER_INCH } from "$lib/config";

// ─── Convert inches → HPGL units ─────────────
function toUnits(inches: number): number {
	return Math.round(inches * HPGL_UNITS_PER_INCH);
}

// ─── Parse SVG path d attr → array of {x, y} points ─────
// We sample the SVG path at regular intervals using a hidden SVGPathElement.
// Falls back to bounding box rectangle if parsing fails.
function sampleSvgPath(
	pathData: string,
	widthInches: number,
	heightInches: number,
	samples = 120,
): Array<{ x: number; y: number }> {
	// Only works in browser context
	if (typeof document === "undefined") {
		return rectPoints(widthInches, heightInches);
	}
	try {
		const ns = "http://www.w3.org/2000/svg";
		const svg = document.createElementNS(ns, "svg");
		const el = document.createElementNS(ns, "path") as SVGPathElement;
		el.setAttribute("d", pathData);
		svg.appendChild(el);
		document.body.appendChild(svg);

		const total = el.getTotalLength();
		const step = total / samples;
		const pts: Array<{ x: number; y: number }> = [];
		const bbox = el.getBBox();
		const scaleX = widthInches / (bbox.width || 1);
		const scaleY = heightInches / (bbox.height || 1);

		for (let i = 0; i <= samples; i++) {
			const pt = el.getPointAtLength(i * step);
			pts.push({
				x: (pt.x - bbox.x) * scaleX,
				y: (pt.y - bbox.y) * scaleY,
			});
		}

		document.body.removeChild(svg);
		return pts;
	} catch {
		return rectPoints(widthInches, heightInches);
	}
}

function rectPoints(w: number, h: number): Array<{ x: number; y: number }> {
	return [
		{ x: 0, y: 0 },
		{ x: w, y: 0 },
		{ x: w, y: h },
		{ x: 0, y: h },
		{ x: 0, y: 0 },
	];
}

// ─── Rotate point around origin ───────────────
function rotatePoint(
	x: number,
	y: number,
	cx: number,
	cy: number,
	deg: number,
) {
	const rad = (deg * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	return {
		x: cos * (x - cx) - sin * (y - cy) + cx,
		y: sin * (x - cx) + cos * (y - cy) + cy,
	};
}

// ─── Transform canvas item points → sheet coords ─────
function transformPoints(
	item: CanvasItem,
	pts: Array<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
	return pts.map((p) => {
		let x = p.x * item.scale;
		let y = p.y * item.scale;

		if (item.flippedH) x = item.width - x;
		if (item.flippedV) y = item.height - y;

		if (item.rotation !== 0) {
			const r = rotatePoint(
				x,
				y,
				item.width / 2,
				item.height / 2,
				item.rotation,
			);
			x = r.x;
			y = r.y;
		}

		return { x: x + item.x, y: y + item.y };
	});
}

// ─── Single item → HPGL commands ─────────────
function itemToHpgl(item: CanvasItem, config: PlotterConfig): string {
	const pts = sampleSvgPath(item.pattern.svgPath, item.width, item.height);
	const transformed = transformPoints(item, pts);

	if (transformed.length === 0) return "";

	const lines: string[] = [];

	// Blade lift, move to start
	const start = transformed[0];
	lines.push(`PU${toUnits(start.x)},${toUnits(start.y)};`);

	// Cut pass(es)
	for (let pass = 0; pass < config.passes; pass++) {
		const sequence =
			pass % 2 === 0 ? transformed : [...transformed].reverse();
		const [first, ...rest] = sequence;
		lines.push(`PU${toUnits(first.x)},${toUnits(first.y)};`);
		lines.push(
			`PD${rest.map((p) => `${toUnits(p.x)},${toUnits(p.y)}`).join(",")};`,
		);

		// Overcut: tiny extra past the start point
		if (config.overcut > 0 && rest.length > 0) {
			lines.push(`PD${toUnits(first.x)},${toUnits(first.y)};`);
		}
	}

	lines.push("PU;"); // Lift blade after each item
	return lines.join("\n");
}

// ─── Full HPGL file ───────────────────────────
export function generateHpgl(
	state: CanvasState,
	config: PlotterConfig,
): string {
	const { items, sheet } = state;

	const lines: string[] = [
		// Header
		`IN;`, // Initialize
		`VS${config.cuttingSpeed};`, // Velocity/speed
		`FS${config.bladeForce};`, // Force (some plotters: SP1 for pen select)
		`SP1;`, // Select pen 1
		`PA;`, // Plot absolute coordinates
		// Origin offset
		...(config.originX || config.originY
			? [
					`RO0;IP${toUnits(config.originX)},${toUnits(config.originY)},${toUnits(sheet.widthInches + config.originX)},${toUnits(sheet.heightInches + config.originY)};`,
				]
			: []),
		"",
	];

	// Sort items by layer, then by y position (top-to-bottom) for efficient cutting
	const sorted = [...items].sort((a, b) => a.layer - b.layer || a.y - b.y);

	for (const item of sorted) {
		lines.push(`; --- ${item.label ?? item.pattern.name} ---`);
		lines.push(itemToHpgl(item, config));
		lines.push("");
	}

	// Footer
	lines.push("PU0,0;"); // Return to origin
	lines.push("SP0;"); // Park pen
	lines.push("IN;"); // Reset

	return lines.join("\n");
}

// ─── SVG export ───────────────────────────────
export function generateSvg(state: CanvasState): string {
	const { items, sheet } = state;
	const W = sheet.widthInches * 96; // 96 px/inch
	const H = sheet.heightInches * 96;

	const paths = items
		.map((item) => {
			const scaleX = item.width / 1;
			const scaleY = item.height / 1;
			const transforms = [
				`translate(${item.x * 96} ${item.y * 96})`,
				`scale(${item.scale * scaleX * 96} ${item.scale * scaleY * 96})`,
				item.rotation ? `rotate(${item.rotation} 0.5 0.5)` : "",
				item.flippedH ? "scale(-1 1) translate(-1 0)" : "",
				item.flippedV ? "scale(1 -1) translate(0 -1)" : "",
			]
				.filter(Boolean)
				.join(" ");
			return `  <!-- ${item.label ?? item.pattern.name} -->\n  <path d="${item.pattern.svgPath}" transform="${transforms}" fill="none" stroke="#000" stroke-width="0.01"/>`;
		})
		.join("\n");

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 ${W} ${H}"
     width="${W}px" height="${H}px">
  <!-- OmniPlot export | ${sheet.name} ${sheet.widthInches}"×${sheet.heightInches}" -->
${paths}
</svg>`;
}

// ─── Trigger browser download ─────────────────
export function downloadFile(
	content: string,
	filename: string,
	mimeType: string,
): void {
	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

export function downloadHpgl(
	state: CanvasState,
	config: PlotterConfig,
	jobName = "omniplot-job",
): void {
	const content = generateHpgl(state, config);
	downloadFile(content, `${jobName}.plt`, "application/octet-stream");
}

export function downloadSvg(
	state: CanvasState,
	jobName = "omniplot-job",
): void {
	const content = generateSvg(state);
	downloadFile(content, `${jobName}.svg`, "image/svg+xml");
}

// ─── Material efficiency ──────────────────────
export function calcEfficiency(
	items: CanvasItem[],
	sheet: MaterialSheet,
): number {
	if (!items.length) return 0;
	const sheetArea = sheet.widthInches * sheet.heightInches;
	const usedArea = items.reduce(
		(sum, item) => sum + item.width * item.height,
		0,
	);
	return Math.min(1, usedArea / sheetArea);
}

// ─── Estimated cut time (seconds) ────────────
export function estimateCutTime(
	items: CanvasItem[],
	speedMmPerSec: number,
): number {
	// Approximate path length as perimeter of bounding box × 1.4 (fudge for curves)
	const MM_PER_INCH = 25.4;
	const totalLengthMm = items.reduce((sum, item) => {
		const perim = 2 * (item.width + item.height) * MM_PER_INCH;
		return sum + perim * 1.4;
	}, 0);
	return Math.round(totalLengthMm / speedMmPerSec);
}
