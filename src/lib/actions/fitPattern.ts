// ─────────────────────────────────────────────
// use:fitPattern — true-proportion pattern previews
// ─────────────────────────────────────────────
// A pattern's svgPath is only a shape: the cutter stretches its bounding box
// to exactly widthInches × heightInches (see sampleSvgPathSubpaths in
// $lib/utils/hpgl.ts). Catalog paths are drawn in a normalised 0–100 box, so
// drawing the raw path in a fixed viewBox shows the wrong proportions.
//
// Put this on the <path>: it applies that same stretch into inch space and
// sets the parent <svg>'s viewBox to the real width × height, so the browser
// zooms it uniformly to fit whatever box the design gives it (default
// preserveAspectRatio = xMidYMid meet). Nothing about the surrounding design
// changes — only the scale.

export interface FitPatternParams {
	/** Real width in inches. Missing/0 → the path's own proportions. */
	w?: number;
	/** Real height in inches. Missing/0 → the path's own proportions. */
	h?: number;
	/** Flip horizontally (mirror previews). */
	mirror?: boolean;
	/** Pass the path data so the fit re-runs when it changes. */
	d?: string;
	/**
	 * The stroke is drawn non-scaling (a non-uniform stretch would otherwise
	 * distort it). By default the element's stroke-width is treated as units
	 * of the old 0–100 box and converted to screen pixels, so outlines keep
	 * the weight they had. Set false when stroke-width is already in pixels.
	 */
	legacyStroke?: boolean;
}

const PAD = 0.04; // breathing room around the shape, as a share of its longest side

export function fitPattern(node: SVGPathElement, params: FitPatternParams = {}) {
	let current = params;
	let frame = 0;
	const baseStroke = parseFloat(node.getAttribute('stroke-width') ?? '') || 0;

	function apply(retry = true) {
		const svg = node.ownerSVGElement;
		if (!svg) return;
		let box: DOMRect;
		try {
			box = node.getBBox(); // ignores the path's own transform — the raw shape
		} catch {
			return;
		}
		if (!box.width || !box.height) {
			// Not laid out yet (e.g. mounted inside a closed panel) — try once more.
			if (retry) frame = requestAnimationFrame(() => apply(false));
			return;
		}

		const w = current.w && current.w > 0 ? current.w : box.width;
		const h = current.h && current.h > 0 ? current.h : box.height;
		const sx = w / box.width;
		const sy = h / box.height;
		node.setAttribute(
			'transform',
			current.mirror
				? `matrix(${-sx} 0 0 ${sy} ${w + box.x * sx} ${-box.y * sy})`
				: `matrix(${sx} 0 0 ${sy} ${-box.x * sx} ${-box.y * sy})`,
		);
		node.setAttribute('vector-effect', 'non-scaling-stroke');

		const pad = Math.max(w, h) * PAD;
		svg.setAttribute('viewBox', `${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`);

		if (current.legacyStroke !== false && baseStroke) {
			const rect = svg.getBoundingClientRect();
			const px = baseStroke * (Math.min(rect.width, rect.height) / 100);
			node.setAttribute('stroke-width', String(Math.max(0.75, px)));
		}
	}

	apply();

	return {
		update(next: FitPatternParams) {
			current = next;
			cancelAnimationFrame(frame);
			apply();
		},
		destroy() {
			cancelAnimationFrame(frame);
		},
	};
}
