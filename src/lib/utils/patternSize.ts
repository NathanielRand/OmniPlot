// ─────────────────────────────────────────────
// ⚠ PRECISION MANUFACTURING — a pattern's size always keeps its outline's
// exact proportions.
//
// Every form that sets widthInches/heightInches goes through these helpers:
// the user enters ONE dimension and the other is derived from the outline
// at full precision (never rounded), so a saved pattern is exactly the
// uploaded shape, uniformly scaled — never stretched or squashed. Saving is
// refused (sizeError) whenever W × H disagrees with the outline.
// ─────────────────────────────────────────────
import { heightForWidth, widthForHeight, pathAspect, sizeMatchesOutline } from "./pathGeometry";

export interface Sized { widthInches: number; heightInches: number }

function validAspect(path: string | undefined): boolean {
	if (!path?.trim()) return false;
	try { const a = pathAspect(path); return isFinite(a) && a > 0; } catch { return false; }
}

/** Width was typed: derive height from the outline. */
export function deriveHeight(p: Sized, path: string | undefined): void {
	if (p.widthInches > 0 && validAspect(path)) p.heightInches = heightForWidth(path!, p.widthInches);
}

/** Height was typed: derive width from the outline. */
export function deriveWidth(p: Sized, path: string | undefined): void {
	if (p.heightInches > 0 && validAspect(path)) p.widthInches = widthForHeight(path!, p.heightInches);
}

/** Outline changed: keep the width (or height if no width) and re-derive the other. */
export function relinkSize(p: Sized, path: string | undefined): void {
	if (p.widthInches > 0) deriveHeight(p, path);
	else if (p.heightInches > 0) deriveWidth(p, path);
}

/** A file declared its real size: use it exactly (it already has the outline's proportions). */
export function applyFileSize(p: Sized, path: string | undefined, size: Sized | null): void {
	if (!size) return;
	p.widthInches = size.widthInches;
	deriveHeight(p, path); // re-derive against the stored outline (removes float noise)
}

/** Null when the size is valid for this outline; otherwise a user-facing reason. */
export function sizeError(p: Sized, path: string | undefined): string | null {
	if (!path?.trim()) return "Import the pattern outline first.";
	if (!validAspect(path)) return "The outline has no width or height.";
	if (!(p.widthInches > 0) || !(p.heightInches > 0)) return "Enter a width or height.";
	if (!sizeMatchesOutline(path, p.widthInches, p.heightInches)) {
		return "Width × height doesn't match the outline's proportions — re-enter one dimension.";
	}
	return null;
}

/** Display a dimension without hiding precision behind rounding. */
export function fmtInches(v: number, decimals = 2): string {
	return `${v.toFixed(decimals)}"`;
}
