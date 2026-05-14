// ─────────────────────────────────────────────
// OmniPlot — AUTO-NESTING ALGORITHM
// Shelf-based bin packing with rotation support
// ─────────────────────────────────────────────
import type { CanvasItem, MaterialSheet } from "$lib/types";

const PADDING_INCHES = 0.25; // Gap between pieces

interface Shelf {
	y: number;
	height: number;
	usedWidth: number;
}

// ─── Main nesting function ────────────────────
// Returns new items with updated x/y positions.
// Items are sorted largest-first (by area) for better packing.
export function autoNest(
	items: CanvasItem[],
	sheet: MaterialSheet,
	allowRotation = true,
): CanvasItem[] {
	if (!items.length) return items;

	const sheetW = sheet.widthInches;
	const sheetH = sheet.heightInches;
	const pad = PADDING_INCHES;

	// Sort by area descending (largest first = better packing)
	const sorted = [...items].sort(
		(a, b) => b.width * b.height - a.width * a.height,
	);

	const shelves: Shelf[] = [];
	const result: CanvasItem[] = [];

	for (const item of sorted) {
		let placed = false;
		let useW = item.width;
		let useH = item.height;

		// Try to fit in existing shelves
		for (const shelf of shelves) {
			// Try normal orientation
			if (
				shelf.usedWidth + useW + pad <= sheetW &&
				useH <= shelf.height + 0.01
			) {
				result.push({
					...item,
					x: shelf.usedWidth + pad,
					y: shelf.y + pad,
					width: useW,
					height: useH,
				});
				shelf.usedWidth += useW + pad;
				placed = true;
				break;
			}
			// Try rotated (90°)
			if (allowRotation) {
				const rW = useH;
				const rH = useW;
				if (
					shelf.usedWidth + rW + pad <= sheetW &&
					rH <= shelf.height + 0.01
				) {
					result.push({
						...item,
						x: shelf.usedWidth + pad,
						y: shelf.y + pad,
						width: rW,
						height: rH,
						rotation: (item.rotation + 90) % 360,
					});
					shelf.usedWidth += rW + pad;
					placed = true;
					break;
				}
			}
		}

		if (!placed) {
			// Open a new shelf
			const lastShelf = shelves[shelves.length - 1];
			const newY = lastShelf ? lastShelf.y + lastShelf.height + pad : pad;

			// Try rotated for better shelf height
			let finalW = useW;
			let finalH = useH;
			let rotation = item.rotation;
			if (allowRotation && useH < useW && useH <= sheetW) {
				finalW = useH;
				finalH = useW;
				rotation = (item.rotation + 90) % 360;
			}

			if (newY + finalH + pad <= sheetH && finalW + pad <= sheetW) {
				const shelf: Shelf = {
					y: newY,
					height: finalH,
					usedWidth: finalW + pad,
				};
				shelves.push(shelf);
				result.push({
					...item,
					x: pad,
					y: newY + pad,
					width: finalW,
					height: finalH,
					rotation,
				});
				placed = true;
			}
		}

		if (!placed) {
			// Doesn't fit — keep original position
			result.push({ ...item });
		}
	}

	// Merge: preserve original item order
	const positioned = new Map(result.map((r) => [r.id, r]));
	return items.map((item) => positioned.get(item.id) ?? item);
}

// ─── Calculate bounding box of all items ─────
export function getBoundingBox(items: CanvasItem[]) {
	if (!items.length) return { x: 0, y: 0, width: 0, height: 0 };
	const minX = Math.min(...items.map((i) => i.x));
	const minY = Math.min(...items.map((i) => i.y));
	const maxX = Math.max(...items.map((i) => i.x + i.width));
	const maxY = Math.max(...items.map((i) => i.y + i.height));
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ─── Check for overlapping items ─────────────
export function findOverlaps(items: CanvasItem[]): string[][] {
	const overlaps: string[][] = [];
	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			const a = items[i];
			const b = items[j];
			if (
				a.x < b.x + b.width &&
				a.x + a.width > b.x &&
				a.y < b.y + b.height &&
				a.y + a.height > b.y
			) {
				overlaps.push([a.id, b.id]);
			}
		}
	}
	return overlaps;
}
