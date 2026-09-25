// ─────────────────────────────────────────────
// ⚠ PRECISION MANUFACTURING — plotter orientation calibration.
//
// Plotters differ in which way their axes run, so the same job can come out
// mirrored on one machine and correct on another. This test cuts a small
// letter "F" — it reads backwards when mirrored no matter how it's turned —
// through the exact same pipeline as a real job (generateHpgl), near the
// roll edge the canvas shows on the left, at the start of the job.
//
// The operator answers two questions and we derive flipH/flipV:
//   F reads correctly? | Near the same roll edge as the preview? | setting
//   yes                | yes                                     | none
//   no (backwards)     | no (opposite edge)                      | flipV
//   no (backwards)     | yes                                     | flipH
//   yes                | no (opposite edge)                      | flipH + flipV
// (mirror across the width moves pieces to the other edge; mirror along the
// length keeps the edge; both together are a 180° turn, which doesn't mirror.)
// ─────────────────────────────────────────────
import type { CanvasItem, CanvasState, MaterialSheet, PlotterConfig } from "$lib/types";
import { generateHpgl } from "./hpgl";
import { itemFootprintPolygons } from "./nesting";

/** Letter F, drawn upright (SVG y-down): stem on the left, two arms to the right. */
export const ORIENTATION_TEST_PATH = "M0 0 H60 V16 H20 V40 H50 V56 H20 V100 H0 Z";
const F_WIDTH_IN = 1.8;
const F_HEIGHT_IN = 3;
const F_OFFSET_IN = 0.5; // from the job start and from the y = 0 roll edge

export function orientationTestItem(): CanvasItem {
	return {
		id: "orientation-test",
		patternId: "orientation-test",
		pattern: {
			id: "orientation-test", vehicleId: "orientation-test", category: "ppf", zone: "custom",
			name: "Orientation test (F)", coverage: "full", svgPath: ORIENTATION_TEST_PATH,
			widthInches: F_WIDTH_IN, heightInches: F_HEIGHT_IN, revision: "", isPublished: false,
			createdAt: new Date(0), updatedAt: new Date(0),
		},
		x: F_OFFSET_IN, y: F_OFFSET_IN,
		width: F_WIDTH_IN, height: F_HEIGHT_IN,
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

export function flipsFromAnswers(readsCorrectly: boolean, sameEdge: boolean): { flipH: boolean; flipV: boolean } {
	if (readsCorrectly && sameEdge) return { flipH: false, flipV: false };
	if (!readsCorrectly && !sameEdge) return { flipH: false, flipV: true };
	if (!readsCorrectly && sameEdge) return { flipH: true, flipV: false };
	return { flipH: true, flipV: true };
}

/** The test was cut WITH the current settings, so the answers describe a
 *  correction on top of them. Mirrors compose by toggling. */
export function correctedOrientation(
	current: { flipH: boolean; flipV: boolean },
	readsCorrectly: boolean,
	sameEdge: boolean,
): { flipH: boolean; flipV: boolean } {
	const c = flipsFromAnswers(readsCorrectly, sameEdge);
	return { flipH: current.flipH !== c.flipH, flipV: current.flipV !== c.flipV };
}
