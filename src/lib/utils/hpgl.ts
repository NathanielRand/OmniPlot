// ─────────────────────────────────────────────
// OmniPlot — EXPORT ENGINE
// Formats: HPGL/PLT · SVG · DXF R2000
//
// Coordinate model
//   svgPath  — authored in 0-100 space (viewBox 0 0 100 100)
//   item.x/y — inches on material sheet
//   item.width/height — final cut dimensions in inches
//   HPGL     — 1016 plotter units / inch
//   SVG out  — 96 px / inch; width/height expressed in mm
//   DXF out  — mm (INSUNITS=4)
// ─────────────────────────────────────────────
import type { CanvasItem, CanvasState, PlotterConfig, MaterialSheet } from "$lib/types";
import { HPGL_UNITS_PER_INCH } from "$lib/config";
import { samplePolygonArea } from "./nesting";

const SVG_PX_PER_INCH = 96;
const MM_PER_INCH = 25.4;
const PATH_SPACE = 100; // native coordinate range of svgPath data

// ─── Helpers ──────────────────────────────────
function n(v: number, dec = 3): string {
	return v.toFixed(dec);
}
function escXml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// ─── Sample SVG path → inch-space points ─────
// Uses SVGPathElement.getPointAtLength for accurate curve sampling.
// The hidden off-screen SVG prevents any visible DOM flash.
// Falls back to a bounding-box rectangle when DOM is unavailable.
function sampleSvgPath(
	pathData: string,
	widthInches: number,
	heightInches: number,
	samples = 200,
): Array<{ x: number; y: number }> {
	if (typeof document === "undefined") {
		return rectPoints(widthInches, heightInches);
	}
	try {
		const ns = "http://www.w3.org/2000/svg";
		const svg = document.createElementNS(ns, "svg") as SVGSVGElement;
		svg.style.cssText =
			"position:absolute;top:-9999px;left:-9999px;visibility:hidden;pointer-events:none;";
		const path = document.createElementNS(ns, "path") as SVGPathElement;
		path.setAttribute("d", pathData);
		svg.appendChild(path);
		document.body.appendChild(svg);

		const total = path.getTotalLength();
		const bbox  = path.getBBox();

		if (total === 0 || bbox.width === 0 || bbox.height === 0) {
			document.body.removeChild(svg);
			return rectPoints(widthInches, heightInches);
		}

		const scaleX = widthInches  / bbox.width;
		const scaleY = heightInches / bbox.height;
		const pts: Array<{ x: number; y: number }> = [];

		for (let i = 0; i <= samples; i++) {
			const pt = path.getPointAtLength((i / samples) * total);
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
		{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h },
		{ x: 0, y: h  }, { x: 0, y: 0 },
	];
}

// ─── Apply item transforms to inch-space points ─────
// Input points are already in item-inch space (0..item.width, 0..item.height).
// Outputs sheet-inch space (translated to item.x, item.y).
function transformPoints(
	item: CanvasItem,
	pts: Array<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
	const cx  = item.width  / 2;
	const cy  = item.height / 2;
	const rad = (item.rotation * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);

	return pts.map((p) => {
		let x = p.x;
		let y = p.y;

		if (item.flippedH) x = item.width  - x;
		if (item.flippedV) y = item.height - y;

		if (item.rotation !== 0) {
			const dx = x - cx;
			const dy = y - cy;
			x = cos * dx - sin * dy + cx;
			y = sin * dx + cos * dy + cy;
		}

		return { x: x + item.x, y: y + item.y };
	});
}

// ═══════════════════════════════════════════════
// HPGL / PLT
// ═══════════════════════════════════════════════

// ─── Protocol-aware speed command ────────────
// Standard HPGL and budget cutters (hpgl): VS in cm/s per HP-GL spec.
// Roland CAMM-1 series (roland): VS in mm/s — non-standard Roland extension.
// HPGL/2 (hpgl2) and Silhouette (gpgl): VS in cm/s.
function speedCommand(config: PlotterConfig): string {
	const speed =
		config.protocol === "roland"
			? config.cuttingSpeed // mm/s directly (Roland firmware extension)
			: Math.max(1, Math.round(config.cuttingSpeed / 10)); // mm/s → cm/s
	return `VS${speed};`;
}

// ─── Protocol-aware force command ────────────
// Standard HPGL / Roland / budget cutters: FS in grams.
// HPGL/2 (Graphtec, Summa): FC 0–38 units; ~15.8 g/unit, min ~10 g.
// GPGL (Silhouette): force is device-only — no serial command supported.
function forceCommand(config: PlotterConfig): string {
	switch (config.protocol) {
		case "hpgl2": {
			const fc = Math.max(0, Math.min(38, Math.round((config.bladeForce - 10) / 15.8)));
			return `FC${fc};`;
		}
		case "gpgl":
			return "";
		default: // hpgl, roland — both use FS in grams
			return `FS${config.bladeForce};`;
	}
}

// ─── Overcut point ────────────────────────────
// Returns the position that is `overcutInches` along the path from pts[0],
// used to advance the blade past the seam and prevent a lift gap.
function overcutPoint(
	pts: Array<{ x: number; y: number }>,
	overcutInches: number,
): { x: number; y: number } | null {
	if (overcutInches <= 0 || pts.length < 2) return null;
	let remaining = overcutInches;
	for (let i = 0; i < pts.length - 1; i++) {
		const dx = pts[i + 1].x - pts[i].x;
		const dy = pts[i + 1].y - pts[i].y;
		const segLen = Math.sqrt(dx * dx + dy * dy);
		if (segLen >= remaining) {
			const t = remaining / segLen;
			return { x: pts[i].x + t * dx, y: pts[i].y + t * dy };
		}
		remaining -= segLen;
	}
	return pts[pts.length - 1];
}

function itemToHpgl(item: CanvasItem, config: PlotterConfig): string {
	const pts = sampleSvgPath(item.pattern.svgPath, item.width, item.height);
	const transformed = transformPoints(item, pts);
	if (transformed.length === 0) return "";

	const toU = (v: number) => Math.round(v * HPGL_UNITS_PER_INCH);
	const lines: string[] = [];
	const overcutInches = config.overcut / MM_PER_INCH;

	// Lift blade and move to path start
	lines.push(`PU${toU(transformed[0].x)},${toU(transformed[0].y)};`);

	for (let pass = 0; pass < config.passes; pass++) {
		// Alternate direction on even/odd passes (bidirectional — reduces travel)
		const seq = pass % 2 === 0 ? transformed : [...transformed].reverse();
		const [first, ...rest] = seq;

		lines.push(`PU${toU(first.x)},${toU(first.y)};`);
		if (rest.length > 0) {
			lines.push(`PD${rest.map((p) => `${toU(p.x)},${toU(p.y)}`).join(",")};`);
		}
		// Overcut: advance the configured distance past the seam to prevent a lift gap.
		// Walk along the path from the start until overcutInches is consumed.
		const oc = overcutPoint(transformed, overcutInches);
		if (oc) {
			lines.push(`PD${toU(oc.x)},${toU(oc.y)};`);
		}
	}

	lines.push("PU;");
	return lines.join("\n");
}

// ─── Segmented HPGL stream ───────────────────
// Splits the job into preamble + one segment per pattern + epilogue.
// Used by sendViaSerialSegmented() so progress can be tracked per-pattern
// and the job can be resumed from a known checkpoint on interruption.
export interface HpglSegment {
    itemId: string;
    label: string;
    hpgl: string; // complete HPGL for this pattern (always ends with PU;)
}

export interface HpglStream {
    preamble: string;
    segments: HpglSegment[];
    epilogue: string;
}

export function generateHpglSegments(state: CanvasState, config: PlotterConfig): HpglStream {
    const { items, sheet } = state;
    const forceCmd = forceCommand(config);

    const preambleLines: string[] = [
        "IN;",
        speedCommand(config),
        ...(forceCmd ? [forceCmd] : []),
        "SP1;",
        "PA;",
    ];

    if (config.originX || config.originY) {
        const x0 = Math.round(config.originX * HPGL_UNITS_PER_INCH);
        const y0 = Math.round(config.originY * HPGL_UNITS_PER_INCH);
        const x1 = Math.round((sheet.widthInches  + config.originX) * HPGL_UNITS_PER_INCH);
        const y1 = Math.round((sheet.heightInches + config.originY) * HPGL_UNITS_PER_INCH);
        preambleLines.push(`IP${x0},${y0},${x1},${y1};`);
    }

    const sorted = [...items]
        .filter((i) => !i.outOfBounds)
        .sort((a, b) => a.layer - b.layer || a.y - b.y);

    const segments: HpglSegment[] = sorted.map((item) => ({
        itemId: item.id,
        label: item.label ?? item.pattern.name,
        hpgl: itemToHpgl(item, config),
    }));

    return {
        preamble: preambleLines.join("\n"),
        segments,
        epilogue: "PU0,0;\nSP0;\nIN;",
    };
}

export function generateHpgl(state: CanvasState, config: PlotterConfig): string {
	const { items, sheet } = state;

	const forceCmd = forceCommand(config);
	const lines: string[] = [
		"IN;",            // Initialize plotter
		speedCommand(config),
		...(forceCmd ? [forceCmd] : []),
		"SP1;",           // Select tool/pen 1
		"PA;",            // Plot absolute coordinates
	];

	// Origin offset: IP sets P1 (lower-left) and P2 (upper-right) reference points
	if (config.originX || config.originY) {
		const x0 = Math.round(config.originX * HPGL_UNITS_PER_INCH);
		const y0 = Math.round(config.originY * HPGL_UNITS_PER_INCH);
		const x1 = Math.round((sheet.widthInches  + config.originX) * HPGL_UNITS_PER_INCH);
		const y1 = Math.round((sheet.heightInches + config.originY) * HPGL_UNITS_PER_INCH);
		lines.push(`IP${x0},${y0},${x1},${y1};`);
	}

	lines.push("");

	const sorted = [...items]
		.filter((i) => !i.outOfBounds)
		.sort((a, b) => a.layer - b.layer || a.y - b.y);

	for (const item of sorted) {
		lines.push(
			`; --- ${item.label ?? item.pattern.name} ` +
			`(${item.width.toFixed(2)}" × ${item.height.toFixed(2)}") ---`,
		);
		lines.push(itemToHpgl(item, config));
		lines.push("");
	}

	lines.push("PU0,0;"); // Return to origin
	lines.push("SP0;");   // Park tool
	lines.push("IN;");    // Reset

	return lines.join("\n");
}

// ═══════════════════════════════════════════════
// SVG
// ═══════════════════════════════════════════════
//
// Transform chain (SVG applies right-to-left):
//   transform="translate(tx,ty) rotate(…) [flip] scale(sx,sy)"
//
//   innermost (scale): maps 0-100 path space → px
//   flip:             mirrors in path space before scaling
//   rotate:           rotates around item centre (already in px)
//   outermost (translate): moves to sheet position

export function generateSvg(state: CanvasState): string {
	const { items, sheet } = state;
	const PX = SVG_PX_PER_INCH;

	const inBounds = items
		.filter((i) => !i.outOfBounds)
		.sort((a, b) => a.layer - b.layer || a.y - b.y);

	if (inBounds.length === 0) {
		return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"/>`;
	}

	// Crop to content width; height = fixed roll cross-cut dimension
	const usedWidthIn   = Math.max(...inBounds.map((i) => i.x + i.width));
	const sheetHeightIn = sheet.widthInches; // Y axis = roll width

	const svgW = Math.ceil(usedWidthIn   * PX);
	const svgH = Math.ceil(sheetHeightIn * PX);
	const wMm  = (usedWidthIn   * MM_PER_INCH).toFixed(1);
	const hMm  = (sheetHeightIn * MM_PER_INCH).toFixed(1);

	const pathEls = inBounds.map((item) => {
		const sx = (item.width  * PX) / PATH_SPACE; // scale from 0-100 → px
		const sy = (item.height * PX) / PATH_SPACE;
		const cx = (item.width  * PX) / 2;           // rotation centre
		const cy = (item.height * PX) / 2;
		const tx = item.x * PX;
		const ty = item.y * PX;

		// Collect transforms outermost→innermost (right-to-left application)
		const parts: string[] = [];
		parts.push(`translate(${n(tx)},${n(ty)})`);
		if (item.rotation) {
			parts.push(`rotate(${item.rotation},${n(cx)},${n(cy)})`);
		}

		// Flip in 0-100 path space (innermost, before scale)
		if (item.flippedH && item.flippedV) {
			parts.push(`translate(${PATH_SPACE},${PATH_SPACE}) scale(-1,-1)`);
		} else if (item.flippedH) {
			parts.push(`translate(${PATH_SPACE},0) scale(-1,1)`);
		} else if (item.flippedV) {
			parts.push(`translate(0,${PATH_SPACE}) scale(1,-1)`);
		}

		parts.push(`scale(${n(sx)},${n(sy)})`);

		const label = escXml(item.label ?? item.pattern.name);
		const dims  = `${item.width.toFixed(2)}"×${item.height.toFixed(2)}"`;
		return (
			`  <!-- ${label} ${dims} -->\n` +
			`  <path d="${escAttr(item.pattern.svgPath)}" transform="${parts.join(" ")}"` +
			` fill="none" stroke="#000000" stroke-width="1" vector-effect="non-scaling-stroke"/>`
		);
	}).join("\n");

	const dateStr = new Date().toISOString().split("T")[0];
	return [
		`<?xml version="1.0" encoding="UTF-8"?>`,
		`<!-- OmniPlot SVG | ${sheet.name} | ${usedWidthIn.toFixed(2)}"×${sheetHeightIn.toFixed(2)}" | ${dateStr} -->`,
		`<svg xmlns="http://www.w3.org/2000/svg"`,
		`     width="${wMm}mm" height="${hMm}mm"`,
		`     viewBox="0 0 ${svgW} ${svgH}">`,
		`  <!-- ${inBounds.length} pattern(s) | Roll: ${sheet.widthInches}" wide | Used: ${usedWidthIn.toFixed(2)}" -->`,
		pathEls,
		`</svg>`,
	].join("\n");
}

// ═══════════════════════════════════════════════
// DXF R2000 (LWPOLYLINE — universal cutter support)
// Coordinates in mm (INSUNITS=4)
// ═══════════════════════════════════════════════

export function generateDxf(state: CanvasState): string {
	const { items } = state;

	const inBounds = items
		.filter((i) => !i.outOfBounds)
		.sort((a, b) => a.layer - b.layer || a.y - b.y);

	const entities: string[] = [];

	for (const item of inBounds) {
		const pts = sampleSvgPath(item.pattern.svgPath, item.width, item.height);
		const transformed = transformPoints(item, pts);
		if (transformed.length < 2) continue;

		const label = item.label ?? item.pattern.name;

		entities.push(
			"0", "LWPOLYLINE",
			"5", entities.length.toString(16).padStart(4, "0"), // handle
			"100", "AcDbEntity",
			"8", "0",             // layer 0
			"62", "7",            // color: black
			"100", "AcDbPolyline",
			`90`, `${transformed.length}`,
			"70", "0",            // open polyline (points already close back to start)
			"43", "0",            // constant width = 0 (hairline)
		);

		for (const pt of transformed) {
			entities.push(
				"10", (pt.x * MM_PER_INCH).toFixed(4),
				"20", (pt.y * MM_PER_INCH).toFixed(4),
			);
		}
		// Entity-level label as extended data (informational, ignored by cutters)
		entities.push("1001", "OmniPlot", "1000", label);
	}

	const lines: string[] = [
		// ── HEADER ──────────────────────────────────
		"0", "SECTION",
		"2", "HEADER",
		"9", "$ACADVER",  "1", "AC1015",   // R2000
		"9", "$INSUNITS", "70", "4",        // 4 = mm
		"9", "$MEASUREMENT", "70", "1",     // metric
		"0", "ENDSEC",
		// ── CLASSES (empty, required for R2000) ─────
		"0", "SECTION",
		"2", "CLASSES",
		"0", "ENDSEC",
		// ── TABLES ──────────────────────────────────
		"0", "SECTION",
		"2", "TABLES",
		"0", "TABLE",
		"2", "LAYER",
		"70", "1",
		"0", "LAYER",
		"2", "0",
		"70", "0",
		"62", "7",
		"6", "CONTINUOUS",
		"0", "ENDTAB",
		"0", "ENDSEC",
		// ── ENTITIES ────────────────────────────────
		"0", "SECTION",
		"2", "ENTITIES",
		...entities,
		"0", "ENDSEC",
		"0", "EOF",
	];

	return lines.join("\n");
}

// ─── File download ────────────────────────────
export function downloadFile(
	content: string,
	filename: string,
	mimeType: string,
): void {
	const blob = new Blob([content], { type: mimeType });
	const url  = URL.createObjectURL(blob);
	const a    = document.createElement("a");
	a.href     = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

export function downloadHpgl(
	state: CanvasState,
	config: PlotterConfig,
	jobName = "omniplot-job",
): void {
	downloadFile(generateHpgl(state, config), `${jobName}.plt`, "application/octet-stream");
}

export function downloadSvg(state: CanvasState, jobName = "omniplot-job"): void {
	downloadFile(generateSvg(state), `${jobName}.svg`, "image/svg+xml;charset=utf-8");
}

export function downloadDxf(state: CanvasState, jobName = "omniplot-job"): void {
	downloadFile(generateDxf(state), `${jobName}.dxf`, "application/dxf");
}

// ─── Metrics ──────────────────────────────────
export function calcEfficiency(items: CanvasItem[], sheet: MaterialSheet): number {
	const inBounds = items.filter((i) => !i.outOfBounds);
	if (!inBounds.length) return 0;
	const usedLength = Math.max(...inBounds.map((i) => i.x + i.width));
	if (usedLength === 0) return 0;
	// Polygon area / (roll width × consumed roll length) — not the full roll.
	// Uses the actual cut-path outline, not the bounding box, so curved shapes
	// (e.g. hood pieces) don't get credited for corner material outside the cut.
	const usedArea = inBounds.reduce(
		(sum, i) => sum + samplePolygonArea(i.pattern.svgPath, i.width, i.height),
		0,
	);
	return Math.min(1, usedArea / (sheet.widthInches * usedLength));
}

export function estimateCutTime(items: CanvasItem[], speedMmPerSec: number): number {
	const MM_PER_IN = 25.4;
	const totalMm   = items
		.filter((i) => !i.outOfBounds)
		.reduce((sum, item) => {
			const perim = 2 * (item.width + item.height) * MM_PER_IN;
			return sum + perim * 1.4; // 1.4 accounts for curves vs. bounding-box perimeter
		}, 0);
	return Math.round(totalMm / speedMmPerSec);
}

// Milliseconds to wait after sending one pattern before sending the next.
// 1.35× estimated cut time gives headroom for acceleration, tight curves,
// and passes. The flat 600ms lets the plotter's UART receive buffer fully
// drain even on very short patterns.
export function patternDelayMs(item: CanvasItem, speedMmPerSec: number): number {
	const estimatedSec = estimateCutTime([item], speedMmPerSec);
	return Math.round(estimatedSec * 1350) + 600;
}
