// ─────────────────────────────────────────────
// ⚠ PRECISION MANUFACTURING — plotter orientation calibration.
//
// Plotters differ in which way their axes run, so the same job can come out
// mirrored on one machine and correct on another. This test cuts a one-sided
// arrow (a harpoon: shaft, tip, a single barb) through the exact same pipeline
// as a real job (generateHpgl), near the roll edge the canvas shows on the
// left, at the start of the job. The arrow points down the roll, the way the
// job runs. It has no "up" and no "backwards" to judge — the operator only
// checks two physical things, one per axis:
//   Arrow points the same way as the preview? | Near the same roll edge? | setting
//   yes                                       | yes                       | none
//   no (reversed)                             | yes                       | flipH
//   yes                                       | no (opposite edge)        | flipV
//   no (reversed)                             | no (opposite edge)        | flipH + flipV
// (flipH mirrors along the roll length — reverses the arrow, keeps the edge;
// flipV mirrors across the roll width — swaps the edge, keeps the arrow.)
// ─────────────────────────────────────────────
import type { CanvasItem, CanvasState, MaterialSheet, PlotterConfig } from "$lib/types";
import { generateHpgl } from "./hpgl";
import { itemFootprintPolygons } from "./nesting";

/**
 * Harpoon pointing along the roll (+x, the job direction), 100 × 60 art units:
 * shaft, tip at the right, and one barb on the side nearest the y = 0 roll edge.
 */
export const ORIENTATION_TEST_PATH = "M0 24 H66 L52 4 L100 30 L66 36 H0 Z";
const ART_WIDTH_IN = 3;
const ART_HEIGHT_IN = 1.8;
const ART_OFFSET_IN = 0.5; // from the job start and from the y = 0 roll edge
export function orientationTestItem(): CanvasItem {
	return {
		id: "orientation-test",
		patternId: "orientation-test",
		pattern: {
			id: "orientation-test", vehicleId: "orientation-test", category: "ppf", zone: "custom",
			name: "Orientation test (arrow)", coverage: "full", svgPath: ORIENTATION_TEST_PATH,
			widthInches: ART_WIDTH_IN, heightInches: ART_HEIGHT_IN, revision: "", isPublished: false,
			createdAt: new Date(0), updatedAt: new Date(0),
		},
		x: ART_OFFSET_IN, y: ART_OFFSET_IN,
		width: ART_WIDTH_IN, height: ART_HEIGHT_IN,
		rotation: 0, flippedH: false, flippedV: false,
		scale: 1, layer: 0, locked: false, color: "#000", outOfBounds: false,
		label: "Orientation test",
	};
}

/** HPGL for the test piece, with the plotter's current orientation applied. */
export function orientationTestHpgl(config: PlotterConfig, sheet: MaterialSheet): string {
	const state: CanvasState = {
		items: [orientationTestItem()], sheet, selectedIds: [], zoom: 100, panX: 0, panY: 0,
		tool: "select", showGrid: false, showRulers: false, rulerStepInches: 5,
		snapToGrid: false, gridSizeInches: 0.5, bufferInches: 0,
	};
	return generateHpgl(state, config);
}

/**
 * The test piece as it appears on the studio canvas (screen x = model y,
 * screen y = model x — the canvas is the model viewed with the roll width
 * across and the job running down). `area` = the region to show, in inches.
 */
export function orientationTestPreview(area = { across: 4, along: 4.5 }): { d: string; viewBox: string } {
	const loops = itemFootprintPolygons(orientationTestItem());
	const d = loops
		.map((loop) => `M ${loop.map((p) => `${p.y.toFixed(4)} ${p.x.toFixed(4)}`).join(" L ")} Z`)
		.join(" ");
	return { d, viewBox: `0 0 ${area.across} ${area.along}` };
}

export function flipsFromAnswers(arrowSameWay: boolean, sameEdge: boolean): { flipH: boolean; flipV: boolean } {
	return { flipH: !arrowSameWay, flipV: !sameEdge };
}

/** The test was cut WITH the current settings, so the answers describe a
 *  correction on top of them. Mirrors compose by toggling. */
export function correctedOrientation(
	current: { flipH: boolean; flipV: boolean },
	arrowSameWay: boolean,
	sameEdge: boolean,
): { flipH: boolean; flipV: boolean } {
	const c = flipsFromAnswers(arrowSameWay, sameEdge);
	return { flipH: current.flipH !== c.flipH, flipV: current.flipV !== c.flipV };
}
