// ─────────────────────────────────────────────
// ⚠ PRECISION MANUFACTURING SOFTWARE — this file drives the blade. ⚠
//
// Everything emitted here is cut into real, expensive film to fit a real
// vehicle. The only acceptable output is EXACTLY the geometry the operator
// saw on the studio canvas: same shape, same size, same orientation, same
// position. To guarantee that, this file does NOT compute any pattern
// geometry of its own — every exporter takes its points from
// itemFootprintPolygons() in nesting.ts, the same function the canvas
// renders and the packer reserves space with. Never add a local
// scale/rotate/flip step here; see the header of nesting.ts.
//
// (A previous version sampled the path into item.width × item.height and
// then rotated it again. item.width/height are the POST-rotation bbox, so
// any packer-rotated piece was cut stretched into the swapped box, then
// rotated a second time — wrong shape, wrong place.)
//
// Coordinate model
//   item.x/y — inches on material sheet (true bbox top-left)
//   item.width/height — the placed piece's true bbox AFTER rotation
//   HPGL     — 1016 plotter units / inch
//   SVG out  — 96 px / inch; width/height expressed in mm
//   DXF out  — mm (INSUNITS=4)
// ─────────────────────────────────────────────
import type { CanvasItem, CanvasState, PlotterConfig, MaterialSheet } from "$lib/types";
import { HPGL_UNITS_PER_INCH } from "$lib/config";
import { samplePolygonArea, itemFootprintPolygons } from "./nesting";

const SVG_PX_PER_INCH = 96;
const MM_PER_INCH = 25.4;

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

// ─── Cut geometry for a placed item ─────────────────────────────────────────
// PRECISION: one closed loop per subpath, in sheet inches, taken verbatim
// from itemFootprintPolygons() — the exact outline drawn on the canvas.
// Each loop is cut separately with a blade lift between them so the blade
// never drags across the fill between disconnected contours.
function itemCutLoops(item: CanvasItem): Array<Array<{ x: number; y: number }>> {
	return itemFootprintPolygons(item).filter((loop) => loop.length > 1);
}

type P = { x: number; y: number };

function isClosedLoop(pts: P[]): boolean {
	const a = pts[0], b = pts[pts.length - 1];
	return pts.length > 2 && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}

// ─── Plotter orientation (calibration) ───────────────────────────────────────
// ⚠ PRECISION: the sheet model is y-up/right-handed (see nesting.ts). Some
// plotters map their axes differently, which would cut the job mirrored.
// flipH/flipV — set once per plotter from the orientation test cut — mirror
// the OUTPUT so the physical cut matches the canvas exactly. They apply to
// direct sends and .plt files only (DXF/SVG are opened in other software
// with its own orientation settings). flipH reflects about the FULL job's
// length (state.jobLengthInches when resuming a partial job) so pieces never
// shift; flipV reflects about the roll width.
function jobLength(state: CanvasState): number {
	if (state.jobLengthInches !== undefined) return state.jobLengthInches;
	const ib = state.items.filter((i) => !i.outOfBounds);
	return ib.length ? Math.max(...ib.map((i) => i.x + i.width)) : 0;
}

export function orientationMap(state: CanvasState, config: PlotterConfig): (p: P) => P {
	const L = jobLength(state);
	const W = state.sheet.widthInches; // roll width (y axis)
	return (p) => ({
		x: config.flipH ? L - p.x : p.x,
		y: config.flipV ? W - p.y : p.y,
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

function itemToHpgl(item: CanvasItem, config: PlotterConfig, orient: (p: P) => P): string {
	// PRECISION: exactly the canvas outline — see itemCutLoops().
	const transformedSubpaths = itemCutLoops(item).map((loop) => loop.map(orient));

	if (transformedSubpaths.length === 0) return "";

	const toU = (v: number) => Math.round(v * HPGL_UNITS_PER_INCH);
	const lines: string[] = [];
	const overcutInches = config.overcut / MM_PER_INCH;

	// Lift to the start of the first subpath before cutting begins
	lines.push(`PU${toU(transformedSubpaths[0][0].x)},${toU(transformedSubpaths[0][0].y)};`);

	for (let pass = 0; pass < config.passes; pass++) {
		for (const transformed of transformedSubpaths) {
			// Alternate direction on even/odd passes (bidirectional — reduces travel)
			const seq = pass % 2 === 0 ? transformed : [...transformed].reverse();
			const [first, ...rest] = seq;

			// PU lifts the blade and moves to this subpath's start — no cut between subpaths
			lines.push(`PU${toU(first.x)},${toU(first.y)};`);
			if (rest.length > 0) {
				lines.push(`PD${rest.map((p) => `${toU(p.x)},${toU(p.y)}`).join(",")};`);
			}
			// Overcut: advance the configured distance past the seam to close the cut loop.
			// Overcut only closes a CLOSED shape — on an open line it would drag
			// the blade straight from the end back across the material.
			const oc = isClosedLoop(transformed) ? overcutPoint(transformed, overcutInches) : null;
			if (oc) {
				lines.push(`PD${toU(oc.x)},${toU(oc.y)};`);
			}
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
    const orient = orientationMap(state, config);

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
        hpgl: itemToHpgl(item, config, orient),
    }));

    return {
        preamble: preambleLines.join("\n"),
        segments,
        epilogue: "PU0,0;\nSP0;\nIN;",
    };
}

export function generateHpgl(state: CanvasState, config: PlotterConfig): string {
	const { items, sheet } = state;
	const orient = orientationMap(state, config);

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
		lines.push(itemToHpgl(item, config, orient));
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
// PRECISION: each piece is written as absolute sheet coordinates from
// itemCutLoops() — no transform attribute. The old transform chain assumed
// the path filled exactly 0–100 (uploads carry a margin and are centred on
// the short axis) and applied flip before rotation (the canvas applies it
// after), so exported files did not match the canvas.

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

	// PRECISION: physical size and viewBox are both exact (no rounding), so
	// 1 viewBox unit is exactly 1/96" on both axes in any SVG reader.
	const svgW = usedWidthIn   * PX;
	const svgH = sheetHeightIn * PX;

	const pathEls = inBounds.map((item) => {
		// Model is y-up; SVG is y-down → y_svg = rollWidth − y, so the file shows
		// the art exactly as uploaded (not mirrored).
		const d = itemCutLoops(item)
			.map((loop) => {
				const [first, ...rest] = loop;
				const Y = (y: number) => n((sheetHeightIn - y) * PX, 4);
				return `M ${n(first.x * PX, 4)} ${Y(first.y)} ` +
					rest.map((p) => `L ${n(p.x * PX, 4)} ${Y(p.y)}`).join(" ") + (isClosedLoop(loop) ? " Z" : "");
			})
			.join(" ");

		const label = escXml(item.label ?? item.pattern.name);
		const dims  = `${item.pattern.widthInches.toFixed(2)}"×${item.pattern.heightInches.toFixed(2)}"`;
		return (
			`  <!-- ${label} ${dims} -->\n` +
			`  <path d="${escAttr(d)}" fill-rule="evenodd"` +
			` fill="none" stroke="#000000" stroke-width="1" vector-effect="non-scaling-stroke"/>`
		);
	}).join("\n");

	const dateStr = new Date().toISOString().split("T")[0];
	return [
		`<?xml version="1.0" encoding="UTF-8"?>`,
		`<!-- OmniPlot SVG | ${sheet.name} | ${usedWidthIn.toFixed(2)}"×${sheetHeightIn.toFixed(2)}" | ${dateStr} -->`,
		`<svg xmlns="http://www.w3.org/2000/svg"`,
		`     width="${usedWidthIn}in" height="${sheetHeightIn}in"`,
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
		// Each subpath becomes its own LWPOLYLINE so the cutter software knows
		// not to connect between them (avoids cutting through the fill).
		// PRECISION: exactly the canvas outline — see itemCutLoops().
		const label = item.label ?? item.pattern.name;

		for (const transformed of itemCutLoops(item)) {

			entities.push(
				"0", "LWPOLYLINE",
				"5", entities.length.toString(16).padStart(4, "0"),
				"100", "AcDbEntity",
				"8", "0",
				"62", "7",
				"100", "AcDbPolyline",
				`90`, `${transformed.length}`,
				"70", "0",
				"43", "0",
			);
			for (const pt of transformed) {
				entities.push(
					"10", (pt.x * MM_PER_INCH).toFixed(4),
					"20", (pt.y * MM_PER_INCH).toFixed(4),
				);
			}
			entities.push("1001", "OmniPlot", "1000", label);
		}
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
		// Pattern dims, not item.width/height (the post-rotation bbox).
		(sum, i) => sum + samplePolygonArea(i.pattern.svgPath, i.pattern.widthInches, i.pattern.heightInches),
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
